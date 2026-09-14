import { setTimeout as sleep } from 'node:timers/promises'

/**
 * 最小间隔串行队列：把异步执行体本身纳入链（下一个请求等上一个完成 + 间隔），
 * 而不是只串行「间隔检查」——否则慢请求执行期间后续请求照样并发在途，
 * 正是网盘风控（115 的 990007 / 天翼的 RatesExceed）敏感的 burst 形态。
 */
export class MinIntervalChain {
  private chain: Promise<unknown> = Promise.resolve()
  private lastDoneAt = 0

  constructor(private readonly intervalMs: number) {}

  run<T>(fn: () => Promise<T>): Promise<T> {
    const task = this.chain.then(async () => {
      const wait = this.lastDoneAt + this.intervalMs - Date.now()
      if (wait > 0) await sleep(wait)
      try {
        return await fn()
      } finally {
        this.lastDoneAt = Date.now()
      }
    })
    // 链上下一个等待者不受本次成败影响
    this.chain = task.then(
      () => undefined,
      () => undefined
    )
    return task
  }
}
