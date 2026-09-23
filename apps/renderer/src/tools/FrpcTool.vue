<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import ToolboxPage from '../ToolboxPage.vue'

const router = useRouter()
const backToPortal = () => router.push({ name: 'portal' })

const status = ref<FrpcStatus>()
const message = ref('正在检测 frpc 状态…')
const messageKind = ref<'info' | 'error' | 'ok'>('info')
const busy = ref(false)
const config = ref('')
const configPath = ref('')
const configDirty = ref(false)

const tunnels = ref<FrpcTunnel[]>([])
const tunnelNote = ref('')
const tunnelLoaded = ref(false)

const notSupported = computed(() => !window.frpcTools)
const running = computed(() => status.value?.running ?? false)
const canControl = computed(() => Boolean(status.value?.ready))
const adminLabel = computed(() => {
  const admin = status.value?.admin
  if (!admin) return '未探测'
  const url = `http://${admin.addr}:${admin.port}`
  if (admin.reachable) return `${url}（可访问）`
  return admin.requiresAuth ? `${url}（需鉴权或不可达）` : `${url}（不可达，可能未开启 webServer）`
})

const report = (text: string, kind: 'info' | 'error' | 'ok' = 'info') => { message.value = text; messageKind.value = kind }

const refresh = async (quiet = false) => {
  if (!window.frpcTools) { report('请重启应用以加载 frpc 组件。', 'error'); return }
  try {
    status.value = await window.frpcTools.status()
    if (!quiet && !status.value.ready) report(status.value.exeConfigured ? '已选择 frpc.exe，请再选择配置文件。' : '请先选择 frpc.exe 与配置文件。')
    if (!quiet && status.value.ready) report(status.value.running ? `frpc 正在运行（${status.value.processes.length} 个进程）。` : 'frpc 未运行。', status.value.running ? 'ok' : 'info')
  } catch (error) {
    report(error instanceof Error ? error.message : String(error), 'error')
  }
}

let pollTimer: ReturnType<typeof setTimeout> | undefined
let disposed = false
// 启动是后台交付的，进程要稍后才可见；连续轮询几次把真实结果反馈出来。
const pollUntilSettled = () => {
  let attempts = 0
  const tick = async () => {
    if (disposed) return
    await refresh(true)
    if (disposed) return
    attempts += 1
    if (!running.value && attempts < 6) pollTimer = setTimeout(tick, 700)
    else if (running.value) report(`frpc 已启动（${status.value?.processes.length ?? 0} 个进程）。`, 'ok')
    else report('未能确认 frpc 已启动，请检查与 frps 的连接或配置。', 'error')
  }
  pollTimer = setTimeout(tick, 500)
}

const chooseExe = async () => {
  if (!window.frpcTools) return
  try {
    const { path } = await window.frpcTools.browseExe()
    if (!path) return
    status.value = await window.frpcTools.setExe(path)
    report(`已关联 ${path}。`, 'ok')
  } catch (error) { report(error instanceof Error ? error.message : String(error), 'error') }
}

const chooseConfig = async () => {
  if (!window.frpcTools) return
  try {
    const { path } = await window.frpcTools.browseConfig()
    if (!path) return
    status.value = await window.frpcTools.setConfig(path)
    report(`已关联配置 ${path}。`, 'ok')
  } catch (error) { report(error instanceof Error ? error.message : String(error), 'error') }
}

const runAction = async (label: string, action: () => Promise<{ output: string; ok: boolean }>, confirmText?: string) => {
  if (!window.frpcTools || busy.value) return
  if (confirmText && !window.confirm(confirmText)) return
  busy.value = true
  try {
    const result = await action()
    report(`${label}：${result.output}`, result.ok ? 'ok' : 'error')
    await refresh(true)
  } catch (error) {
    report(error instanceof Error ? error.message : String(error), 'error')
  } finally {
    busy.value = false
  }
}

const startFrpc = async () => {
  if (!window.frpcTools || busy.value) return
  busy.value = true
  try {
    const result = await window.frpcTools.start()
    report(`启动：${result.output}`, result.ok ? 'ok' : 'error')
    if (result.ok) pollUntilSettled()
    else await refresh(true)
  } catch (error) {
    report(error instanceof Error ? error.message : String(error), 'error')
  } finally {
    busy.value = false
  }
}

const toggleAutostart = async (event: Event) => {
  if (!window.frpcTools) return
  const enabled = (event.target as HTMLInputElement).checked
  try {
    status.value = await window.frpcTools.setAutostart(enabled)
    report(enabled ? '已开启开机自启（当前用户登录后启动）。' : '已关闭开机自启。', 'ok')
  } catch (error) {
    report(error instanceof Error ? error.message : String(error), 'error')
    await refresh(true) // 失败时回滚开关显示的真实状态。
  }
}

const verify = async () => { await runAction('配置校验', () => window.frpcTools!.verify()) }
const reload = async () => { await runAction('热重载', () => window.frpcTools!.reload(), '热重载会通过 admin API 应用新配置，无需重启。是否继续？') }
const stop = async () => { await runAction('停止', () => window.frpcTools!.stop(), '停止会结束本配置的 frpc 进程，穿透连接随之中断。是否继续？') }

const loadTunnels = async () => {
  if (!window.frpcTools) return
  tunnelLoaded.value = true
  try {
    const result = await window.frpcTools.tunnels()
    tunnels.value = result.tunnels
    tunnelNote.value = result.available ? '' : (result.reason ?? '无法获取隧道状态')
    if (result.available) report(`已刷新 ${result.tunnels.length} 条隧道状态。`, 'ok')
  } catch (error) {
    tunnels.value = []
    tunnelNote.value = error instanceof Error ? error.message : String(error)
  }
}

const formatBytes = (bytes: number) => {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`
}

const loadConfig = async () => {
  if (!window.frpcTools) return
  try {
    const result = await window.frpcTools.readConfig()
    configPath.value = result.path
    config.value = result.content
    configDirty.value = false
    report(result.exists ? `已载入 ${result.path}` : '配置文件尚不存在，可直接写入。')
  } catch (error) { report(error instanceof Error ? error.message : String(error), 'error') }
}

const saveConfig = async () => {
  if (!window.frpcTools || !config.value.trim()) { report('配置内容为空，已取消保存。', 'error'); return }
  if (!window.confirm('将覆盖现有配置文件（旧内容备份为 .bak）。是否继续？')) return
  try {
    const result = await window.frpcTools.saveConfig(config.value)
    configDirty.value = false
    const check = await window.frpcTools.verify()
    report(`已保存到 ${result.path}。校验：${check.output}`, check.ok ? 'ok' : 'error')
  } catch (error) { report(error instanceof Error ? error.message : String(error), 'error') }
}

const openTarget = async (target: FrpcOpenTarget) => {
  if (!window.frpcTools) return
  try { await window.frpcTools.open(target) } catch (error) { report(error instanceof Error ? error.message : String(error), 'error') }
}

const killAll = async () => {
  if (!window.frpcTools) return
  if (!window.confirm('将强制结束本机全部 frpc 进程（含其他实例），可能中断正在穿透的连接。是否继续？')) return
  busy.value = true
  try {
    const { killed } = await window.frpcTools.killAll()
    report(killed ? `已结束 ${killed} 个 frpc 进程。` : '没有发现 frpc 进程。', 'ok')
    await refresh(true)
  } catch (error) { report(error instanceof Error ? error.message : String(error), 'error') } finally { busy.value = false }
}

// 与端口工具一致：状态变化后即时刷新，不做后台轮询（每次检测都要起一次外部进程）。
onBeforeUnmount(() => { disposed = true; if (pollTimer) clearTimeout(pollTimer) })

void refresh()
</script>

<template>
  <ToolboxPage>
    <header class="toolbox-heading">
      <div><p>网络工具 / FRPC</p><h2>frpc 内网穿透管理</h2><span>本机 frpc 客户端的启停、配置校验与编辑、热重载、隧道状态与开机自启。</span></div>
      <button class="back-button" @click="backToPortal">‹ 返回工具列表</button>
    </header>

    <p v-if="notSupported" class="tool-message error">frpc 管理当前仅支持 Windows。</p>

    <template v-else>
      <section class="ip-check-card">
        <div class="ip-check-intro">
          <i>{{ running ? '●' : '○' }}</i>
          <div>
            <strong>{{ running ? 'frpc 正在运行' : status?.ready ? 'frpc 未运行' : '尚未完成关联' }}</strong>
            <span v-if="running">{{ status?.processes.length }} 个进程 · PID {{ status?.processes.map((item) => item.pid).join('、') }}</span>
            <span v-else-if="status?.ready">点击「启动」拉起客户端，或先用「校验配置」排除语法问题。</span>
            <span v-else>分别选择 frpc.exe 与配置文件（frpc.toml / frpc.ini），二者可在任意目录。</span>
          </div>
          <div class="frpc-header-actions">
            <button type="button" :disabled="busy" @click="refresh(false)">刷新状态</button>
            <button type="button" :disabled="busy" @click="chooseExe">{{ status?.exeConfigured ? '重选 exe' : '选择 frpc.exe' }}</button>
            <button type="button" :disabled="busy" @click="chooseConfig">{{ status?.configConfigured ? '重选配置' : '选择配置文件' }}</button>
          </div>
        </div>
        <p class="tool-message" :class="{ error: messageKind === 'error', ok: messageKind === 'ok' }">{{ message }}</p>
        <dl v-if="status?.ready" class="ip-result">
          <div class="ip-result-primary"><dt>可执行文件</dt><dd :title="status.exePath">{{ status.exePath }}</dd></div>
          <div class="ip-result-primary"><dt>配置文件</dt><dd :title="status.configPath">{{ status.configPath }}</dd></div>
          <div><dt>进程 PID</dt><dd>{{ status.processes.length ? status.processes.map((item) => item.pid).join('  ') : '无' }}</dd></div>
          <div><dt>Admin API</dt><dd>{{ adminLabel }}</dd></div>
          <div><dt>开机自启</dt><dd>{{ status.autostart ? '已开启（登录后启动）' : '未开启' }}</dd></div>
        </dl>
      </section>

      <section v-if="canControl" class="network-form frpc-actions">
        <button class="primary" :disabled="busy || running" @click="startFrpc">启动</button>
        <button :disabled="busy || !running" @click="reload">热重载</button>
        <button :disabled="busy || !running" @click="stop">停止</button>
        <button @click="verify">校验配置</button>
        <button class="danger" :disabled="busy" @click="killAll">强制结束进程</button>
        <label class="frpc-autostart"><input type="checkbox" :checked="status?.autostart" :disabled="busy || !status?.ready" @change="toggleAutostart"><span>开机自启</span></label>
      </section>

      <section v-if="canControl" class="results-card frpc-tunnels">
        <div class="results-heading">
          <h3>隧道状态</h3>
          <p>来自 frpc admin API（配置里的 webServer / admin_port）· 需 frpc 正在运行且开启 admin 接口</p>
        </div>
        <div class="frpc-tunnel-actions">
          <button :disabled="busy || !running" @click="loadTunnels">刷新隧道</button>
          <span v-if="!running" class="frpc-tunnel-hint">启动后可查看各隧道在线状态与流量。</span>
        </div>
        <p v-if="tunnelNote" class="tool-message error">{{ tunnelNote }}</p>
        <table v-else-if="tunnels.length" class="frpc-tunnel-table">
          <thead><tr><th>隧道名称</th><th>类型</th><th>状态</th><th>今日流量</th><th>累计入 / 出</th></tr></thead>
          <tbody>
            <tr v-for="tunnel in tunnels" :key="tunnel.name">
              <td>{{ tunnel.name }}</td>
              <td>{{ tunnel.type }}</td>
              <td :class="{ 'frpc-online': tunnel.status === 'online', 'frpc-waiting': tunnel.status !== 'online' }">{{ tunnel.status }}</td>
              <td>{{ formatBytes(tunnel.todayTraffic) }}</td>
              <td>{{ formatBytes(tunnel.trafficIn) }} / {{ formatBytes(tunnel.trafficOut) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else-if="tunnelLoaded" class="frpc-tunnel-hint">未返回任何隧道，请确认配置里已定义代理（proxies）。</p>
      </section>

      <section v-if="canControl" class="network-form frpc-open">
        <span class="frpc-open-label">快速打开</span>
        <button @click="openTarget('exeDir')">程序目录</button>
        <button @click="openTarget('configDir')">配置目录</button>
        <button @click="openTarget('config')">默认程序打开配置</button>
      </section>

      <section v-if="canControl" class="results-card frpc-config">
        <div class="results-heading">
          <h3>配置文件</h3>
          <p>{{ configPath || (status?.configExists ? '配置文件' : '尚未载入') }} · 保存前自动备份为 .bak，保存后自动执行 frpc verify</p>
        </div>
        <div class="frpc-config-actions">
          <button :disabled="busy" @click="loadConfig">载入配置</button>
          <button class="primary" :disabled="!configDirty" @click="saveConfig">保存并校验</button>
          <span v-if="configDirty" class="frpc-dirty">有未保存的修改</span>
        </div>
        <textarea v-model="config" spellcheck="false" placeholder="点击「载入配置」读取 frpc 配置文件" @input="configDirty = true"></textarea>
      </section>
    </template>
  </ToolboxPage>
</template>

<style scoped>
.frpc-header-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
.frpc-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 18px; }
.frpc-autostart { display: flex; align-items: center; gap: 7px; margin-left: auto; color: #526158; font-size: 13px; font-weight: 750; cursor: pointer; }
.frpc-autostart input { width: 15px; height: 15px; accent-color: #069f4f; cursor: pointer; }
.frpc-open { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 14px; }
.frpc-open-label { color: #7a8c82; font-size: 12px; font-weight: 850; letter-spacing: .06em; }
.frpc-tunnels { margin-top: 20px; padding: 20px; }
.frpc-tunnel-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 4px 0 12px; }
.frpc-tunnel-hint { color: #7a8c82; font-size: 12px; }
.frpc-tunnel-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.frpc-tunnel-table th, .frpc-tunnel-table td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #eef2ef; }
.frpc-tunnel-table th { color: #7a8c82; font-weight: 800; }
.frpc-online { color: #078f46; font-weight: 700; }
.frpc-waiting { color: #c07a17; font-weight: 700; }
.frpc-config { margin-top: 20px; padding: 20px; }
.frpc-config textarea { width: 100%; min-height: 380px; padding: 13px; resize: vertical; }
.frpc-config-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 4px 0 12px; }
.frpc-dirty { color: #c07a17; font-size: 12px; font-weight: 700; }
.tool-message.ok { color: #078f46; }
</style>
