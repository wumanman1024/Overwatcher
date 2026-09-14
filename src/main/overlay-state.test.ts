import { expect, test } from 'vitest'
import { clampPosition, reduceOverlayMode, selectWorkAreaForPosition, shouldToggleOverlayOnPointerUp, sizeForOverlayMode } from './overlay-state'

test('鼠标进入加速球后进入展开状态，固定后忽略离开事件', () => {
  expect(reduceOverlayMode('orb', 'hover')).toBe('expanded')
  expect(reduceOverlayMode('expanded', 'pin')).toBe('pinned')
  expect(reduceOverlayMode('pinned', 'leave')).toBe('pinned')
})

test('恢复的位置会被限制在显示器工作区内', () => {
  expect(clampPosition({ x: 1900, y: -50 }, { width: 92, height: 92 }, { x: 0, y: 24, width: 1920, height: 1056 }))
    .toEqual({ x: 1828, y: 24 })
})

test('拖动跨屏时根据窗口中心选择目标屏幕', () => {
  expect(selectWorkAreaForPosition(
    { x: -900, y: 120 },
    { width: 164, height: 72 },
    [
      { x: 0, y: 0, width: 1920, height: 1080 },
      { x: -1280, y: 0, width: 1280, height: 1024 }
    ]
  )).toEqual({ x: -1280, y: 0, width: 1280, height: 1024 })
})

test('加速球展开时为详情面板预留窗口空间', () => {
  expect(sizeForOverlayMode('orb')).toEqual({ width: 164, height: 72 })
  expect(sizeForOverlayMode('expanded')).toEqual({ width: 280, height: 320 })
})

test('轻点加速球切换详情，拖动不切换', () => {
  expect(shouldToggleOverlayOnPointerUp({ x: 100, y: 100 }, { x: 102, y: 101 })).toBe(true)
  expect(shouldToggleOverlayOnPointerUp({ x: 100, y: 100 }, { x: 108, y: 100 })).toBe(false)
})
