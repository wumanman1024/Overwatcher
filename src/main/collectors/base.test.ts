import { expect, test } from 'vitest'
import { formatBytes } from './base'

test('将字节数格式化为中文悬浮窗可读单位', () => {
  expect(formatBytes(1536)).toBe('1.5 KB')
})
