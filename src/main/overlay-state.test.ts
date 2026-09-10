import { expect, test } from 'vitest'
import { clampPosition, reduceOverlayMode } from './overlay-state'

test('鼠标进入加速球后进入展开状态，固定后忽略离开事件', () => {
  expect(reduceOverlayMode('orb', 'hover')).toBe('expanded')
  expect(reduceOverlayMode('expanded', 'pin')).toBe('pinned')
  expect(reduceOverlayMode('pinned', 'leave')).toBe('pinned')
})

test('恢复的位置会被限制在显示器工作区内', () => {
  expect(clampPosition({ x: 1900, y: -50 }, { width: 92, height: 92 }, { x: 0, y: 24, width: 1920, height: 1056 }))
    .toEqual({ x: 1828, y: 24 })
})
