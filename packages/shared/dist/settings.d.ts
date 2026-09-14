import { z } from 'zod';
import type { MetricKey } from './metrics.js';
export declare const settingsSchema: z.ZodObject<{
    opacity: z.ZodDefault<z.ZodNumber>;
    refreshInterval: z.ZodDefault<z.ZodNumber>;
    visibleMetrics: z.ZodDefault<z.ZodArray<z.ZodEnum<["cpu", "memory", "gpu", "disk", "network"]>, "many">>;
    thresholds: z.ZodDefault<z.ZodObject<{
        cpuUsage: z.ZodDefault<z.ZodObject<{
            warning: z.ZodNumber;
            critical: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            warning: number;
            critical: number;
        }, {
            warning: number;
            critical: number;
        }>>;
        gpuUsage: z.ZodDefault<z.ZodObject<{
            warning: z.ZodNumber;
            critical: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            warning: number;
            critical: number;
        }, {
            warning: number;
            critical: number;
        }>>;
        memoryUsage: z.ZodDefault<z.ZodObject<{
            warning: z.ZodNumber;
            critical: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            warning: number;
            critical: number;
        }, {
            warning: number;
            critical: number;
        }>>;
        cpuTemperature: z.ZodDefault<z.ZodObject<{
            warning: z.ZodNumber;
            critical: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            warning: number;
            critical: number;
        }, {
            warning: number;
            critical: number;
        }>>;
        gpuTemperature: z.ZodDefault<z.ZodObject<{
            warning: z.ZodNumber;
            critical: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            warning: number;
            critical: number;
        }, {
            warning: number;
            critical: number;
        }>>;
    }, "strip", z.ZodTypeAny, {
        cpuUsage: {
            warning: number;
            critical: number;
        };
        gpuUsage: {
            warning: number;
            critical: number;
        };
        memoryUsage: {
            warning: number;
            critical: number;
        };
        cpuTemperature: {
            warning: number;
            critical: number;
        };
        gpuTemperature: {
            warning: number;
            critical: number;
        };
    }, {
        cpuUsage?: {
            warning: number;
            critical: number;
        } | undefined;
        gpuUsage?: {
            warning: number;
            critical: number;
        } | undefined;
        memoryUsage?: {
            warning: number;
            critical: number;
        } | undefined;
        cpuTemperature?: {
            warning: number;
            critical: number;
        } | undefined;
        gpuTemperature?: {
            warning: number;
            critical: number;
        } | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    opacity: number;
    refreshInterval: number;
    visibleMetrics: ("network" | "memory" | "cpu" | "gpu" | "disk")[];
    thresholds: {
        cpuUsage: {
            warning: number;
            critical: number;
        };
        gpuUsage: {
            warning: number;
            critical: number;
        };
        memoryUsage: {
            warning: number;
            critical: number;
        };
        cpuTemperature: {
            warning: number;
            critical: number;
        };
        gpuTemperature: {
            warning: number;
            critical: number;
        };
    };
}, {
    opacity?: number | undefined;
    refreshInterval?: number | undefined;
    visibleMetrics?: ("network" | "memory" | "cpu" | "gpu" | "disk")[] | undefined;
    thresholds?: {
        cpuUsage?: {
            warning: number;
            critical: number;
        } | undefined;
        gpuUsage?: {
            warning: number;
            critical: number;
        } | undefined;
        memoryUsage?: {
            warning: number;
            critical: number;
        } | undefined;
        cpuTemperature?: {
            warning: number;
            critical: number;
        } | undefined;
        gpuTemperature?: {
            warning: number;
            critical: number;
        } | undefined;
    } | undefined;
}>;
export type AppSettings = z.infer<typeof settingsSchema>;
export declare const defaultSettings: AppSettings;
export type VisibleMetricKey = MetricKey;
