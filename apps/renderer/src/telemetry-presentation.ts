interface TimedSample { timestamp: number }
interface UtilizationValues { cpu: number; gpu: number; memory: number }

const utilizationMeta = [
  { key: 'cpu', label: 'CPU', caption: '处理器' },
  { key: 'gpu', label: 'GPU', caption: '图形处理器' },
  { key: 'memory', label: '内存', caption: '物理内存' }
] as const

export function formatHistoryWindow(history: TimedSample[]): string {
  if (history.length < 2) return '实时数据'

  const elapsedSeconds = Math.round((history.at(-1)!.timestamp - history[0]!.timestamp) / 1_000)
  return `最近 ${Math.min(Math.max(elapsedSeconds, 1), 60)} 秒`
}

export function toUtilizationItems(values: UtilizationValues) {
  return utilizationMeta.map((item) => ({
    ...item,
    value: Math.min(Math.max(Math.round(values[item.key]), 0), 100)
  }))
}
