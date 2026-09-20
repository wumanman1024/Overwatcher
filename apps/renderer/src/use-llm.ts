import { useModels } from './use-models'

export type ChatRole = 'system' | 'user' | 'assistant'
export interface ChatMessage { role: ChatRole; content: string }

const missingBridge = () => new Error('AI 组件未加载，请重启应用')
const missingModel = () => new Error('尚未配置模型，请先在左下角「模型管理」中添加一个模型')

function requireModel() {
  const { activeModel } = useModels()
  const config = activeModel.value
  if (!config) throw missingModel()
  if (!window.llmTools) throw missingBridge()
  return config
}

function toMessages(input: ChatMessage[] | string): ChatMessage[] {
  return typeof input === 'string' ? [{ role: 'user', content: input }] : input
}

/** 非流式调用，返回完整文本。菜单 SQL 这类要一次性拿结构化结果的场景用这个。 */
export async function callLlm(input: ChatMessage[] | string): Promise<string> {
  const config = requireModel()
  const result = await window.llmTools!.chat({ config, messages: toMessages(input) })
  return result.content
}

/** 流式调用：onDelta 收到每一段增量，Promise 在结束时兑现为拼好的全文。 */
export function streamLlm(input: ChatMessage[] | string, onDelta: (delta: string) => void): Promise<string> {
  const config = requireModel()
  const stream = window.llmTools!.chatStream({ config, messages: toMessages(input) })
  return new Promise<string>((resolve, reject) => {
    let text = ''
    const unsubs: Array<() => void> = []
    const cleanup = () => { while (unsubs.length) unsubs.pop()?.() }
    unsubs.push(stream.onChunk((delta) => { text += delta; onDelta(delta) }))
    unsubs.push(stream.onDone(() => { cleanup(); resolve(text) }))
    unsubs.push(stream.onError((error) => { cleanup(); reject(new Error(error)) }))
  })
}
