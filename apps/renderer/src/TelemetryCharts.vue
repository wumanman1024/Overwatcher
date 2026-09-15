<script setup lang="ts">
import { computed, ref } from 'vue'
import { use } from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'
import { LineChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import VChart from 'vue-echarts'
import { toTrendSeries, type TelemetrySample } from './telemetry-history'
import { formatHistoryWindow, toUtilizationItems } from './telemetry-presentation'
import { healthForValue } from './metric-health'

use([SVGRenderer, LineChart, GridComponent, LegendComponent, TooltipComponent])
const props = defineProps<{ history: TelemetrySample[] }>()
const trend = ref<'usage' | 'thermal' | 'network' | 'power'>('usage')
const latest = computed(() => props.history.at(-1))
const historyWindow = computed(() => formatHistoryWindow(props.history))
const utilizationItems = computed(() => toUtilizationItems({ cpu: latest.value?.cpu ?? 0, gpu: latest.value?.gpu ?? 0, memory: latest.value?.memory ?? 0 }).map((item) => ({
  ...item,
  health: healthForValue(item.value, item.key === 'cpu' ? { warning: 80, danger: 95 } : item.key === 'gpu' ? { warning: 85, danger: 98 } : { warning: 85, danger: 95 })
})))
const clockLabels = computed(() => props.history.map((sample) => new Date(sample.timestamp).toLocaleTimeString('zh-CN', { minute: '2-digit', second: '2-digit' })))
const values = (key: Exclude<keyof TelemetrySample, 'timestamp'>) => toTrendSeries(props.history, key).map(([, value]) => value)
const trendDefinitions = computed(() => ({
  usage: { unit: '%', series: [{ name: 'CPU', key: 'cpu', color: '#19b968' }, { name: 'GPU', key: 'gpu', color: '#42a5f5' }, { name: '内存', key: 'memory', color: '#ed7c3a' }] },
  thermal: { unit: '°C', series: [{ name: 'CPU 温度', key: 'cpuTemperature', color: '#ed7c3a' }, { name: 'GPU 温度', key: 'gpuTemperature', color: '#d85d3a' }] },
  network: { unit: 'B/s', series: [{ name: '下载', key: 'networkDown', color: '#19b968' }, { name: '上传', key: 'networkUp', color: '#ed7c3a' }] },
  power: { unit: 'W', series: [{ name: '电池功率', key: 'batteryPower', color: '#42b883' }] }
}))
const chartOption = computed(() => {
  const definition = trendDefinitions.value[trend.value]
  return {
    animationDurationUpdate: 300,
    grid: { left: 10, right: 10, top: 23, bottom: 6, containLabel: true },
    tooltip: { trigger: 'axis', confine: true, backgroundColor: 'rgba(20, 48, 78, .94)', borderWidth: 0, textStyle: { color: '#fff', fontSize: 10 } },
    legend: { top: 0, left: 0, itemWidth: 7, itemHeight: 7, textStyle: { color: '#6584a2', fontSize: 9 } },
    xAxis: { type: 'category', boundaryGap: false, data: clockLabels.value, axisLabel: { show: false }, axisLine: { lineStyle: { color: '#d9e5f0' } }, axisTick: { show: false } },
    yAxis: { type: 'value', min: trend.value === 'usage' ? 0 : undefined, max: trend.value === 'usage' ? 100 : undefined, name: definition.unit, nameTextStyle: { color: '#7a9ab8', fontSize: 9, padding: [0, 0, 0, -4] }, splitNumber: 2, axisLabel: { color: '#7693b0', fontSize: 9, formatter: `{value} ${definition.unit}` }, splitLine: { lineStyle: { color: '#e5edf5' } } },
    series: definition.series.map((item) => ({ name: item.name, type: 'line', smooth: 0.35, symbol: 'none', emphasis: { focus: 'series' }, data: values(item.key as Exclude<keyof TelemetrySample, 'timestamp'>), lineStyle: { width: 2.5, color: item.color }, areaStyle: { color: item.color, opacity: 0.07 } }))
  }
})
</script>

<template>
  <section class="telemetry-charts" aria-label="实时趋势">
    <div class="chart-section-heading"><div><span>核心负载</span><small>CORE UTILIZATION</small></div><span class="live-state"><i></i>实时更新</span></div>
    <div class="utilization-strip" aria-label="CPU、GPU 与内存占用"><article v-for="item in utilizationItems" :key="item.key" class="utilization-item" :class="[`status-${item.health}`, `${item.key}-utilization`]"><div class="utilization-copy"><strong>{{ item.label }}</strong><small>{{ item.caption }}</small></div><span class="utilization-value">{{ item.value }}<small>%</small></span><span class="utilization-track" role="progressbar" :aria-label="`${item.label} 占用`" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="item.value"><i :style="{ width: `${item.value}%` }"></i></span></article></div>
    <div class="trend-heading"><div><span>趋势分析</span><small>{{ historyWindow }}</small></div><div class="chart-tabs" role="tablist" aria-label="趋势指标"><button v-for="(_, key) in trendDefinitions" :key="key" :class="{ active: trend === key }" type="button" role="tab" :aria-selected="trend === key" @click="trend = key">{{ { usage: '占用', thermal: '温度', network: '网络', power: '功率' }[key] }}</button></div></div>
    <VChart class="trend-chart" :option="chartOption" :init-options="{ renderer: 'svg' }" autoresize aria-label="实时趋势图" />
  </section>
</template>
