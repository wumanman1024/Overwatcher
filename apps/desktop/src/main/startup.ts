type SingleInstanceApp = {
  requestSingleInstanceLock: () => boolean
  quit: () => void
}

export function ensureSingleInstance(app: SingleInstanceApp): boolean {
  if (app.requestSingleInstanceLock()) return true

  app.quit()
  return false
}
