import { ipcMain, net as electronNet } from 'electron'
import { normalizeModelConfig } from '@localforge/shared/model-config'
import type { LlmChatRequest, LlmChatResult, LlmTestResult, ModelConfig } from '@localforge/shared/model-config'

/*
 * 大模型调用的主进程转发层。渲染层 CSP 的 connect-src 只允许 self，无法直连模型服务，
 * 所有 HTTP 都必须从这里出去（与 network:detect-exit-ip 同一套路）。
 *
 * 这一层刻意保持无状态：模型地址、模型标识、API Key 全部由渲染层从 localStorage 读出来后
 * 随请求传进来，主进程不落盘、也不内置任何服务地址或模型名，因此源码里不会出现任何具体环境的信息。
 */

const CHAT_PATH = '/chat/completions'
const MODELS_PATH = '/models'
const DEFAULT_TIMEOUT_MS = 120_000

interface ChatStreamEvent { requestId: string; delta?: string; error?: string; finishReason?: string }

const endpoint = (baseUrl: string, path: string) => `${baseUrl.replace(/\/+$/, '')}${path}`

const authHeaders = (config: ModelConfig): Record<string, string> =>
  config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}

/** 由思考强度决定请求体：off 走 chat_template_kwargs 关思考，其余透传 vLLM 的 reasoning_effort。 */
function applyEffort(body: Record<string, unknown>, config: ModelConfig): void {
  if (config.effort === 'off') body.chat_template_kwargs = { enable_thinking: false }
  else body.reasoning_effort = config.effort
  if (config.maxTokens) body.max_tokens = config.maxTokens
}

function assertChatRequest(request: unknown): LlmChatRequest {
  const { config, messages } = request as { config?: unknown; messages?: unknown }
  const normalized = normalizeModelConfig(config)
  if (!normalized) throw new Error('模型配置无效，请在「模型管理」中检查服务地址、模型标识等字段')
  if (!Array.isArray(messages) || !messages.length) throw new Error('没有待发送的对话内容')
  const sanitized = messages.map((message): LlmChatRequest['messages'][number] => {
    const { role, content } = message as { role?: unknown; content?: unknown }
    if (role !== 'system' && role !== 'user' && role !== 'assistant') throw new Error('对话角色只能是 system/user/assistant')
    if (typeof content !== 'string' || !content.trim()) throw new Error('对话内容不能为空')
    return { role, content }
  })
  return { config: normalized, messages: sanitized }
}

function assertConfigOnly(request: unknown): ModelConfig {
  const { config } = request as { config?: unknown }
  const normalized = normalizeModelConfig(config)
  if (!normalized) throw new Error('模型配置无效，请在「模型管理」中检查服务地址、模型标识等字段')
  return normalized
}

const timeoutOf = (config: ModelConfig) => AbortSignal.timeout(config.timeoutMs || DEFAULT_TIMEOUT_MS)

/** 把 fetch/读流的异常翻译成人话：AbortSignal.timeout 触发的是 TimeoutError/AbortError，原样抛出只有 "This operation was aborted"，用户无从下手。 */
const friendlyFetchError = (config: ModelConfig, error: unknown): Error => {
  const name = error instanceof Error || error instanceof DOMException ? (error as { name?: string }).name ?? '' : ''
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new Error(`模型服务在 ${Math.round((config.timeoutMs || DEFAULT_TIMEOUT_MS) / 1000)} 秒内未返回完整结果，可在「模型管理」调大超时时间、把思考强度调低，或减少一次生成的节点数`)
  }
  return new Error(`连接模型服务失败：${error instanceof Error ? error.message : String(error)}`)
}

/** 连通性测试：打 /models 列出可用模型，供界面上的状态灯使用。 */
async function testConnection(config: ModelConfig): Promise<LlmTestResult> {
  try {
    const response = await electronNet.fetch(endpoint(config.baseUrl, MODELS_PATH), { headers: authHeaders(config), signal: timeoutOf(config) })
    if (!response.ok) return { ok: false, error: `服务响应异常（${response.status}）` }
    const payload = await response.json() as { data?: unknown }
    const count = Array.isArray(payload.data) ? payload.data.length : undefined
    return { ok: true, ...(count === undefined ? {} : { count }) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function chat(payload: unknown): Promise<LlmChatResult> {
  const { config, messages } = assertChatRequest(payload)
  const body: Record<string, unknown> = { model: config.modelId, messages, temperature: config.temperature, stream: false }
  applyEffort(body, config)
  let response: Response
  try {
    response = await electronNet.fetch(endpoint(config.baseUrl, CHAT_PATH), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(config) },
      body: JSON.stringify(body),
      signal: timeoutOf(config)
    })
  } catch (error) {
    throw new Error(`连接模型服务失败：${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`模型服务响应异常（${response.status}）${detail ? `：${detail.slice(0, 300)}` : ''}`)
  }
  const result = await response.json() as { choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }> }
  // 只取 content，忽略 vLLM 并行返回的 reasoning 字段（思考过程不参与最终结果）。
  const message = result.choices?.[0]?.message
  const content = typeof message?.content === 'string' ? message.content : ''
  if (!content.trim()) throw new Error('模型没有返回内容，可降低思考强度或缩短输入后重试')
  return { content, finishReason: typeof result.choices?.[0]?.finish_reason === 'string' ? result.choices[0].finish_reason : undefined }
}

/** 逐行吃 SSE：按空行分帧，攒 buffer 处理半包，遇 [DONE] 收尾。 */
function createSseParser(onDelta: (text: string) => void, onFinish: (reason?: string) => void) {
  let buffer = ''
  return (chunk: string): void => {
    buffer += chunk
    let boundary = buffer.indexOf('\n\n')
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      boundary = buffer.indexOf('\n\n')
      const dataLine = frame.split('\n').find((line) => line.startsWith('data:'))
      if (!dataLine) continue
      const data = dataLine.slice(5).trim()
      if (data === '[DONE]') { onFinish(); return }
      try {
        const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: unknown }; finish_reason?: unknown }> }
        const delta = parsed.choices?.[0]?.delta?.content
        if (typeof delta === 'string' && delta) onDelta(delta)
        const reason = parsed.choices?.[0]?.finish_reason
        if (typeof reason === 'string') onFinish(reason)
      } catch {
        // 单个数据帧解析失败就跳过，不中断整条流（某些服务会发心跳注释行）。
      }
    }
  }
}

async function chatStream(event: Electron.IpcMainEvent, payload: unknown): Promise<void> {
  const { requestId } = payload as { requestId?: unknown }
  if (typeof requestId !== 'string' || !requestId) return
  const emit = (channel: 'llm:chunk' | 'llm:done' | 'llm:error', body: ChatStreamEvent) => {
    if (!event.sender.isDestroyed()) event.sender.send(channel, body)
  }
  try {
    const { config, messages } = assertChatRequest(payload)
    const body: Record<string, unknown> = { model: config.modelId, messages, temperature: config.temperature, stream: true }
    applyEffort(body, config)
    const response = await electronNet.fetch(endpoint(config.baseUrl, CHAT_PATH), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream', ...authHeaders(config) },
      body: JSON.stringify(body),
      signal: timeoutOf(config)
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`模型服务响应异常（${response.status}）${detail ? `：${detail.slice(0, 300)}` : ''}`)
    }
    if (!response.body) throw new Error('模型服务没有返回可读取的数据流')
    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let finished = false
    const consume = createSseParser(
      (delta) => emit('llm:chunk', { requestId, delta }),
      (finishReason) => { if (!finished) { finished = true; emit('llm:done', { requestId, finishReason }) } }
    )
    // stream:true 让多字节的中文按 UTF-8 增量解码，避免半个汉字变成乱码。
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      consume(decoder.decode(value, { stream: true }))
    }
    consume(decoder.decode())
    if (!finished) emit('llm:done', { requestId })
  } catch (error) {
    emit('llm:error', { requestId, error: error instanceof Error ? error.message : String(error) })
  }
}

export function registerLlmIpc(): void {
  ipcMain.handle('llm:test', (_event, request: unknown) => testConnection(assertConfigOnly(request)))
  ipcMain.handle('llm:chat', (_event, request: unknown) => chat(request))
  ipcMain.on('llm:chat-stream', (event, request: unknown) => { void chatStream(event, request) })
}
