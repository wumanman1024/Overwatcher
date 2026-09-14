import { describe, expect, it, vi } from 'vitest'
import { ensureSingleInstance } from './startup'

describe('ensureSingleInstance', () => {
  it('quits the newly launched process when another instance owns the lock', () => {
    const quit = vi.fn()
    const app = {
      requestSingleInstanceLock: () => false,
      quit
    }

    expect(ensureSingleInstance(app)).toBe(false)
    expect(quit).toHaveBeenCalledOnce()
  })

  it('allows startup when the process owns the lock', () => {
    const quit = vi.fn()
    const app = {
      requestSingleInstanceLock: () => true,
      quit
    }

    expect(ensureSingleInstance(app)).toBe(true)
    expect(quit).not.toHaveBeenCalled()
  })
})
