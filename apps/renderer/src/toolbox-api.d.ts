import type { MetricSnapshot } from '@localforge/shared/metrics'

declare global {
  type CleanupTarget = { id: string; path: string }
  type DeleteResult = { id: string; path?: string; success: boolean; error?: string }
  type ExitIpResult = { ip: string; country: string; city: string; isp: string; timezone: string }
  type LocalIpv4 = { name: string; address: string }
  type ListeningProcess = { protocol: string; address: string; port: number; pid: number; name: string }
  type NetworkDiagnosis = { host: string; port: number; mode: 'tcp' | 'http' | 'https'; addresses: string[]; dnsError?: string; ipv4: string[]; ipv6: string[]; tcp: { reachable: boolean; latencyMs?: number; error?: string }; http?: { reachable: boolean; status?: number; statusText?: string; latencyMs?: number; error?: string } }
  type VoltaNodeState = { installed: boolean; voltaVersion?: string; versions: Array<{ version: string; isDefault: boolean }>; defaultVersion?: string; currentVersion?: string; error?: string }
  type NvmNodeState = { installed: boolean; nvmVersion?: string; versions: Array<{ version: string; isCurrent: boolean }>; currentVersion?: string; error?: string }
  type NodeRelease = { version: string; channel: 'CURRENT' | 'LTS' | 'OLD STABLE' | 'OLD UNSTABLE' }
  type AssistantPromptTool = 'codex' | 'cursor' | 'claude-code'
  type AssistantConfigFile = 'prompt' | 'config'
  type AssistantConfigResult = { path: string; exists: boolean; content: string }

  interface Window {
    developerTools: { selectDirectory(): Promise<string | undefined>; scanDirectories(rootPath: string, directoryName: string): Promise<CleanupTarget[]>; deleteDirectories(ids: string[]): Promise<DeleteResult[]>; selectImageOutputDirectory(): Promise<string | undefined>; saveCompressedImages(outputDirectory: string, files: Array<{ name: string; data: ArrayBuffer }>): Promise<{ directory: string; files: string[] }> }
    hardwareMonitor: { getSnapshot(): Promise<MetricSnapshot | undefined>; getHistory(): Promise<MetricSnapshot[]>; subscribe(callback: (snapshot: MetricSnapshot) => void): () => void; moveOverlay(position: { x: number; y: number }): void; movePanel(position: { x: number; y: number }): void; moveTrend(position: { x: number; y: number }): void; openPanel(): void; closePanel(): void; openTrend(): void; closeTrend(): void; subscribeStatus(callback: (text: string) => void): () => void }
    windowControls: { minimize(): void; toggleMaximize(): void; close(): void; isMaximized(): Promise<boolean> }
    networkTools?: { getLocalIpv4(): Promise<{ lan: LocalIpv4[]; wired: LocalIpv4[] }>; detectExitIp(): Promise<ExitIpResult>; diagnose(host: string, port: number, mode: 'tcp' | 'http' | 'https'): Promise<NetworkDiagnosis> }
    processTools?: { listListening(): Promise<ListeningProcess[]>; terminate(pid: number): Promise<{ pid: number }> }
    voltaTools?: { getNodeState(): Promise<VoltaNodeState>; installNode(version: string): Promise<VoltaNodeState>; pinNode(version: string, directory: string): Promise<{ directory: string; version: string }> }
    nvmTools?: { getNodeState(): Promise<NvmNodeState>; installNode(version: string): Promise<NvmNodeState>; useNode(version: string): Promise<NvmNodeState>; uninstallNode(version: string): Promise<NvmNodeState> }
    nodeReleaseTools?: { list(): Promise<NodeRelease[]>; installManager(manager: 'volta' | 'nvm'): Promise<VoltaNodeState | NvmNodeState> }
    assistantConfig?: { read(tool: AssistantPromptTool, file: AssistantConfigFile): Promise<AssistantConfigResult>; save(tool: AssistantPromptTool, file: AssistantConfigFile, content: string): Promise<{ path: string }> }
    screenColorPicker?: { pick(): Promise<string>; preview(point: { x: number; y: number }): Promise<{ color: string; preview: string }>; choose(point: { x: number; y: number }): void; cancel(): void }
  }
}

export {}
