export type OverlayMode = 'docked' | 'orb' | 'expanded' | 'pinned'
export type OverlayEvent = 'hover' | 'leave' | 'pin' | 'unpin' | 'dock'
export interface Position { x: number; y: number }
export interface Size { width: number; height: number }
export interface WorkArea extends Position, Size {}

const orbSize: Size = { width: 164, height: 72 }
const expandedSize: Size = { width: 300, height: 290 }

export function sizeForOverlayMode(mode: OverlayMode): Size {
  return mode === 'expanded' || mode === 'pinned' ? expandedSize : orbSize
}

export function shouldToggleOverlayOnPointerUp(start: Position, end: Position): boolean {
  return Math.hypot(end.x - start.x, end.y - start.y) < 4
}

export function reduceOverlayMode(mode: OverlayMode, event: OverlayEvent): OverlayMode {
  if (event === 'dock') return 'docked'
  if (event === 'hover' && (mode === 'docked' || mode === 'orb')) return mode === 'docked' ? 'orb' : 'expanded'
  if (event === 'leave' && mode === 'expanded') return 'orb'
  if (event === 'pin' && mode === 'expanded') return 'pinned'
  if (event === 'unpin' && mode === 'pinned') return 'orb'
  return mode
}

export function clampPosition(position: Position, size: Size, workArea: WorkArea): Position {
  return {
    x: Math.min(Math.max(position.x, workArea.x), workArea.x + workArea.width - size.width),
    y: Math.min(Math.max(position.y, workArea.y), workArea.y + workArea.height - size.height)
  }
}
