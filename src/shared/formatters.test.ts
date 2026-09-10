import { expect, test } from 'vitest'
import { formatMetricValue, formatRate } from './formatters'

test('百分比保留至多一位小数且去除尾零', () => {
  expect(formatMetricValue(32.400000000000006, '%')).toBe('32.4%')
  expect(formatMetricValue(18, '%')).toBe('18%')
})

test('速率按 1024 进制动态选择单位', () => {
  expect(formatRate(999)).toBe('999 B/s')
  expect(formatRate(1536)).toBe('1.5 KB/s')
  expect(formatRate(1.5 * 1024 * 1024)).toBe('1.5 MB/s')
})
