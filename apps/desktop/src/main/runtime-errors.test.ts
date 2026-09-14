import { expect, test, vi } from 'vitest'
import { reportRuntimeError } from './runtime-errors'

test('将运行时错误完整输出到控制台', () => {
  const error = new Error('telemetry failed')
  const consoleLike = { error: vi.fn() }

  reportRuntimeError(consoleLike, '主进程未处理异常', error)

  expect(consoleLike.error).toHaveBeenCalledWith('[硬件监控] 主进程未处理异常', error)
})
