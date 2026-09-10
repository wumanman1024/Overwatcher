import type { MetricSnapshot, MetricValue } from '../../shared/metrics'

export type CollectorResult = Partial<Omit<MetricSnapshot, 'timestamp'>>
export type Collector = () => Promise<CollectorResult>

const unavailable = (reason: string): MetricValue => ({ available: false, reason })

function mergeMetric(previous: MetricValue | undefined, next: MetricValue): MetricValue {
  if (!previous) return next
  const extras = new Map((previous.extras ?? []).map((extra) => [extra.label, extra]))
  for (const extra of next.extras ?? []) extras.set(extra.label, extra)
  return {
    available: previous.available || next.available,
    value: next.value ?? previous.value,
    unit: next.unit ?? previous.unit,
    detail: next.detail ?? previous.detail,
    ...(extras.size > 0 ? { extras: [...extras.values()] } : {}),
    reason: next.reason ?? previous.reason
  }
}

export class MetricSampler {
  private running: Promise<MetricSnapshot> | undefined

  constructor(private readonly collectors: Collector[]) {}

  collectOnce(): Promise<MetricSnapshot> {
    if (this.running) return this.running
    this.running = this.collect().finally(() => { this.running = undefined })
    return this.running
  }

  private async collect(): Promise<MetricSnapshot> {
    const results = await Promise.all(this.collectors.map(async (collector) => {
      try {
        return await collector()
      } catch {
        return {}
      }
    }))
    const merged: CollectorResult = {}
    for (const result of results) {
      for (const [key, metric] of Object.entries(result)) {
        const metricKey = key as keyof CollectorResult
        const next = metric as MetricValue
        merged[metricKey] = mergeMetric(merged[metricKey], next)
      }
    }
    return {
      timestamp: Date.now(),
      cpu: merged.cpu ?? unavailable('暂时无法读取 CPU 数据'),
      memory: merged.memory ?? unavailable('暂时无法读取内存数据'),
      gpu: merged.gpu ?? unavailable('暂时无法读取 GPU 数据'),
      disk: merged.disk ?? unavailable('暂时无法读取磁盘数据'),
      network: merged.network ?? unavailable('暂时无法读取网络数据'),
      display: merged.display ?? unavailable('暂时无法读取显示器刷新率'),
      power: merged.power ?? unavailable('暂时无法读取充放电功率')
    }
  }
}
