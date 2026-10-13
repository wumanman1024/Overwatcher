const { readFileSync } = require('node:fs')
const { join } = require('node:path')

// pnpm 11 only reads registry/auth settings from .npmrc. Forward binary
// mirrors to lifecycle scripts so Electron and electron-rebuild receive them.
const mirrorKeys = new Set([
  'electron_mirror',
  'electron_builder_binaries_mirror',
  'better_sqlite3_binary_host',
])

module.exports = {
  hooks: {
    updateConfig(config) {
      const extraEnv = { ...config.extraEnv }
      for (const line of readFileSync(join(__dirname, '.npmrc'), 'utf8').split(/\r?\n/)) {
        const separator = line.indexOf('=')
        if (separator < 0) continue
        const key = line.slice(0, separator).trim()
        if (mirrorKeys.has(key)) {
          extraEnv[`npm_config_${key}`] = line.slice(separator + 1).trim()
        }
      }
      return { ...config, extraEnv }
    },
  },
}
