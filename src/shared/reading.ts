import type { ChapterWithProgress } from './types'

type ReadingChapter = Pick<ChapterWithProgress, 'id' | 'read_page' | 'completed' | 'read_updated_at'>

/** 首页与详情共用：优先最近未完话，否则按章节顺序接续，全部读完仍可重读。 */
export function seriesReading<T extends ReadingChapter>(chapters: T[]) {
  const inProgress = chapters.filter((chapter) => chapter.completed !== 1 && chapter.read_page !== null)
  const latest = inProgress.reduce<T | null>((result, chapter) => {
    if (!result) return chapter
    const time = chapter.read_updated_at ?? 0
    const previousTime = result.read_updated_at ?? 0
    return time > previousTime || (time === previousTime && chapter.id > result.id) ? chapter : result
  }, null)
  return {
    chapter: latest ?? chapters.find((chapter) => chapter.completed !== 1) ?? chapters.at(-1) ?? null,
    started: chapters.some((chapter) => chapter.read_page !== null || chapter.completed === 1)
  }
}

/** 未完成章节最多计入不足一话，页数未知时只呈现在读状态，不猜测比例。 */
export function chapterFraction(page: number | null, count: number, completed: boolean): number {
  if (completed) return 1
  if (page === null || count <= 0) return 0
  return Math.min(0.99, Math.max(0, (page + 1) / count))
}

export function readingPageLabel(page: number | null, count: number): string {
  if (page === null) return count > 0 ? `尚未开始 · 共 ${count} 页` : '尚未开始 · 总页数待确认'
  return count > 0 ? `第 ${Math.min(page + 1, count)} / ${count} 页` : `读到第 ${page + 1} 页`
}
