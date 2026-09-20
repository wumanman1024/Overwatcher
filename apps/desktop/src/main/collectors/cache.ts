export interface CacheOptions {
  ttlMs: number
  // 拉取失败时若已有旧值，返回旧值而非抛出，避免慢查询抖动导致整帧数据丢失。
  serveStaleOnError?: boolean
}

export function createCache<T>(loader: () => Promise<T>, { ttlMs, serveStaleOnError = true }: CacheOptions): () => Promise<T> {
  let value: T | undefined
  let hasValue = false
  let expiresAt = 0
  let pending: Promise<T> | undefined

  return () => {
    const now = Date.now()
    if (hasValue && now < expiresAt) return Promise.resolve(value as T)
    if (!pending) {
      pending = loader()
        .then((result) => {
          value = result
          hasValue = true
          expiresAt = Date.now() + ttlMs
          return result
        })
        .catch((error) => {
          if (serveStaleOnError && hasValue) return value as T
          throw error
        })
        .finally(() => { pending = undefined })
    }
    return pending
  }
}

export interface BackoffGateOptions {
  // 判定一次结果是否代表「采集器可用」；不可用时按退避间隔重试，可用则恢复默认间隔。
  isAvailable: (result: unknown) => boolean
  baseMs: number
  maxMs?: number
}

/*
 * 失败退避门：没有对应硬件的机器（无 NVIDIA 驱动、无 GPU 计数器）不必每秒
 * 反复 spawn 探测进程；连续失败后重试间隔指数退避，一旦成功立即恢复常态。
 */
export function createBackoffGate<T>(collect: () => Promise<T>, { isAvailable, baseMs, maxMs = 60_000 }: BackoffGateOptions): () => Promise<T> {
  let retryAfter = 0
  let intervalMs = baseMs
  let lastResult: T | undefined
  let pending: Promise<T> | undefined

  return async () => {
    const now = Date.now()
    if (now < retryAfter) return lastResult as T
    if (pending) return pending
    pending = collect()
      .then((result) => {
        lastResult = result
        if (isAvailable(result)) {
          intervalMs = baseMs
          retryAfter = 0
        } else {
          intervalMs = Math.min(intervalMs * 2, maxMs)
          retryAfter = Date.now() + intervalMs
        }
        return result
      })
      .finally(() => { pending = undefined })
    return pending
  }
}
