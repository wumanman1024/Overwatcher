<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { formatByteSize } from '@localforge/shared/formatters'
import ToolboxPage from '../ToolboxPage.vue'

const router = useRouter()
const supported = window.memoryBooster?.platform === 'win32'
const state = ref<'idle' | 'running' | 'error'>('idle')
const message = ref(supported ? '整理各进程的内存占用，可用内存会立即上升；整个过程在本地完成。' : '内存整理当前仅支持 Windows。')
const result = ref<MemoryBoostResult>()
const backToPortal = () => router.push({ name: 'portal' })

// 可用内存的净增才是这次加速真正的收益；各进程工作集差值之和会虚高到超过物理内存。
const freedText = computed(() => (result.value ? formatByteSize(result.value.freedBytes) : '—'))
const usageDrop = computed(() => {
  if (!result.value) return undefined
  const drop = result.value.beforeUsage - result.value.afterUsage
  // 其他进程此刻也在吃内存时占用可能不降反升，这时不该显示一个负的「下降」。
  return drop > 0.05 ? drop : undefined
})

const runBoost = async () => {
  if (!window.memoryBooster || !supported || state.value === 'running') return
  state.value = 'running'
  message.value = '正在整理各进程的内存占用，约需几秒…'
  try {
    result.value = await window.memoryBooster.boost()
    state.value = 'idle'
    message.value = `已整理 ${result.value.trimmed} 个进程；${result.value.skipped} 个因权限不足或占用过小被跳过。`
  } catch (error) {
    state.value = 'error'
    message.value = error instanceof Error ? error.message : String(error)
  }
}
</script>

<template><ToolboxPage><header class="toolbox-heading"><div><p>文件工具 / 本机资源</p><h2>内存加速</h2><span>把各进程暂不使用的内存换出到待机列表，立即抬高可用内存。</span></div><button class="back-button" @click="backToPortal">‹ 返回工具列表</button></header><section class="network-form"><button class="primary" :disabled="!supported || state === 'running'" @click="runBoost">{{ state === 'running' ? '正在加速…' : '立即加速' }}</button><p class="tool-message" :class="{ error: state === 'error' }">{{ message }}</p></section><section v-if="result" class="results-card port-results"><div class="port-table"><div class="port-row port-head"><span>指标</span><span>加速前</span><span>加速后</span><span>变化</span></div><div class="port-row"><span>内存占用</span><code>{{ result.beforeUsage.toFixed(1) }}%</code><code>{{ result.afterUsage.toFixed(1) }}%</code><span>{{ usageDrop !== undefined ? `下降 ${usageDrop.toFixed(1)} 个百分点` : '基本持平' }}</span></div><div class="port-row"><span>可用内存</span><code>{{ formatByteSize(result.beforeAvailable) }}</code><code>{{ formatByteSize(result.afterAvailable) }}</code><span>增加 {{ freedText }}</span></div></div></section><section v-if="result?.top.length" class="results-card port-results"><div class="port-table"><div class="port-row port-head"><span>被整理的进程</span><span>PID</span><span>整理前占用</span></div><div v-for="entry in result.top" :key="`${entry.pid}-${entry.name}`" class="port-row"><span>{{ entry.name }}</span><code>{{ entry.pid }}</code><code>{{ formatByteSize(entry.workingSet) }}</code></div></div></section><section class="network-form"><p class="tool-message"><strong>关于「加速」究竟做了什么：</strong>这里调用系统的 EmptyWorkingSet，把各进程暂不使用的内存换出到待机列表，可用内存随即上升。它不会删除任何数据；但被换出的页在进程再次访问时要换回来，所以收益是削峰而非永久回收，整理后短时间内应用首次响应可能略慢。普通权限只能触达约一半系统进程，属预期而非失败。</p></section></ToolboxPage></template>
