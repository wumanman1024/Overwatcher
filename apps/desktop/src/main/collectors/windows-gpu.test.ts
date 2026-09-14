import { expect, test } from 'vitest'
import { collectWindowsGpuMetrics, selectActiveGpuUtilization } from './windows-gpu'

test('选择利用率最高的 Windows GPU 适配器，而不是固定厂商', () => {
  expect(selectActiveGpuUtilization([
    { Path: '\\GPU Engine(pid_10_luid_0x00000000_0x00000001_phys_0_eng_0_engtype_3D)\\Utilization Percentage', CookedValue: 17 },
    { Path: '\\GPU Engine(pid_10_luid_0x00000000_0x00000001_phys_0_eng_1_engtype_Copy)\\Utilization Percentage', CookedValue: 4 },
    { Path: '\\GPU Engine(pid_12_luid_0x00000000_0x00000002_phys_0_eng_0_engtype_3D)\\Utilization Percentage', CookedValue: 62 },
    { Path: '\\GPU Engine(pid_12_luid_0x00000000_0x00000002_phys_0_eng_1_engtype_Compute)\\Utilization Percentage', CookedValue: 7 }
  ])).toEqual({ adapterId: 'luid_0x00000000_0x00000002', utilization: 62 })
})

test('忽略没有适配器标识或无效数值的计数器', () => {
  expect(selectActiveGpuUtilization([
    { Path: '\\GPU Engine(pid_10_luid_0x00000000_0x00000001_phys_0_eng_0_engtype_3D)\\Utilization Percentage', CookedValue: 'NaN' },
    { Path: '\\GPU Engine(unavailable)\\Utilization Percentage', CookedValue: 91 }
  ])).toBeUndefined()
})

test.runIf(process.platform === 'win32')('在 Windows 上从真实 GPU 性能计数器读取利用率', async () => {
  const result = await collectWindowsGpuMetrics()

  expect(result.gpu).toMatchObject({ available: true, unit: '%' })
  expect(result.gpu?.value).toEqual(expect.any(Number))
}, 10_000)
