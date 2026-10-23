import { describe, expect, it } from 'vitest'
import { chapterFraction, readingPageLabel } from '@shared/reading'
import { chapterGroups } from './chapterList'
import type { ChapterWithProgress } from '@shared/types'

describe('阅读状态表达', () => {
  it('未知页数只显示实际位置，不产生零分母或虚假比例', () => {
    expect(readingPageLabel(2, 0)).toBe('读到第 3 页')
    expect(readingPageLabel(null, 0)).toBe('尚未开始 · 总页数待确认')
    expect(chapterFraction(2, 0, false)).toBe(0)
  })
  it('未开始、首屏、部分阅读及显式完成分别计入进度', () => {
    expect(chapterFraction(null, 10, false)).toBe(0)
    expect(chapterFraction(0, 10, false)).toBe(0.1)
    expect(chapterFraction(4, 10, false)).toBe(0.5)
    expect(chapterFraction(99, 10, false)).toBe(0.99)
    expect(chapterFraction(2, 0, true)).toBe(1)
    expect(readingPageLabel(null, 10)).toBe('尚未开始 · 共 10 页')
    expect(readingPageLabel(4, 10)).toBe('第 5 / 10 页')
  })
})

const chapters = [
  { id: 1, title: '序章', volume: null, number: null },
  { id: 2, title: '新的冒险', volume: '1', number: 1 },
  { id: 3, title: '归来', volume: '1', number: 2 },
  { id: 4, title: 'Final', volume: '2', number: 3 },
  { id: 5, title: '番外', volume: '1', number: 4 }
] as ChapterWithProgress[]

describe('章节搜索与卷分组', () => {
  it('只合并相邻同卷，未分卷章节与重复卷号保留独立分组', () => {
    expect(chapterGroups(chapters).map((group) => group.items.map(({ chapter }) => chapter.id)))
      .toEqual([[1], [2, 3], [4], [5]])
  })
  it('按标题、话号和卷号搜索，多个词同时匹配且忽略大小写', () => {
    expect(chapterGroups(chapters, ' final ')[0].items[0].chapter.id).toBe(4)
    expect(chapterGroups(chapters, '第 1 卷').flatMap((group) => group.items.map(({ chapter }) => chapter.id)))
      .toEqual([2, 3, 5])
    expect(chapterGroups(chapters, '归来 2')[0].items[0].chapter.id).toBe(3)
    expect(chapterGroups(chapters, '不存在')).toEqual([])
  })
  it('搜索保留原序号与卷标识，空关键词恢复所有章节且不改动原列表', () => {
    const before = JSON.stringify(chapters)
    const all = chapterGroups(chapters)
    const found = chapterGroups(chapters, '归来')[0]
    expect(found.key).toBe(all[1].key)
    expect(found.items[0].index).toBe(2)
    expect(chapterGroups(chapters, '  ')).toEqual(all)
    expect(JSON.stringify(chapters)).toBe(before)
  })
})
