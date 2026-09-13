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
  /** 横宽比 >1 的跨页大图（扉页/彩页），双页模式下单独占满一屏 */
  widePages: number[]
  /** 双页配对偏移：0 = (1,2)(3,4)…；1 = 第 1 页单独、(2,3)(4,5)…（C 键切换） */
  spreadOffset: number
  /** 阅读器缩放（0.5–4，1 = 100%）；放在 store 而非组件局部：翻页/切话/跨话拼接都保持 */
  zoom: number

  /** 沉浸模式：隐藏 UI */
  immersive: boolean
  showThumbs: boolean

  init: (prefs: ReaderPrefs, pageCount: number, startPage: number) => void
  setPage: (page: number) => void
  next: () => void
  prev: () => void
  patch: (prefs: ReaderPrefs) => void
  setWidePages: (pages: number[]) => void
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
  widePages: [],
  spreadOffset: 0,
  zoom: 1,
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
      widePages: [],
      spreadOffset: prefs.spreadOffset ?? 0,
      zoom: prefs.zoom ?? 1,
      immersive: false
    }),

  setPage: (page) => {
    const { pageCount } = get()
    set({ page: clampPage(page, pageCount) })
  },

  // 页码始终按阅读顺序递增；rtl 只影响 spread 内的左右排布（见 spreadPages）。
  // 步长取「当前 spread 的阅读顺序末页 +1」：跨页大图单独成屏时步长自动变 1。
  next: () => {
    const { mode, page, pageCount, widePages, spreadOffset, setPage } = get()
    if (mode !== 'double' || pageCount <= 0) {
      setPage(page + 1)
      return
    }
    const spread = spreadPages(page, pageCount, false, widePages, spreadOffset)
    setPage(Math.max(...spread) + 1)
  },

  prev: () => {
    const { mode, page, pageCount, widePages, spreadOffset, setPage } = get()
    if (mode !== 'double' || pageCount <= 0) {
      setPage(page - 1)
      return
    }
    const spread = spreadPages(page, pageCount, false, widePages, spreadOffset)
    setPage(Math.min(...spread) - 1)
  },

  patch: (prefs) => set(prefs as Partial<ReaderState>),

  setWidePages: (pages) => set({ widePages: pages }),

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

/**
 * 当前屏是否已含末页（用于「读完进下一话」的边界判定）。
 * 双页模式最后一屏可能是 (n-2, n-1) 两页，按 spread 的最大页判定而不是 page 本身。
 */
export function atLastScreen(
  page: number,
  pageCount: number,
  mode: ReaderMode,
  widePages: number[] = [],
  spreadOffset = 0
): boolean {
  if (pageCount <= 0) return false
  if (mode !== 'double') return page >= pageCount - 1
  return (
    Math.max(...spreadPages(page, pageCount, false, widePages, spreadOffset)) >= pageCount - 1
  )
}

/**
 * 恢复起始页：未读完回到上次位置；已读完（或进度已停在末页）从头开始。
 * 否则点「下一话」跳进一话读过的章节会落在末页，随手一翻又触发进下一话。
 */
export function resumeStartPage(
  progress: { page: number; completed: number } | null,
  pageCount: number
): number {
  if (!progress) return 0
  if (progress.completed || (pageCount > 0 && progress.page >= pageCount - 1)) return 0
  return progress.page
}

/**
 * double 模式下当前 spread 展示的页索引数组（rtl 只决定返回数组内的左右顺序）。
 * 约定：第 0 页（封面）单独展示，之后按阅读顺序两两配对；
 * wide 中的跨页大图单独占一屏，它后面的配对从下一页重新开始。
 * spreadOffset（C 键切换的「跨页配对」）：1 = 第 1 页也单独展示，配对从第 2 页开始，
 * 用于修正「正文第一页其实是独立扉页」这类自动配对落空的情形。
 */
export function spreadPages(
  page: number,
  pageCount: number,
  rtl: boolean,
  wide: number[] = [],
  spreadOffset = 0
): number[] {
  // 页数未知时退化为单页，避免双页模式下整屏空白
  if (pageCount <= 0) return [Math.max(page, 0)]
  if (page === 0) return [0]

  const isWide = (p: number): boolean => wide.includes(p)
  // 从第 1 页开始沿阅读顺序模拟配对，找到包含 page 的那一屏
  let i = 1
  if (spreadOffset === 1) {
    if (page === 1) return [1]
    i = 2
  }
  while (i < pageCount) {
    if (isWide(i)) {
      if (page === i) return [i]
      i += 1
      continue
    }
    const right = i + 1
    if (right < pageCount && !isWide(right)) {
      if (page === i || page === right) {
        const pages = [i, right]
        return rtl ? pages.reverse() : pages
      }
      i += 2
    } else {
      // 末页落单，或右侧是跨页大图
      if (page === i) return [i]
      i += 1
    }
  }
  return [clampPage(page, pageCount)]
}
