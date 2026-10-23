import type { ChapterWithProgress } from '@shared/types'

/** 分组先于搜索，保证搜索结果中的序号、卷归属和折叠标识稳定。 */
export function chapterGroups(chapters: ChapterWithProgress[], query = '') {
  const groups: Array<{
    key: string
    volume: string | null
    items: Array<{ chapter: ChapterWithProgress; index: number }>
  }> = []
  chapters.forEach((chapter, index) => {
    const last = groups.at(-1)
    if (last && last.volume === chapter.volume) last.items.push({ chapter, index })
    else groups.push({ key: `volume-${index}`, volume: chapter.volume, items: [{ chapter, index }] })
  })
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return groups
  return groups.map((group) => ({
    ...group,
    items: group.items.filter(({ chapter, index }) => {
      const text = `${chapter.title} 第 ${chapter.number ?? index + 1} 话 ${group.volume === null ? '' : `第 ${group.volume} 卷`}`.toLocaleLowerCase()
      return terms.every((term) => text.includes(term))
    })
  })).filter((group) => group.items.length > 0)
}
