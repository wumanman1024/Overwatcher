<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import QRCode from 'qrcode'
import jsQR from 'jsqr'
import YAML from 'yaml'
import toml from 'smol-toml'
import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser'
import CryptoJS from 'crypto-js'
import { sm2, sm3, sm4 } from 'sm-crypto'
import { ElMessage } from 'element-plus'
import SvgIcon from './components/SvgIcon.vue'

type CleanupTarget = { id: string; path: string }
type DeleteResult = { id: string; path?: string; success: boolean; error?: string }
type ExitIpResult = { ip: string; country: string; city: string; isp: string; timezone: string }
type LocalIpv4 = { name: string; address: string }
type ListeningProcess = { protocol: string; address: string; port: number; pid: number; name: string }
type NetworkDiagnosis = { host: string; port: number; addresses: string[]; ipv4: string[]; ipv6: string[]; tcp: { reachable: boolean; latencyMs?: number; error?: string }; http?: { reachable: boolean; status?: number; statusText?: string; latencyMs?: number; error?: string } }
type BatchImage = { id: string; file: File; status: 'waiting' | 'compressing' | 'ready' | 'failed'; resultSize?: number; error?: string; outputName?: string }
type VoltaNodeState = { installed: boolean; voltaVersion?: string; versions: Array<{ version: string; isDefault: boolean }>; defaultVersion?: string; currentVersion?: string; error?: string }
type NvmNodeState = { installed: boolean; nvmVersion?: string; versions: Array<{ version: string; isCurrent: boolean }>; currentVersion?: string; error?: string }
type NodeRelease = { version: string; channel: 'CURRENT' | 'LTS' | 'OLD STABLE' | 'OLD UNSTABLE' }
type AssistantPromptTool = 'codex' | 'cursor' | 'claude-code'
type AssistantConfigFile = 'prompt' | 'config'
type AssistantConfigResult = { path: string; exists: boolean; content: string }

declare global {
  interface Window {
    developerTools: {
      selectDirectory(): Promise<string | undefined>
      scanDirectories(rootPath: string, directoryName: string): Promise<CleanupTarget[]>
      deleteDirectories(ids: string[]): Promise<DeleteResult[]>
      selectImageOutputDirectory(): Promise<string | undefined>
      saveCompressedImages(outputDirectory: string, files: Array<{ name: string; data: ArrayBuffer }>): Promise<{ directory: string; files: string[] }>
    }
    windowControls: {
      minimize(): void
      toggleMaximize(): void
      close(): void
      isMaximized(): Promise<boolean>
    }
    networkTools?: {
      getLocalIpv4(): Promise<{ lan: LocalIpv4[]; wired: LocalIpv4[] }>
      detectExitIp(): Promise<ExitIpResult>
      diagnose(host: string, port: number, mode: 'tcp' | 'http' | 'https'): Promise<NetworkDiagnosis>
    }
    processTools?: {
      listListening(): Promise<ListeningProcess[]>
      terminate(pid: number): Promise<{ pid: number }>
    }
    voltaTools?: {
      getNodeState(): Promise<VoltaNodeState>
      installNode(version: string): Promise<VoltaNodeState>
      pinNode(version: string, directory: string): Promise<{ directory: string; version: string }>
    }
    nvmTools?: {
      getNodeState(): Promise<NvmNodeState>
      installNode(version: string): Promise<NvmNodeState>
      useNode(version: string): Promise<NvmNodeState>
      uninstallNode(version: string): Promise<NvmNodeState>
    }
    nodeReleaseTools?: {
      list(): Promise<NodeRelease[]>
      installManager(manager: 'volta' | 'nvm'): Promise<VoltaNodeState | NvmNodeState>
    }
    assistantConfig?: {
      read(tool: AssistantPromptTool, file: AssistantConfigFile): Promise<AssistantConfigResult>
      save(tool: AssistantPromptTool, file: AssistantConfigFile, content: string): Promise<{ path: string }>
    }
  }
}

type ToolView = 'portal' | 'cleanup' | 'json' | 'data-lab' | 'stats' | 'radix' | 'bytes' | 'crypto' | 'diff' | 'convert' | 'color' | 'image-compress' | 'image-crop' | 'background-remove' | 'screen-color' | 'qrcode' | 'ip-check' | 'network-diagnosis' | 'ports' | 'volta' | 'nvm' | 'assistant-prompt'
type ToolCategory = 'all' | 'file' | 'data' | 'network' | 'design'
const props = defineProps<{ tool: ToolView }>()
const savedDefaultCategory = localStorage.getItem('localforge:default-category')
const initialCategory: ToolCategory = savedDefaultCategory === 'file' || savedDefaultCategory === 'data' || savedDefaultCategory === 'network' || savedDefaultCategory === 'design' ? savedDefaultCategory : 'all'
const savedIndent = Number(localStorage.getItem('localforge:json-indent'))
const route = useRoute()
const router = useRouter()

const activeTool = ref<ToolView>(props.tool)
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
const localIpv4 = ref<{ lan: LocalIpv4[]; wired: LocalIpv4[] }>({ lan: [], wired: [] })
const localIpv4Message = ref('正在读取…')
const exitIp = ref<ExitIpResult>()
const ipCheckState = ref<'idle' | 'checking' | 'error'>('idle')
const ipCheckMessage = ref('检测会访问外部 IP 服务，以显示当前应用实际使用的出口地址。')
const dataSource = ref('')
const dataResult = ref('')
const dataMessage = ref('输入仅在本地转换，不会上传。')
const dataOperation = ref<'base64-encode' | 'base64-decode' | 'url-encode' | 'url-decode' | 'timestamp' | 'jwt'>('base64-encode')
const statsSource = ref('LocalForge 本地开发者工具箱')
const radixSource = ref('255')
const radixFrom = ref(10)
const radixTo = ref(16)
const radixResult = ref('FF')
const radixMessage = ref('支持 2 至 36 进制的整数转换。')
const byteSource = ref('1024')
const byteUnit = ref<'B' | 'KB' | 'MB' | 'GB' | 'TB'>('KB')
const byteResult = ref<Array<{ unit: string; value: string }>>([])
const byteMessage = ref('支持任意长度的非负整数，结果保留最多 6 位小数且不会丢失精度。')
const cryptoAlgorithm = ref<'md5' | 'sha256' | 'sm3' | 'aes' | 'sm4' | 'sm2'>('md5')
const cryptoOperation = ref<'encrypt' | 'decrypt'>('encrypt')
const cryptoSource = ref('LocalForge')
const cryptoKey = ref('')
const cryptoMode = ref<'ecb' | 'cbc'>('cbc')
const cryptoIv = ref('')
const cryptoPadding = ref<'pkcs7' | 'none'>('pkcs7')
const sm2CipherMode = ref<0 | 1>(1)
const sm3Key = ref('')
const cryptoPublicKey = ref('')
const cryptoPrivateKey = ref('')
const cryptoResult = ref('')
const cryptoMessage = ref('MD5、SHA-256、SM3 为摘要算法；AES、SM4、SM2 支持本地加解密。')
const diffLeft = ref('name: LocalForge\nversion: 1')
const diffRight = ref('name: LocalForge\nversion: 2\nlocal: true')
const convertSource = ref('{\n  "name": "LocalForge",\n  "local": true\n}')
const convertResult = ref('')
const convertFrom = ref<'json' | 'yaml' | 'toml' | 'xml'>('json')
const convertTo = ref<'json' | 'yaml' | 'toml' | 'xml'>('yaml')
const convertMessage = ref('选择输入与输出格式后转换；所有内容仅在本机处理。')
const qrText = ref('https://localforge.app')
const qrImage = ref('')
const qrMessage = ref('输入文本或 URL 后生成二维码，也可选择图片识别二维码。')
const qrInput = ref<HTMLInputElement>()
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
const voltaState = ref<VoltaNodeState>()
const voltaVersionInput = ref('')
const voltaSelectedVersion = ref('')
const voltaProjectPath = ref('')
const voltaBusy = ref(false)
const voltaMessage = ref('读取本机 Volta 的 Node 工具链状态。')
const nvmState = ref<NvmNodeState>()
const nvmVersionInput = ref('')
const nvmBusy = ref(false)
const nvmMessage = ref('读取本机 NVM 的 Node 版本列表。')
const nodeReleases = ref<NodeRelease[]>([])
const nodeReleasesBusy = ref(false)
const showAllNvmReleases = ref(false)
const nodeReleasesMessage = ref('通过 NVM 命令读取可安装版本。默认仅显示 LTS。')
const managerInstallBusy = ref<'volta' | 'nvm'>()
const assistantPromptTool = ref<AssistantPromptTool>('codex')
const assistantConfigFile = ref<AssistantConfigFile>('prompt')
const assistantConfigContent = ref('')
const assistantConfigPath = ref('')
const assistantConfigExists = ref(false)
const assistantConfigBusy = ref(false)
const assistantConfigMessage = ref('选择助手和文件后读取本机全局配置。')
const colorHex = ref('#16a34a')
const colorMessage = ref('输入或选择颜色，即可获得不同格式的颜色值。')
const imageInput = ref<HTMLInputElement>()
const imageBatchInput = ref<HTMLInputElement>()
const imageFolderInput = ref<HTMLInputElement>()
const imagePreviewUrl = ref('')
const imageFile = ref<File>()
const imageInfo = ref<{ width: number; height: number }>()
const imageMessage = ref('选择一张本地图片后，可预览并导出 PNG 或 JPEG。')
const imageCrop = ref({ x: 0, y: 0, width: 0, height: 0 })
const imageOutputType = ref<'original' | 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml'>('original')
const imageQuality = ref(82)
const imageScale = ref(100)
const compressedImage = ref<{ url: string; blob: Blob; format: string }>()
const imageCompressing = ref(false)
const imageBatch = ref<BatchImage[]>([])
const imageBatchMessage = ref('可选择多张图片或一个图片文件夹，压缩后将统一导出到新文件夹。')
const backgroundTolerance = ref(36)
const imageSampleColor = ref('')
const imageProcessing = ref(false)
const eyeDropperSupported = 'EyeDropper' in window

const isBusy = computed(() => scanState.value !== 'idle')
const allSelected = computed(() => targets.value.length > 0 && selectedIds.value.length === targets.value.length)
const filteredListeningProcesses = computed(() => {
  const query = portQuery.value.trim().toLowerCase()
  if (!query) return listeningProcesses.value
  return listeningProcesses.value.filter((process) => `${process.port} ${process.name} ${process.pid} ${process.address}`.toLowerCase().includes(query))
})
const latestLtsNodeReleases = computed(() => {
  const majors = new Set<string>()
  return nodeReleases.value.filter((release) => {
    if (release.channel !== 'LTS') return false
    const major = release.version.split('.')[0]
    if (majors.has(major)) return false
    majors.add(major)
    return true
  })
})
const visibleNodeReleases = computed(() => showAllNvmReleases.value ? nodeReleases.value : latestLtsNodeReleases.value)
const voltaDownloadableReleases = latestLtsNodeReleases
const successfulDeletes = computed(() => deleteResults.value.filter((item) => item.success).length)
const categories: Array<{ id: ToolCategory; label: string }> = [
  { id: 'all', label: '全部工具' },
  { id: 'file', label: '文件工具' },
  { id: 'data', label: '数据工具' },
  { id: 'design', label: '设计工具' },
  { id: 'network', label: '网络工具' }
]
const portalTools: Array<{ id: Exclude<ToolView, 'portal'>; category: Exclude<ToolCategory, 'all'>; title: string; description: string; state: string }> = [
  { id: 'cleanup', category: 'file', title: '批量清理目录', description: '递归扫描并清理 node_modules 或指定名称的目录。', state: '文件工具' },
  { id: 'json', category: 'data', title: 'JSON 格式化', description: '格式化、压缩、键排序与本地校验。', state: '数据工具' },
  { id: 'data-lab', category: 'data', title: '开发数据转换台', description: 'Base64、URL、时间戳与 JWT 的本地转换和解析。', state: '数据工具' },
  { id: 'stats', category: 'data', title: '字数统计', description: '统计字符、汉字、英文词、数字、行数与 UTF-8 字节数。', state: '数据工具' },
  { id: 'radix', category: 'data', title: '进制转换', description: '在 2 到 36 进制之间转换任意精度整数。', state: '数据工具' },
  { id: 'bytes', category: 'data', title: '字节单位转换', description: '在 B、KB、MB、GB、TB 间快速换算。', state: '数据工具' },
  { id: 'crypto', category: 'data', title: '加解密工作台', description: 'MD5、SHA-256、AES 与国密 SM2、SM3、SM4。', state: '数据工具' },
  { id: 'diff', category: 'data', title: '文本差异对比', description: '逐行比较两段文本，快速查看新增、删除和未变内容。', state: '数据工具' },
  { id: 'convert', category: 'data', title: '配置格式转换', description: '在 JSON、YAML、TOML 与 XML 之间本地转换。', state: '数据工具' },
  { id: 'color', category: 'design', title: '颜色转换器', description: '在 HEX、RGB 与 HSL 之间转换，并一键复制颜色值。', state: '设计工具' },
  { id: 'image-compress', category: 'design', title: 'TinyPNG 图片压缩', description: '批量压缩图片、统一转换格式并导出至新文件夹。', state: '设计工具' },
  { id: 'image-crop', category: 'design', title: '图片裁剪', description: '按像素精确裁剪本地图片，并下载裁剪结果。', state: '设计工具' },
  { id: 'background-remove', category: 'design', title: '背景透明化', description: '根据四角颜色移除纯色或近似纯色背景。', state: '设计工具' },
  { id: 'screen-color', category: 'design', title: '屏幕取色', description: '从屏幕任意位置吸取颜色并复制 HEX 值。', state: '设计工具' },
  { id: 'qrcode', category: 'design', title: '二维码工具', description: '在本地生成二维码，并识别图片中的二维码内容。', state: '设计工具' },
  { id: 'ports', category: 'network', title: '端口与进程管理', description: '查看本机监听端口，并按需结束关联进程。', state: '网络工具' },
  { id: 'ip-check', category: 'network', title: 'IP 与代理检测', description: '检测当前出口公网 IP，确认代理或 VPN 是否实际生效。', state: '网络工具' },
  { id: 'network-diagnosis', category: 'network', title: '网络诊断', description: 'DNS 解析与 TCP 端口连通性检查。', state: '网络工具' },
  { id: 'volta', category: 'data', title: 'Volta Node 管理', description: '查看、安装默认 Node 版本，或为项目固定版本。', state: '数据工具' },
  { id: 'nvm', category: 'data', title: 'NVM Node 管理', description: '查看可下载版本、安装、切换或移除 NVM Node。', state: '数据工具' },
  { id: 'assistant-prompt', category: 'data', title: 'AI 提示词与配置', description: '编辑 Codex、Cursor、Claude Code 的全局提示词和配置文件。', state: '数据工具' }
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
const assistantToolLabel = computed(() => ({ codex: 'Codex', cursor: 'Cursor', 'claude-code': 'Claude Code' })[assistantPromptTool.value])
const assistantFileLabel = computed(() => assistantConfigFile.value === 'prompt' ? '全局提示词' : '配置文件')
const loadAssistantConfig = async () => {
  if (!window.assistantConfig) { assistantConfigMessage.value = '请重启应用以加载 AI 配置组件'; return }
  assistantConfigBusy.value = true
  try {
    const result = await window.assistantConfig.read(assistantPromptTool.value, assistantConfigFile.value)
    assistantConfigContent.value = result.content
    assistantConfigPath.value = result.path
    assistantConfigExists.value = result.exists
    assistantConfigMessage.value = result.exists ? `已读取 ${assistantFileLabel.value}。` : '文件尚不存在；保存后会在对应全局目录创建。'
  } catch (error) {
    assistantConfigMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    assistantConfigBusy.value = false
  }
}
const saveAssistantConfig = async () => {
  if (!window.assistantConfig) return
  const action = assistantConfigExists.value ? '覆盖保存' : '创建并保存'
  if (!window.confirm(`确认${action} ${assistantToolLabel.value} 的${assistantFileLabel.value}吗？`)) return
  assistantConfigBusy.value = true
  try {
    const result = await window.assistantConfig.save(assistantPromptTool.value, assistantConfigFile.value, assistantConfigContent.value)
    assistantConfigPath.value = result.path
    assistantConfigExists.value = true
    assistantConfigMessage.value = `已保存到 ${result.path}`
    ElMessage.success({ message: '已保存全局配置', duration: 1_800 })
  } catch (error) {
    assistantConfigMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    assistantConfigBusy.value = false
  }
}
const refreshLocalIpv4 = async () => {
  if (!window.networkTools?.getLocalIpv4) {
    localIpv4Message.value = '请重启应用以加载网络组件'
    return
  }
  try {
    localIpv4.value = await window.networkTools.getLocalIpv4()
    localIpv4Message.value = localIpv4.value.lan.length ? '' : '未发现活动网卡'
  } catch {
    localIpv4.value = { lan: [], wired: [] }
    localIpv4Message.value = '本机 IPv4 读取失败'
  }
}
const copyLocalIpv4 = async (address: string) => {
  await navigator.clipboard.writeText(address)
  ElMessage.success({ message: `已复制 ${address}`, duration: 1_800 })
}
void refreshLocalIpv4()
const saveSettings = () => {
  localStorage.setItem('localforge:default-category', defaultCategory.value)
  localStorage.setItem('localforge:json-indent', String(jsonIndent.value))
  settingsOpen.value = false
}
watch(() => props.tool, (tool) => {
  activeTool.value = tool
  if (tool === 'assistant-prompt') void loadAssistantConfig()
}, { immediate: true })
watch(() => route.query.category, (category) => {
  activeCategory.value = category === 'file' || category === 'data' || category === 'network' || category === 'design' || category === 'all' ? category : initialCategory
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
const textStats = computed(() => {
  const text = statsSource.value
  return {
    characters: Array.from(text).length,
    noWhitespace: Array.from(text.replace(/\s/g, '')).length,
    chinese: (text.match(/[\u3400-\u9fff]/g) ?? []).length,
    words: (text.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) ?? []).length,
    numbers: (text.match(/\d/g) ?? []).length,
    lines: text ? text.split(/\r?\n/).length : 0,
    bytes: new TextEncoder().encode(text).length
  }
})
const copyTextStats = async () => {
  const stats = textStats.value
  await navigator.clipboard.writeText([
    `字符数: ${stats.characters}`,
    `非空白字符: ${stats.noWhitespace}`,
    `汉字: ${stats.chinese}`,
    `英文词: ${stats.words}`,
    `数字: ${stats.numbers}`,
    `行数: ${stats.lines}`,
    `UTF-8 字节: ${stats.bytes}`
  ].join('\n'))
}
const parseRadixInteger = (source: string, radix: number): bigint => {
  const normalized = source.trim().toLowerCase()
  if (!normalized) throw new Error('请输入整数')
  const negative = normalized.startsWith('-')
  const digits = negative || normalized.startsWith('+') ? normalized.slice(1) : normalized
  if (!digits) throw new Error('请输入有效整数')
  let value = 0n
  for (const character of digits) {
    const digit = Number.parseInt(character, 36)
    if (!Number.isInteger(digit) || digit >= radix) throw new Error(`“${character}”不属于 ${radix} 进制`)
    value = value * BigInt(radix) + BigInt(digit)
  }
  return negative ? -value : value
}
const convertRadix = () => {
  try {
    if (radixFrom.value < 2 || radixFrom.value > 36 || radixTo.value < 2 || radixTo.value > 36) throw new Error('进制范围必须是 2 到 36')
    radixResult.value = parseRadixInteger(radixSource.value, radixFrom.value).toString(radixTo.value).toUpperCase()
    radixMessage.value = `已转换为 ${radixTo.value} 进制。`
  } catch (error) { radixMessage.value = `转换失败：${error instanceof Error ? error.message : String(error)}` }
}
const copyRadixResult = async () => {
  if (!radixResult.value) return
  await navigator.clipboard.writeText(radixResult.value)
  radixMessage.value = '转换结果已复制到剪贴板。'
}
const byteUnits = ['B', 'KB', 'MB', 'GB', 'TB'] as const
const formatByteValue = (bytes: bigint, unitIndex: number) => {
  const divisor = 1024n ** BigInt(unitIndex)
  const whole = bytes / divisor
  const remainder = bytes % divisor
  if (!remainder) return whole.toString()
  const fraction = (remainder * 1_000_000n / divisor).toString().padStart(6, '0').replace(/0+$/, '')
  return `${whole}.${fraction}`
}
const convertBytes = () => {
  try {
    if (!/^\d+$/.test(byteSource.value.trim())) throw new Error('请输入非负整数；小数会造成字节精度歧义。')
    const bytes = BigInt(byteSource.value.trim()) * 1024n ** BigInt(byteUnits.indexOf(byteUnit.value))
    byteResult.value = byteUnits.map((unit, index) => ({ unit, value: formatByteValue(bytes, index) }))
    byteMessage.value = '已按 1 KB = 1024 B 精确换算。'
  } catch (error) {
    byteResult.value = []
    byteMessage.value = error instanceof Error ? error.message : '无法转换输入数值。'
  }
}
const copyByteValue = async (item: { unit: string; value: string }) => {
  await navigator.clipboard.writeText(`${item.value} ${item.unit}`)
  byteMessage.value = `${item.unit} 数值已复制到剪贴板。`
}
const copyByteResults = async () => {
  await navigator.clipboard.writeText(byteResult.value.map((item) => `${item.unit}: ${item.value}`).join('\n'))
  byteMessage.value = '全部换算结果已复制到剪贴板。'
}
convertBytes()
const generateSm2Keys = () => {
  const pair = sm2.generateKeyPairHex()
  cryptoPrivateKey.value = pair.privateKey
  cryptoPublicKey.value = pair.publicKey
  cryptoMessage.value = '已在本机生成 SM2 密钥对；请妥善保存私钥，离开此页面后不会保留。'
}
const parseHexWordArray = (value: string, label: string, lengths: number[]) => {
  const normalized = value.trim()
  if (!lengths.includes(normalized.length) || !/^[\da-f]+$/i.test(normalized)) throw new Error(`${label}必须是 ${lengths.join('、')} 位十六进制字符`)
  return CryptoJS.enc.Hex.parse(normalized)
}
const runCrypto = () => {
  try {
    if (!cryptoSource.value) throw new Error('请输入待处理内容')
    if (cryptoAlgorithm.value === 'md5') cryptoResult.value = CryptoJS.MD5(cryptoSource.value).toString()
    else if (cryptoAlgorithm.value === 'sha256') cryptoResult.value = CryptoJS.SHA256(cryptoSource.value).toString()
    else if (cryptoAlgorithm.value === 'sm3') cryptoResult.value = sm3Key.value.trim() ? sm3(cryptoSource.value, { key: sm3Key.value.trim() }) : sm3(cryptoSource.value)
    else if (cryptoAlgorithm.value === 'aes') {
      const key = parseHexWordArray(cryptoKey.value, 'AES 密钥', [32, 48, 64])
      const iv = cryptoMode.value === 'cbc' ? parseHexWordArray(cryptoIv.value, 'AES IV', [32]) : undefined
      const options = { mode: cryptoMode.value === 'cbc' ? CryptoJS.mode.CBC : CryptoJS.mode.ECB, padding: cryptoPadding.value === 'pkcs7' ? CryptoJS.pad.Pkcs7 : CryptoJS.pad.NoPadding, ...(iv ? { iv } : {}) }
      cryptoResult.value = cryptoOperation.value === 'encrypt' ? CryptoJS.AES.encrypt(cryptoSource.value, key, options).toString() : CryptoJS.AES.decrypt(cryptoSource.value, key, options).toString(CryptoJS.enc.Utf8)
      if (cryptoOperation.value === 'decrypt' && !cryptoResult.value) throw new Error('解密失败：请确认密文、密钥和参数')
    } else if (cryptoAlgorithm.value === 'sm4') {
      if (!/^[\da-f]{32}$/i.test(cryptoKey.value)) throw new Error('SM4 密钥必须是 32 位十六进制字符')
      if (cryptoMode.value === 'cbc' && !/^[\da-f]{32}$/i.test(cryptoIv.value)) throw new Error('SM4 CBC IV 必须是 32 位十六进制字符')
      const options = { mode: cryptoMode.value, padding: cryptoPadding.value === 'pkcs7' ? 'pkcs#7' : 'none', ...(cryptoMode.value === 'cbc' ? { iv: cryptoIv.value } : {}) }
      cryptoResult.value = cryptoOperation.value === 'encrypt' ? sm4.encrypt(cryptoSource.value, cryptoKey.value, options) : sm4.decrypt(cryptoSource.value, cryptoKey.value, options)
    } else {
      if (cryptoOperation.value === 'encrypt') {
        if (!cryptoPublicKey.value) throw new Error('请输入 SM2 公钥')
        cryptoResult.value = sm2.doEncrypt(cryptoSource.value, cryptoPublicKey.value, sm2CipherMode.value)
      } else {
        if (!cryptoPrivateKey.value) throw new Error('请输入 SM2 私钥')
        cryptoResult.value = sm2.doDecrypt(cryptoSource.value, cryptoPrivateKey.value, sm2CipherMode.value)
      }
    }
    cryptoMessage.value = cryptoAlgorithm.value === 'md5' || cryptoAlgorithm.value === 'sha256' || cryptoAlgorithm.value === 'sm3' ? '摘要已生成。摘要不可逆，不能用于解密。' : `${cryptoOperation.value === 'encrypt' ? '加密' : '解密'}完成。`
  } catch (error) { cryptoResult.value = ''; cryptoMessage.value = `处理失败：${error instanceof Error ? error.message : String(error)}` }
}
const copyCryptoResult = async () => {
  if (!cryptoResult.value) return
  await navigator.clipboard.writeText(cryptoResult.value)
  cryptoMessage.value = '结果已复制到剪贴板。'
}
type DiffRow = { kind: 'same' | 'add' | 'remove'; text: string }
const diffRows = computed<DiffRow[]>(() => {
  const left = diffLeft.value.replace(/\r/g, '').split('\n')
  const right = diffRight.value.replace(/\r/g, '').split('\n')
  if (left.length + right.length > 2_000) return [{ kind: 'remove', text: '内容过长，请将两侧总行数控制在 2000 行以内。' }]
  const table = Array.from({ length: left.length + 1 }, () => new Uint16Array(right.length + 1))
  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) table[leftIndex][rightIndex] = left[leftIndex] === right[rightIndex] ? table[leftIndex + 1][rightIndex + 1] + 1 : Math.max(table[leftIndex + 1][rightIndex], table[leftIndex][rightIndex + 1])
  }
  const rows: DiffRow[] = []
  let leftIndex = 0
  let rightIndex = 0
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) { rows.push({ kind: 'same', text: left[leftIndex] }); leftIndex += 1; rightIndex += 1 }
    else if (table[leftIndex + 1][rightIndex] >= table[leftIndex][rightIndex + 1]) { rows.push({ kind: 'remove', text: left[leftIndex] }); leftIndex += 1 }
    else { rows.push({ kind: 'add', text: right[rightIndex] }); rightIndex += 1 }
  }
  while (leftIndex < left.length) rows.push({ kind: 'remove', text: left[leftIndex++] })
  while (rightIndex < right.length) rows.push({ kind: 'add', text: right[rightIndex++] })
  return rows
})
const copyDiff = async () => {
  await navigator.clipboard.writeText(diffRows.value.map((row) => `${row.kind === 'add' ? '+' : row.kind === 'remove' ? '-' : ' '} ${row.text}`).join('\n'))
}
const parseStructured = (format: 'json' | 'yaml' | 'toml' | 'xml', source: string): unknown => {
  if (format === 'json') return JSON.parse(source)
  if (format === 'yaml') return YAML.parse(source)
  if (format === 'toml') return toml.parse(source)
  const validation = XMLValidator.validate(source)
  if (validation !== true) throw new Error(`XML 第 ${validation.err.line} 行：${validation.err.msg}`)
  return new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' }).parse(source)
}
const stringifyStructured = (format: 'json' | 'yaml' | 'toml' | 'xml', value: unknown): string => {
  if (format === 'json') return JSON.stringify(value, null, jsonIndent.value)
  if (format === 'yaml') return YAML.stringify(value)
  if (format === 'toml') return toml.stringify(value as Record<string, unknown>)
  return new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@_', format: true, indentBy: '  ' }).build(value)
}
const convertStructured = () => {
  try {
    if (!convertSource.value.trim()) throw new Error('请输入要转换的内容')
    convertResult.value = stringifyStructured(convertTo.value, parseStructured(convertFrom.value, convertSource.value))
    convertMessage.value = `${convertFrom.value.toUpperCase()} 已转换为 ${convertTo.value.toUpperCase()}。`
  } catch (error) {
    convertMessage.value = `转换失败：${error instanceof Error ? error.message : String(error)}`
  }
}
const copyConvertResult = async () => {
  if (!convertResult.value) return
  await navigator.clipboard.writeText(convertResult.value)
  convertMessage.value = '转换结果已复制到剪贴板。'
}
const generateQr = async () => {
  try {
    if (!qrText.value.trim()) throw new Error('请输入要编码的文本或 URL')
    qrImage.value = await QRCode.toDataURL(qrText.value, { errorCorrectionLevel: 'M', margin: 2, width: 360, color: { dark: '#173b2a', light: '#ffffff' } })
    qrMessage.value = '二维码已生成，内容未离开本机。'
  } catch (error) {
    qrMessage.value = `生成失败：${error instanceof Error ? error.message : String(error)}`
  }
}
const downloadQr = () => {
  if (!qrImage.value) return
  const link = document.createElement('a')
  link.href = qrImage.value
  link.download = 'localforge-qrcode.png'
  link.click()
}
const scanQr = (file: File | undefined) => {
  if (!file?.type.startsWith('image/')) { qrMessage.value = '请选择一张图片文件。'; return }
  const image = new Image()
  const url = URL.createObjectURL(file)
  image.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) { qrMessage.value = '无法读取图片像素。'; URL.revokeObjectURL(url); return }
    context.drawImage(image, 0, 0)
    const code = jsQR(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)
    qrMessage.value = code ? '已识别二维码内容。' : '未在图片中发现可识别的二维码。'
    if (code) qrText.value = code.data
    URL.revokeObjectURL(url)
  }
  image.onerror = () => { qrMessage.value = '图片加载失败。'; URL.revokeObjectURL(url) }
  image.src = url
}
const normalizedHex = computed(() => {
  const value = colorHex.value.trim().replace('#', '')
  if (/^[\da-f]{3}$/i.test(value)) return `#${value.split('').map((part) => part + part).join('').toUpperCase()}`
  return /^[\da-f]{6}$/i.test(value) ? `#${value.toUpperCase()}` : undefined
})
const colorRgb = computed(() => {
  if (!normalizedHex.value) return undefined
  const value = normalizedHex.value.slice(1)
  return { r: Number.parseInt(value.slice(0, 2), 16), g: Number.parseInt(value.slice(2, 4), 16), b: Number.parseInt(value.slice(4, 6), 16) }
})
const colorHsl = computed(() => {
  if (!colorRgb.value) return undefined
  const { r, g, b } = colorRgb.value
  const [red, green, blue] = [r, g, b].map((part) => part / 255)
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const lightness = (max + min) / 2
  const delta = max - min
  if (!delta) return { h: 0, s: 0, l: Math.round(lightness * 100) }
  const saturation = delta / (1 - Math.abs(2 * lightness - 1))
  const hue = max === red ? ((green - blue) / delta) % 6 : max === green ? (blue - red) / delta + 2 : (red - green) / delta + 4
  return { h: Math.round((hue * 60 + 360) % 360), s: Math.round(saturation * 100), l: Math.round(lightness * 100) }
})
const setHex = (value: string) => {
  colorHex.value = value
  colorMessage.value = /^#[\da-f]{3}([\da-f]{3})?$/i.test(value.trim()) ? '颜色已更新。' : '请输入 3 位或 6 位 HEX 颜色值。'
}
const copyColor = async (value: string) => {
  await navigator.clipboard.writeText(value)
  colorMessage.value = `已复制 ${value}`
}
const openImagePicker = () => imageInput.value?.click()
const formatBytes = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(bytes < 1024 ? 0 : 1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`
const clearCompressedImage = () => {
  if (compressedImage.value?.url) URL.revokeObjectURL(compressedImage.value.url)
  compressedImage.value = undefined
}
const imageExtension = (format: string) => format === 'image/jpeg' ? 'jpg' : format === 'image/svg+xml' ? 'svg' : format.split('/')[1]
const isSupportedImageFile = (file: File) => file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(file.name)
const resolveOutputFormat = (file?: File) => {
  if (imageOutputType.value !== 'original') return imageOutputType.value
  return file?.type === 'image/jpeg' || file?.type === 'image/png' || file?.type === 'image/webp' || file?.type === 'image/svg+xml' ? file.type : 'image/png'
}
const scaleCanvas = (canvas: HTMLCanvasElement) => {
  if (imageScale.value >= 100) return canvas
  const scaled = document.createElement('canvas')
  scaled.width = Math.max(1, Math.round(canvas.width * imageScale.value / 100))
  scaled.height = Math.max(1, Math.round(canvas.height * imageScale.value / 100))
  const context = scaled.getContext('2d')
  if (!context) throw new Error('无法缩放图片')
  context.drawImage(canvas, 0, 0, scaled.width, scaled.height)
  return scaled
}
const loadCanvasImage = (url: string): Promise<HTMLImageElement> => new Promise((resolveImage, rejectImage) => {
  const image = new Image()
  image.onload = () => resolveImage(image)
  image.onerror = () => rejectImage(new Error('图片加载失败'))
  image.src = url
})
const renderImageCanvas = async (): Promise<HTMLCanvasElement> => {
  if (!imagePreviewUrl.value || !imageInfo.value) throw new Error('请先选择图片')
  const image = await loadCanvasImage(imagePreviewUrl.value)
  const x = Math.max(0, Math.min(imageInfo.value.width - 1, Math.floor(imageCrop.value.x)))
  const y = Math.max(0, Math.min(imageInfo.value.height - 1, Math.floor(imageCrop.value.y)))
  const width = Math.max(1, Math.min(imageInfo.value.width - x, Math.floor(imageCrop.value.width || imageInfo.value.width)))
  const height = Math.max(1, Math.min(imageInfo.value.height - y, Math.floor(imageCrop.value.height || imageInfo.value.height)))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法创建图片画布')
  context.drawImage(image, x, y, width, height, 0, 0, width, height)
  return canvas
}
const updatePreviewFromCanvas = (canvas: HTMLCanvasElement, message: string) => {
  if (imagePreviewUrl.value.startsWith('blob:')) URL.revokeObjectURL(imagePreviewUrl.value)
  imagePreviewUrl.value = canvas.toDataURL('image/png')
  imageInfo.value = { width: canvas.width, height: canvas.height }
  imageCrop.value = { x: 0, y: 0, width: canvas.width, height: canvas.height }
  imageMessage.value = message
  clearCompressedImage()
}
const loadImage = (file: File | undefined) => {
  if (!file || !isSupportedImageFile(file)) {
    imageMessage.value = '请选择 PNG、JPEG、WebP、GIF、BMP 或 SVG 图片文件。'
    return
  }
  if (imagePreviewUrl.value) URL.revokeObjectURL(imagePreviewUrl.value)
  clearCompressedImage()
  imageFile.value = file
  imagePreviewUrl.value = URL.createObjectURL(file)
  const image = new Image()
  image.onload = () => {
    imageInfo.value = { width: image.naturalWidth, height: image.naturalHeight }
    imageCrop.value = { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight }
    imageSampleColor.value = ''
    imageMessage.value = '图片已加载，所有处理仅在本机完成。'
  }
  image.onerror = () => {
    imagePreviewUrl.value = ''
    imageFile.value = undefined
    imageInfo.value = undefined
    imageMessage.value = '图片无法加载。请确认文件未损坏，并使用 PNG、JPG、WebP、GIF、BMP 或 SVG 格式。'
  }
  image.src = imagePreviewUrl.value
}
const onImageSelected = (event: Event) => {
  const input = event.target as HTMLInputElement
  loadImage(input.files?.[0])
  input.value = ''
}
const onImageDropped = (event: DragEvent) => {
  const files = event.dataTransfer?.files
  if (!files?.length) return
  if (files.length > 1 && activeTool.value === 'image-compress') loadImageBatch(files)
  else loadImage(files[0])
}
const loadImageBatch = (files: FileList | File[]) => {
  const images = Array.from(files).filter(isSupportedImageFile)
  if (!images.length) {
    imageBatchMessage.value = '没有识别到可处理的图片文件。'
    return
  }
  imageBatch.value = images.map((file, index) => ({ id: `${file.name}-${file.lastModified}-${index}`, file, status: 'waiting' }))
  loadImage(images[0])
  imageBatchMessage.value = `已加入 ${images.length} 张图片。可调整格式和质量后批量压缩。`
}
const onImageBatchSelected = (event: Event) => {
  const input = event.target as HTMLInputElement
  if (input.files) loadImageBatch(input.files)
  input.value = ''
}
const onImageFolderSelected = (event: Event) => {
  const input = event.target as HTMLInputElement
  if (input.files) loadImageBatch(input.files)
  input.value = ''
}
const renderFileCanvas = async (file: File) => {
  const url = URL.createObjectURL(file)
  try {
    const image = await loadCanvasImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建图片画布')
    context.drawImage(image, 0, 0)
    return scaleCanvas(canvas)
  } finally { URL.revokeObjectURL(url) }
}
const englishOutputName = (file: File, index: number) => {
  const extension = imageExtension(resolveOutputFormat(file))
  const sourceStem = file.name.replace(/\.[^.]+$/, '')
  const asciiStem = sourceStem.normalize('NFKD').replace(/[^\x20-\x7E]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()
  const hasNonAscii = /[^\x00-\x7F]/.test(sourceStem)
  return `${hasNonAscii || !asciiStem ? 'image' : asciiStem}-${String(index + 1).padStart(3, '0')}.${extension}`
}
const setBatchItem = (id: string, update: Partial<BatchImage>) => {
  imageBatch.value = imageBatch.value.map((item) => item.id === id ? { ...item, ...update } : item)
}
const compressBatch = async () => {
  if (!imageBatch.value.length) {
    imageBatchMessage.value = '请先选择多张图片或一个图片文件夹。'
    return
  }
  const outputDirectory = await window.developerTools.selectImageOutputDirectory()
  if (!outputDirectory) return
  imageCompressing.value = true
  const outputFiles: Array<{ name: string; data: ArrayBuffer }> = []
  try {
    for (const [index, item] of imageBatch.value.entries()) {
      setBatchItem(item.id, { status: 'compressing', error: undefined })
      try {
        const blob = await encodeCanvas(await renderFileCanvas(item.file), resolveOutputFormat(item.file))
        const outputName = englishOutputName(item.file, index)
        outputFiles.push({ name: outputName, data: await blob.arrayBuffer() })
        setBatchItem(item.id, { status: 'ready', resultSize: blob.size, outputName })
      } catch (error) {
        setBatchItem(item.id, { status: 'failed', error: error instanceof Error ? error.message : String(error) })
      }
    }
    if (!outputFiles.length) throw new Error('没有图片成功压缩，未创建导出文件夹。')
    const result = await window.developerTools.saveCompressedImages(outputDirectory, outputFiles)
    const failures = imageBatch.value.filter((item) => item.status === 'failed').length
    imageBatchMessage.value = `已导出 ${result.files.length} 张图片至：${result.directory}${failures ? `；${failures} 张处理失败。` : '。'}`
  } catch (error) {
    imageBatchMessage.value = error instanceof Error ? error.message : String(error)
  } finally { imageCompressing.value = false }
}
const encodeCanvas = (canvas: HTMLCanvasElement, format = resolveOutputFormat(imageFile.value)) => new Promise<Blob>((resolve, reject) => {
  if (format === 'image/svg+xml') {
    const png = canvas.toDataURL('image/png')
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}"><image href="${png}" width="100%" height="100%"/></svg>`
    resolve(new Blob([svg], { type: 'image/svg+xml' }))
    return
  }
  canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('图片编码失败，请更换格式后重试。')), format, format === 'image/png' ? undefined : imageQuality.value / 100)
})
const compressImage = async () => {
  try {
    imageCompressing.value = true
    const canvas = scaleCanvas(await renderImageCanvas())
    const format = resolveOutputFormat(imageFile.value)
    const blob = await encodeCanvas(canvas, format)
    clearCompressedImage()
    compressedImage.value = { url: URL.createObjectURL(blob), blob, format }
    const change = imageFile.value ? Math.round((1 - blob.size / imageFile.value.size) * 100) : 0
    imageMessage.value = change >= 0 ? `压缩完成，节省 ${change}% 空间。` : '已完成重新编码；当前设置的输出文件比原图更大，可降低质量或改用 WebP。'
  } catch (error) { imageMessage.value = error instanceof Error ? error.message : String(error) } finally { imageCompressing.value = false }
}
const downloadCompressedImage = () => {
  if (!compressedImage.value) return
  const extension = imageExtension(compressedImage.value.format)
  const link = document.createElement('a')
  link.href = compressedImage.value.url
  link.download = `${imageFile.value?.name.replace(/\.[^.]+$/, '') ?? 'image'}-tinied.${extension}`
  link.click()
  imageMessage.value = `已下载压缩后的 ${extension.toUpperCase()} 图片。`
}
const applyCrop = async () => {
  try { updatePreviewFromCanvas(await renderImageCanvas(), '裁剪已应用。') } catch (error) { imageMessage.value = error instanceof Error ? error.message : String(error) }
}
const removeBackground = async () => {
  imageProcessing.value = true
  try {
    const canvas = await renderImageCanvas()
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('无法读取图片像素')
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
    const { data } = pixels
    const corners = [0, (canvas.width - 1) * 4, (canvas.height - 1) * canvas.width * 4, ((canvas.height - 1) * canvas.width + canvas.width - 1) * 4]
    const background = corners.reduce((sum, index) => ({ r: sum.r + data[index], g: sum.g + data[index + 1], b: sum.b + data[index + 2] }), { r: 0, g: 0, b: 0 })
    background.r /= corners.length; background.g /= corners.length; background.b /= corners.length
    const threshold = backgroundTolerance.value * backgroundTolerance.value * 3
    for (let index = 0; index < data.length; index += 4) {
      const distance = (data[index] - background.r) ** 2 + (data[index + 1] - background.g) ** 2 + (data[index + 2] - background.b) ** 2
      if (distance <= threshold) data[index + 3] = 0
    }
    context.putImageData(pixels, 0, 0)
    imageOutputType.value = 'image/png'
    updatePreviewFromCanvas(canvas, '已按图片四角的背景色生成透明区域；复杂背景建议调高容差后重试。')
  } catch (error) { imageMessage.value = error instanceof Error ? error.message : String(error) } finally { imageProcessing.value = false }
}
const sampleImageColor = async (event: MouseEvent) => {
  if (!imagePreviewUrl.value || !imageInfo.value) return
  const target = event.currentTarget as HTMLImageElement
  const bounds = target.getBoundingClientRect()
  const canvas = document.createElement('canvas')
  canvas.width = imageInfo.value.width; canvas.height = imageInfo.value.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return
  context.drawImage(await loadCanvasImage(imagePreviewUrl.value), 0, 0)
  const x = Math.max(0, Math.min(canvas.width - 1, Math.floor((event.clientX - bounds.left) / bounds.width * canvas.width)))
  const y = Math.max(0, Math.min(canvas.height - 1, Math.floor((event.clientY - bounds.top) / bounds.height * canvas.height)))
  const [red, green, blue] = context.getImageData(x, y, 1, 1).data
  imageSampleColor.value = `#${[red, green, blue].map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`
  await navigator.clipboard.writeText(imageSampleColor.value)
  imageMessage.value = `已吸附并复制 ${imageSampleColor.value}。`
}
const pickScreenColor = async () => {
  try {
    const EyeDropper = (window as Window & { EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper
    if (!EyeDropper) throw new Error('当前 Electron 版本不支持系统屏幕取色。')
    imageSampleColor.value = (await new EyeDropper().open()).sRGBHex.toUpperCase()
    await navigator.clipboard.writeText(imageSampleColor.value)
    imageMessage.value = `已吸附并复制 ${imageSampleColor.value}。`
  } catch (error) { if (error instanceof Error && error.name !== 'AbortError') imageMessage.value = error.message }
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
const copyExitIp = async () => {
  if (!exitIp.value) return
  await navigator.clipboard.writeText(exitIp.value.ip)
  ipCheckMessage.value = '出口 IP 已复制到剪贴板。'
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
const copyNetworkDiagnosis = async () => {
  if (!networkDiagnosis.value) return
  const result = networkDiagnosis.value
  await navigator.clipboard.writeText([
    `主机: ${result.host}`,
    `端口: ${result.port}`,
    `DNS: ${result.addresses.join(', ') || '未返回地址'}`,
    `IPv4: ${result.ipv4.join(', ') || '未返回记录'}`,
    `IPv6: ${result.ipv6.join(', ') || '未返回记录'}`,
    `TCP: ${result.tcp.reachable ? `连接成功${result.tcp.latencyMs === undefined ? '' : ` (${result.tcp.latencyMs} ms)`}` : `无法连接 (${result.tcp.error ?? '未知原因'})`}`,
    result.http ? `HTTP: ${result.http.reachable ? `${result.http.status} ${result.http.statusText ?? ''} (${result.http.latencyMs} ms)` : `请求失败 (${result.http.error ?? '未知原因'})`}` : ''
  ].filter(Boolean).join('\n'))
  networkDiagnosisMessage.value = '诊断结果已复制到剪贴板。'
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

const refreshVoltaState = async () => {
  if (!window.voltaTools) return
  voltaBusy.value = true
  try {
    voltaState.value = await window.voltaTools.getNodeState()
    if (!voltaSelectedVersion.value || !voltaState.value.versions.some((item) => item.version === voltaSelectedVersion.value)) {
      voltaSelectedVersion.value = voltaState.value.defaultVersion ?? voltaState.value.versions[0]?.version ?? ''
    }
    voltaMessage.value = voltaState.value.installed
      ? '已读取 Volta 工具链。项目锁定的版本会优先于这里的默认版本。'
      : `未检测到可用的 Volta：${voltaState.value.error ?? '请确认 volta 已加入 PATH。'}`
  } catch (error) {
    voltaMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    voltaBusy.value = false
  }
}

const installVoltaNode = async (version?: string) => {
  if (!window.voltaTools) return
  const target = (version ?? voltaVersionInput.value).trim()
  if (!target) { voltaMessage.value = '请输入要安装的 Node 版本。'; return }
  if (!window.confirm(`Volta 将下载 Node@${target} 并把它设为默认版本，是否继续？`)) return
  voltaBusy.value = true
  try {
    voltaState.value = await window.voltaTools.installNode(target)
    voltaSelectedVersion.value = voltaState.value.defaultVersion ?? target
    voltaVersionInput.value = ''
    voltaMessage.value = `Node@${voltaState.value.defaultVersion ?? target} 已安装，并已设为 Volta 默认版本。`
  } catch (error) {
    voltaMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    voltaBusy.value = false
  }
}

const setVoltaDefault = async () => {
  if (!window.voltaTools || !voltaSelectedVersion.value) return
  const version = voltaSelectedVersion.value
  if (!window.confirm(`将 Volta 默认 Node 切换到 ${version}，是否继续？`)) return
  voltaBusy.value = true
  try {
    voltaState.value = await window.voltaTools.installNode(version)
    voltaSelectedVersion.value = voltaState.value.defaultVersion ?? version
    voltaMessage.value = `Node@${voltaSelectedVersion.value} 已设为 Volta 默认版本。`
  } catch (error) {
    voltaMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    voltaBusy.value = false
  }
}

const chooseVoltaProject = async () => {
  const selected = await window.developerTools.selectDirectory()
  if (selected) voltaProjectPath.value = selected
}

const pinVoltaNode = async () => {
  if (!window.voltaTools) return
  const version = voltaVersionInput.value.trim() || voltaState.value?.defaultVersion
  if (!version) { voltaMessage.value = '请先输入要固定的 Node 版本。'; return }
  if (!voltaProjectPath.value) { voltaMessage.value = '请先选择项目目录。'; return }
  if (!window.confirm(`将修改该项目的 package.json，固定 Node@${version}。是否继续？`)) return
  voltaBusy.value = true
  try {
    const result = await window.voltaTools.pinNode(version, voltaProjectPath.value)
    voltaMessage.value = `已在 ${result.directory} 的 package.json 中固定 Node@${result.version}。`
  } catch (error) {
    voltaMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    voltaBusy.value = false
  }
}

const refreshNvmState = async () => {
  if (!window.nvmTools) return
  nvmBusy.value = true
  try {
    nvmState.value = await window.nvmTools.getNodeState()
    nvmMessage.value = nvmState.value.installed
      ? '已读取 NVM 管理的 Node 版本。切换后会影响系统当前启用的 Node。'
      : `未检测到可用的 NVM：${nvmState.value.error ?? '请确认 nvm 已加入 PATH。'}`
  } catch (error) {
    nvmMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    nvmBusy.value = false
  }
}

const installNvmNode = async (requestedVersion?: string) => {
  if (!window.nvmTools) return
  const version = (requestedVersion ?? nvmVersionInput.value).trim()
  if (!version) { nvmMessage.value = '请输入要安装的 Node 版本。'; return }
  if (!window.confirm(`NVM 将下载 Node@${version}，是否继续？`)) return
  nvmBusy.value = true
  try {
    nvmState.value = await window.nvmTools.installNode(version)
    nvmVersionInput.value = ''
    nvmMessage.value = `Node@${version} 已由 NVM 安装。`
  } catch (error) {
    nvmMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    nvmBusy.value = false
  }
}

const refreshNodeReleases = async () => {
  if (!window.nodeReleaseTools) return
  nodeReleasesBusy.value = true
  try {
    nodeReleases.value = await window.nodeReleaseTools.list()
    nodeReleasesMessage.value = `已通过 nvm list available 加载 ${nodeReleases.value.length} 个可安装版本。`
  } catch (error) {
    nodeReleasesMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    nodeReleasesBusy.value = false
  }
}

const installVersionManager = async (manager: 'volta' | 'nvm') => {
  if (!window.nodeReleaseTools) return
  const label = manager === 'volta' ? 'Volta' : 'NVM for Windows'
  if (!window.confirm(`将通过 winget 安装 ${label}。安装程序可能要求管理员授权，是否继续？`)) return
  managerInstallBusy.value = manager
  try {
    await window.nodeReleaseTools.installManager(manager)
    await Promise.all([refreshVoltaState(), refreshNvmState()])
    nodeReleasesMessage.value = `${label} 安装命令已完成；如界面仍未识别，请重启 LocalForge。`
  } catch (error) {
    nodeReleasesMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    managerInstallBusy.value = undefined
  }
}

const useNvmNode = async (version: string) => {
  if (!window.nvmTools || !window.confirm(`将系统当前 Node 切换到 NVM 的 ${version}，是否继续？`)) return
  nvmBusy.value = true
  try {
    nvmState.value = await window.nvmTools.useNode(version)
    nvmMessage.value = `当前 Node 已切换为 ${nvmState.value.currentVersion ?? version}。`
  } catch (error) {
    nvmMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    nvmBusy.value = false
  }
}

const uninstallNvmNode = async (version: string) => {
  if (!window.nvmTools || !window.confirm(`将永久移除 NVM 管理的 Node@${version}，是否继续？`)) return
  nvmBusy.value = true
  try {
    nvmState.value = await window.nvmTools.uninstallNode(version)
    nvmMessage.value = `Node@${version} 已从 NVM 移除。`
  } catch (error) {
    nvmMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    nvmBusy.value = false
  }
}

void refreshVoltaState()
void refreshNvmState()
void refreshNodeReleases()
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
          <button v-for="category in categories" :key="category.id" :class="{ active: activeTool === 'portal' && activeCategory === category.id }" @click="showPortal(category.id)"><SvgIcon class="sidebar-icon" :name="category.id === 'all' ? 'dashboard' : category.id === 'file' ? 'folder' : category.id === 'data' ? 'code' : category.id === 'design' ? 'palette' : 'globe'" />{{ category.label }}</button>
        </nav>
        <section class="sidebar-local-ip" aria-label="本机 IPv4 地址">
          <div>
            <small>局域网 IPv4</small>
            <strong v-for="item in localIpv4.lan" :key="`lan-${item.name}-${item.address}`" :title="`${item.name} · 点击复制`" @click="copyLocalIpv4(item.address)">{{ item.address }}</strong>
            <span v-if="!localIpv4.lan.length">{{ localIpv4Message }}</span>
          </div>
          <div>
            <small>网线 IPv4</small>
            <strong v-for="item in localIpv4.wired" :key="`wired-${item.name}-${item.address}`" :title="`${item.name} · 点击复制`" @click="copyLocalIpv4(item.address)">{{ item.address }}</strong>
            <span v-if="!localIpv4.wired.length">未连接网线</span>
          </div>
        </section>
        <div class="sidebar-actions">
          <button type="button" title="打开系统监控" aria-label="打开系统监控" @click="openMonitor"><SvgIcon name="monitor"/><span>系统监控</span></button>
          <button class="settings-action" type="button" title="打开设置" aria-label="打开设置" @click="settingsOpen = true"><SvgIcon name="settings"/><span>设置</span></button>
        </div>
      </aside>

      <section class="toolbox-content">
      <template v-if="activeTool === 'portal'">
        <header class="toolbox-heading"><p>LOCALFORGE / TOOL PORTAL</p><h2>{{ portalTitle }}</h2><span>选择一项工具开始工作，所有处理均在本机完成。</span></header>
        <section class="portal-list" :aria-label="`${portalTitle}列表`">
          <button v-for="tool in visiblePortalTools" :key="tool.id" class="portal-item" type="button" @click="openTool(tool.id)">
            <i class="portal-icon" :class="`portal-icon-${tool.id}`"><SvgIcon :name="tool.id === 'cleanup' ? 'trash' : tool.id === 'json' || tool.id === 'data-lab' || tool.id === 'stats' || tool.id === 'radix' || tool.id === 'bytes' || tool.id === 'crypto' || tool.id === 'diff' || tool.id === 'convert' || tool.id === 'volta' || tool.id === 'nvm' || tool.id === 'assistant-prompt' ? 'code' : tool.id === 'color' ? 'palette' : tool.id === 'image' || tool.id === 'qrcode' ? 'image' : tool.id === 'ports' ? 'monitor' : 'globe'" /></i>
            <span class="portal-copy"><em>{{ tool.state }}</em><strong>{{ tool.title }}</strong><small>{{ tool.description }}</small></span>
            <b>›</b>
          </button>
          <p v-if="!visiblePortalTools.length" class="portal-empty">该分类暂时没有可用工具。</p>
        </section>
      </template>

      <template v-else-if="activeTool === 'assistant-prompt'">
        <header class="toolbox-heading"><div><p>数据工具 / AI CODING ASSISTANTS</p><h2>AI 提示词与配置</h2><span>在本机直接维护 Codex、Cursor 和 Claude Code 的全局提示词与配置文件。</span></div><button class="back-button" @click="backToPortal">‹ 返回工具列表</button></header>
        <section class="assistant-config-card">
          <div class="assistant-config-controls">
            <label>AI 编程助手<select v-model="assistantPromptTool" :disabled="assistantConfigBusy" @change="loadAssistantConfig"><option value="codex">Codex</option><option value="cursor">Cursor</option><option value="claude-code">Claude Code</option></select></label>
            <label>编辑内容<select v-model="assistantConfigFile" :disabled="assistantConfigBusy" @change="loadAssistantConfig"><option value="prompt">全局提示词</option><option value="config">配置文件</option></select></label>
            <button :disabled="assistantConfigBusy" @click="loadAssistantConfig">{{ assistantConfigBusy ? '读取中…' : '重新读取' }}</button>
            <button class="primary" :disabled="assistantConfigBusy" @click="saveAssistantConfig">{{ assistantConfigBusy ? '处理中…' : '保存到全局' }}</button>
          </div>
          <p class="tool-message" :class="{ error: assistantConfigMessage.includes('失败') || assistantConfigMessage.includes('无效') }">{{ assistantConfigMessage }}</p>
          <p class="assistant-config-path"><small>文件位置</small><code>{{ assistantConfigPath || '读取后显示' }}</code></p>
          <label class="assistant-config-editor"><span>{{ assistantToolLabel }} · {{ assistantFileLabel }}</span><textarea v-model="assistantConfigContent" spellcheck="false" :placeholder="assistantConfigFile === 'prompt' ? '输入适用于所有项目的指令…' : '输入配置文件内容…'"></textarea></label>
          <p class="assistant-config-note">保存会直接覆盖该全局文件；配置文件请保持对应格式有效。Cursor 的全局提示词保存为 <code>~/.cursor/rules/global.mdc</code>。</p>
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

      <template v-else-if="activeTool === 'stats'">
        <header class="toolbox-heading"><div><p>数据工具 / TEXT</p><h2>字数统计</h2><span>实时统计文本字符、词数、行数和 UTF-8 字节长度。</span></div><button class="back-button" @click="backToPortal">‹ 返回工具列表</button></header>
        <section class="stats-layout"><label>待统计文本<textarea v-model="statsSource" spellcheck="false" placeholder="输入或粘贴文本"></textarea></label><section class="stats-grid"><div><small>字符数</small><strong>{{ textStats.characters }}</strong></div><div><small>非空白字符</small><strong>{{ textStats.noWhitespace }}</strong></div><div><small>汉字</small><strong>{{ textStats.chinese }}</strong></div><div><small>英文词</small><strong>{{ textStats.words }}</strong></div><div><small>数字</small><strong>{{ textStats.numbers }}</strong></div><div><small>行数</small><strong>{{ textStats.lines }}</strong></div><div><small>UTF-8 字节</small><strong>{{ textStats.bytes }}</strong></div><button type="button" @click="copyTextStats">复制统计</button></section></section>
      </template>

      <template v-else-if="activeTool === 'radix'">
        <header class="toolbox-heading"><div><p>数据工具 / RADIX</p><h2>进制转换</h2><span>支持 2 至 36 进制的任意精度整数，不受 JavaScript Number 精度限制。</span></div><button class="back-button" @click="backToPortal">‹ 返回工具列表</button></header>
        <section class="converter-card"><label>输入数值<input v-model="radixSource" spellcheck="false"></label><label>原进制<input v-model.number="radixFrom" type="number" min="2" max="36"></label><label>目标进制<input v-model.number="radixTo" type="number" min="2" max="36"></label><button class="primary" @click="convertRadix">转换</button><button :disabled="!radixResult" @click="copyRadixResult">复制结果</button><p class="tool-message">{{ radixMessage }}</p><label class="converter-result">转换结果<textarea v-model="radixResult" readonly></textarea></label></section>
      </template>

      <template v-else-if="activeTool === 'bytes'">
        <header class="toolbox-heading"><div><p>数据工具 / BYTES</p><h2>字节单位转换</h2><span>采用 1 KB = 1024 B 的二进制换算方式，支持任意长度整数。</span></div><button class="back-button" @click="backToPortal">‹ 返回工具列表</button></header>
        <section class="converter-card byte-card"><label>数值<input v-model.trim="byteSource" inputmode="numeric" spellcheck="false" placeholder="例如 1048576" @input="convertBytes"></label><label>输入单位<select v-model="byteUnit" @change="convertBytes"><option>B</option><option>KB</option><option>MB</option><option>GB</option><option>TB</option></select></label><button :disabled="!byteResult.length" @click="copyByteResults">复制全部结果</button><p class="tool-message" :class="{ error: !byteResult.length }">{{ byteMessage }}</p><section v-if="byteResult.length" class="byte-results"><div v-for="item in byteResult" :key="item.unit"><small>{{ item.unit }}</small><strong :title="item.value">{{ item.value }}</strong><button type="button" @click="copyByteValue(item)">复制</button></div></section></section>
      </template>

      <template v-else-if="activeTool === 'crypto'">
        <header class="toolbox-heading"><div><p>数据工具 / CRYPTO</p><h2>加解密工作台</h2><span>处理仅在本机完成。不要在不可信设备或页面中输入生产密钥。</span></div><button class="back-button" @click="backToPortal">‹ 返回工具列表</button></header>
        <section class="crypto-card"><div class="crypto-actions"><label>算法<select v-model="cryptoAlgorithm"><option value="md5">MD5 摘要</option><option value="sha256">SHA-256 摘要</option><option value="sm3">SM3 摘要</option><option value="aes">AES</option><option value="sm4">SM4</option><option value="sm2">SM2</option></select></label><label v-if="!['md5', 'sha256', 'sm3'].includes(cryptoAlgorithm)">操作<select v-model="cryptoOperation"><option value="encrypt">加密</option><option value="decrypt">解密</option></select></label></div><label>输入<textarea v-model="cryptoSource" spellcheck="false" placeholder="输入明文、密文或待计算摘要的内容"></textarea></label><template v-if="cryptoAlgorithm === 'aes' || cryptoAlgorithm === 'sm4'"><label>{{ cryptoAlgorithm === 'sm4' ? 'SM4 密钥（32 位十六进制）' : 'AES 密钥（32 / 48 / 64 位十六进制）' }}<input v-model="cryptoKey" type="password" spellcheck="false"></label><label>分组模式<select v-model="cryptoMode"><option value="cbc">CBC</option><option value="ecb">ECB</option></select></label><label v-if="cryptoMode === 'cbc'">初始化向量 IV（32 位十六进制）<input v-model="cryptoIv" type="password" spellcheck="false"></label><label>填充方式<select v-model="cryptoPadding"><option value="pkcs7">PKCS#7</option><option value="none">无填充（明文需为 16 字节倍数）</option></select></label></template><template v-else-if="cryptoAlgorithm === 'sm3'"><label>HMAC 密钥（可选，十六进制）<input v-model="sm3Key" type="password" spellcheck="false"></label></template><template v-else-if="cryptoAlgorithm === 'sm2'"><div class="sm2-key-actions"><button @click="generateSm2Keys">生成 SM2 密钥对</button><label>密文排列<select v-model.number="sm2CipherMode"><option :value="1">C1C3C2（推荐）</option><option :value="0">C1C2C3</option></select></label></div><p class="crypto-note">SM2 是椭圆曲线公钥加密，不使用 IV 或分组填充；互操作时需确保双方采用相同密文排列。</p><label>SM2 公钥（加密使用，支持压缩或非压缩格式）<textarea v-model="cryptoPublicKey" spellcheck="false"></textarea></label><label>SM2 私钥（解密使用）<textarea v-model="cryptoPrivateKey" spellcheck="false"></textarea></label></template><div class="crypto-run"><button class="primary" @click="runCrypto">{{ ['md5', 'sha256', 'sm3'].includes(cryptoAlgorithm) ? '生成摘要' : cryptoOperation === 'encrypt' ? '加密' : '解密' }}</button><button :disabled="!cryptoResult" @click="copyCryptoResult">复制结果</button></div><p class="tool-message">{{ cryptoMessage }}</p><label>结果<textarea v-model="cryptoResult" readonly spellcheck="false"></textarea></label></section>
      </template>

      <template v-else-if="activeTool === 'diff'">
        <header class="toolbox-heading"><div><p>数据工具 / DIFF</p><h2>文本差异对比</h2><span>按行比较两段文本；绿色为新增、红色为删除、白色为未变内容。</span></div><button class="back-button" @click="backToPortal">‹ 返回工具列表</button></header>
        <section class="json-actions"><button :disabled="!diffRows.length" @click="copyDiff">复制统一 Diff</button><small class="diff-summary">共 {{ diffRows.length }} 行差异结果</small></section>
        <section class="json-editors diff-editors"><label>原始文本<textarea v-model="diffLeft" spellcheck="false" placeholder="粘贴原始文本"></textarea></label><label>目标文本<textarea v-model="diffRight" spellcheck="false" placeholder="粘贴目标文本"></textarea></label></section>
        <section class="diff-result" aria-label="差异结果"><p v-for="(row, index) in diffRows" :key="index" :class="row.kind"><b>{{ row.kind === 'add' ? '+' : row.kind === 'remove' ? '−' : ' ' }}</b><code>{{ row.text || ' ' }}</code></p></section>
      </template>

      <template v-else-if="activeTool === 'convert'">
        <header class="toolbox-heading"><div><p>数据工具 / CONFIG</p><h2>配置格式转换</h2><span>在 JSON、YAML、TOML 和 XML 间进行本地转换，XML 属性保留为 <code>@_属性名</code>。</span></div><button class="back-button" @click="backToPortal">‹ 返回工具列表</button></header>
        <section class="json-actions"><label>输入格式 <select v-model="convertFrom"><option value="json">JSON</option><option value="yaml">YAML</option><option value="toml">TOML</option><option value="xml">XML</option></select></label><label>输出格式 <select v-model="convertTo"><option value="json">JSON</option><option value="yaml">YAML</option><option value="toml">TOML</option><option value="xml">XML</option></select></label><button class="primary" @click="convertStructured">开始转换</button><button :disabled="!convertResult" @click="copyConvertResult">复制结果</button></section>
        <p class="tool-message">{{ convertMessage }}</p>
        <section class="json-editors"><label>输入<textarea v-model="convertSource" spellcheck="false" placeholder="粘贴配置内容"></textarea></label><label>结果<textarea v-model="convertResult" spellcheck="false" readonly placeholder="转换结果会出现在这里"></textarea></label></section>
      </template>

      <template v-else-if="activeTool === 'color'">
        <header class="toolbox-heading"><div><p>设计工具 / 颜色</p><h2>颜色转换器</h2><span>输入 HEX 颜色，快速获得 RGB 与 HSL 表示法。</span></div><button class="back-button" @click="backToPortal">‹ 返回工具列表</button></header>
        <section class="color-card">
          <div class="color-preview" :style="{ background: normalizedHex ?? '#eef2ef' }"></div>
          <label>HEX 颜色<input v-model="colorHex" maxlength="7" placeholder="#16A34A" @input="setHex(colorHex)"></label>
          <input class="color-picker" type="color" :value="normalizedHex ?? '#16a34a'" aria-label="选择颜色" @input="setHex(($event.target as HTMLInputElement).value)">
          <p class="tool-message" :class="{ error: !normalizedHex }">{{ colorMessage }}</p>
        </section>
        <section v-if="colorRgb && colorHsl && normalizedHex" class="color-values">
          <button type="button" @click="copyColor(normalizedHex)"><small>HEX</small><strong>{{ normalizedHex }}</strong><span>点击复制</span></button>
          <button type="button" @click="copyColor(`rgb(${colorRgb.r}, ${colorRgb.g}, ${colorRgb.b})`)"><small>RGB</small><strong>rgb({{ colorRgb.r }}, {{ colorRgb.g }}, {{ colorRgb.b }})</strong><span>点击复制</span></button>
          <button type="button" @click="copyColor(`hsl(${colorHsl.h}, ${colorHsl.s}%, ${colorHsl.l}%)`)"><small>HSL</small><strong>hsl({{ colorHsl.h }}, {{ colorHsl.s }}%, {{ colorHsl.l }}%)</strong><span>点击复制</span></button>
        </section>
      </template>

      <template v-else-if="activeTool === 'image-compress'">
        <header class="toolbox-heading"><div><p>设计工具 / TINYPNG STYLE</p><h2>TinyPNG 图片压缩</h2><span>批量压缩、转换格式并导出至新文件夹；图片始终留在本机。</span></div><button class="back-button" @click="backToPortal">‹ 返回工具列表</button></header>
        <input ref="imageInput" class="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/svg+xml" @change="onImageSelected">
        <input ref="imageBatchInput" class="visually-hidden" type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/svg+xml" @change="onImageBatchSelected">
        <input ref="imageFolderInput" class="visually-hidden" type="file" webkitdirectory directory multiple accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/svg+xml" @change="onImageFolderSelected">
        <section class="batch-import-card"><div><small>BATCH COMPRESS</small><strong>批量压缩并导出文件夹</strong><span>中文文件名会自动改为英文安全名，例如 <code>image-001.webp</code>。</span></div><button type="button" @click="imageBatchInput?.click()">选择多张图片</button><button class="primary" type="button" @click="imageFolderInput?.click()">选择图片文件夹</button></section>
        <section class="image-dropzone" :class="{ 'has-image': imagePreviewUrl }" @click="openImagePicker" @dragover.prevent @drop.prevent="onImageDropped">
          <img v-if="imagePreviewUrl" :src="imagePreviewUrl" :alt="imageFile?.name ?? '图片预览'">
          <div v-else><SvgIcon name="image" /><strong>拖入图片开始压缩</strong><span>支持 PNG、JPEG、WebP、GIF、BMP 与 SVG · 单次处理一张</span></div>
        </section>
        <p class="tool-message">{{ imageMessage }}</p>
        <section v-if="imageFile && imageInfo" class="image-details">
          <div><small>文件名称</small><strong>{{ imageFile.name }}</strong></div><div><small>像素尺寸</small><strong>{{ imageInfo.width }} × {{ imageInfo.height }}</strong></div><div><small>文件大小</small><strong>{{ formatBytes(imageFile.size) }}</strong></div>
        </section>
        <section v-if="imageFile && imageInfo" class="image-workbench">
          <div><h3>压缩与格式</h3><p>批量导出会统一使用以下参数。降低质量或尺寸比例可显著减小体积；SVG 为嵌入图片，并非矢量化。</p><label>格式 <select v-model="imageOutputType" @change="clearCompressedImage"><option value="original">保持原格式</option><option value="image/png">统一 PNG</option><option value="image/jpeg">统一 JPG</option><option value="image/webp">统一 WebP（推荐）</option><option value="image/svg+xml">统一 SVG（嵌入图片）</option></select></label><label>清晰度（JPG/WebP） <input v-model.number="imageQuality" type="range" min="20" max="100" :disabled="imageOutputType === 'image/png' || imageOutputType === 'image/svg+xml'"><output>{{ imageQuality }}%</output></label><label>尺寸比例 <input v-model.number="imageScale" type="range" min="10" max="100" step="5" @change="clearCompressedImage"><output>{{ imageScale }}%</output></label><button class="primary" :disabled="imageCompressing" @click="compressImage">{{ imageCompressing ? '压缩中…' : '开始压缩' }}</button></div>
        </section>
        <section v-if="imageBatch.length" class="batch-queue">
          <header><div><small>待处理队列</small><strong>{{ imageBatch.length }} 张图片</strong></div><button class="primary" :disabled="imageCompressing" @click="compressBatch">{{ imageCompressing ? '正在批量压缩…' : '压缩并导出文件夹' }}</button></header>
          <p class="tool-message">{{ imageBatchMessage }}</p>
          <div class="batch-file-list"><div v-for="item in imageBatch" :key="item.id"><span :title="item.file.name">{{ item.file.name }}</span><small>{{ formatBytes(item.file.size) }}</small><strong :class="`batch-${item.status}`">{{ item.status === 'waiting' ? '等待处理' : item.status === 'compressing' ? '压缩中…' : item.status === 'ready' ? `${formatBytes(item.resultSize ?? 0)} · ${item.outputName}` : item.error ?? '处理失败' }}</strong></div></div>
        </section>
        <section v-if="compressedImage && imageFile" class="compression-result">
          <div><small>原始文件</small><strong>{{ formatBytes(imageFile.size) }}</strong></div><i aria-hidden="true">→</i><div><small>压缩结果</small><strong>{{ formatBytes(compressedImage.blob.size) }}</strong></div><div><small>空间变化</small><strong :class="{ 'file-larger': compressedImage.blob.size > imageFile.size }">{{ compressedImage.blob.size <= imageFile.size ? `节省 ${Math.round((1 - compressedImage.blob.size / imageFile.size) * 100)}%` : `增加 ${Math.round((compressedImage.blob.size / imageFile.size - 1) * 100)}%` }}</strong></div><button class="primary" @click="downloadCompressedImage">下载图片</button>
        </section>
      </template>

      <template v-else-if="activeTool === 'image-crop'">
        <header class="toolbox-heading"><div><p>设计工具 / CROP</p><h2>图片裁剪</h2><span>按像素精确裁剪本地图片，裁剪后可直接下载结果。</span></div><button class="back-button" @click="backToPortal">‹ 返回工具列表</button></header>
        <input ref="imageInput" class="visually-hidden" type="file" accept="image/*" @change="onImageSelected"><section class="image-dropzone" :class="{ 'has-image': imagePreviewUrl }" @click="openImagePicker" @dragover.prevent @drop.prevent="onImageDropped"><img v-if="imagePreviewUrl" :src="imagePreviewUrl" :alt="imageFile?.name ?? '图片预览'"><div v-else><SvgIcon name="image" /><strong>选择或拖入图片</strong><span>支持常见图片格式</span></div></section><p class="tool-message">{{ imageMessage }}</p>
        <section v-if="imageFile && imageInfo" class="image-workbench single-image-tool"><div><h3>裁剪区域</h3><p>设置裁剪区域后先应用，再下载处理结果。</p><label>X <input v-model.number="imageCrop.x" type="number" min="0" :max="Math.max(0, imageInfo.width - 1)"></label><label>Y <input v-model.number="imageCrop.y" type="number" min="0" :max="Math.max(0, imageInfo.height - 1)"></label><label>宽 <input v-model.number="imageCrop.width" type="number" min="1" :max="imageInfo.width - imageCrop.x"></label><label>高 <input v-model.number="imageCrop.height" type="number" min="1" :max="imageInfo.height - imageCrop.y"></label><button class="primary" @click="applyCrop">应用裁剪</button><button @click="compressImage">生成下载文件</button></div></section>
        <section v-if="compressedImage && imageFile" class="compression-result"><div><small>裁剪结果</small><strong>{{ formatBytes(compressedImage.blob.size) }}</strong></div><button class="primary" @click="downloadCompressedImage">下载图片</button></section>
      </template>

      <template v-else-if="activeTool === 'background-remove'">
        <header class="toolbox-heading"><div><p>设计工具 / TRANSPARENT BACKGROUND</p><h2>背景透明化</h2><span>基于图片四角的颜色移除接近的纯色背景，适合商品图和证件照。</span></div><button class="back-button" @click="backToPortal">‹ 返回工具列表</button></header>
        <input ref="imageInput" class="visually-hidden" type="file" accept="image/*" @change="onImageSelected"><section class="image-dropzone" :class="{ 'has-image': imagePreviewUrl }" @click="openImagePicker" @dragover.prevent @drop.prevent="onImageDropped"><img v-if="imagePreviewUrl" :src="imagePreviewUrl" :alt="imageFile?.name ?? '图片预览'"><div v-else><SvgIcon name="image" /><strong>选择或拖入图片</strong><span>建议使用纯色背景图片</span></div></section><p class="tool-message">{{ imageMessage }}</p>
        <section v-if="imageFile && imageInfo" class="image-workbench single-image-tool"><div><h3>去除背景</h3><p>根据四角颜色生成透明区域；复杂背景建议多次调整容差。</p><label>容差 <input v-model.number="backgroundTolerance" type="range" min="8" max="100"><output>{{ backgroundTolerance }}</output></label><button class="primary" :disabled="imageProcessing" @click="removeBackground">{{ imageProcessing ? '处理中…' : '去除背景' }}</button><button @click="compressImage">生成下载文件</button></div></section>
        <section v-if="compressedImage && imageFile" class="compression-result"><div><small>处理结果</small><strong>{{ formatBytes(compressedImage.blob.size) }}</strong></div><button class="primary" @click="downloadCompressedImage">下载 PNG</button></section>
      </template>

      <template v-else-if="activeTool === 'screen-color'">
        <header class="toolbox-heading"><div><p>设计工具 / COLOR PICKER</p><h2>屏幕取色</h2><span>从屏幕任意位置吸取颜色，并自动复制 HEX 值。</span></div><button class="back-button" @click="backToPortal">‹ 返回工具列表</button></header>
        <section class="color-card"><div class="color-preview" :style="{ background: imageSampleColor || '#eef2ef' }"></div><label>当前颜色<input :value="imageSampleColor" readonly placeholder="点击开始取色"></label><button class="primary" :disabled="!eyeDropperSupported" @click="pickScreenColor">开始取色</button><p class="tool-message">{{ eyeDropperSupported ? '点击后选择屏幕任意位置，颜色会自动复制到剪贴板。' : '当前 Electron 版本不支持系统屏幕取色。' }}</p></section>
      </template>

      <template v-else-if="activeTool === 'qrcode'">
        <header class="toolbox-heading"><div><p>设计工具 / QR CODE</p><h2>二维码工具</h2><span>生成二维码或从本地图片中识别内容，处理过程不经过网络。</span></div><button class="back-button" @click="backToPortal">‹ 返回工具列表</button></header>
        <input ref="qrInput" class="visually-hidden" type="file" accept="image/*" @change="scanQr(($event.target as HTMLInputElement).files?.[0])">
        <section class="qr-card"><label>二维码内容<textarea v-model="qrText" spellcheck="false" placeholder="输入文本或 URL"></textarea></label><div class="qr-actions"><button class="primary" @click="generateQr">生成二维码</button><button @click="qrInput?.click()">识别本地图片</button><button :disabled="!qrImage" @click="downloadQr">下载 PNG</button></div><p class="tool-message">{{ qrMessage }}</p><img v-if="qrImage" :src="qrImage" alt="生成的二维码"></section>
      </template>

      <template v-else-if="activeTool === 'volta'">
        <header class="toolbox-heading"><div><p>数据工具 / VOLTA</p><h2>Node.js 版本管理</h2><span>这是 Volta 的可视化入口：界面直接调用本机 Volta，不替代它的版本管理机制。</span></div><button class="back-button" @click="backToPortal">‹ 返回工具列表</button></header>
        <section class="volta-overview"><div class="volta-summary"><small>VOLTA</small><strong>{{ voltaState?.installed ? `v${voltaState.voltaVersion}` : '未检测' }}</strong><span>{{ voltaState?.installed ? '本机命令行工具链' : '请确认已安装并加入 PATH' }}</span></div><div class="volta-summary"><small>默认 NODE</small><strong>{{ voltaState?.defaultVersion ? `v${voltaState.defaultVersion}` : '—' }}</strong><span>全局默认；项目固定版本优先</span></div><div class="volta-summary"><small>当前 NODE</small><strong>{{ voltaState?.currentVersion ? `v${voltaState.currentVersion}` : '—' }}</strong><span>当前 LocalForge 工作目录的解析结果</span></div></section>
        <section class="release-catalog"><header><div><p>VOLTA / DOWNLOADABLE NODE</p><h3>可下载 Node 版本</h3><span>目录复用 <code>nvm list available</code>；每个主版本仅保留最新 LTS，安装时只调用 Volta。</span></div><button :disabled="nodeReleasesBusy" @click="refreshNodeReleases">{{ nodeReleasesBusy ? '读取中…' : '刷新列表' }}</button></header><p class="tool-message">{{ nodeReleasesMessage }}</p><div v-if="voltaDownloadableReleases.length" class="release-list"><div v-for="release in voltaDownloadableReleases" :key="release.version" class="release-row"><code>v{{ release.version }}</code><span>LTS</span><small>Node {{ release.version.split('.')[0] }} 主版本的最新 LTS</small><button class="primary" :disabled="voltaBusy || !voltaState?.installed" @click="installVoltaNode(release.version)">Volta 安装</button></div></div><p v-else-if="nodeReleases.length" class="empty-state">NVM 未返回 LTS 版本。</p></section>
        <section v-if="!voltaState?.installed" class="manager-installs"><span>未检测到 Volta，可通过 winget 安装：</span><button :disabled="Boolean(managerInstallBusy)" @click="installVersionManager('volta')">{{ managerInstallBusy === 'volta' ? '正在安装 Volta…' : '安装 Volta' }}</button></section>
        <section class="volta-actions"><label>已安装版本<select v-model="voltaSelectedVersion" :disabled="voltaBusy || !voltaState?.versions.length"><option v-for="item in voltaState?.versions ?? []" :key="item.version" :value="item.version">v{{ item.version }}{{ item.isDefault ? '（默认）' : '' }}</option></select></label><button :disabled="voltaBusy || !voltaSelectedVersion || voltaSelectedVersion === voltaState?.defaultVersion" @click="setVoltaDefault">{{ voltaSelectedVersion === voltaState?.defaultVersion ? '当前默认版本' : '设为默认' }}</button><label>安装新版本<input v-model.trim="voltaVersionInput" placeholder="例如 22、22.18.0、lts 或 latest" @keyup.enter="installVoltaNode()"></label><button class="primary" :disabled="voltaBusy" @click="installVoltaNode()">{{ voltaBusy ? '处理中…' : '安装并设为默认' }}</button><button :disabled="voltaBusy" @click="refreshVoltaState">刷新列表</button><p class="tool-message" :class="{ error: voltaState && !voltaState.installed }">{{ voltaMessage }}</p></section>
        <section v-if="voltaState?.installed" class="results-card volta-versions"><header><div><strong>Volta Node 运行时</strong><small>直接读取 <code>volta list all</code>；该命令只列出本机 Volta 工具链。</small></div></header><div v-if="voltaState.versions.length" class="volta-version-list"><div v-for="item in voltaState.versions" :key="item.version" class="volta-version-row"><code>v{{ item.version }}</code><span v-if="item.isDefault">默认版本</span><button :disabled="voltaBusy || item.isDefault" @click="voltaSelectedVersion = item.version; setVoltaDefault()">{{ item.isDefault ? '正在使用' : '设为默认' }}</button></div></div><p v-else class="empty-state">Volta 未返回 Node 运行时。</p></section>
        <section class="volta-pin"><div><strong>为项目固定 Node 版本</strong><span>会由 Volta 修改所选项目的 <code>package.json</code>，适合需要提交团队版本约束的项目。</span></div><input :value="voltaProjectPath" readonly placeholder="选择项目目录"><button @click="chooseVoltaProject">选择目录</button><button class="primary" :disabled="voltaBusy || !voltaProjectPath" @click="pinVoltaNode">固定到项目</button></section>
      </template>

      <template v-else-if="activeTool === 'nvm'">
        <header class="toolbox-heading"><div><p>数据工具 / NVM</p><h2>NVM Node.js 管理</h2><span>直接调用 NVM for Windows；切换版本会改变系统当前启用的 Node。</span></div><button class="back-button" @click="backToPortal">‹ 返回工具列表</button></header>
        <section class="nvm-overview"><div><small>NVM</small><strong>{{ nvmState?.installed ? `v${nvmState.nvmVersion}` : '未检测' }}</strong><span>{{ nvmState?.installed ? '本机 NVM for Windows' : '请确认已安装并加入 PATH' }}</span></div><div><small>当前 NODE</small><strong>{{ nvmState?.currentVersion ? `v${nvmState.currentVersion}` : '—' }}</strong><span>由 <code>nvm use</code> 管理</span></div></section>
        <section class="release-catalog"><header><div><p>NVM LIST AVAILABLE</p><h3>可下载版本</h3><span>直接执行 <code>nvm list available</code>，默认每个主版本仅显示最新长期支持版。</span></div><button :disabled="nodeReleasesBusy" @click="refreshNodeReleases">{{ nodeReleasesBusy ? '读取中…' : '刷新列表' }}</button></header><p class="tool-message">{{ nodeReleasesMessage }}</p><label class="release-filter"><input v-model="showAllNvmReleases" type="checkbox"> 显示所有版本 <small>默认显示 {{ latestLtsNodeReleases.length }} 个 LTS 主版本</small></label><div v-if="visibleNodeReleases.length" class="release-list"><div v-for="release in visibleNodeReleases" :key="`${release.channel}-${release.version}`" class="release-row"><code>v{{ release.version }}</code><span :class="`release-channel-${release.channel.toLowerCase().replace(/\s+/g, '-')}`">{{ release.channel }}</span><small>{{ release.channel === 'LTS' ? '长期支持版本' : 'NVM 可安装版本' }}</small><button class="primary" :disabled="nvmBusy || !nvmState?.installed" @click="installNvmNode(release.version)">NVM 安装</button></div></div><p v-else-if="nodeReleases.length" class="empty-state">NVM 没有返回 LTS 版本；开启“显示所有版本”查看完整列表。</p><div v-if="!nvmState?.installed" class="manager-installs"><span>未检测到 NVM，可通过 winget 安装：</span><button :disabled="Boolean(managerInstallBusy)" @click="installVersionManager('nvm')">{{ managerInstallBusy === 'nvm' ? '正在安装 NVM…' : '安装 NVM for Windows' }}</button></div></section>
        <section class="nvm-actions"><label>Node 版本<input v-model.trim="nvmVersionInput" placeholder="例如 20.19.0 或 22" @keyup.enter="installNvmNode"></label><button class="primary" :disabled="nvmBusy" @click="installNvmNode">{{ nvmBusy ? '处理中…' : '安装版本' }}</button><button :disabled="nvmBusy" @click="refreshNvmState">刷新状态</button><p class="tool-message" :class="{ error: nvmState && !nvmState.installed }">{{ nvmMessage }}</p></section>
        <section v-if="nvmState?.installed" class="results-card nvm-versions"><div v-if="nvmState.versions.length" class="nvm-version-list"><div v-for="item in nvmState.versions" :key="item.version" class="nvm-version-row"><code>v{{ item.version }}</code><span v-if="item.isCurrent">当前使用</span><button :disabled="nvmBusy || item.isCurrent" @click="useNvmNode(item.version)">{{ item.isCurrent ? '正在使用' : '切换到此版本' }}</button><button class="danger" :disabled="nvmBusy || item.isCurrent" @click="uninstallNvmNode(item.version)">移除</button></div></div><p v-else class="empty-state">NVM 中暂未安装 Node 版本。</p></section>
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
          <dl v-if="exitIp" class="ip-result"><div class="ip-result-primary"><dt>出口 IP</dt><dd>{{ exitIp.ip }}</dd><button type="button" @click="copyExitIp">复制 IP</button></div><div><dt>国家或地区</dt><dd>{{ exitIp.country || '未提供' }}</dd></div><div><dt>城市</dt><dd>{{ exitIp.city || '未提供' }}</dd></div><div><dt>网络服务商</dt><dd>{{ exitIp.isp || '未提供' }}</dd></div><div><dt>时区</dt><dd>{{ exitIp.timezone || '未提供' }}</dd></div></dl>
        </section>
      </template>

      <template v-else-if="activeTool === 'network-diagnosis'">
        <header class="toolbox-heading"><div><p>网络工具 / DNS 与 TCP</p><h2>网络诊断</h2><span>检查域名解析结果，并从本机测试指定 TCP 端口的连通性。</span></div><button class="back-button" @click="backToPortal">‹ 返回工具列表</button></header>
        <section class="network-form"><label>域名或 IP<input v-model.trim="networkHost" placeholder="例如 api.example.com"></label><label>端口<input v-model.number="networkPort" type="number" min="1" max="65535"></label><label>探测方式<select v-model="networkMode"><option value="tcp">TCP（Telnet 类）</option><option value="http">HTTP</option><option value="https">HTTPS</option></select></label><button class="primary" :disabled="networkDiagnosisState === 'checking'" @click="runNetworkDiagnosis">{{ networkDiagnosisState === 'checking' ? '诊断中…' : '开始诊断' }}</button><button :disabled="!networkDiagnosis" @click="copyNetworkDiagnosis">复制诊断结果</button></section>
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
