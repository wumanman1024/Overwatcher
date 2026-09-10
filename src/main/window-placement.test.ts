import { expect, test } from 'vitest'
import { placeAtRightCenter } from './window-placement'

test('将悬浮窗放在屏幕工作区右侧并垂直居中', () => {
  expect(placeAtRightCenter(
    { x: 0, y: 24, width: 1920, height: 1056 },
    { width: 400, height: 520 }
  )).toEqual({ x: 1504, y: 292 })
})
