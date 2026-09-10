const { chmod } = require('node:fs/promises')
const { join } = require('node:path')

/**
 * Electron 在 Linux 上需要 chrome-sandbox 为 root:root 的 setuid helper。
 * dpkg 会在安装时以 root 解包，因此这里只保留 4755 文件模式。
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return
  await chmod(join(context.appOutDir, 'chrome-sandbox'), 0o4755)
}
