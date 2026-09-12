import { create } from 'zustand'
import type { ReactNode } from 'react'

export type ToastKind = 'success' | 'warning' | 'error'

export interface ToastEntry {
  /** 槽位 id：扫描提示 / 云通知等单一来源各自固定一个，重推顶替旧条 */
  id: string
  kind: ToastKind
  /** 首行标题（加粗主文案） */
  title: ReactNode
  /** 次行说明 / 操作入口 */
  children?: ReactNode
}

interface ToastState {
  toasts: ToastEntry[]
  /** 同 id 顶替（单一来源只保留最新一条） */
  push: (entry: ToastEntry) => void
  close: (id: string) => void
}

/** 全局 Toast 队列：所有来源（扫描提示、云通知…）汇入同一宿主竖排堆叠，互不遮挡 */
export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (entry) =>
    set((s) => ({ toasts: [...s.toasts.filter((t) => t.id !== entry.id), entry] })),
  close: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))
