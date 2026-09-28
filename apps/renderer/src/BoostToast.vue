<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { formatByteSize } from '@localforge/shared/formatters'

type ToastStatus = { phase: 'running' | 'done' | 'error'; freedBytes?: number; trimmed?: number; skipped?: number; message?: string }

const status = ref<ToastStatus>({ phase: 'running' })
let unsubscribe: (() => void) | undefined

const headline = computed(() => {
  if (status.value.phase === 'running') return '正在整理内存占用…'
  if (status.value.phase === 'error') return '内存整理失败'
  const freed = status.value.freedBytes && status.value.freedBytes > 0 ? formatByteSize(status.value.freedBytes) : undefined
  return freed ? `已整理 ${freed}` : '整理完成'
})
// 说「整理」不说「释放」：换出到待机列表不等于数据消失，进程再访问时还会换回来。
// 刻意不显示 skipped 数：被跳过的绝大多数是占用过小、本就不值得整理的小进程，
// 与「已整理」并列会被读成「大部分失败了」。权限受限那层解释放在工具箱页面里。
const detail = computed(() => {
  if (status.value.phase === 'running') return '请稍候，约需几秒'
  if (status.value.phase === 'error') return status.value.message ?? '未知错误'
  return `已整理 ${status.value.trimmed ?? 0} 个进程的内存占用`
})
// 卡片只有 260px 宽，这行必须短到一行放得下，否则会被省略号截成半句话。
const hint = computed(() => (status.value.phase === 'done' ? '换出的页稍后访问会自动换回' : ''))

onMounted(() => {
  unsubscribe = window.boostToast?.subscribe((next) => { status.value = next as ToastStatus })
})
onUnmounted(() => unsubscribe?.())
</script>

<template>
  <div class="boost-toast" :class="`boost-toast-${status.phase}`" role="status">
    <i class="boost-toast-mark" aria-hidden="true"></i>
    <div class="boost-toast-copy">
      <strong>{{ headline }}</strong>
      <span>{{ detail }}</span>
      <small v-if="hint">{{ hint }}</small>
    </div>
  </div>
</template>
