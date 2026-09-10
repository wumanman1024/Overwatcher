import Store from 'electron-store'
import type { Position } from './overlay-state'

export interface OverlayPreferences {
  position?: Position
  statusBarEdge: 'top' | 'bottom'
}

const defaults: OverlayPreferences = { statusBarEdge: 'bottom' }
const store = new Store<OverlayPreferences>({ name: 'overlay-preferences', defaults })

export function loadOverlayPreferences(): OverlayPreferences {
  const value = store.store
  return {
    statusBarEdge: value.statusBarEdge === 'top' ? 'top' : 'bottom',
    ...(value.position && Number.isFinite(value.position.x) && Number.isFinite(value.position.y) ? { position: value.position } : {})
  }
}

export function saveOverlayPreferences(preferences: OverlayPreferences): void {
  store.set(preferences)
}
