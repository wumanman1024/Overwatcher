import { expect, test } from 'vitest'
import { parseMillidegrees } from './linux-temperature'

test('将 Linux 温度毫摄氏度转为摄氏度', () => {
  expect(parseMillidegrees('42500\n')).toBe(42.5)
})
