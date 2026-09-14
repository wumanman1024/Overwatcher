import { expect, test } from 'vitest'
import { calculateMemoryUsage, formatBytes } from './base'

test('将字节数格式化为中文悬浮窗可读单位', () => {
  expect(formatBytes(1536)).toBe('1.5 KB')
})

test('内存占用按不可用内存计算，不把可回收缓存算作已用', () => {
  expect(calculateMemoryUsage({ total: 16 * 1024, available: 8 * 1024 })).toBe(50)
})
