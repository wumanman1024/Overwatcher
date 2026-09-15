<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SvgIcon from './components/SvgIcon.vue'

type CleanupTarget = { id: string; path: string }
type DeleteResult = { id: string; path?: string; success: boolean; error?: string }
type ExitIpResult = { ip: string; country: string; city: string; isp: string; timezone: string }
type ListeningProcess = { protocol: string; address: string; port: number; pid: number; name: string }
type NetworkDiagnosis = { host: string; port: number; addresses: string[]; ipv4: string[]; ipv6: string[]; tcp: { reachable: boolean; latencyMs?: number; error?: string }; http?: { reachable: boolean; status?: number; statusText?: string; latencyMs?: number; error?: string } }

declare global {
  interface Window {
    developerTools: {
      selectDirectory(): Promise<string | undefined>
      scanDirectories(rootPath: string, directoryName: string): Promise<CleanupTarget[]>
      deleteDirectories(ids: string[]): Promise<DeleteResult[]>
    }
    windowControls: {
      minimize(): void
      toggleMaximize(): void
      close(): void
      isMaximized(): Promise<boolean>
    }
    networkTools?: {
      detectExitIp(): Promise<ExitIpResult>
      diagnose(host: string, port: number, mode: 'tcp' | 'http' | 'https'): Promise<NetworkDiagnosis>
    }
    processTools?: {
      listListening(): Promise<ListeningProcess[]>
      terminate(pid: number): Promise<{ pid: number }>
    }
  }
}

type ToolView = 'portal' | 'cleanup' | 'json' | 'data-lab' | 'ip-check' | 'network-diagnosis' | 'ports'
type ToolCategory = 'all' | 'file' | 'data' | 'network'
const savedDefaultCategory = localStorage.getItem('localforge:default-category')
const initialCategory: ToolCategory = savedDefaultCategory === 'file' || savedDefaultCategory === 'data' || savedDefaultCategory === 'network' ? savedDefaultCategory : 'all'
const savedIndent = Number(localStorage.getItem('localforge:json-indent'))
const route = useRoute()
const router = useRouter()

const activeTool = ref<ToolView>('portal')
const activeCategory = ref<ToolCategory>(initialCategory)
const settingsOpen = ref(false)
const isMaximized = ref(false)
const defaultCategory = ref<ToolCategory>(initialCategory)
const rootPath = ref('')
const directoryName = ref('node_modules')
const targets = ref<CleanupTarget[]>([])
const selectedIds = ref<string[]>([])
const scanState = ref<'idle' | 'scanning' | 'deleting'>('idle')
const cleanupMessage = ref('选择一个项目或工作区目录后开始扫描。')
const deleteResults = ref<DeleteResult[]>([])

const sourceJson = ref('{\n  "hello": "developer toolbox"\n}')
const resultJson = ref('')
const jsonIndent = ref(savedIndent === 4 ? 4 : 2)
const jsonMessage = ref('在本地格式化 JSON，内容不会上传。')
const exitIp = ref<ExitIpResult>()
const ipCheckState = ref<'idle' | 'checking' | 'error'>('idle')
const ipCheckMessage = ref('检测会访问外部 IP 服务，以显示当前应用实际使用的出口地址。')
const dataSource = ref('')
const dataResult = ref('')
const dataMessage = ref('输入仅在本地转换，不会上传。')
const dataOperation = ref<'base64-encode' | 'base64-decode' | 'url-encode' | 'url-decode' | 'timestamp' | 'jwt'>('base64-encode')
const networkHost = ref('example.com')
const networkPort = ref(443)
const networkMode = ref<'tcp' | 'http' | 'https'>('https')
const networkDiagnosis = ref<NetworkDiagnosis>()
const networkDiagnosisState = ref<'idle' | 'checking' | 'error'>('idle')
const networkDiagnosisMessage = ref('解析 DNS，并测试指定 TCP 端口能否连通。')
const listeningProcesses = ref<ListeningProcess[]>([])
const portQuery = ref('')
const portState = ref<'idle' | 'loading' | 'terminating' | 'error'>('idle')
const portMessage = ref('查询当前 Windows 上正在监听的 TCP 端口。')

const isBusy = computed(() => scanState.value !== 'idle')
const allSelected = computed(() => targets.value.length > 0 && selectedIds.value.length === targets.value.length)
const filteredListeningProcesses = computed(() => {
  const query = portQuery.value.trim().toLowerCase()
  if (!query) return listeningProcesses.value
  return listeningProcesses.value.filter((process) => `${process.port} ${process.name} ${process.pid} ${process.address}`.toLowerCase().includes(query))
})
const successfulDeletes = computed(() => deleteResults.value.filter((item) => item.success).length)
const categories: Array<{ id: ToolCategory; label: string }> = [
  { id: 'all', label: '全部工具' },
  { id: 'file', label: '文件工具' },
  { id: 'data', label: '数据工具' },
  { id: 'network', label: '网络工具' }
]
const portalTools: Array<{ id: Exclude<ToolView, 'portal'>; category: Exclude<ToolCategory, 'all'>; title: string; description: string; state: string }> = [
  { id: 'cleanup', category: 'file', title: '批量清理目录', description: '递归扫描并清理 node_modules 或指定名称的目录。', state: '文件工具' },
  { id: 'json', category: 'data', title: 'JSON 格式化', description: '格式化、压缩、键排序与本地校验。', state: '数据工具' },
  { id: 'data-lab', category: 'data', title: '开发数据转换台', description: 'Base64、URL、时间戳与 JWT 的本地转换和解析。', state: '数据工具' },
  { id: 'ports', category: 'network', title: '端口与进程管理', description: '查看本机监听端口，并按需结束关联进程。', state: '网络工具' },
  { id: 'ip-check', category: 'network', title: 'IP 与代理检测', description: '检测当前出口公网 IP，确认代理或 VPN 是否实际生效。', state: '网络工具' },
  { id: 'network-diagnosis', category: 'network', title: '网络诊断', description: 'DNS 解析与 TCP 端口连通性检查。', state: '网络工具' }
]
const visiblePortalTools = computed(() => activeCategory.value === 'all'
  ? portalTools
  : portalTools.filter((tool) => tool.category === activeCategory.value))
const portalTitle = computed(() => categories.find((category) => category.id === activeCategory.value)?.label ?? '全部工具')
const showPortal = (category: ToolCategory) => router.push({ name: 'portal', query: { category } })
const openTool = (tool: Exclude<ToolView, 'portal'>) => router.push({ name: tool })
const backToPortal = () => router.push({ name: 'portal', query: { category: activeCategory.value } })
const openMonitor = () => (window as Window & { hardwareMonitor: { openPanel(): void } }).hardwareMonitor.openPanel()
const minimizeWindow = () => window.windowControls.minimize()
const toggleMaximizeWindow = async () => {
  window.windowControls.toggleMaximize()
  isMaximized.value = await window.windowControls.isMaximized()
}
const closeWindow = () => window.windowControls.close()
const saveSettings = () => {
  localStorage.setItem('localforge:default-category', defaultCategory.value)
  localStorage.setItem('localforge:json-indent', String(jsonIndent.value))
  settingsOpen.value = false
}
watch(() => route.name, (name) => {
  activeTool.value = name === 'cleanup' || name === 'json' || name === 'data-lab' || name === 'ip-check' || name === 'network-diagnosis' || name === 'ports' ? name : 'portal'
}, { immediate: true })
watch(() => route.query.category, (category) => {
  activeCategory.value = category === 'file' || category === 'data' || category === 'network' || category === 'all' ? category : initialCategory
}, { immediate: true })
void window.windowControls.isMaximized().then((value) => { isMaximized.value = value })

const chooseDirectory = async () => {
  const selected = await window.developerTools.selectDirectory()
  if (!selected) return
  rootPath.value = selected
  targets.value = []
  selectedIds.value = []
  deleteResults.value = []
  cleanupMessage.value = '目录已选择，点击“扫描”查找匹配项。'
}

const scan = async () => {
  if (!rootPath.value.trim()) {
    cleanupMessage.value = '请先选择扫描根目录。'
    return
  }
  scanState.value = 'scanning'
  deleteResults.value = []
  try {
    targets.value = await window.developerTools.scanDirectories(rootPath.value, directoryName.value)
    selectedIds.value = targets.value.map((target) => target.id)
    cleanupMessage.value = targets.value.length
      ? `已找到 ${targets.value.length} 个“${directoryName.value.trim()}”目录，请确认后删除。`
      : `没有找到名为“${directoryName.value.trim()}”的目录。`
  } catch (error) {
    targets.value = []
    selectedIds.value = []
    cleanupMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    scanState.value = 'idle'
  }
}

const toggleAll = () => {
  selectedIds.value = allSelected.value ? [] : targets.value.map((target) => target.id)
}

const deleteSelected = async () => {
  if (!selectedIds.value.length) {
    cleanupMessage.value = '请至少选择一个目录。'
    return
  }
  const count = selectedIds.value.length
  if (!window.confirm(`即将永久删除 ${count} 个“${directoryName.value.trim()}”目录。此操作不可撤销，是否继续？`)) return
  scanState.value = 'deleting'
  try {
    deleteResults.value = await window.developerTools.deleteDirectories(selectedIds.value)
    const deleted = new Set(deleteResults.value.filter((item) => item.success).map((item) => item.id))
    targets.value = targets.value.filter((item) => !deleted.has(item.id))
    selectedIds.value = selectedIds.value.filter((id) => !deleted.has(id))
    cleanupMessage.value = `删除完成：成功 ${successfulDeletes.value} 个，失败 ${deleteResults.value.length - successfulDeletes.value} 个。`
  } catch (error) {
    cleanupMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    scanState.value = 'idle'
  }
}

const parse = (): unknown => JSON.parse(sourceJson.value)
const formatJson = () => {
  try {
    resultJson.value = JSON.stringify(parse(), null, jsonIndent.value)
    jsonMessage.value = '格式化成功。'
  } catch (error) {
    jsonMessage.value = `JSON 无效：${error instanceof Error ? error.message : String(error)}`
  }
}
const minifyJson = () => {
  try {
    resultJson.value = JSON.stringify(parse())
    jsonMessage.value = '压缩成功。'
  } catch (error) {
    jsonMessage.value = `JSON 无效：${error instanceof Error ? error.message : String(error)}`
  }
}
const sortObject = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortObject)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sortObject(child)]))
  }
  return value
}
const sortJson = () => {
  try {
    resultJson.value = JSON.stringify(sortObject(parse()), null, jsonIndent.value)
    jsonMessage.value = '已按键名排序。'
  } catch (error) {
    jsonMessage.value = `JSON 无效：${error instanceof Error ? error.message : String(error)}`
  }
}
const copyResult = async () => {
  if (!resultJson.value) return
  await navigator.clipboard.writeText(resultJson.value)
  jsonMessage.value = '结果已复制到剪贴板。'
}
const unicodeToBase64 = (value: string) => btoa(Array.from(new TextEncoder().encode(value), (byte) => String.fromCharCode(byte)).join(''))
const base64ToUnicode = (value: string) => new TextDecoder().decode(Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (character) => character.charCodeAt(0)))
const runDataTransform = (operation: 'base64-encode' | 'base64-decode' | 'url-encode' | 'url-decode' | 'timestamp' | 'jwt') => {
  try {
    const input = dataSource.value.trim()
    if (!input) throw new Error('请输入要处理的内容')
    if (operation === 'base64-encode') dataResult.value = unicodeToBase64(dataSource.value)
    if (operation === 'base64-decode') dataResult.value = base64ToUnicode(input)
    if (operation === 'url-encode') dataResult.value = encodeURIComponent(dataSource.value)
    if (operation === 'url-decode') dataResult.value = decodeURIComponent(input)
    if (operation === 'timestamp') {
      const numeric = Number(input)
      const date = Number.isFinite(numeric) ? new Date(Math.abs(numeric) < 100_000_000_000 ? numeric * 1000 : numeric) : new Date(input)
      if (Number.isNaN(date.getTime())) throw new Error('无法识别时间戳或日期')
      dataResult.value = JSON.stringify({ local: date.toLocaleString(), iso: date.toISOString(), unixSeconds: Math.floor(date.getTime() / 1000), unixMilliseconds: date.getTime() }, null, 2)
    }
    if (operation === 'jwt') {
      const parts = input.split('.')
      if (parts.length < 2) throw new Error('JWT 至少应包含 Header 与 Payload')
      dataResult.value = JSON.stringify({ header: JSON.parse(base64ToUnicode(parts[0])), payload: JSON.parse(base64ToUnicode(parts[1])) }, null, 2)
    }
    dataMessage.value = operation === 'jwt' ? 'JWT 仅完成本地解码，不代表签名已验证。' : '转换完成。'
  } catch (error) {
    dataMessage.value = `处理失败：${error instanceof Error ? error.message : String(error)}`
  }
}
const copyDataResult = async () => {
  if (!dataResult.value) return
  await navigator.clipboard.writeText(dataResult.value)
  dataMessage.value = '结果已复制到剪贴板。'
}
const checkExitIp = async () => {
  if (!window.networkTools) {
    ipCheckState.value = 'error'
    ipCheckMessage.value = '网络检测组件刚刚更新，请完全退出并重新启动 LocalForge 后再试。'
    return
  }
  ipCheckState.value = 'checking'
  ipCheckMessage.value = '正在检测当前出口地址…'
  try {
    exitIp.value = await window.networkTools.detectExitIp()
    ipCheckState.value = 'idle'
    ipCheckMessage.value = '检测完成。这是 LocalForge 当前网络连接实际使用的出口 IP。'
  } catch (error) {
    exitIp.value = undefined
    ipCheckState.value = 'error'
    ipCheckMessage.value = error instanceof Error ? error.message : String(error)
  }
}
const runNetworkDiagnosis = async () => {
  if (!window.networkTools) return
  networkDiagnosisState.value = 'checking'
  networkDiagnosisMessage.value = '正在解析 DNS 并测试 TCP 连接…'
  try {
    networkDiagnosis.value = await window.networkTools.diagnose(networkHost.value, networkPort.value, networkMode.value)
    networkDiagnosisState.value = 'idle'
    networkDiagnosisMessage.value = networkDiagnosis.value.tcp.reachable ? '诊断完成，目标端口可以连接。' : `诊断完成，但目标端口不可连接：${networkDiagnosis.value.tcp.error ?? '未知原因'}`
  } catch (error) {
    networkDiagnosis.value = undefined
    networkDiagnosisState.value = 'error'
    networkDiagnosisMessage.value = error instanceof Error ? error.message : String(error)
  }
}
const refreshListeningProcesses = async () => {
  if (!window.processTools) return
  portState.value = 'loading'
  portMessage.value = '正在读取监听端口…'
  try {
    listeningProcesses.value = await window.processTools.listListening()
    portState.value = 'idle'
    portMessage.value = `已找到 ${listeningProcesses.value.length} 个监听端口。`
  } catch (error) {
    portState.value = 'error'
    portMessage.value = error instanceof Error ? error.message : String(error)
  }
}
const terminateProcess = async (process: ListeningProcess) => {
  if (!window.processTools) return
  if (!window.confirm(`将强制结束 ${process.name}（PID ${process.pid}），其子进程也会终止。是否继续？`)) return
  portState.value = 'terminating'
  try {
    await window.processTools.terminate(process.pid)
    portMessage.value = `已结束 ${process.name}（PID ${process.pid}）。`
    await refreshListeningProcesses()
  } catch (error) {
    portState.value = 'error'
    portMessage.value = error instanceof Error ? error.message : String(error)
  }
}
</script>

<template>
  <main class="toolbox-shell">
    <header class="toolbox-statusbar">
      <div class="toolbox-status-brand"><i><b></b><b></b><b></b></i><div><strong>LocalForge</strong><small>LOCAL DEVELOPER UTILITY</small></div></div>
      <div class="window-controls" aria-label="窗口控制">
        <button type="button" aria-label="最小化" title="最小化" @click="minimizeWindow"><SvgIcon name="window-minimize" /></button>
        <button type="button" :aria-label="isMaximized ? '还原窗口' : '最大化'" :title="isMaximized ? '还原窗口' : '最大化'" @click="toggleMaximizeWindow"><SvgIcon :name="isMaximized ? 'window-restore' : 'window-maximize'" /></button>
        <button class="window-control-close" type="button" aria-label="关闭" title="关闭" @click="closeWindow"><SvgIcon name="window-close" /></button>
      </div>
    </header>
    <div class="toolbox-main">
      <aside class="toolbox-sidebar">
        <div class="toolbox-brand"><span>⌘</span><div><p>TOOLS</p><h1>工具分类</h1></div></div>
        <nav aria-label="工具列表">
          <button v-for="category in categories" :key="category.id" :class="{ active: activeTool === 'portal' && activeCategory === category.id }" @click="showPortal(category.id)"><SvgIcon class="sidebar-icon" :name="category.id === 'all' ? 'dashboard' : category.id === 'file' ? 'folder' : category.id === 'data' ? 'code' : 'globe'" />{{ category.label }}</button>
        </nav>
        <div class="sidebar-actions">
          <button type="button" title="打开系统监控" aria-label="打开系统监控" @click="openMonitor"><SvgIcon name="monitor"/><span>系统监控</span></button>
          <button class="settings-action" type="button" title="打开设置" aria-label="打开设置" @click="settingsOpen = true"><SvgIcon name="settings"/><span>设置</span></button>
        </div>
        <p class="sidebar-note">LOCAL · SAFE · FAST</p>
      </aside>

      <section class="toolbox-content">
      <template v-if="activeTool === 'portal'">
        <header class="toolbox-heading"><p>LOCALFORGE / TOOL PORTAL</p><h2>{{ portalTitle }}</h2><span>选择一项工具开始工作，所有处理均在本机完成。</span></header>
        <section class="portal-list" :aria-label="`${portalTitle}列表`">
          <button v-for="tool in visiblePortalTools" :key="tool.id" class="portal-item" type="button" @click="openTool(tool.id)">
            <i class="portal-icon" :class="`portal-icon-${tool.id}`"><SvgIcon :name="tool.id === 'cleanup' ? 'trash' : tool.id === 'json' || tool.id === 'data-lab' ? 'code' : tool.id === 'ports' ? 'monitor' : 'globe'" /></i>
            <span class="portal-copy"><em>{{ tool.state }}</em><strong>{{ tool.title }}</strong><small>{{ tool.description }}</small></span>
            <b>›</b>
          </button>
          <p v-if="!visiblePortalTools.length" class="portal-empty">该分类暂时没有可用工具。</p>
        </section>
      </template>

      <template v-else-if="activeTool === 'cleanup'">
        <header class="toolbox-heading"><div><p>文件工具 / 安全清理</p><h2>批量清理目录</h2><span>递归查找指定名称的目录，先预览，再删除。</span></div><button class="back-button" @click="backToPortal">‹ 返回工具列表</button></header>
        <section class="cleanup-card">
          <label>扫描根目录</label>
          <div class="path-picker"><input v-model="rootPath" readonly placeholder="请选择项目或工作区目录"><button type="button" @click="chooseDirectory">选择目录</button></div>
          <label>要清理的目录名</label>
          <div class="scan-row"><input v-model="directoryName" :disabled="isBusy" placeholder="例如 node_modules"><button class="primary" type="button" :disabled="isBusy" @click="scan">{{ scanState === 'scanning' ? '扫描中…' : '开始扫描' }}</button></div>
          <p class="tool-message">{{ cleanupMessage }}</p>
        </section>
        <section v-if="targets.length || deleteResults.length" class="results-card">
          <div class="results-heading"><div><h3>扫描结果</h3><p>不会跟随符号链接，也不会删除扫描根目录本身。</p></div><button v-if="targets.length" class="danger" type="button" :disabled="isBusy || !selectedIds.length" @click="deleteSelected">{{ scanState === 'deleting' ? '删除中…' : `删除已选 ${selectedIds.length} 项` }}</button></div>
          <label v-if="targets.length" class="select-all"><input type="checkbox" :checked="allSelected" @change="toggleAll"> 全选（{{ targets.length }}）</label>
          <div v-if="targets.length" class="target-list">
            <label v-for="target in targets" :key="target.id" class="target-item"><input v-model="selectedIds" type="checkbox" :value="target.id"><code>{{ target.path }}</code></label>
          </div>
          <ul v-if="deleteResults.length" class="delete-report"><li v-for="result in deleteResults" :key="result.id" :class="{ failed: !result.success }">{{ result.success ? '✓' : '!' }} {{ result.path ?? result.id }}<small v-if="result.error">{{ result.error }}</small></li></ul>
        </section>
      </template>

      <template v-else-if="activeTool === 'json'">
        <header class="toolbox-heading"><div><p>数据工具 / JSON</p><h2>JSON 格式化与校验</h2><span>输入内容只在本地处理，不会发送到网络。</span></div><button class="back-button" @click="backToPortal">‹ 返回工具列表</button></header>
        <section class="json-actions"><label>缩进 <select v-model.number="jsonIndent"><option :value="2">2 空格</option><option :value="4">4 空格</option></select></label><button class="primary" @click="formatJson">格式化</button><button @click="minifyJson">压缩</button><button @click="sortJson">键排序</button><button :disabled="!resultJson" @click="copyResult">复制结果</button></section>
        <p class="tool-message">{{ jsonMessage }}</p>
        <section class="json-editors"><label>输入<textarea v-model="sourceJson" spellcheck="false" placeholder="粘贴 JSON 内容"></textarea></label><label>结果<textarea v-model="resultJson" spellcheck="false" readonly placeholder="格式化结果会出现在这里"></textarea></label></section>
      </template>

      <template v-else-if="activeTool === 'data-lab'">
        <header class="toolbox-heading"><div><p>数据工具 / 开发转换台</p><h2>开发数据转换台</h2><span>适合接口调试中的编码、时间与令牌内容检查，处理全程只在本机完成。</span></div><button class="back-button" @click="backToPortal">‹ 返回工具列表</button></header>
        <section class="json-actions data-actions"><label>转换方式 <select v-model="dataOperation"><option value="base64-encode">Base64 编码</option><option value="base64-decode">Base64 解码</option><option value="url-encode">URL 编码</option><option value="url-decode">URL 解码</option><option value="timestamp">解析时间戳</option><option value="jwt">解析 JWT</option></select></label><button class="primary" @click="runDataTransform(dataOperation)">执行转换</button><button :disabled="!dataResult" @click="copyDataResult">复制结果</button></section>
        <p class="tool-message">{{ dataMessage }}</p>
        <section class="json-editors"><label>输入<textarea v-model="dataSource" spellcheck="false" placeholder="粘贴文本、Base64、URL、时间戳或 JWT"></textarea></label><label>结果<textarea v-model="dataResult" spellcheck="false" readonly placeholder="转换结果会出现在这里"></textarea></label></section>
      </template>

      <template v-else-if="activeTool === 'ports'">
        <header class="toolbox-heading"><div><p>网络工具 / 本机进程</p><h2>端口与进程管理</h2><span>查看正在监听 TCP 端口的进程；结束进程前始终要求明确确认。</span></div><button class="back-button" @click="backToPortal">‹ 返回工具列表</button></header>
        <section class="network-form"><label>筛选端口、进程名或 PID<input v-model.trim="portQuery" placeholder="例如 5173、node、12345"></label><button class="primary" :disabled="portState === 'loading' || portState === 'terminating'" @click="refreshListeningProcesses">{{ portState === 'loading' ? '刷新中…' : '刷新端口列表' }}</button><p class="tool-message" :class="{ error: portState === 'error' }">{{ portMessage }}{{ portQuery ? ` 当前显示 ${filteredListeningProcesses.length} 项。` : '' }}</p></section>
        <section v-if="filteredListeningProcesses.length" class="results-card port-results"><div class="port-table"><div class="port-row port-head"><span>端口</span><span>地址</span><span>进程</span><span>操作</span></div><div v-for="process in filteredListeningProcesses" :key="`${process.protocol}-${process.address}-${process.port}-${process.pid}`" class="port-row"><code>{{ process.protocol }} :{{ process.port }}</code><code>{{ process.address }}</code><span>{{ process.name }} <small>PID {{ process.pid }}</small></span><button class="danger" :disabled="portState === 'terminating'" @click="terminateProcess(process)">结束进程</button></div></div></section>
      </template>

      <template v-else-if="activeTool === 'ip-check'">
        <header class="toolbox-heading"><div><p>网络工具 / 出口检测</p><h2>IP 与代理检测</h2><span>通过外部服务确认当前应用的实际出口公网 IP。</span></div><button class="back-button" @click="backToPortal">‹ 返回工具列表</button></header>
        <section class="ip-check-card">
          <div class="ip-check-intro"><i aria-hidden="true">◎</i><div><strong>当前网络出口</strong><span>启用系统代理或 VPN 后，检测结果应显示代理服务器的出口地址。</span></div><button class="primary" type="button" :disabled="ipCheckState === 'checking'" @click="checkExitIp">{{ ipCheckState === 'checking' ? '检测中…' : '检测出口 IP' }}</button></div>
          <p class="tool-message" :class="{ error: ipCheckState === 'error' }">{{ ipCheckMessage }}</p>
          <dl v-if="exitIp" class="ip-result"><div class="ip-result-primary"><dt>出口 IP</dt><dd>{{ exitIp.ip }}</dd></div><div><dt>国家或地区</dt><dd>{{ exitIp.country || '未提供' }}</dd></div><div><dt>城市</dt><dd>{{ exitIp.city || '未提供' }}</dd></div><div><dt>网络服务商</dt><dd>{{ exitIp.isp || '未提供' }}</dd></div><div><dt>时区</dt><dd>{{ exitIp.timezone || '未提供' }}</dd></div></dl>
        </section>
      </template>

      <template v-else-if="activeTool === 'network-diagnosis'">
        <header class="toolbox-heading"><div><p>网络工具 / DNS 与 TCP</p><h2>网络诊断</h2><span>检查域名解析结果，并从本机测试指定 TCP 端口的连通性。</span></div><button class="back-button" @click="backToPortal">‹ 返回工具列表</button></header>
        <section class="network-form"><label>域名或 IP<input v-model.trim="networkHost" placeholder="例如 api.example.com"></label><label>端口<input v-model.number="networkPort" type="number" min="1" max="65535"></label><label>探测方式<select v-model="networkMode"><option value="tcp">TCP（Telnet 类）</option><option value="http">HTTP</option><option value="https">HTTPS</option></select></label><button class="primary" :disabled="networkDiagnosisState === 'checking'" @click="runNetworkDiagnosis">{{ networkDiagnosisState === 'checking' ? '诊断中…' : '开始诊断' }}</button></section>
        <p class="tool-message" :class="{ error: networkDiagnosisState === 'error' }">{{ networkDiagnosisMessage }}</p>
        <section v-if="networkDiagnosis" class="results-card diagnosis-results"><div><h3>DNS 解析</h3><p>{{ networkDiagnosis.addresses.join(' · ') || '未返回地址' }}</p></div><div><h3>IPv4 记录</h3><p>{{ networkDiagnosis.ipv4.join(' · ') || '未返回记录' }}</p></div><div><h3>IPv6 记录</h3><p>{{ networkDiagnosis.ipv6.join(' · ') || '未返回记录' }}</p></div><div><h3>TCP {{ networkDiagnosis.port }}</h3><p :class="{ 'network-failed': !networkDiagnosis.tcp.reachable }">{{ networkDiagnosis.tcp.reachable ? `连接成功 · ${networkDiagnosis.tcp.latencyMs} ms` : `无法连接 · ${networkDiagnosis.tcp.error}` }}</p></div><div v-if="networkDiagnosis.http"><h3>{{ networkMode.toUpperCase() }} 请求</h3><p :class="{ 'network-failed': !networkDiagnosis.http.reachable }">{{ networkDiagnosis.http.reachable ? `${networkDiagnosis.http.status} ${networkDiagnosis.http.statusText} · ${networkDiagnosis.http.latencyMs} ms` : `请求失败 · ${networkDiagnosis.http.error}` }}</p></div></section>
      </template>

      </section>
    </div>
    <div v-if="settingsOpen" class="settings-backdrop" @click.self="settingsOpen = false">
      <section class="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header><div><p>LOCALFORGE / PREFERENCES</p><h2 id="settings-title">设置</h2></div><button type="button" aria-label="关闭设置" @click="settingsOpen = false"><SvgIcon name="window-close" /></button></header>
        <label>默认打开分类<select v-model="defaultCategory"><option v-for="category in categories" :key="category.id" :value="category.id">{{ category.label }}</option></select></label>
        <label>JSON 默认缩进<select v-model.number="jsonIndent"><option :value="2">2 空格</option><option :value="4">4 空格</option></select></label>
        <p>偏好设置仅保存在当前设备。系统监控可通过左下角快捷入口随时打开。</p>
        <footer><button type="button" @click="settingsOpen = false">取消</button><button class="primary" type="button" @click="saveSettings">保存设置</button></footer>
      </section>
    </div>
  </main>
</template>
