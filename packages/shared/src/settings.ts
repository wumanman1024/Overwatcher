import { z } from 'zod'
import type { MetricKey } from './metrics.js'

const thresholdSchema = z.object({ warning: z.number().finite(), critical: z.number().finite() })

export const settingsSchema = z.object({
  opacity: z.number().min(0.2).max(1).default(0.86),
  refreshInterval: z.number().int().min(500).max(10000).default(1000),
  visibleMetrics: z.array(z.enum(['cpu', 'memory', 'gpu', 'disk', 'network'])).default(['cpu', 'memory', 'gpu', 'disk', 'network']),
  thresholds: z.object({
    cpuUsage: thresholdSchema.default({ warning: 80, critical: 95 }),
    gpuUsage: thresholdSchema.default({ warning: 85, critical: 98 }),
    memoryUsage: thresholdSchema.default({ warning: 85, critical: 95 }),
    cpuTemperature: thresholdSchema.default({ warning: 80, critical: 90 }),
    gpuTemperature: thresholdSchema.default({ warning: 80, critical: 90 })
  }).default({})
})

export type AppSettings = z.infer<typeof settingsSchema>
export const defaultSettings: AppSettings = settingsSchema.parse({})
export type VisibleMetricKey = MetricKey
