import { expect, test } from 'vitest'
import { appendTelemetrySample, toTrendSeries } from './telemetry-history'

const snapshot = (timestamp: number, cpu: number) => ({
  timestamp,
  cpu: { available: true, value: cpu, unit: '%' },
  memory: { available: true, value: 30, unit: '%' },
  gpu: { available: true, value: 40, unit: '%' },
  disk: { available: true, value: 20, unit: '%' },
  network: { available: true, value: 0, unit: 'B/s' }
})

test('保留最新 60 个每秒遥测样本', () => {
  const history = Array.from({ length: 61 }, (_, index) => index + 1)
    .reduce((items, timestamp) => appendTelemetrySample(items, snapshot(timestamp, timestamp)), [])

  expect(history).toHaveLength(60)
  expect(history[0]).toMatchObject({ timestamp: 2, cpu: 2 })
  expect(history.at(-1)).toMatchObject({ timestamp: 61, cpu: 61 })
})

test('将历史样本转成 ECharts 可用的趋势序列', () => {
  const history = [
    { timestamp: 1, cpu: 20 },
    { timestamp: 2, cpu: 35 }
  ]

  expect(toTrendSeries(history, 'cpu')).toEqual([[1, 20], [2, 35]])
})
