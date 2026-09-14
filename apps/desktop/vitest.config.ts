import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const workspaceRoot = resolve(__dirname, '../..')

export default defineConfig({
  resolve: {
    alias: {
      '@hardware-overlay/shared': resolve(workspaceRoot, 'packages/shared/src'),
      '@renderer': resolve(workspaceRoot, 'apps/renderer/src')
    }
  },
  test: {
    include: ['src/**/*.test.ts', '../renderer/src/**/*.test.ts']
  }
})
