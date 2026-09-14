<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { formatExtra, formatMetric } from './metric-display'
import { shouldToggleOverlayOnPointerUp } from '@hardware-overlay/shared/overlay-state'

interface MetricExtra { label: string; value: string | number; unit?: string }
interface Metric { available: boolean; value?: number; unit?: string; detail?: string; extras?: MetricExtra[]; reason?: string }
interface Snapshot { cpu: Metric; memory: Metric; gpu: Metric; disk: Metric; network: Metric; display?: Metric; power?: Metric }
declare global { interface Window { hardwareMonitor: { getSnapshot(): Promise<Snapshot | undefined>; subscribe(callback: (snapshot: Snapshot) => void): () => void; moveOverlay(position: { x: number; y: number }): void; setOverlayExpanded(expanded: boolean): void; subscribeStatus(callback: (text: string) => void): () => void } } }

const snapshot = ref<Snapshot>()
const metricRows = [
  { label: '内存', key: 'memory', subtitle: 'MEMORY', glyph: 'M' },
  { label: 'GPU', key: 'gpu', subtitle: 'GRAPHICS', glyph: 'G' },
  { label: '磁盘', key: 'disk', subtitle: 'STORAGE', glyph: 'D' },
  { label: '网络', key: 'network', subtitle: 'THROUGHPUT', glyph: 'N' }
] as const
const orbMetrics = [
  { label: 'CPU', key: 'cpu' },
  { label: 'RAM', key: 'memory' },
  { label: 'GPU', key: 'gpu' }
] as const
let unsubscribe: (() => void) | undefined
const isExpanded = ref(false)
const activeMetricIndex = ref(0)
const isRotationPaused = ref(false)
const rendererFps = ref(0)
let rotationInterval: ReturnType<typeof setInterval> | undefined
let animationFrame: number | undefined
let frameCount = 0
let frameWindowStarted = 0
let drag: { x: number; y: number; screenX: number; screenY: number } | undefined
const measureFps = (timestamp: number) => {
  if (frameWindowStarted === 0) frameWindowStarted = timestamp
  frameCount++
  const elapsed = timestamp - frameWindowStarted
  if (elapsed >= 1000) {
    rendererFps.value = Math.round(frameCount * 1000 / elapsed)
    frameCount = 0
    frameWindowStarted = timestamp
  }
  animationFrame = requestAnimationFrame(measureFps)
}
onMounted(async () => {
  unsubscribe = window.hardwareMonitor.subscribe((next) => { snapshot.value = next })
  try {
    snapshot.value = await window.hardwareMonitor.getSnapshot()
  } catch (error) {
    console.warn('首次读取监控数据失败，等待下一次更新：', error)
  }
  rotationInterval = setInterval(() => {
    if (!isRotationPaused.value && !isExpanded.value) activeMetricIndex.value = (activeMetricIndex.value + 1) % orbMetrics.length
  }, 2500)
  animationFrame = requestAnimationFrame(measureFps)
})
onUnmounted(() => {
  unsubscribe?.()
  if (rotationInterval) clearInterval(rotationInterval)
  if (animationFrame !== undefined) cancelAnimationFrame(animationFrame)
})
const startDrag = (event: PointerEvent) => { drag = { x: event.screenX, y: event.screenY, screenX: window.screenX, screenY: window.screenY }; (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId) }
const moveDrag = (event: PointerEvent) => { if (!drag) return; window.hardwareMonitor.moveOverlay({ x: drag.screenX + event.screenX - drag.x, y: drag.screenY + event.screenY - drag.y }) }
const stopDrag = (event: PointerEvent) => {
  if (!drag) return
  const started = drag
  drag = undefined
  if (shouldToggleOverlayOnPointerUp({ x: started.x, y: started.y }, { x: event.screenX, y: event.screenY })) setExpanded(!isExpanded.value)
}
const cancelDrag = () => { drag = undefined }
const setExpanded = (expanded: boolean) => { if (drag || isExpanded.value === expanded) return; isExpanded.value = expanded; window.hardwareMonitor.setOverlayExpanded(expanded) }
const cpuValue = computed(() => Math.min(Math.max(snapshot.value?.cpu.value ?? 0, 0), 100))
const activeMetric = computed(() => orbMetrics[activeMetricIndex.value % orbMetrics.length] ?? orbMetrics[0])
const metricProgress = (metric: Metric) => Math.min(Math.max(metric.value ?? 0, 0), 100)
const metricDetail = (metric: Metric) => metric.detail ?? metric.reason ?? (metric.available ? '运行正常' : '暂不可用')
const splitDisplay = (formatted: string) => {
  const parts = formatted.match(/^([\d.,]+|—)(.*)$/)
  return { value: parts?.[1] ?? formatted, unit: parts?.[2].trim() ?? '' }
}
const metricDisplay = (metric: Metric) => splitDisplay(formatMetric(metric))
const metricExtraDisplay = (metric: Metric | undefined, label: string) => {
  const extra = metric?.extras?.find((item) => item.label === label)
  return extra ? splitDisplay(formatExtra(extra.value, extra.unit)) : undefined
}
const activeMetricValue = computed(() => snapshot.value?.[activeMetric.value.key])
const activeMetricDisplay = computed(() => metricDisplay(activeMetricValue.value ?? { available: false }))
const activeSecondary = computed(() => metricExtraDisplay(activeMetricValue.value, '温度'))
const activeFill = computed(() => metricProgress(activeMetricValue.value ?? { available: false }))
const cpuTemperature = computed(() => metricExtraDisplay(snapshot.value?.cpu, '温度'))
const networkDown = computed(() => metricExtraDisplay(snapshot.value?.network, '下载'))
const networkUp = computed(() => metricExtraDisplay(snapshot.value?.network, '上传'))
const diskRead = computed(() => metricExtraDisplay(snapshot.value?.disk, '读取'))
const diskWrite = computed(() => metricExtraDisplay(snapshot.value?.disk, '写入'))
const displayRate = computed(() => snapshot.value?.display?.available ? metricDisplay(snapshot.value.display) : undefined)
const powerRate = computed(() => snapshot.value?.power?.available ? metricDisplay(snapshot.value.power) : undefined)
const powerBattery = computed(() => metricExtraDisplay(snapshot.value?.power, '电量'))
const hasAuxTelemetry = computed(() => Boolean(displayRate.value || powerRate.value))
const panelTemperature = (key: typeof metricRows[number]['key']) => key !== 'network' ? metricExtraDisplay(snapshot.value?.[key], '温度') : undefined
const pauseRotation = () => { isRotationPaused.value = true }
const handlePointerLeave = () => { isRotationPaused.value = false; setExpanded(false) }
</script>

<template>
  <main
    class="overlay"
    :class="{ expanded: isExpanded }"
    :aria-expanded="isExpanded"
    tabindex="0"
    @keydown.enter.prevent="setExpanded(!isExpanded)"
    @keydown.space.prevent="setExpanded(!isExpanded)"
    @pointerenter="pauseRotation"
    @pointerleave="handlePointerLeave"
    @pointerdown="startDrag"
    @pointermove="moveDrag"
    @pointerup="stopDrag"
    @pointercancel="cancelDrag"
  >
    <div v-if="snapshot" class="orb-face">
      <div class="orb-core">
        <div class="orb-liquid" :style="{ height: `${activeFill}%` }" aria-hidden="true"><i></i><i></i></div>
        <Transition name="metric-swap">
          <div :key="activeMetric.key" class="orb-reading">
            <span class="orb-label"><i></i>{{ activeMetric.label }}</span>
            <strong><span>{{ activeMetricDisplay.value }}</span><small v-if="activeMetricDisplay.unit">{{ activeMetricDisplay.unit }}</small></strong>
            <span v-if="activeSecondary" class="orb-secondary"><i>◆</i>{{ activeSecondary.value }}<small v-if="activeSecondary.unit">{{ activeSecondary.unit }}</small></span>
          </div>
        </Transition>
      </div>
    </div>
    <aside v-if="snapshot && (networkDown || networkUp)" class="orb-network-strip" aria-label="网络速率">
      <span v-if="networkDown"><i>↓</i><strong>{{ networkDown.value }}<small v-if="networkDown.unit">{{ networkDown.unit }}</small></strong></span>
      <span v-if="networkUp"><i>↑</i><strong>{{ networkUp.value }}<small v-if="networkUp.unit">{{ networkUp.unit }}</small></strong></span>
    </aside>

    <div class="expanded-content">
      <header class="panel-header">
        <div class="brand-mark" aria-hidden="true"><span></span></div>
        <div class="panel-title">
          <p>CORE PULSE</p>
          <h1>系统状态</h1>
        </div>
        <span class="live"><i></i>实时监测</span>
      </header>

      <template v-if="snapshot">
        <section class="cpu-summary" :style="{ '--progress': `${cpuValue * 3.6}deg` }">
          <div class="cpu-copy">
            <span class="section-kicker">PROCESSOR LOAD</span>
            <strong>{{ Math.round(cpuValue) }}<small>%</small></strong>
            <div class="cpu-meta">
              <p>{{ metricDetail(snapshot.cpu) }}</p>
              <span v-if="cpuTemperature" class="temperature"><i>◆</i>{{ cpuTemperature.value }}<small v-if="cpuTemperature.unit">{{ cpuTemperature.unit }}</small></span>
            </div>
          </div>
          <div class="cpu-gauge" aria-hidden="true"><span><i></i></span></div>
        </section>

        <div class="metric-grid">
          <section
            v-for="metric in metricRows"
            :key="metric.key"
            class="metric-card"
            :class="{ unavailable: !snapshot[metric.key].available, 'network-card': metric.key === 'network' }"
          >
            <header>
              <span class="metric-icon" aria-hidden="true">{{ metric.glyph }}</span>
              <div><h2>{{ metric.label }}</h2><p>{{ metric.subtitle }}</p></div>
              <strong v-if="metric.key !== 'network'"><span>{{ metricDisplay(snapshot[metric.key]).value }}</span><small v-if="metricDisplay(snapshot[metric.key]).unit">{{ metricDisplay(snapshot[metric.key]).unit }}</small></strong>
            </header>
            <template v-if="metric.key === 'network'">
              <div class="network-rates">
                <span v-if="networkDown" class="network-rate down"><i aria-hidden="true">↓</i><strong><span>{{ networkDown.value }}</span><small v-if="networkDown.unit">{{ networkDown.unit }}</small></strong></span>
                <span v-if="networkUp" class="network-rate up"><i aria-hidden="true">↑</i><strong><span>{{ networkUp.value }}</span><small v-if="networkUp.unit">{{ networkUp.unit }}</small></strong></span>
              </div>
            </template>
            <template v-else-if="metric.key === 'disk'">
              <div class="disk-meta">
                <div class="disk-rates">
                  <span v-if="diskRead"><i>R</i>{{ diskRead.value }}<small v-if="diskRead.unit">{{ diskRead.unit }}</small></span>
                  <span v-if="diskWrite"><i>W</i>{{ diskWrite.value }}<small v-if="diskWrite.unit">{{ diskWrite.unit }}</small></span>
                </div>
                <span v-if="panelTemperature(metric.key)" class="temperature"><i>◆</i>{{ panelTemperature(metric.key)?.value }}<small v-if="panelTemperature(metric.key)?.unit">{{ panelTemperature(metric.key)?.unit }}</small></span>
              </div>
              <div class="meter" aria-hidden="true"><i :style="{ width: `${metricProgress(snapshot[metric.key])}%` }"></i></div>
            </template>
            <template v-else>
              <div class="metric-meta">
                <p class="metric-detail">{{ metricDetail(snapshot[metric.key]) }}</p>
                <span v-if="panelTemperature(metric.key)" class="temperature"><i>◆</i>{{ panelTemperature(metric.key)?.value }}<small v-if="panelTemperature(metric.key)?.unit">{{ panelTemperature(metric.key)?.unit }}</small></span>
              </div>
              <div class="meter" aria-hidden="true"><i :style="{ width: `${metricProgress(snapshot[metric.key])}%` }"></i></div>
            </template>
          </section>
        </div>

        <div v-if="hasAuxTelemetry" class="panel-aux">
          <span v-if="displayRate" class="aux-item display-item"><i>DISPLAY</i><strong>{{ rendererFps }}<small>FPS</small></strong><em>/</em><strong>{{ displayRate.value }}<small v-if="displayRate.unit">{{ displayRate.unit }}</small></strong></span>
          <span v-if="powerRate" class="aux-item power-item"><i>{{ snapshot.power?.detail ?? 'POWER' }}</i><strong>{{ powerRate.value }}<small v-if="powerRate.unit">{{ powerRate.unit }}</small></strong><em v-if="powerBattery">·</em><strong v-if="powerBattery">{{ powerBattery.value }}<small v-if="powerBattery.unit">{{ powerBattery.unit }}</small></strong></span>
        </div>
      </template>
      <p v-else class="loading"><i></i>正在初始化监控数据…</p>
    </div>
  </main>
</template>
