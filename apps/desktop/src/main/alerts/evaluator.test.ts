import { describe, expect, it } from 'vitest'
import { evaluateAlert } from './evaluator'

describe('告警状态机', () => {
  it('连续两次超过阈值才进入警告状态', () => {
    const threshold = { warning: 80, critical: 90 }
    const first = evaluateAlert(undefined, 82, threshold)
    const second = evaluateAlert(first, 82, threshold)

    expect(first.severity).toBe('normal')
    expect(second.severity).toBe('warning')
  })

  it('不可用指标不会保留告警状态', () => {
    const state = evaluateAlert(
      { severity: 'critical', candidate: 'critical', count: 2 },
      null,
      { warning: 80, critical: 90 }
    )

    expect(state.severity).toBe('normal')
  })
})
