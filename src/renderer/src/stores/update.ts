import { create } from 'zustand'

/** 应用更新域：状态本体在全局 store（事件监听在 App 挂载时注册，切页不丢）。
 *  交互模型（与主进程 updater.ts 对应）：检查 -> 用户点「下载更新」-> 用户点「立即重启」。 */

export type UpdateStatus = '' | 'dev' | 'busy' | 'available' | 'latest' | 'error'

interface UpdateStore {
  current: string
  /** '' = 还没查过；dev = 开发模式不检查 */
  status: UpdateStatus
  version: string
  notes: string
  error: string
  checking: boolean
  downloading: boolean
  percent: number
  /** 已下载待安装的版本（空 = 没有） */
  ready: string
  /** 读当前版本 + 恢复待安装状态 + 注册进度/就绪监听（幂等） */
  init: () => Promise<void>
  check: () => Promise<void>
  download: () => Promise<void>
  install: () => void
}

let inited = false

export const useUpdateStore = create<UpdateStore>((set, get) => ({
  current: '',
  status: '',
  version: '',
  notes: '',
  error: '',
  checking: false,
  downloading: false,
  percent: 0,
  ready: '',

  init: async () => {
    if (inited) return
    inited = true
    const [v, s] = await Promise.all([window.yiben.updater.appVersion(), window.yiben.updater.state()])
    set({ current: v, ready: s.ready, downloading: s.downloading })
    window.yiben.updater.onProgress((percent) => set({ percent }))
    window.yiben.updater.onReady((version) => set({ ready: version, downloading: false }))
  },

  check: async () => {
    set({ checking: true, error: '', notes: '', version: '' })
    try {
      const r = await window.yiben.updater.check()
      set({
        status: r.status,
        current: r.current,
        version: r.version ?? '',
        notes: r.notes ?? '',
        error: r.error ?? ''
      })
    } catch (e) {
      set({ status: 'error', error: String(e) })
    } finally {
      set({ checking: false })
    }
  },

  download: async () => {
    set({ downloading: true, percent: 0, error: '' })
    try {
      const r = await window.yiben.updater.download()
      if (!r.ok) set({ downloading: false, error: r.error ?? '下载失败' })
      // 成功时 onReady 事件把 downloading 置 false 并写入 ready
    } catch (e) {
      // IPC 层 rejection 不接住的话 downloading 恒为 true，按钮永久转圈只能重启
      set({ downloading: false, error: String(e) })
    }
  },

  install: () => {
    if (get().ready) void window.yiben.updater.install()
  }
}))
