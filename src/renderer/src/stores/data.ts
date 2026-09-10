import { create } from 'zustand'

interface DataState {
  /** 扫描完成/库变更后自增，驱动列表重新拉取 */
  version: number
  bump: () => void
  /** 顶栏搜索词 */
  query: string
  setQuery: (q: string) => void
}

export const useDataStore = create<DataState>((set) => ({
  version: 0,
  bump: () => set((s) => ({ version: s.version + 1 })),
  query: '',
  setQuery: (query) => set({ query })
}))

export interface ScanState {
  active: boolean
  current: number
  total: number
  title: string
}

/** 扫描错误/告警：由主进程 scan:notice 推送 */
export interface ScanNotice {
  level: 'error' | 'warn'
  message: string
}

interface ScanStatusState extends ScanState {
  notice: ScanNotice | null
  setProgress: (p: { current?: number; total?: number; title?: string; phase: string }) => void
  setNotice: (notice: ScanNotice | null) => void
}

export const useScanStore = create<ScanStatusState>((set) => ({
  active: false,
  current: 0,
  total: 0,
  title: '',
  notice: null,
  setProgress: (p) =>
    set((s) => {
      const done = p.phase === 'done'
      return {
        active: !done,
        current: p.current ?? s.current,
        total: p.total ?? s.total,
        title: p.title ?? s.title
        // notice 不在这里清：失败时 error 与 done 一起到，清了就看不到了
      }
    }),
  setNotice: (notice) => set(notice ? { notice, active: false } : { notice })
}))
