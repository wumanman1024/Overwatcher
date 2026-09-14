export type ErrorConsole = Pick<Console, 'error'>

export function reportRuntimeError(consoleLike: ErrorConsole, scope: string, error: unknown): void {
  consoleLike.error(`[硬件监控] ${scope}`, error)
}

export function installMainErrorLogging(): void {
  process.on('uncaughtException', (error) => reportRuntimeError(console, '主进程未处理异常', error))
  process.on('unhandledRejection', (reason) => reportRuntimeError(console, '主进程未处理 Promise 拒绝', reason))
}
