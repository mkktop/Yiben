/** 指数退避相关的纯工具，便于单测 */

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    const abort = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      reject(signal?.reason)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', abort, { once: true })
  })
}

/**
 * 第 attempt 次失败后的等待毫秒数（0 起）：5s → 15s → 45s，封顶 60s，
 * 再乘 0.8–1.2 的抖动，避免固定节奏被服务端识别为脚本行为。
 */
export function backoffDelay(attempt: number): number {
  const base = Math.min(5000 * 3 ** Math.max(0, attempt), 60_000)
  return Math.round(base * (0.8 + Math.random() * 0.4))
}

/** 章节间停顿：2–5 秒随机 */
export function chapterGapMs(): number {
  return Math.round(2000 + Math.random() * 3000)
}
