import { expect, test } from 'vitest'
import { formatStatusText } from './status-text'

test('状态条格式化网络上下行并省略不可用 GPU', () => {
  expect(formatStatusText({
    timestamp: 0,
    cpu: { available: true, value: 32.4, unit: '%' },
    memory: { available: true, value: 61, unit: '%' },
    gpu: { available: false }, disk: { available: false },
    network: { available: true, value: 0, unit: 'B/s', extras: [{ label: '下载', value: 856 * 1024, unit: 'B/s' }, { label: '上传', value: 1.4 * 1024 * 1024, unit: 'B/s' }] }
  })).toBe('CPU 32.4% · MEM 61% · ↓ 856 KB/s · ↑ 1.4 MB/s')
})
