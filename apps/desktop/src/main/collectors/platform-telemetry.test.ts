import { expect, test } from 'vitest'
import { buildBatteryMetric } from './platform-telemetry'

test('将充电状态和功率映射为具名电池属性', () => {
  expect(buildBatteryMetric({ percent: 72, isCharging: true, voltage: 11.4, amperage: 1.6, cycleCount: 184 }, 18.4)).toEqual({
    available: true,
    value: 18.4,
    unit: 'W',
    detail: '充电',
    extras: [
      { label: '电量', value: 72, unit: '%' },
      { label: '充电功率', value: 18.4, unit: 'W' },
      { label: '电压', value: 11.4, unit: 'V' },
      { label: '电流', value: 1.6, unit: 'A' },
      { label: '循环次数', value: 184 }
    ]
  })
})

test('将未接电源的电池功率标为放电功率', () => {
  expect(buildBatteryMetric({ percent: 56, isCharging: false, acConnected: false }, 9.8)).toMatchObject({
    detail: '放电',
    extras: expect.arrayContaining([{ label: '放电功率', value: 9.8, unit: 'W' }])
  })
})
