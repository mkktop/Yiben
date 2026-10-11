import { errorMessage } from './utils'

/** 确认操作同步上锁，避免 React 尚未刷新禁用状态时重复执行。 */
export function createConfirmation(callbacks: {
  busy: (value: boolean) => void
  error: (message: string) => void
}) {
  let running = false
  let completed = false
  return {
    dismiss(close: () => void): void {
      if (!running && !completed) close()
    },
    async confirm(action: () => Promise<void>, close: () => void): Promise<void> {
      if (running || completed) return
      running = true
      callbacks.error('')
      callbacks.busy(true)
      try {
        await action()
        completed = true
        close()
      } catch (error) {
        callbacks.error(errorMessage(error))
      } finally {
        running = false
        callbacks.busy(false)
      }
    }
  }
}
