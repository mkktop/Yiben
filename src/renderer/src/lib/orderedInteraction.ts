/** 全量替换型写入按顺序执行，后一次变更始终基于前一次已保存的值。 */
export function createOrderedValue<T>(initial: T) {
  let value = initial
  let tail: Promise<unknown> = Promise.resolve()
  return {
    update(change: (previous: T) => T, persist: (next: T) => Promise<unknown>): Promise<T> {
      const operation = tail.then(async () => {
        const next = change(value)
        await persist(next)
        value = next
        return next
      })
      // 一次失败不阻塞后续操作；失败值也不成为后续操作的基准。
      tail = operation.catch(() => {})
      return operation
    }
  }
}

/** 路径与目录内容同时提交；失败或旧请求均不会更改当前目录归属。 */
export function createDirectoryNavigation<Target, Result>(callbacks: {
  commit: (target: Target, result: Result) => void
  error: (error: unknown) => void
  busy: (value: boolean) => void
}) {
  let revision = 0
  return {
    async navigate(target: Target, load: (target: Target) => Promise<Result>): Promise<void> {
      const request = ++revision
      callbacks.busy(true)
      try {
        const result = await load(target)
        if (request === revision) callbacks.commit(target, result)
      } catch (error) {
        if (request === revision) callbacks.error(error)
      } finally {
        if (request === revision) callbacks.busy(false)
      }
    },
    invalidate(): void {
      revision++
    }
  }
}
