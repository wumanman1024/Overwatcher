<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { MetricSnapshot, MetricValue } from '@localforge/shared/metrics'
import { formatExtra, formatMetric } from './metric-display'
import { metricHealth } from './metric-health'
import { shouldOpenPanelOnPointerUp } from '@localforge/shared/overlay-state'
import HardwareOverview from './HardwareOverview.vue'
import { RouterView } from 'vue-router'
import SvgIcon from './components/SvgIcon.vue'

const snapshot = ref<MetricSnapshot>()
const orbMetrics = [
  { label: 'CPU', key: 'cpu' },
  { label: 'RAM', key: 'memory' },
  { label: 'GPU', key: 'gpu' }
] as const
let unsubscribe: (() => void) | undefined
const isPanelSurface = new URLSearchParams(location.search).get('surface') === 'panel'
const isToolboxSurface = new URLSearchParams(location.search).get('surface') === 'toolbox'
const isExpanded = ref(isPanelSurface)
const activeMetricIndex = ref(0)
const isRotationPaused = ref(false)
const isMetricPinned = ref(false)
const isHovering = ref(false)
const isWindowMaximized = ref(false)
let rotationInterval: ReturnType<typeof setInterval> | undefined
let drag: { x: number; y: number; screenX: number; screenY: number } | undefined
const reportRendererError = (scope: string, error: unknown) => console.error(`[硬件监控] ${scope}`, error)
const handleWindowError = (event: ErrorEvent) => reportRendererError('渲染进程未处理异常', event.error ?? event.message)
const handleUnhandledRejection = (event: PromiseRejectionEvent) => reportRendererError('渲染进程未处理 Promise 拒绝', event.reason)
onMounted(async () => {
  window.addEventListener('error', handleWindowError)
  window.addEventListener('unhandledrejection', handleUnhandledRejection)
  unsubscribe = window.hardwareMonitor.subscribe((next) => { snapshot.value = next })
  try {
    snapshot.value = await window.hardwareMonitor.getSnapshot()
  } catch (error) {
    reportRendererError('首次读取监控数据失败，等待下一次更新', error)
  }
  rotationInterval = setInterval(() => {
    if (!isRotationPaused.value && !isMetricPinned.value && !isExpanded.value) activeMetricIndex.value = (activeMetricIndex.value + 1) % orbMetrics.length
  }, 2500)
  if (isPanelSurface) isWindowMaximized.value = await window.windowControls.isMaximized()
})
onUnmounted(() => {
  window.removeEventListener('error', handleWindowError)
  window.removeEventListener('unhandledrejection', handleUnhandledRejection)
  unsubscribe?.()
  if (rotationInterval) clearInterval(rotationInterval)
})
const startDrag = (event: PointerEvent) => { if (isPanelSurface && !(event.target as HTMLElement).closest('.panel-header')) return; drag = { x: event.screenX, y: event.screenY, screenX: window.screenX, screenY: window.screenY }; (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId) }
const moveDrag = (event: PointerEvent) => { if (!drag) return; const position = { x: drag.screenX + event.screenX - drag.x, y: drag.screenY + event.screenY - drag.y }; if (isPanelSurface) window.hardwareMonitor.movePanel(position); else window.hardwareMonitor.moveOverlay(position) }
const stopDrag = (event: PointerEvent) => {
  if (!drag) return
  const started = drag
  drag = undefined
  if (shouldOpenPanelOnPointerUp({ x: started.x, y: started.y }, { x: event.screenX, y: event.screenY })) window.hardwareMonitor.openPanel()
}
const cancelDrag = () => { drag = undefined }
const openPanel = () => { if (!isPanelSurface) window.hardwareMonitor.openPanel() }
const closePanel = () => window.hardwareMonitor.closePanel()
const minimizeWindow = () => window.windowControls.minimize()
const toggleMaximizeWindow = async () => {
  window.windowControls.toggleMaximize()
  isWindowMaximized.value = await window.windowControls.isMaximized()
}
const closeWindow = () => window.windowControls.close()
const activeMetric = computed(() => orbMetrics[activeMetricIndex.value % orbMetrics.length] ?? orbMetrics[0])
const metricProgress = (metric: MetricValue) => Math.min(Math.max(metric.value ?? 0, 0), 100)
const splitDisplay = (formatted: string) => {
  const parts = formatted.match(/^([\d.,]+|—)(.*)$/)
  return { value: parts?.[1] ?? formatted, unit: parts?.[2].trim() ?? '' }
}
const metricDisplay = (metric: MetricValue) => splitDisplay(formatMetric(metric))
const metricExtraDisplay = (metric: MetricValue | undefined, label: string) => {
  const extra = metric?.extras?.find((item) => item.label === label)
  return extra ? splitDisplay(formatExtra(extra.value, extra.unit)) : undefined
}
const activeMetricValue = computed(() => snapshot.value?.[activeMetric.value.key])
const activeMetricDisplay = computed(() => metricDisplay(activeMetricValue.value ?? { available: false }))
const activeFill = computed(() => metricProgress(activeMetricValue.value ?? { available: false }))
const activeMetricHealth = computed(() => metricHealth(activeMetric.value.key, activeMetricValue.value))
const networkDown = computed(() => metricExtraDisplay(snapshot.value?.network, '下载'))
const networkUp = computed(() => metricExtraDisplay(snapshot.value?.network, '上传'))
const pauseRotation = () => { isRotationPaused.value = true; isHovering.value = true }
const handlePointerLeave = () => { isRotationPaused.value = false; isHovering.value = false }
const stepMetric = (delta: number) => { activeMetricIndex.value = (activeMetricIndex.value + delta + orbMetrics.length) % orbMetrics.length }
const togglePin = () => { isMetricPinned.value = !isMetricPinned.value }
</script>

<template>
  <RouterView v-if="isToolboxSurface" />
  <main
    v-else
    class="overlay"
    :class="{ expanded: isExpanded, 'orb-window': !isPanelSurface }"
    :aria-expanded="isExpanded"
    tabindex="0"
    @keydown.enter.prevent="openPanel"
    @keydown.space.prevent="openPanel"
    @pointerenter="pauseRotation"
    @pointerleave="handlePointerLeave"
    @pointerdown="startDrag"
    @pointermove="moveDrag"
    @pointerup="stopDrag"
    @pointercancel="cancelDrag"
  >
    <div v-if="snapshot && !isPanelSurface" class="orb-face" :class="`status-${activeMetricHealth}`">
      <div class="orb-core">
        <div class="orb-liquid" :style="{ height: `${activeFill}%` }" aria-hidden="true"><i></i><i></i></div>
        <Transition name="metric-swap">
          <div :key="activeMetric.key" class="orb-reading">
            <span class="orb-label"><i></i>{{ activeMetric.label }}</span>
            <strong><span>{{ activeMetricDisplay.value }}</span><small v-if="activeMetricDisplay.unit">{{ activeMetricDisplay.unit }}</small></strong>
          </div>
        </Transition>
      </div>
    </div>
    <aside v-if="snapshot && !isPanelSurface && (networkDown || networkUp)" class="orb-network-strip" aria-label="网络速率">
      <div class="orb-net-rates">
        <span v-if="networkDown"><i>↓</i><strong>{{ networkDown.value }}<small v-if="networkDown.unit">{{ networkDown.unit }}</small></strong></span>
        <span v-if="networkUp"><i>↑</i><strong>{{ networkUp.value }}<small v-if="networkUp.unit">{{ networkUp.unit }}</small></strong></span>
      </div>
      <div class="orb-controls" :class="{ visible: isHovering }" @pointerdown.stop @pointerup.stop>
        <button type="button" class="orb-step" aria-label="上一个指标" title="上一个指标" @click.stop="stepMetric(-1)"><i>▲</i></button>
        <button type="button" class="orb-pin" :class="{ on: isMetricPinned }" :aria-pressed="isMetricPinned" :aria-label="isMetricPinned ? '取消固定指标' : '固定当前指标'" :title="isMetricPinned ? '取消固定指标' : '固定当前指标'" @click.stop="togglePin"><i class="orb-pin-box"></i></button>
        <button type="button" class="orb-step" aria-label="下一个指标" title="下一个指标" @click.stop="stepMetric(1)"><i>▼</i></button>
      </div>
    </aside>

    <div class="expanded-content">
      <header class="panel-header">
        <div class="brand-mark" aria-hidden="true"><SvgIcon name="app-mark" /></div>
        <div class="panel-title">
          <p>CORE PULSE · LOCAL</p>
          <h1>监控中心</h1>
        </div>
        <div class="window-controls panel-window-controls" aria-label="窗口控制">
          <button type="button" aria-label="最小化" title="最小化" @pointerdown.stop @pointerup.stop @click.stop="minimizeWindow"><SvgIcon name="window-minimize" /></button>
          <button type="button" :aria-label="isWindowMaximized ? '还原窗口' : '最大化'" :title="isWindowMaximized ? '还原窗口' : '最大化'" @pointerdown.stop @pointerup.stop @click.stop="toggleMaximizeWindow"><SvgIcon :name="isWindowMaximized ? 'window-restore' : 'window-maximize'" /></button>
          <button class="window-control-close" type="button" aria-label="关闭" title="关闭" @pointerdown.stop @pointerup.stop @click.stop="closeWindow"><SvgIcon name="window-close" /></button>
        </div>
      </header>

      <template v-if="snapshot">
        <HardwareOverview :snapshot="snapshot" />
      </template>
      <p v-else class="loading"><i></i>正在初始化监控数据…</p>
    </div>
  </main>
</template>
