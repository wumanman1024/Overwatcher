<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import SvgIcon from './components/SvgIcon.vue'

type ToolCategory = 'all' | 'file' | 'data' | 'network' | 'design'
const savedCategory = localStorage.getItem('localforge:default-category')
const initialCategory: ToolCategory = savedCategory === 'file' || savedCategory === 'data' || savedCategory === 'network' || savedCategory === 'design' ? savedCategory : 'all'
const savedIndent = Number(localStorage.getItem('localforge:json-indent'))
const route = useRoute()
const router = useRouter()
const activeCategory = ref<ToolCategory>(initialCategory)
const settingsOpen = ref(false)
const isMaximized = ref(false)
const defaultCategory = ref<ToolCategory>(initialCategory)
const settingsDefaultCategory = ref<ToolCategory>(initialCategory)
const settingsJsonIndent = ref<2 | 4>(savedIndent === 4 ? 4 : 2)
const localIpv4 = ref<{ lan: LocalIpv4[]; wired: LocalIpv4[] }>({ lan: [], wired: [] })
const localIpv4Message = ref('正在读取…')
const activeTool = computed(() => String(route.name ?? 'portal'))
const categories: Array<{ id: ToolCategory; label: string }> = [
  { id: 'all', label: '全部工具' },
  { id: 'file', label: '文件工具' },
  { id: 'data', label: '数据工具' },
  { id: 'design', label: '设计工具' },
  { id: 'network', label: '网络工具' }
]

const showPortal = (category: ToolCategory) => router.push({ name: 'portal', query: { category } })
const openMonitor = () => window.hardwareMonitor.openPanel()
const minimizeWindow = () => window.windowControls.minimize()
const toggleMaximizeWindow = async () => { window.windowControls.toggleMaximize(); isMaximized.value = await window.windowControls.isMaximized() }
const closeWindow = () => window.windowControls.close()
const refreshLocalIpv4 = async () => {
  if (!window.networkTools?.getLocalIpv4) { localIpv4Message.value = '请重启应用以加载网络组件'; return }
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
const openSettings = () => {
  settingsDefaultCategory.value = defaultCategory.value
  settingsJsonIndent.value = Number(localStorage.getItem('localforge:json-indent')) === 4 ? 4 : 2
  settingsOpen.value = true
}
const saveSettings = () => {
  defaultCategory.value = settingsDefaultCategory.value
  localStorage.setItem('localforge:default-category', settingsDefaultCategory.value)
  localStorage.setItem('localforge:json-indent', String(settingsJsonIndent.value))
  window.dispatchEvent(new CustomEvent('localforge:json-indent-changed', { detail: settingsJsonIndent.value }))
  settingsOpen.value = false
}

watch(() => route.query.category, (category) => {
  activeCategory.value = category === 'file' || category === 'data' || category === 'network' || category === 'design' || category === 'all' ? category : initialCategory
}, { immediate: true })
void refreshLocalIpv4()
void window.windowControls.isMaximized().then((value) => { isMaximized.value = value })
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
          <div><small>局域网 IPv4</small><strong v-for="item in localIpv4.lan" :key="`lan-${item.name}-${item.address}`" :title="`${item.name} · 点击复制`" @click="copyLocalIpv4(item.address)">{{ item.address }}</strong><span v-if="!localIpv4.lan.length">{{ localIpv4Message }}</span></div>
          <div><small>网线 IPv4</small><strong v-for="item in localIpv4.wired" :key="`wired-${item.name}-${item.address}`" :title="`${item.name} · 点击复制`" @click="copyLocalIpv4(item.address)">{{ item.address }}</strong><span v-if="!localIpv4.wired.length">未连接网线</span></div>
        </section>
        <div class="sidebar-actions">
          <button type="button" title="打开系统监控" aria-label="打开系统监控" @click="openMonitor"><SvgIcon name="monitor"/><span>系统监控</span></button>
          <button class="settings-action" type="button" title="打开设置" aria-label="打开设置" @click="openSettings"><SvgIcon name="settings"/><span>设置</span></button>
        </div>
      </aside>
      <section class="toolbox-content"><slot /></section>
    </div>
    <div v-if="settingsOpen" class="settings-backdrop" @click.self="settingsOpen = false">
      <section class="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header><div><p>LOCALFORGE / PREFERENCES</p><h2 id="settings-title">设置</h2></div><button type="button" aria-label="关闭设置" @click="settingsOpen = false"><SvgIcon name="window-close" /></button></header>
        <label>默认打开分类<select v-model="settingsDefaultCategory"><option v-for="category in categories" :key="category.id" :value="category.id">{{ category.label }}</option></select></label>
        <label>JSON 默认缩进<select v-model.number="settingsJsonIndent"><option :value="2">2 空格</option><option :value="4">4 空格</option></select></label>
        <p>偏好设置仅保存在当前设备。系统监控可通过左下角快捷入口随时打开。</p>
        <footer><button type="button" @click="settingsOpen = false">取消</button><button class="primary" type="button" @click="saveSettings">保存设置</button></footer>
      </section>
    </div>
  </main>
</template>
