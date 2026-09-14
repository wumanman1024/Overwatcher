import { expect, test } from 'vitest'
import { formatMetric } from './metric-display'

test('将可用指标格式化为主读数', () => {
  expect(formatMetric({ available: true, value: 32.400000000000006, unit: '%' })).toBe('32.4%')
})

test('将不可用指标显示为占位符', () => {
  expect(formatMetric({ available: false })).toBe('—')
})
