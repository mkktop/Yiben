import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ dir: '' }))
vi.mock('electron', () => ({ app: { getPath: () => mock.dir } }))
vi.mock('./backup', () => ({ createBackup: vi.fn() }))
vi.mock('./rescan', () => ({ runExclusiveScan: (fn: () => Promise<unknown>) => fn() }))
import {
  openDb,
  closeDb,
  addLibrary,
  upsertSeries,
  upsertChapter,
  getChapter,
  getChapterSource,
  chaptersBySeries,
  listSeries,
  saveProgress,
  toggleBookmark,
  bookmarksForSeries,
  neighborChapters,
  continueReading,
  retireSeriesNotIn,
  adoptSeriesData,
  logReadingTime,
  readingStats,
  updateSeriesMeta,
  getSeries,
  setSeriesTags,
  seriesTagNames
} from './db'
import { mergeSeriesData, unmergeSeriesData, mergeSources } from './seriesMerge'
import { setSetting, getSetting } from './settings'
let lib = 0,
  source = 0,
  target = 0,
  chapter = 0
function series(title: string, library = lib): number {
  return upsertSeries({
    library_id: library,
    title,
    author: null,
    description: null,
    status: null,
    tags: null,
    folder_path: `D:/merge/${title}`,
    is_single_file: 0
  })
}
function seedChapter(seriesId: number, title: string): number {
  return upsertChapter({
    series_id: seriesId,
    title,
    volume: null,
    number: 1,
    sort_index: 0,
    path: `D:/merge/${title}.zip`,
    kind: 'zip',
    page_count: 4,
    size: 100,
    mtime: 0
  })
}
beforeAll(() => {
  mock.dir = mkdtempSync(join(tmpdir(), 'yudu-merge-'))
  openDb()
  lib = addLibrary('合并库', 'D:/merge').id
  source = series('来源')
  target = series('主系列')
  chapter = seedChapter(source, '来源章节')
  seedChapter(target, '主章节')
})
afterAll(() => {
  closeDb()
  rmSync(mock.dir, { recursive: true, force: true })
})
describe('逻辑合并保留数据', () => {
  it('章节、进度、书签、首页与邻话使用合并归属，文件来源保持原样', () => {
    saveProgress(chapter, 2, false)
    toggleBookmark(chapter, 1)
    setSetting('readerPrefs', { [source]: { rtl: false } })
    setSetting('offlinePinnedSeries', [source])
    mergeSeriesData(source, target)
    expect(listSeries().map((row) => row.id)).toEqual([target])
    expect(chaptersBySeries(target)).toHaveLength(2)
    expect(chaptersBySeries(target).find((row) => row.id === chapter)?.read_page).toBe(2)
    expect(getChapter(chapter)?.series_id).toBe(target)
    expect(getChapterSource(chapter)?.libraryId).toBe(lib)
    expect(bookmarksForSeries(target)).toHaveLength(1)
    expect(continueReading(5)[0].series_id).toBe(target)
    expect(neighborChapters(chapter)?.total).toBe(2)
    expect(getSetting<Record<string, unknown>>('readerPrefs', {})[target]).toEqual({ rtl: false })
    expect(getSetting<number[]>('offlinePinnedSeries', [])).toEqual([target])
  })
  it('合并按卷话编号排序，邻话与系列列表一致；来源查询保持索引路径', () => {
    openDb().prepare('UPDATE chapters SET number = 3 WHERE id = ?').run(chapter)
    const ordered = chaptersBySeries(target)
    expect(ordered[1].id).toBe(chapter)
    expect(neighborChapters(ordered[0].id)?.next?.id).toBe(chapter)
    const plan = openDb()
      .prepare('EXPLAIN QUERY PLAN SELECT * FROM effective_chapters WHERE series_id = ?')
      .all(target) as Array<{ detail: string }>
    expect(plan.some((row) => row.detail.includes('idx_chapters_series'))).toBe(true)
    expect(plan.some((row) => row.detail.includes('idx_series_merges_target'))).toBe(true)
    expect(plan.some((row) => /SCAN c\b/.test(row.detail))).toBe(false)
  })
  it('重扫相同文件维持关联，无阅读进度的合并目标离线也保留', () => {
    expect(seedChapter(source, '来源章节')).toBe(chapter)
    expect(getChapter(chapter)?.series_id).toBe(target)
    expect(retireSeriesNotIn(lib, ['D:/merge/来源']).deletedSeries).toEqual([])
    expect(mergeSources(target).map((row) => row.id)).toEqual([source])
  })
  it('移动重定位转移合并关联及日志，不丢书签', () => {
    updateSeriesMeta(source, { author: '作者备注' })
    setSeriesTags(source, ['搬迁保留标签'])
    const moved = series('来源新目录'),
      newChapter = seedChapter(moved, '来源迁移章节')
    adoptSeriesData(source, new Map([[chapter, newChapter]]))
    expect(mergeSources(target).map((row) => row.id)).toEqual([moved])
    expect(getChapter(newChapter)?.series_id).toBe(target)
    expect(getSeries(moved)?.author).toBe('作者备注')
    expect(seriesTagNames(moved)).toEqual(['搬迁保留标签'])
    expect(getSetting<Record<string, unknown>>('readerPrefs', {})[moved]).toEqual({ rtl: false })
    expect(bookmarksForSeries(target)[0].chapter_id).toBe(newChapter)
    unmergeSeriesData(moved)
    expect(getChapter(newChapter)?.series_id).toBe(moved)
    expect(chaptersBySeries(target)).toHaveLength(1)
    expect(getSetting<number[]>('offlinePinnedSeries', [])).toContain(moved)
  })
  it('拒绝跨库、自己和合并环，整批保持一致', () => {
    const otherLib = addLibrary('另一库', 'D:/other').id,
      other = series('外库', otherLib),
      a = series('甲'),
      b = series('乙')
    expect(() => mergeSeriesData(other, target)).toThrow('同一书库')
    expect(() => mergeSeriesData(target, target)).toThrow()
    mergeSeriesData(a, b)
    expect(() => mergeSeriesData(b, a)).toThrow('合并来源')
    expect(mergeSources(b)).toHaveLength(1)
  })
  it('时长心跳不增加页数，非法参数不能污染统计', () => {
    const before = readingStats()
    logReadingTime(chapter, 60000) // 已被重定位删除的旧 id 不记账。
    const current = chaptersBySeries(target)[0].id
    logReadingTime(current, 60000)
    const after = readingStats()
    expect(after.totalMinutes - before.totalMinutes).toBe(1)
    expect(after.totalPages).toBe(before.totalPages)
    expect(() => logReadingTime(current, -1)).toThrow()
    expect(() => logReadingTime(current, 120001)).toThrow()
  })
})
