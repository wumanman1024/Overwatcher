import type { AlertSeverity } from '@localforge/shared/metrics'

export interface Threshold {
  warning: number
  critical: number
}

export interface AlertState {
  severity: AlertSeverity
  candidate: AlertSeverity
  count: number
}

function candidateFor(value: number, threshold: Threshold): AlertSeverity {
  if (value >= threshold.critical) return 'critical'
  if (value >= threshold.warning) return 'warning'
  return 'normal'
}

export function evaluateAlert(
  previous: AlertState | undefined,
  value: number | null,
  threshold: Threshold
): AlertState {
  if (value === null) return { severity: 'normal', candidate: 'normal', count: 0 }

  const candidate = candidateFor(value, threshold)
  const count = previous?.candidate === candidate ? previous.count + 1 : 1
  const severity = count >= 2 ? candidate : (previous?.severity ?? 'normal')

  return { severity, candidate, count }
}
