import { describe, expect, it, vi } from 'vitest'
import { MetricSampler, type Collector } from './sampler'

describe('MetricSampler', () => {
  it('一个采集器失败时仍返回成功指标', async () => {
    const ok: Collector = async () => ({ cpu: { available: true, value: 24, unit: '%' } })
    const failed: Collector = async () => { throw new Error('读取失败') }
    const sampler = new MetricSampler([ok, failed])

    await expect(sampler.collectOnce()).resolves.toMatchObject({ cpu: { available: true, value: 24 } })
  })

  it('并发调用不会重复运行慢采集器', async () => {
    let release!: () => void
    const slow = vi.fn(() => new Promise<Record<string, never>>((resolve) => { release = () => resolve({}) }))
    const sampler = new MetricSampler([slow])
    const first = sampler.collectOnce()
    const second = sampler.collectOnce()
    release()
    await Promise.all([first, second])

    expect(slow).toHaveBeenCalledTimes(1)
  })

  it('温度采集不会覆盖 CPU 占用率，并会合并为附加字段', async () => {
    const load: Collector = async () => ({ cpu: { available: true, value: 24, unit: '%' } })
    const temperature: Collector = async () => ({
      cpu: { available: true, extras: [{ label: '温度', value: '62°C' }] }
    })
    const snapshot = await new MetricSampler([load, temperature]).collectOnce()

    expect(snapshot.cpu).toMatchObject({ value: 24, unit: '%', extras: [{ label: '温度', value: '62°C' }] })
  })
})
