import type { MetricSnapshot } from '@localforge/shared/metrics'
import type { LlmChatResult, LlmTestResult, ModelConfig, ModelConfigInput } from '@localforge/shared/model-config'

declare global {
  type CleanupTarget = { id: string; path: string }
  type DeleteResult = { id: string; path?: string; success: boolean; error?: string }
  type ExitIpResult = { ip: string; country: string; city: string; isp: string; timezone: string }
  type LocalIpv4 = { name: string; address: string }
  // 冻结式取色的整屏快照：RGBA 像素（每像素 4 字节，主进程已从 BGRA 转正）。
  type DisplaySnapshot = { image: Uint8Array; width: number; height: number }
  type ListeningProcess = { protocol: string; address: string; port: number; pid: number; name: string }
  type NetworkDiagnosis = { host: string; port: number; mode: 'tcp' | 'http' | 'https'; addresses: string[]; dnsError?: string; ipv4: string[]; ipv6: string[]; tcp: { reachable: boolean; latencyMs?: number; error?: string }; http?: { reachable: boolean; status?: number; statusText?: string; latencyMs?: number; error?: string } }
  type VoltaNodeState = { installed: boolean; voltaVersion?: string; versions: Array<{ version: string; isDefault: boolean }>; defaultVersion?: string; currentVersion?: string; error?: string }
  type NodeRelease = { version: string; channel: 'CURRENT' | 'LTS' | 'OLD STABLE' | 'OLD UNSTABLE' }
  type AssistantPromptTool = 'codex' | 'cursor' | 'claude-code'
  type AssistantConfigFile = 'prompt' | 'config'
  type AssistantConfigResult = { path: string; exists: boolean; content: string }
  type NginxStatus = { exeConfigured: boolean; exePath?: string; prefix?: string; paths?: { conf: string; logs: string; html: string }; configExists: boolean; running: boolean; processes: Array<{ pid: number; role: 'master' | 'worker' }>; autostart: boolean; autostartCommand?: string }
  type NginxAction = 'stop' | 'quit' | 'reload' | 'reopen'
  type NginxOpenTarget = 'prefix' | 'confDir' | 'logs' | 'html' | 'config'
  type FrpcStatus = { exeConfigured: boolean; configConfigured: boolean; ready: boolean; exePath?: string; configPath?: string; configExists: boolean; running: boolean; processes: Array<{ pid: number }>; admin?: { addr: string; port: number; reachable: boolean; requiresAuth: boolean }; autostart: boolean; autostartCommand?: string }
  type FrpcTunnel = { name: string; type: string; status: string; trafficIn: number; trafficOut: number; todayTraffic: number }
  type FrpcTunnelsResult = { available: boolean; reason?: string; tunnels: FrpcTunnel[] }
  type FrpcOpenTarget = 'exeDir' | 'configDir' | 'config'

  interface Window {
    developerTools: { selectDirectory(): Promise<string | undefined>; scanDirectories(rootPath: string, directoryName: string): Promise<CleanupTarget[]>; deleteDirectories(ids: string[]): Promise<DeleteResult[]>; selectImageOutputDirectory(): Promise<string | undefined>; saveCompressedImages(outputDirectory: string, files: Array<{ name: string; data: ArrayBuffer }>): Promise<{ directory: string; files: string[] }> }
    hardwareMonitor: { getSnapshot(): Promise<MetricSnapshot | undefined>; getHistory(): Promise<MetricSnapshot[]>; subscribe(callback: (snapshot: MetricSnapshot) => void): () => void; moveOverlay(position: { x: number; y: number }): void; movePanel(position: { x: number; y: number }): void; moveTrend(position: { x: number; y: number }): void; openPanel(): void; closePanel(): void; openTrend(): void; closeTrend(): void; subscribeStatus(callback: (text: string) => void): () => void }
    windowControls: { minimize(): void; toggleMaximize(): void; close(): void; isMaximized(): Promise<boolean> }
    networkTools?: { getLocalIpv4(): Promise<{ lan: LocalIpv4[]; wired: LocalIpv4[] }>; detectExitIp(): Promise<ExitIpResult>; diagnose(host: string, port: number, mode: 'tcp' | 'http' | 'https'): Promise<NetworkDiagnosis> }
    processTools?: { listListening(): Promise<ListeningProcess[]>; terminate(pid: number): Promise<{ pid: number }> }
    voltaTools?: { getNodeState(): Promise<VoltaNodeState>; installNode(version: string): Promise<VoltaNodeState>; pinNode(version: string, directory: string): Promise<{ directory: string; version: string }> }
    nodeReleaseTools?: { list(): Promise<NodeRelease[]>; installManager(manager: 'volta'): Promise<VoltaNodeState> }
    assistantConfig?: { read(tool: AssistantPromptTool, file: AssistantConfigFile): Promise<AssistantConfigResult>; save(tool: AssistantPromptTool, file: AssistantConfigFile, content: string): Promise<{ path: string }> }
    nginxTools?: { status(): Promise<NginxStatus>; browse(): Promise<{ path?: string }>; setPath(path: string): Promise<NginxStatus>; start(): Promise<{ output: string; ok: boolean }>; control(action: NginxAction): Promise<{ output: string; ok: boolean }>; testConfig(): Promise<{ output: string; ok: boolean }>; killAll(): Promise<{ killed: number }>; setAutostart(enabled: boolean): Promise<NginxStatus>; readConfig(): Promise<AssistantConfigResult>; saveConfig(content: string): Promise<{ path: string }>; open(target: NginxOpenTarget): Promise<void> }
    frpcTools?: { status(): Promise<FrpcStatus>; tunnels(): Promise<FrpcTunnelsResult>; browseExe(): Promise<{ path?: string }>; browseConfig(): Promise<{ path?: string }>; setExe(path: string): Promise<FrpcStatus>; setConfig(path: string): Promise<FrpcStatus>; start(): Promise<{ output: string; ok: boolean }>; stop(): Promise<{ output: string; ok: boolean }>; reload(): Promise<{ output: string; ok: boolean }>; verify(): Promise<{ output: string; ok: boolean }>; killAll(): Promise<{ killed: number }>; setAutostart(enabled: boolean): Promise<FrpcStatus>; readConfig(): Promise<AssistantConfigResult>; saveConfig(content: string): Promise<{ path: string }>; open(target: FrpcOpenTarget): Promise<void> }
    screenColorPicker?: { pick(): Promise<string>; snapshot(displayId: number): Promise<DisplaySnapshot>; choose(color: string): void; cancel(): void }
    menuSqlTools?: { saveScript(request: { fileName?: string; content: string }): Promise<{ path: string } | undefined> }
    modelConfigs?: {
      list(): Promise<ModelConfig[]>
      save(input: ModelConfigInput, id?: string): Promise<ModelConfig>
      remove(id: string): Promise<void>
      setDefault(id: string): Promise<void>
    }
    llmTools?: {
      test(config: ModelConfig): Promise<LlmTestResult>
      chat(request: { config: ModelConfig; messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> }): Promise<LlmChatResult>
      chatStream(request: { config: ModelConfig; messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>): {
        onChunk(callback: (delta: string) => void): () => void
        onDone(callback: (finishReason?: string) => void): () => void
        onError(callback: (error: string) => void): () => void
      }
    }
  }
}

export {}
