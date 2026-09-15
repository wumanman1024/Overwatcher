<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import type { MetricSnapshot } from '@localforge/shared/metrics'
import TelemetryCharts from './TelemetryCharts.vue'
import { appendTelemetrySample, type TelemetrySample } from './telemetry-history'
import SvgIcon from './components/SvgIcon.vue'

const history = ref<TelemetrySample[]>([])
let unsubscribe: (() => void) | undefined
let drag: { x: number; y: number; screenX: number; screenY: number } | undefined

onMounted(async () => {
  const snapshots = await window.hardwareMonitor.getHistory()
  history.value = snapshots.reduce<TelemetrySample[]>((items, snapshot) => appendTelemetrySample(items, snapshot), [])
  unsubscribe = window.hardwareMonitor.subscribe((snapshot) => { history.value = appendTelemetrySample(history.value, snapshot) })
})
onUnmounted(() => unsubscribe?.())

const startDrag = (event: PointerEvent) => { drag = { x: event.screenX, y: event.screenY, screenX: window.screenX, screenY: window.screenY }; (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId) }
const moveDrag = (event: PointerEvent) => { if (drag) window.hardwareMonitor.moveTrend({ x: drag.screenX + event.screenX - drag.x, y: drag.screenY + event.screenY - drag.y }) }
const stopDrag = () => { drag = undefined }
const closeTrend = () => window.hardwareMonitor.closeTrend()
</script>

<template>
  <main class="overlay expanded trend-window">
    <header class="panel-header" @pointerdown="startDrag" @pointermove="moveDrag" @pointerup="stopDrag" @pointercancel="stopDrag">
      <div class="brand-mark" aria-hidden="true"><span></span></div>
      <div class="panel-title"><p>CORE PULSE · ANALYTICS</p><h1>趋势分析</h1></div>
      <span class="window-caption">60 SECOND HISTORY</span>
      <button class="panel-close" type="button" aria-label="关闭趋势分析" @pointerdown.stop @click.stop="closeTrend"><SvgIcon name="window-close" /></button>
    </header>
    <TelemetryCharts :history="history" />
  </main>
</template>
