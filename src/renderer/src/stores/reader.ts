import { create } from 'zustand'
import type { ReaderPrefs } from '@shared/types'

export type ReaderMode = 'single' | 'double' | 'webtoon'
export type ReaderFit = 'width' | 'height' | 'original'

interface ReaderState {
  mode: ReaderMode
  fit: ReaderFit
  rtl: boolean
  rotate: number
  /** 当前页（spread 场景下是展开页的第一页索引） */
  page: number
  pageCount: number

  /** 沉浸模式：隐藏 UI */
  immersive: boolean
  showThumbs: boolean

  init: (prefs: ReaderPrefs, pageCount: number, startPage: number) => void
  setPage: (page: number) => void
  next: () => void
  prev: () => void
  patch: (prefs: ReaderPrefs) => void
  toggleImmersive: () => void
  toggleThumbs: () => void
}

export const useReaderStore = create<ReaderState>((set, get) => ({
  mode: 'single',
  fit: 'width',
  rtl: true,
  rotate: 0,
  page: 0,
  /** 0 = 未知（init 前或页数待回填），此时不判定「已读完」 */
  pageCount: 0,
  immersive: false,
  showThumbs: false,

  init: (prefs, pageCount, startPage) =>
    set({
      mode: (prefs.mode as ReaderMode) ?? 'single',
      fit: (prefs.fit as ReaderFit) ?? 'width',
      rtl: prefs.rtl ?? true,
      rotate: prefs.rotate ?? 0,
      pageCount,
      page: clampPage(startPage, pageCount),
      immersive: false
    }),

  setPage: (page) => {
    const { pageCount } = get()
    set({ page: clampPage(page, pageCount) })
  },

  // 页码始终按阅读顺序递增；rtl 只影响 spread 内的左右排布（见 spreadPages），
  // 这里若再按 rtl 反向会导致双页日漫模式下 next 直接卡在首页。
  next: () => {
    const { mode, page, setPage } = get()
    setPage(page + (mode === 'double' ? 2 : 1))
  },

  prev: () => {
    const { mode, page, setPage } = get()
    setPage(page - (mode === 'double' ? 2 : 1))
  },

  patch: (prefs) => set(prefs as Partial<ReaderState>),

  toggleImmersive: () => set((s) => ({ immersive: !s.immersive })),
  toggleThumbs: () => set((s) => ({ showThumbs: !s.showThumbs }))
}))

/**
 * 页码钳位。
 * pageCount 为 0 表示页数未知（未回填的云端压缩包/PDF）：此时不做上界钳位，
 * 否则会把页码压到 0 甚至 -1，导致协议层「页码越界」。
 */
function clampPage(page: number, pageCount: number): number {
  const max = pageCount > 0 ? pageCount - 1 : Math.max(page, 0)
  return Math.max(0, Math.min(page, max))
}

/** double 模式下当前 spread 展示的页索引数组 */
export function spreadPages(page: number, pageCount: number, rtl: boolean): number[] {
  // 页数未知时退化为单页，避免双页模式下整屏空白
  if (pageCount <= 0) return [Math.max(page, 0)]
  // 约定：第 0 页（封面）单独展示，之后 (1,2) (3,4) …
  let left: number
  let right: number
  if (page === 0) return [0]
  if (page % 2 === 1) {
    left = page
    right = page + 1
  } else {
    left = page - 1
    right = page
  }
  const pages = right < pageCount ? [left, right] : [left]
  return rtl ? pages.reverse() : pages
}
