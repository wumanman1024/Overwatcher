<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { formatExtra, formatMetric } from './metric-display'

interface MetricExtra { label: string; value: string | number; unit?: string }
interface Metric { available: boolean; value?: number; unit?: string; detail?: string; extras?: MetricExtra[]; reason?: string }
interface Snapshot { cpu: Metric; memory: Metric; gpu: Metric; disk: Metric; network: Metric }
declare global { interface Window { hardwareMonitor: { getSnapshot(): Promise<Snapshot | undefined>; subscribe(callback: (snapshot: Snapshot) => void): () => void; moveOverlay(position: { x: number; y: number }): void; subscribeStatus(callback: (text: string) => void): () => void } } }

const snapshot = ref<Snapshot>()
const rows = [
  ['CPU', 'cpu', '处理器'], ['内存', 'memory', 'RAM'], ['GPU', 'gpu', '显卡'],
  ['磁盘', 'disk', '存储'], ['网络', 'network', '实时吞吐']
] as const
let unsubscribe: (() => void) | undefined
const activeIndex = ref(0)
const active = computed(() => rows[activeIndex.value])
let interval: ReturnType<typeof setInterval> | undefined
let drag: { x: number; y: number; screenX: number; screenY: number } | undefined
onMounted(async () => {
  unsubscribe = window.hardwareMonitor.subscribe((next) => { snapshot.value = next })
  try {
    snapshot.value = await window.hardwareMonitor.getSnapshot()
  } catch (error) {
    console.warn('首次读取监控数据失败，等待下一次更新：', error)
  }
  interval = setInterval(() => { activeIndex.value = (activeIndex.value + 1) % rows.length }, 2500)
})
onUnmounted(() => { unsubscribe?.(); if (interval) clearInterval(interval) })
const startDrag = (event: PointerEvent) => { drag = { x: event.screenX, y: event.screenY, screenX: window.screenX, screenY: window.screenY }; (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId) }
const moveDrag = (event: PointerEvent) => { if (!drag) return; window.hardwareMonitor.moveOverlay({ x: drag.screenX + event.screenX - drag.x, y: drag.screenY + event.screenY - drag.y }) }
const stopDrag = () => { drag = undefined }
</script>

<template>
  <main class="overlay" :class="{ orb: true }" @pointerdown="startDrag" @pointermove="moveDrag" @pointerup="stopDrag">
    <div v-if="snapshot" class="orb-face"><img src="/core-pulse-icon.png" alt="" /><span>{{ active[0] }}</span><strong>{{ formatMetric(snapshot[active[1]]) }}</strong></div>
    <header class="titlebar"><div><p class="eyebrow">SYSTEM OVERVIEW</p><h1>硬件监控</h1></div><span class="live"><i></i>实时</span></header>
    <div v-if="snapshot" class="metrics">
      <section v-for="[label, key, subtitle] in rows" :key="key" class="metric" :class="{ unavailable: !snapshot[key].available }">
        <div class="metric-heading"><div><h2>{{ label }}</h2><span>{{ subtitle }}</span></div><strong>{{ formatMetric(snapshot[key]) }}</strong></div>
        <div v-if="snapshot[key].available" class="meter" aria-hidden="true"><i :style="{ width: `${Math.min(snapshot[key].value ?? 0, 100)}%` }"></i></div>
        <dl v-if="snapshot[key].extras?.length" class="extras"><template v-for="extra in snapshot[key].extras" :key="extra.label"><dt>{{ extra.label }}</dt><dd>{{ formatExtra(extra.value, extra.unit) }}</dd></template></dl>
        <p v-else class="metric-note">{{ snapshot[key].detail ?? snapshot[key].reason ?? '暂时无附加数据' }}</p>
      </section>
    </div>
    <p v-else class="loading">正在初始化监控数据…</p>
  </main>
</template>
