import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ userData: '' }))

// db/index.ts 只用到 app.getPath('userData')
vi.mock('electron', () => ({ app: { getPath: () => mocks.userData } }))

import {
  addLibrary,
  closeDb,
  openDb,
  readingStats,
  saveProgress,
  upsertChapter,
  upsertSeries
} from './index'

let dir = ''

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'yiben-stats-'))
  mocks.userData = dir
  openDb()
  addLibrary('统计测试库', 'D:/stats')
})

afterAll(() => {
  closeDb()
  rmSync(dir, { recursive: true, force: true })
})

/** 本地时区 YYYY-MM-DD（与实现同源，避免测试自己造一套日期格式） */
function dayKey(d: Date): string {
  return d.toLocaleDateString('sv')
}

/** 相对今天偏移 offset 天的日期串（-1 = 昨天） */
function shiftDay(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return dayKey(d)
}

let seriesSeq = 0

/** 建一个独立系列 + 章节，返回章节 id（progress/日志互不干扰） */
function seedChapter(label: string): number {
  const seriesId = upsertSeries({
    library_id: 1,
    title: `统计系列${++seriesSeq}-${label}`,
    author: null,
    description: null,
    status: null,
    tags: null,
    folder_path: `D:/stats/series-${seriesSeq}`,
    is_single_file: 0
  })
  return upsertChapter({
    series_id: seriesId,
    title: label,
    volume: null,
    number: null,
    sort_index: 0,
    path: `D:/stats/series-${seriesSeq}/${label}.zip`,
    kind: 'zip',
    page_count: 999,
    size: 1,
    mtime: 1
  })
}

/** 绕过埋点直接插一条指定日期的日志（chapter_id 传 null 表示合成数据） */
function insertLog(dayOffset: number, pages = 3, chapterId: number | null = null): void {
  openDb()
    .prepare(
      'INSERT INTO reading_log (chapter_id, series_id, day, pages, ms, at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(chapterId, 0, shiftDay(dayOffset), pages, 0, Date.now())
}

describe('reading_log 埋点', () => {
  it('增量计算：首读记 page+1，继续读记差值，往回翻不计', () => {
    const ch = seedChapter('增量')
    const before = readingStats(365).totalPages

    saveProgress(ch, 4, false) // 首次记录：4 + 1 = 5 页
    saveProgress(ch, 9, false) // 前进：9 - 4 = 5 页
    saveProgress(ch, 3, false) // 往回翻：delta <= 0，不产生日志

    const rows = openDb()
      .prepare('SELECT pages FROM reading_log WHERE chapter_id = ? ORDER BY id')
      .all(ch) as Array<{ pages: number }>
    expect(rows.map((r) => r.pages)).toEqual([5, 5])
    expect(readingStats(365).totalPages - before).toBe(10)
  })
})

describe('readingStats 统计窗口', () => {
  it('跨天边界：只聚合最近 N 天，窗口外的日志不参与统计', () => {
    const ch = seedChapter('跨天')
    saveProgress(ch, 0, false) // 今天产生一条 1 页日志
    // 把这条日志改到昨天：验证按天归属（而非按写入时刻）
    openDb().prepare('UPDATE reading_log SET day = ? WHERE chapter_id = ?').run(shiftDay(-1), ch)
    // 400 天前的旧日志：超出默认 365 天窗口
    openDb()
      .prepare(
        'INSERT INTO reading_log (chapter_id, series_id, day, pages, ms, at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(ch, 0, shiftDay(-400), 7, 0, Date.now())

    const year = readingStats(365)
    expect(year.days.find((d) => d.day === shiftDay(-1))?.pages).toBe(1)
    expect(year.days.find((d) => d.day === shiftDay(-400))).toBeUndefined()

    // 收窄窗口：7 天窗口含昨天，起点是 6 天前
    const week = readingStats(7)
    expect(week.days.some((d) => d.day === shiftDay(-1))).toBe(true)
    expect(week.days.every((d) => d.day >= shiftDay(-6))).toBe(true)
  })
})

describe('readingStats 连续天数', () => {
  it('连续打卡中断：缺口即断；今天还没读时从昨天起算', () => {
    // 前面的用例可能已经写过今天的日志：清空今天，构造「今天还没读」的场景
    openDb().prepare('DELETE FROM reading_log WHERE day = ?').run(shiftDay(0))
    // 昨天、前天、大前天有记录，今天还没读 → 从昨天起算连续 3 天
    insertLog(-1)
    insertLog(-2)
    insertLog(-3)
    expect(readingStats(365).streak).toBe(3)

    // 今天也读了 → 4 天
    insertLog(0)
    expect(readingStats(365).streak).toBe(4)

    // 更早（5 天前）也有，但 4 天前缺失 → 缺口断开，仍是 4
    insertLog(-5)
    expect(readingStats(365).streak).toBe(4)

    // 指标一致性：总页数 = 各天之和，最佳单日取最大
    const st = readingStats(365)
    expect(st.totalPages).toBe(st.days.reduce((s, d) => s + d.pages, 0))
    expect(st.bestDay?.pages).toBe(Math.max(...st.days.map((d) => d.pages)))
    expect(st.totalDays).toBe(st.days.length)
  })
})
