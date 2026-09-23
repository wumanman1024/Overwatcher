<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import ToolboxPage from '../ToolboxPage.vue'

const router = useRouter()
const backToPortal = () => router.push({ name: 'portal' })

const status = ref<NginxStatus>()
const message = ref('正在检测 nginx 状态…')
const messageKind = ref<'info' | 'error' | 'ok'>('info')
const busy = ref(false)
const config = ref('')
const configPath = ref('')
const configDirty = ref(false)

const notSupported = computed(() => !window.nginxTools)
const running = computed(() => status.value?.running ?? false)
const canControl = computed(() => Boolean(status.value?.exeConfigured))
const masterCount = computed(() => status.value?.processes.filter((item) => item.role === 'master').length ?? 0)
const workerCount = computed(() => status.value?.processes.filter((item) => item.role === 'worker').length ?? 0)

const report = (text: string, kind: 'info' | 'error' | 'ok' = 'info') => { message.value = text; messageKind.value = kind }

const refresh = async (quiet = false) => {
  if (!window.nginxTools) { report('请重启应用以加载 nginx 组件。', 'error'); return }
  try {
    status.value = await window.nginxTools.status()
    if (!quiet && !status.value.exeConfigured) report('请先选择 nginx.exe 路径。')
    if (!quiet && status.value.exeConfigured) report(status.value.running ? `nginx 正在运行（${masterCount.value} master / ${workerCount.value} worker）。` : 'nginx 未运行。', status.value.running ? 'ok' : 'info')
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
    else if (running.value) report(`nginx 已启动（${masterCount.value} master / ${workerCount.value} worker）。`, 'ok')
    else report('未能确认 nginx 已启动，请检查端口占用或错误日志。', 'error')
  }
  pollTimer = setTimeout(tick, 500)
}

const choosePath = async () => {
  if (!window.nginxTools) return
  try {
    const { path } = await window.nginxTools.browse()
    if (!path) return
    status.value = await window.nginxTools.setPath(path)
    report(`已关联 ${status.value.prefix}。`, 'ok')
  } catch (error) { report(error instanceof Error ? error.message : String(error), 'error') }
}

const runAction = async (label: string, action: () => Promise<{ output: string; ok: boolean }>, confirmText?: string) => {
  if (!window.nginxTools || busy.value) return
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

const startNginx = async () => {
  if (!window.nginxTools || busy.value) return
  busy.value = true
  try {
    const result = await window.nginxTools.start()
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
  if (!window.nginxTools) return
  const enabled = (event.target as HTMLInputElement).checked
  try {
    status.value = await window.nginxTools.setAutostart(enabled)
    report(enabled ? '已开启开机自启（当前用户登录后启动）。' : '已关闭开机自启。', 'ok')
  } catch (error) {
    report(error instanceof Error ? error.message : String(error), 'error')
    await refresh(true) // 失败时回滚开关显示的真实状态。
  }
}

const testConfig = async () => { await runAction('配置校验', () => window.nginxTools!.testConfig()) }

// 模板取不到 window（不在 Vue 的全局白名单里），信号类操作在这里包一层。
const control = (action: NginxAction) => () => window.nginxTools!.control(action)

const loadConfig = async () => {
  if (!window.nginxTools) return
  try {
    const result = await window.nginxTools.readConfig()
    configPath.value = result.path
    config.value = result.content
    configDirty.value = false
    report(result.exists ? `已载入 ${result.path}` : '配置文件尚不存在，可直接写入。')
  } catch (error) { report(error instanceof Error ? error.message : String(error), 'error') }
}

const saveConfig = async () => {
  if (!window.nginxTools || !config.value.trim()) { report('配置内容为空，已取消保存。', 'error'); return }
  if (!window.confirm('将覆盖现有 nginx.conf（旧内容备份为 nginx.conf.bak）。是否继续？')) return
  try {
    const result = await window.nginxTools.saveConfig(config.value)
    configDirty.value = false
    const check = await window.nginxTools.testConfig()
    report(`已保存到 ${result.path}。校验：${check.output}`, check.ok ? 'ok' : 'error')
  } catch (error) { report(error instanceof Error ? error.message : String(error), 'error') }
}

const openTarget = async (target: NginxOpenTarget) => {
  if (!window.nginxTools) return
  try { await window.nginxTools.open(target) } catch (error) { report(error instanceof Error ? error.message : String(error), 'error') }
}

const killAll = async () => {
  if (!window.nginxTools) return
  if (!window.confirm('将强制结束本机全部 nginx 进程（含其他实例的子进程），可能中断正在处理的请求。是否继续？')) return
  busy.value = true
  try {
    const { killed } = await window.nginxTools.killAll()
    report(killed ? `已结束 ${killed} 个 nginx 进程。` : '没有发现 nginx 进程。', 'ok')
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
      <div><p>网络工具 / NGINX</p><h2>nginx 管理</h2><span>本机 nginx 的启停、配置校验与编辑、开机自启和目录快捷入口。</span></div>
      <button class="back-button" @click="backToPortal">‹ 返回工具列表</button>
    </header>

    <p v-if="notSupported" class="tool-message error">nginx 管理当前仅支持 Windows。</p>

    <template v-else>
      <section class="ip-check-card">
        <div class="ip-check-intro">
          <i>{{ running ? '●' : '○' }}</i>
          <div>
            <strong>{{ running ? 'nginx 正在运行' : status?.exeConfigured ? 'nginx 未运行' : '尚未关联 nginx.exe' }}</strong>
            <span v-if="running">{{ masterCount }} 个 master、{{ workerCount }} 个 worker · PID {{ status?.processes.map((item) => item.pid).join('、') }}</span>
            <span v-else-if="status?.exeConfigured">点击「启动」拉起服务，或先用「校验配置」排除语法问题。</span>
            <span v-else>nginx.exe 必须留在官方目录里运行，它按当前目录定位 conf 与 logs。</span>
          </div>
          <div class="nginx-header-actions">
            <button type="button" :disabled="busy" @click="refresh(false)">刷新状态</button>
            <button type="button" :disabled="busy" @click="choosePath">{{ status?.exeConfigured ? '重新选择' : '选择 nginx.exe' }}</button>
          </div>
        </div>
        <p class="tool-message" :class="{ error: messageKind === 'error', ok: messageKind === 'ok' }">{{ message }}</p>
        <dl v-if="status?.exeConfigured" class="ip-result">
          <div class="ip-result-primary"><dt>安装目录 PREFIX</dt><dd :title="status.prefix">{{ status.prefix }}</dd></div>
          <div><dt>进程 PID</dt><dd>{{ status.processes.length ? status.processes.map((item) => `${item.pid} (${item.role})`).join('  ') : '无' }}</dd></div>
          <div><dt>开机自启</dt><dd>{{ status.autostart ? '已开启（登录后启动）' : '未开启' }}</dd></div>
        </dl>
      </section>

      <section v-if="canControl" class="network-form nginx-actions">
        <button class="primary" :disabled="busy || running" @click="startNginx">启动</button>
        <button :disabled="busy || !running" @click="runAction('重载配置', control('reload'), '热重载配置与证书，不中断现有连接。是否继续？')">重载配置</button>
        <button :disabled="busy || !running" @click="runAction('重新打开日志', control('reopen'))">重开日志</button>
        <button :disabled="busy || !running" @click="runAction('优雅停止', control('quit'), '优雅停止会处理完当前请求再退出。是否继续？')">优雅停止</button>
        <button :disabled="busy || !running" @click="runAction('快速停止', control('stop'), '快速停止会立即断开正在处理的连接。是否继续？')">快速停止</button>
        <button @click="testConfig">校验配置</button>
        <button class="danger" :disabled="busy" @click="killAll">强制结束进程</button>
        <label class="nginx-autostart"><input type="checkbox" :checked="status?.autostart" :disabled="busy || !status?.exeConfigured" @change="toggleAutostart"><span>开机自启</span></label>
      </section>

      <section v-if="canControl" class="network-form nginx-open">
        <span class="nginx-open-label">快速打开</span>
        <button @click="openTarget('prefix')">安装目录</button>
        <button @click="openTarget('confDir')">配置目录</button>
        <button @click="openTarget('logs')">日志目录</button>
        <button @click="openTarget('html')">站点目录</button>
        <button @click="openTarget('config')">默认程序打开配置</button>
      </section>

      <section v-if="canControl" class="results-card nginx-config">
        <div class="results-heading">
          <h3>配置文件</h3>
          <p>{{ configPath || (status?.configExists ? 'nginx.conf' : '尚未载入') }} · 保存前自动备份为 .bak，保存后自动执行 nginx -t</p>
        </div>
        <div class="nginx-config-actions">
          <button :disabled="busy" @click="loadConfig">载入配置</button>
          <button class="primary" :disabled="!configDirty" @click="saveConfig">保存并校验</button>
          <span v-if="configDirty" class="nginx-dirty">有未保存的修改</span>
        </div>
        <textarea v-model="config" spellcheck="false" placeholder="点击「载入配置」读取 nginx.conf" @input="configDirty = true"></textarea>
      </section>
    </template>
  </ToolboxPage>
</template>

<style scoped>
.nginx-header-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
.nginx-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 18px; }
.nginx-autostart { display: flex; align-items: center; gap: 7px; margin-left: auto; color: #526158; font-size: 13px; font-weight: 750; cursor: pointer; }
.nginx-autostart input { width: 15px; height: 15px; accent-color: #069f4f; cursor: pointer; }
.nginx-open { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 14px; }
.nginx-open-label { color: #7a8c82; font-size: 12px; font-weight: 850; letter-spacing: .06em; }
.nginx-config { margin-top: 20px; padding: 20px; }
.nginx-config textarea { width: 100%; min-height: 380px; padding: 13px; resize: vertical; }
.nginx-config-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 4px 0 12px; }
.nginx-dirty { color: #c07a17; font-size: 12px; font-weight: 700; }
.tool-message.ok { color: #078f46; }
</style>
