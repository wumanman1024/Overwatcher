<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { HardwareField, HardwareSection, MetricKey, MetricSnapshot, MetricValue } from '@hardware-overlay/shared/metrics'
import { formatExtra, formatMetric } from './metric-display'

const props = defineProps<{ snapshot: MetricSnapshot }>()
const activeKey = ref<HardwareSection['key']>('system')

const fallbackSections: HardwareSection[] = [
  { key: 'system', title: '电脑概览', icon: 'PC', summary: '正在读取硬件档案', fields: [{ label: '状态', value: '硬件信息采集中…' }] },
  { key: 'cpu', title: '处理器', icon: 'CPU', summary: '处理器实时状态', fields: [] },
  { key: 'memory', title: '内存', icon: 'RAM', summary: '物理内存实时状态', fields: [] },
  { key: 'gpu', title: '显卡', icon: 'GPU', summary: '图形处理器实时状态', fields: [] },
  { key: 'storage', title: '硬盘', icon: 'SSD', summary: '存储设备实时状态', fields: [] },
  { key: 'display', title: '显示器', icon: 'DSP', summary: '显示设备实时状态', fields: [] },
  { key: 'network', title: '网卡', icon: 'NET', summary: '网络接口实时状态', fields: [] }
]

const sections = computed(() => props.snapshot.hardware?.sections ?? fallbackSections)
watch(sections, (items) => {
  if (!items.some((item) => item.key === activeKey.value)) activeKey.value = items[0]?.key ?? 'system'
})

const metricField = (label: string, metric: MetricValue | undefined): HardwareField | undefined => metric ? { label, value: formatMetric(metric) } : undefined
const extras = (metric: MetricValue | undefined): HardwareField[] => (metric?.extras ?? []).map((item) => ({ label: item.label, value: formatExtra(item.value, item.unit) }))
const extraDisplay = (metric: MetricValue | undefined, label: string): string => {
  const item = metric?.extras?.find((extra) => extra.label === label)
  return item ? formatExtra(item.value, item.unit) : '—'
}
const networkDown = computed(() => extraDisplay(props.snapshot.network, '下载'))
const networkUp = computed(() => extraDisplay(props.snapshot.network, '上传'))
const runtimeFields = computed<Record<HardwareSection['key'], HardwareField[]>>(() => ({
  system: [{ label: '设备名称', value: props.snapshot.hardware?.deviceName ?? '本机' }, { label: '操作系统', value: props.snapshot.hardware?.operatingSystem ?? '正在读取…' }],
  cpu: [metricField('当前占用', props.snapshot.cpu), ...extras(props.snapshot.cpu)].filter((item): item is HardwareField => Boolean(item)),
  board: [],
  memory: [metricField('当前占用', props.snapshot.memory), ...extras(props.snapshot.memory)].filter((item): item is HardwareField => Boolean(item)),
  gpu: [metricField('当前占用', props.snapshot.gpu), ...extras(props.snapshot.gpu)].filter((item): item is HardwareField => Boolean(item)),
  storage: [metricField('磁盘占用', props.snapshot.disk), ...extras(props.snapshot.disk)].filter((item): item is HardwareField => Boolean(item)),
  display: [metricField('当前刷新率', props.snapshot.display), ...(props.snapshot.display?.detail ? [{ label: '当前分辨率', value: props.snapshot.display.detail }] : [])].filter((item): item is HardwareField => Boolean(item)),
  network: [
    { label: '↓ 下载速度', value: networkDown.value },
    { label: '↑ 上传速度', value: networkUp.value },
    ...extras(props.snapshot.network).filter((item) => item.label !== '下载' && item.label !== '上传')
  ]
}))

const activeSection = computed(() => sections.value.find((item) => item.key === activeKey.value) ?? sections.value[0])
const visibleFields = computed(() => {
  const section = activeSection.value
  if (!section) return []
  const merged = [...runtimeFields.value[section.key], ...section.fields]
  const unique = new Map<string, HardwareField>()
  for (const item of merged) if (!unique.has(`${item.label}:${item.value}`)) unique.set(`${item.label}:${item.value}`, item)
  return [...unique.values()]
})

const coreMetrics = computed(() => ([
  { key: 'cpu', label: 'CPU', metric: props.snapshot.cpu },
  { key: 'gpu', label: 'GPU', metric: props.snapshot.gpu },
  { key: 'memory', label: '内存', metric: props.snapshot.memory },
  { key: 'disk', label: '磁盘', metric: props.snapshot.disk },
  { key: 'network', label: '网络', metric: props.snapshot.network }
] satisfies Array<{ key: MetricKey; label: string; metric: MetricValue }>))
</script>

<template>
  <section class="hardware-workbench" aria-label="硬件参数">
    <aside class="hardware-nav">
      <div class="machine-summary"><strong>{{ snapshot.hardware?.deviceName ?? '本机' }}</strong><span>{{ snapshot.hardware?.operatingSystem ?? '硬件检测中' }}</span></div>
      <button v-for="section in sections" :key="section.key" type="button" :class="{ active: activeKey === section.key }" @click="activeKey = section.key">
        <i>{{ section.icon }}</i><span>{{ section.title }}</span><b>›</b>
      </button>
    </aside>

    <div class="hardware-content">
      <div class="core-readings">
        <div v-for="item in coreMetrics" :key="item.key" :class="{ 'network-reading': item.key === 'network' }">
          <span>{{ item.label }}</span>
          <strong v-if="item.key !== 'network'">{{ formatMetric(item.metric) }}</strong>
          <strong v-else class="network-directions"><b>↓</b>{{ networkDown }}<i>↑</i>{{ networkUp }}</strong>
        </div>
      </div>
      <header class="hardware-section-title">
        <div><i>{{ activeSection?.icon }}</i><span><strong>{{ activeSection?.title }}</strong><small>{{ activeSection?.summary }}</small></span></div>
        <em>{{ visibleFields.length }} 项参数</em>
      </header>
      <div class="parameter-grid">
        <div v-for="item in visibleFields" :key="`${item.label}:${item.value}`" class="parameter-row"><span>{{ item.label }}</span><strong :title="item.value">{{ item.value }}</strong></div>
      </div>
    </div>
  </section>
</template>
