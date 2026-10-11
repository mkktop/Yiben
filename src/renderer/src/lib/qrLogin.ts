export type QrState = 'waiting' | 'scanned' | 'done' | 'expired'

export interface QrApi {
  start: () => Promise<{ dataUrl: string }>
  poll: () => Promise<{ state: QrState; username?: string }>
}

/** 查询失败保留已扫描状态；刷新或关闭后，旧会话响应不能覆盖新二维码。 */
export function createQrLogin(api: QrApi, callbacks: {
  image: (value: string) => void
  state: (value: QrState) => void
  error: (value: string) => void
  loading: (value: boolean) => void
  done: () => Promise<void>
}) {
  let revision = 0
  let ready = false
  let polling = false
  let failures = 0
  return {
    async refresh(): Promise<void> {
      const request = ++revision
      ready = false
      failures = 0
      callbacks.loading(true)
      callbacks.image('')
      callbacks.state('waiting')
      callbacks.error('')
      try {
        const result = await api.start()
        if (request !== revision) return
        callbacks.image(result.dataUrl)
        ready = true
      } catch {
        if (request === revision)
          callbacks.error('获取二维码失败，请检查网络后重新获取。')
      } finally {
        if (request === revision) callbacks.loading(false)
      }
    },
    async poll(): Promise<void> {
      if (!ready || polling) return
      const request = revision
      polling = true
      try {
        const result = await api.poll()
        if (request !== revision) return
        failures = 0
        callbacks.error('')
        callbacks.state(result.state)
        if (result.state === 'expired') ready = false
        if (result.state === 'done') {
          await callbacks.done()
          if (request === revision) ready = false
        }
      } catch {
        if (request !== revision) return
        failures++
        if (failures >= 3)
          callbacks.error('暂时无法查询扫码状态，正在自动重试；也可重新获取二维码。')
      } finally {
        polling = false
      }
    },
    close(): void {
      revision++
      ready = false
    }
  }
}
