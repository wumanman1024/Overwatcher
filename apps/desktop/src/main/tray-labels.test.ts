import { expect, test } from 'vitest'
import { clickThroughLabel } from './tray-labels'

test('根据穿透状态生成中文托盘操作文案', () => {
  expect(clickThroughLabel(false)).toBe('开启鼠标穿透')
  expect(clickThroughLabel(true)).toBe('关闭鼠标穿透')
})
