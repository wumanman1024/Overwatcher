<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import ToolboxPage from '../ToolboxPage.vue'
const router = useRouter()
const rootPath = ref('')
const directoryName = ref('node_modules')
const targets = ref<CleanupTarget[]>([])
const selectedIds = ref<string[]>([])
const scanState = ref<'idle' | 'scanning' | 'deleting'>('idle')
const cleanupMessage = ref('选择一个项目或工作区目录后开始扫描。')
const deleteResults = ref<DeleteResult[]>([])
const isBusy = computed(() => scanState.value !== 'idle')
const allSelected = computed(() => targets.value.length > 0 && selectedIds.value.length === targets.value.length)
const successfulDeletes = computed(() => deleteResults.value.filter((item) => item.success).length)
const backToPortal = () => router.push({ name: 'portal' })
const chooseDirectory = async () => {
  const selected = await window.developerTools.selectDirectory()
  if (!selected) return
  rootPath.value = selected; targets.value = []; selectedIds.value = []; deleteResults.value = []
  cleanupMessage.value = '目录已选择，点击“扫描”查找匹配项。'
}
const scan = async () => {
  if (!rootPath.value.trim()) { cleanupMessage.value = '请先选择扫描根目录。'; return }
  scanState.value = 'scanning'; deleteResults.value = []
  try {
    targets.value = await window.developerTools.scanDirectories(rootPath.value, directoryName.value)
    selectedIds.value = targets.value.map((target) => target.id)
    cleanupMessage.value = targets.value.length ? `已找到 ${targets.value.length} 个“${directoryName.value.trim()}”目录，请确认后删除。` : `没有找到名为“${directoryName.value.trim()}”的目录。`
  } catch (error) { targets.value = []; selectedIds.value = []; cleanupMessage.value = error instanceof Error ? error.message : String(error) } finally { scanState.value = 'idle' }
}
const toggleAll = () => { selectedIds.value = allSelected.value ? [] : targets.value.map((target) => target.id) }
const deleteSelected = async () => {
  if (!selectedIds.value.length) { cleanupMessage.value = '请至少选择一个目录。'; return }
  if (!window.confirm(`即将永久删除 ${selectedIds.value.length} 个“${directoryName.value.trim()}”目录。此操作不可撤销，是否继续？`)) return
  scanState.value = 'deleting'
  try {
    deleteResults.value = await window.developerTools.deleteDirectories(selectedIds.value)
    const deleted = new Set(deleteResults.value.filter((item) => item.success).map((item) => item.id))
    targets.value = targets.value.filter((item) => !deleted.has(item.id)); selectedIds.value = selectedIds.value.filter((id) => !deleted.has(id))
    cleanupMessage.value = `删除完成：成功 ${successfulDeletes.value} 个，失败 ${deleteResults.value.length - successfulDeletes.value} 个。`
  } catch (error) { cleanupMessage.value = error instanceof Error ? error.message : String(error) } finally { scanState.value = 'idle' }
}
</script>
<template><ToolboxPage>
  <header class="toolbox-heading"><div><p>文件工具 / 安全清理</p><h2>批量清理目录</h2><span>递归查找指定名称的目录，先预览，再删除。</span></div><button class="back-button" @click="backToPortal">‹ 返回工具列表</button></header>
  <section class="cleanup-card"><label>扫描根目录</label><div class="path-picker"><input v-model="rootPath" readonly placeholder="请选择项目或工作区目录"><button type="button" @click="chooseDirectory">选择目录</button></div><label>要清理的目录名</label><div class="scan-row"><input v-model="directoryName" :disabled="isBusy" placeholder="例如 node_modules"><button class="primary" type="button" :disabled="isBusy" @click="scan">{{ scanState === 'scanning' ? '扫描中…' : '开始扫描' }}</button></div><p class="tool-message">{{ cleanupMessage }}</p></section>
  <section v-if="targets.length || deleteResults.length" class="results-card"><div class="results-heading"><div><h3>扫描结果</h3><p>不会跟随符号链接，也不会删除扫描根目录本身。</p></div><button v-if="targets.length" class="danger" type="button" :disabled="isBusy || !selectedIds.length" @click="deleteSelected">{{ scanState === 'deleting' ? '删除中…' : `删除已选 ${selectedIds.length} 项` }}</button></div><label v-if="targets.length" class="select-all"><input type="checkbox" :checked="allSelected" @change="toggleAll"> 全选（{{ targets.length }}）</label><div v-if="targets.length" class="target-list"><label v-for="target in targets" :key="target.id" class="target-item"><input v-model="selectedIds" type="checkbox" :value="target.id"><code>{{ target.path }}</code></label></div><ul v-if="deleteResults.length" class="delete-report"><li v-for="result in deleteResults" :key="result.id" :class="{ failed: !result.success }">{{ result.success ? '✓' : '!' }} {{ result.path ?? result.id }}<small v-if="result.error">{{ result.error }}</small></li></ul></section>
</ToolboxPage></template>
