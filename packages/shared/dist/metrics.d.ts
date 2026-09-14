export type MetricKey = 'cpu' | 'memory' | 'gpu' | 'disk' | 'network' | 'display' | 'power';
export type CoreMetricKey = 'cpu' | 'memory' | 'gpu' | 'disk' | 'network';
export type AuxiliaryMetricKey = 'display' | 'power';
export type AlertSeverity = 'normal' | 'warning' | 'critical';
export interface MetricValue {
    available: boolean;
    value?: number;
    unit?: string;
    detail?: string;
    extras?: MetricExtra[];
    reason?: string;
}
export interface MetricExtra {
    label: string;
    value: string | number;
    unit?: string;
}
export interface HardwareField {
    label: string;
    value: string;
}
export interface HardwareGroup {
    title: string;
    subtitle?: string;
    status?: string;
    fields: HardwareField[];
}
export interface HardwareSection {
    key: 'system' | 'cpu' | 'board' | 'memory' | 'gpu' | 'storage' | 'display' | 'network';
    title: string;
    icon: string;
    summary: string;
    fields: HardwareField[];
    groups?: HardwareGroup[];
}
export interface HardwareProfile {
    deviceName: string;
    operatingSystem: string;
    sections: HardwareSection[];
}
export type MetricSnapshot = Record<CoreMetricKey, MetricValue> & Partial<Record<AuxiliaryMetricKey, MetricValue>> & {
    timestamp: number;
    hardware?: HardwareProfile;
};
