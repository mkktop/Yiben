import type { ChapterWithProgress } from '@shared/types'

type ReadingChapter = Pick<ChapterWithProgress, 'id' | 'read_page' | 'completed' | 'read_updated_at'>

/** 优先接续最近在读的未完话，再从章节顺序中找下一话；不修改传入列表。 */
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
