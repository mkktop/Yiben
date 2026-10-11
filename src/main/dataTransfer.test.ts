import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ userData: '', open: vi.fn(), save: vi.fn() }))
vi.mock('electron', () => ({
  app: { getPath: () => mocks.userData },
  dialog: { showOpenDialog: mocks.open, showSaveDialog: mocks.save }
}))

import {
  addBookmark,
  addLibrary,
  bookmarkPages,
  closeDb,
  getProgress,
  openDb,
  saveProgress,
  setChapterCompleted,
  setSeriesHidden,
  setSeriesProgress,
  upsertChapter,
  upsertSeries
} from './db'
import { exportData, importData } from './dataTransfer'

let dir: string
let file: string
let chapterId: number
let seriesId: number

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'yudu-transfer-'))
  mocks.userData = dir
  file = join(dir, 'progress.json')
  openDb()
})

afterAll(() => {
  closeDb()
  rmSync(dir, { recursive: true, force: true })
})

beforeEach(() => {
  openDb().prepare('DELETE FROM libraries').run()
  const lib = addLibrary('备份测试', 'D:/transfer')
  seriesId = upsertSeries({
    library_id: lib.id,
    title: '测试漫画',
    folder_path: 'D:/transfer/漫画',
    author: null,
    description: null,
    status: null,
    tags: null,
    is_single_file: 0
  })
  chapterId = upsertChapter({
    series_id: seriesId,
    title: '第一话',
    volume: null,
    number: 1,
    sort_index: 0,
    path: 'D:/transfer/漫画/1.zip',
    kind: 'zip',
    page_count: 10,
    size: 1,
    mtime: 1
  })
  mocks.open.mockResolvedValue({ canceled: false, filePaths: [file] })
  mocks.save.mockResolvedValue({ canceled: false, filePath: file })
})

function backup(page = 4, updatedAt = 1000) {
  return {
    app: 'yudu',
    version: 1,
    exportedAt: 2000,
    series: [
      {
        folderPath: 'D:/transfer/漫画',
        title: '测试漫画',
        hidden: 0,
        chapters: [
          {
            path: 'D:/transfer/漫画/1.zip',
            title: '第一话',
            sortIndex: 0,
            progress: { page, completed: 0, updatedAt },
            bookmarks: [0, 3]
          }
        ]
      }
    ]
  }
}

function writeBackup(value: unknown): void {
  writeFileSync(file, JSON.stringify(value), 'utf-8')
}

describe('阅读数据备份', () => {
  it('隐藏或源目录离线的系列仍完整导出进度与书签', async () => {
    saveProgress(chapterId, 2, false)
    addBookmark(chapterId, 1)
    setSeriesHidden(seriesId, true)
    openDb().prepare('UPDATE series SET missing = 1 WHERE id = ?').run(seriesId)
    expect(await exportData()).toMatchObject({ series: 1, progress: 1, bookmarks: 1 })
    const out = JSON.parse(readFileSync(file, 'utf-8'))
    expect(out.series[0]).toMatchObject({ hidden: 1, chapters: [{ bookmarks: [1] }] })
  })

  it('导入保留原时间戳、不计阅读日志，重复导入幂等', async () => {
    writeBackup(backup())
    expect(await importData()).toMatchObject({ progress: 1, bookmarks: 2 })
    expect(getProgress([chapterId])[0]).toMatchObject({ page: 4, updated_at: 1000 })
    expect(openDb().prepare('SELECT COUNT(*) AS n FROM reading_log').get()).toEqual({ n: 0 })
    expect(await importData()).toMatchObject({ progress: 0, bookmarks: 0 })
  })

  it('按真实更新时间合并，多次导入逐步更新且旧备份不回退', async () => {
    writeBackup(backup(4, 1000))
    await importData()
    writeBackup(backup(7, 2000))
    expect(await importData()).toMatchObject({ progress: 1 })
    writeBackup(backup(1, 1500))
    expect(await importData()).toMatchObject({ progress: 0 })
    expect(getProgress([chapterId])[0]).toMatchObject({ page: 7, updated_at: 2000 })
  })

  it('页数已知时钳位进度并排除越界书签，未知时保留页码', async () => {
    const out = backup(100)
    out.series[0].chapters[0].bookmarks = [3, 100]
    writeBackup(out)
    await importData()
    expect(getProgress([chapterId])[0].page).toBe(9)
    expect(bookmarkPages(chapterId)).toEqual([3])
    openDb().prepare('UPDATE chapters SET page_count = 0 WHERE id = ?').run(chapterId)
    out.series[0].chapters[0].progress.updatedAt = 2000
    writeBackup(out)
    await importData()
    expect(getProgress([chapterId])[0].page).toBe(100)
    expect(bookmarkPages(chapterId)).toEqual([3, 100])
  })

  it.each([
    [
      '不支持的版本',
      (b: ReturnType<typeof backup>) => {
        b.version = 2
      }
    ],
    [
      '负数页码',
      (b: ReturnType<typeof backup>) => {
        b.series[0].chapters[0].progress.page = -1
      }
    ],
    [
      '小数书签',
      (b: ReturnType<typeof backup>) => {
        b.series[0].chapters[0].bookmarks = [1.5]
      }
    ],
    [
      '无效时间戳',
      (b: ReturnType<typeof backup>) => {
        b.series[0].chapters[0].progress.updatedAt = NaN
      }
    ],
    [
      '损坏的后续章节',
      (b: ReturnType<typeof backup>) => {
        b.series[0].chapters.push(null as never)
      }
    ]
  ])('%s 在写库前拒绝，不留下部分进度', async (_label, mutate) => {
    const out = backup()
    mutate(out)
    writeBackup(out)
    await expect(importData()).rejects.toThrow()
    expect(getProgress([chapterId])).toEqual([])
    expect(bookmarkPages(chapterId)).toEqual([])
  })

  it('写书签失败时整笔事务回滚，进度也不残留', async () => {
    openDb().exec(`CREATE TEMP TRIGGER fail_bookmark BEFORE INSERT ON bookmarks
      BEGIN SELECT RAISE(ABORT, '模拟磁盘写入失败'); END`)
    try {
      writeBackup(backup())
      await expect(importData()).rejects.toThrow('模拟磁盘写入失败')
      expect(getProgress([chapterId])).toEqual([])
      expect(bookmarkPages(chapterId)).toEqual([])
    } finally {
      openDb().exec('DROP TRIGGER fail_bookmark')
    }
  })

  it('手动标记单话和整系列已读不制造阅读日志，实际翻页仍计数', () => {
    setChapterCompleted(chapterId, true)
    setSeriesProgress(seriesId, false)
    setSeriesProgress(seriesId, true)
    expect(openDb().prepare('SELECT COUNT(*) AS n FROM reading_log').get()).toEqual({ n: 0 })
    setSeriesProgress(seriesId, false)
    saveProgress(chapterId, 2, false)
    expect(openDb().prepare('SELECT pages FROM reading_log').all()).toEqual([{ pages: 3 }])
  })

  it('取消对话框不读写备份', async () => {
    mocks.open.mockResolvedValue({ canceled: true, filePaths: [] })
    mocks.save.mockResolvedValue({ canceled: true })
    expect(await importData()).toBeNull()
    expect(await exportData()).toBeNull()
  })
  it('逻辑合并后 JSON 仍按原文件来源导出，解除合并也能正确恢复进度', async () => {
    const db = openDb()
    const library = db.prepare('SELECT library_id FROM series WHERE id = ?').get(seriesId) as {
      library_id: number
    }
    const target = upsertSeries({
      library_id: library.library_id,
      title: '合并主系列',
      folder_path: 'D:/transfer/主系列',
      author: null,
      description: null,
      status: null,
      tags: null,
      is_single_file: 0
    })
    db.prepare('INSERT INTO series_merges (source_id,target_id) VALUES (?,?)').run(seriesId, target)
    saveProgress(chapterId, 5, false, { updatedAt: 5000, trackReading: false })
    await exportData()
    const data = JSON.parse(readFileSync(file, 'utf8'))
    expect(
      data.series.find((entry: { folderPath: string }) => entry.folderPath === 'D:/transfer/漫画')
        .chapters[0].progress.page
    ).toBe(5)
    expect(
      data.series.find((entry: { folderPath: string }) => entry.folderPath === 'D:/transfer/主系列')
        .chapters
    ).toEqual([])
    db.prepare('DELETE FROM series_merges').run()
    db.prepare('DELETE FROM progress').run()
    await importData()
    expect(getProgress([chapterId])[0].page).toBe(5)
  })
})
