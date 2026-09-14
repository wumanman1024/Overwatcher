import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

const workspaceRoot = resolve(__dirname, '../..')
const rendererRoot = resolve(workspaceRoot, 'apps/renderer')
const sharedSource = resolve(workspaceRoot, 'packages/shared/src')
const sharedAlias = { '@hardware-overlay/shared': sharedSource }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@hardware-overlay/shared'] })],
    resolve: { alias: sharedAlias }
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@hardware-overlay/shared'] })],
    resolve: { alias: sharedAlias },
    build: {
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    root: rendererRoot,
    build: {
      rollupOptions: {
        input: resolve(rendererRoot, 'index.html')
      }
    },
    resolve: {
      alias: {
        ...sharedAlias,
        '@renderer': resolve(rendererRoot, 'src')
      }
    },
    plugins: [vue()]
  }
})
