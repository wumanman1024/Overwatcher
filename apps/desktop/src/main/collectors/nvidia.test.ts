import { expect, test } from 'vitest'
import { parseNvidiaCsv } from './nvidia'

test('解析 nvidia-smi 的 GPU 利用率、显存与温度', () => {
  expect(parseNvidiaCsv('38, 1024, 8192, 67\n')).toEqual({
    available: true,
    value: 38,
    unit: '%',
    extras: [
      { label: '温度', value: 67, unit: '°C' },
      { label: '显存已用', value: 1024, unit: 'MiB' },
      { label: '显存总量', value: 8192, unit: 'MiB' }
    ]
  })
})
