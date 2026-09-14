import type { MetricSnapshot, MetricValue } from '@hardware-overlay/shared/metrics'

export interface TelemetrySample {
  timestamp: number
  cpu?: number
  memory?: number
  gpu?: number
  batteryPower?: number
  networkDown?: number
  networkUp?: number
  cpuTemperature?: number
  gpuTemperature?: number
  cpuFrequency?: number
}

const valueOf = (metric: MetricValue | undefined): number | undefined => (
  metric?.available && typeof metric.value === 'number' && Number.isFinite(metric.value) ? metric.value : undefined
)

const extraValue = (metric: MetricValue | undefined, label: string): number | undefined => {
  const value = metric?.extras?.find((extra) => extra.label === label)?.value
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function appendTelemetrySample(history: TelemetrySample[], snapshot: MetricSnapshot): TelemetrySample[] {
  const sample: TelemetrySample = {
    timestamp: snapshot.timestamp,
    cpu: valueOf(snapshot.cpu),
    memory: valueOf(snapshot.memory),
    gpu: valueOf(snapshot.gpu),
    batteryPower: valueOf(snapshot.power),
    networkDown: extraValue(snapshot.network, '下载'),
    networkUp: extraValue(snapshot.network, '上传'),
    cpuTemperature: extraValue(snapshot.cpu, '温度'),
    gpuTemperature: extraValue(snapshot.gpu, '温度'),
    cpuFrequency: extraValue(snapshot.cpu, '频率')
  }
  return [...history, sample].slice(-60)
}

export function toTrendSeries(history: TelemetrySample[], key: Exclude<keyof TelemetrySample, 'timestamp'>): Array<[number, number]> {
  return history.flatMap((sample) => {
    const value = sample[key]
    return typeof value === 'number' ? [[sample.timestamp, value]] : []
  })
}
