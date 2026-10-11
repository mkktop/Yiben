import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ userData: '' }))

// db/index.ts 只用到 app.getPath('userData')
vi.mock('electron', () => ({ app: { getPath: () => mocks.userData } }))

import {
  addLibrary,
  chaptersBySeries,
  closeDb,
  continueReading,
  deleteChaptersNotIn,
  getSeries,
  listSeries,
  openDb,
  recentlyAdded,
  rebuildFts,
  saveProgress,
  setSeriesHidden,
  updateSeriesMeta,
  upsertChapter,
  upsertSeries
} from './index'

let dir = ''

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'yudu-db-'))
  mocks.userData = dir
  openDb()
  addLibrary('测试库', 'D:/lib')
})

afterAll(() => {
  closeDb()
  rmSync(dir, { recursive: true, force: true })
})

/** 直接改 updated_at：saveProgress 内部用 Date.now()，注入不了确定的时间戳 */
function touch(chapterId: number, updatedAt: number, completed = 0): void {
  openDb()
    .prepare('UPDATE progress SET updated_at = ?, completed = ? WHERE chapter_id = ?')
    .run(updatedAt, completed, chapterId)
}

function chapterIds(seriesId: number): number[] {
  return (
    openDb().prepare('SELECT id FROM chapters WHERE series_id = ? ORDER BY id').all(seriesId) as {
      id: number
    }[]
  ).map((r) => r.id)
}

function seedSeries(title: string, names: string[], hidden = false): number {
  const seriesId = upsertSeries({
    library_id: 1,
    title,
    author: null,
    description: null,
    status: null,
    tags: null,
    folder_path: `D:/lib/${title}`,
    is_single_file: 0
  })
  for (const n of names) {
    upsertChapter({
      series_id: seriesId,
      title: n,
      volume: null,
      number: null,
      sort_index: 0,
      path: `D:/lib/${title}/${n}.zip`,
      kind: 'zip',
      page_count: 10,
      size: 1,
      mtime: 1
    })
  }
  if (hidden) setSeriesHidden(seriesId, true)
  return seriesId
}

describe('系列章节进度详情', () => {
  it('携带阅读时间供继续入口选择，未读章节仍为空', () => {
    const series = seedSeries('阅读时间详情', ['时间1', '时间2'])
    const [first, second] = chapterIds(series)
    saveProgress(second, 2, false)
    touch(second, 1250)
    const chapters = chaptersBySeries(series)
    expect(chapters.find((chapter) => chapter.id === first)).toMatchObject({
      read_page: null, completed: null, read_updated_at: null
    })
    expect(chapters.find((chapter) => chapter.id === second)).toMatchObject({
      read_page: 2, completed: 0, read_updated_at: 1250
    })
    // 该用例的进度不参与其他首页列表测试。
    openDb().prepare('DELETE FROM progress WHERE chapter_id = ?').run(second)
  })
})

describe('continueReading（每系列取最近未完话）', () => {
  it('取该系列最近更新且未读完的一话；整系列读完/隐藏不出现', () => {
    const a = seedSeries('系列A', ['a1', 'a2'])
    const b = seedSeries('系列B', ['b1'])
    const c = seedSeries('系列C', ['c1'])
    const d = seedSeries('隐藏系列', ['d1'], true)
    const [a1, a2] = chapterIds(a)
    const [b1] = chapterIds(b)
    const [c1] = chapterIds(c)
    const [d1] = chapterIds(d)
    for (const ch of [a1, a2, b1, c1, d1]) saveProgress(ch, 0, false)
    // A：a1 读完在前，a2 未完在后 → 应返回 a2
    touch(a1, 1000, 1)
    touch(a2, 3000, 0)
    touch(b1, 2000, 0)
    touch(c1, 1500, 1) // 整系列读完 → 不出现
    touch(d1, 4000, 0) // 隐藏系列 → 不出现

    const rows = continueReading(12)
    expect(rows.map((r) => r.chapter_id)).toEqual([a2, b1])
  })

  it('同一系列只出一话；updated_at 并列时按章节 id 取大（确定性行为）', () => {
    const e = seedSeries('系列E', ['e1', 'e2', 'e3'])
    const [e1, e2, e3] = chapterIds(e)
    for (const id of [e1, e2, e3]) saveProgress(id, 0, false)
    touch(e1, 500)
    touch(e2, 900)
    touch(e3, 900) // 并列：e2 与 e3 同一 updated_at，只出一话且取 id 大的

    const rows = continueReading(12).filter((r) => r.series_title === '系列E')
    expect(rows).toHaveLength(1)
    expect(rows[0].chapter_id).toBe(e3)
  })
})

describe('updateSeriesMeta（patch key 白名单）', () => {
  it('只应用白名单字段；渲染层传来的任意字段名被忽略而不进 SQL', () => {
    const id = seedSeries('原书名', ['z1'])
    updateSeriesMeta(id, {
      title: '新书名',
      // 模拟渲染层绕过类型注入的字段名：必须被白名单挡住，而不是拼进 SQL
      ...({ "description = 'x', title": 'hack' } as unknown as Record<string, string>)
    })
    const row = getSeries(id)
    expect(row?.title).toBe('新书名')
    expect(row?.description).toBeNull()
    const metaEdited = (
      openDb().prepare('SELECT meta_edited FROM series WHERE id = ?').get(id) as {
        meta_edited: number
      }
    ).meta_edited
    expect(metaEdited).toBe(1)
  })
})

describe('deleteChaptersNotIn（返回被删章节 id）', () => {
  it('删除不在 keep 清单里的章节并返回其 id，保留的章节原样不动', () => {
    const id = seedSeries('删除测试', ['k1', 'k2', 'gone'])
    const chapters = (
      openDb().prepare('SELECT id, path FROM chapters WHERE series_id = ? ORDER BY id').all(id) as {
        id: number
        path: string
      }[]
    )
    const gone = chapters.find((c) => c.path.includes('gone'))!
    const keepPaths = chapters.filter((c) => c.id !== gone.id).map((c) => c.path)

    const removed = deleteChaptersNotIn(id, keepPaths)
    expect(removed).toEqual([gone.id])

    const rest = openDb()
      .prepare('SELECT id FROM chapters WHERE series_id = ? ORDER BY id')
      .all(id) as { id: number }[]
    expect(rest.map((r) => r.id)).toEqual(
      chapters.filter((c) => c.id !== gone.id).map((c) => c.id)
    )
  })
})

describe('listSeries（元数据编辑后不被扫描覆盖的前提字段存在）', () => {
  it('meta_edited 打标后系列仍在列表中', () => {
    const id = seedSeries('可见性', ['v1'])
    updateSeriesMeta(id, { title: '可见性改' })
    rebuildFts() // 生产里由 series:updateMeta IPC 在改元数据后调用
    expect(listSeries({ query: '可见性改' }).map((s) => s.id)).toContain(id)
  })
})

describe('系列级进度聚合（read_chapters / total_chapters）', () => {
  it('listSeries 按已完成章节数聚合，读完一章涨一格', () => {
    const id = seedSeries('聚合A', ['x1', 'x2', 'x3'])
    const [x1, x2] = chapterIds(id)
    const row = (): ReturnType<typeof listSeries>[number] | undefined =>
      listSeries().find((s) => s.id === id)

    expect(row()?.total_chapters).toBe(3)
    expect(row()?.read_chapters).toBe(0)

    saveProgress(x1, 9, true)
    expect(row()?.read_chapters).toBe(1)
    saveProgress(x2, 9, false) // 在读未完不计入
    expect(row()?.read_chapters).toBe(1)
  })

  it('recentlyAdded 返回同样的聚合列', () => {
    const id = seedSeries('聚合B', ['y1', 'y2'])
    const [y1] = chapterIds(id)
    saveProgress(y1, 9, true)
    const row = recentlyAdded(50).find((s) => s.id === id)
    expect(row).toMatchObject({ total_chapters: 2, read_chapters: 1 })
  })

  it('无章节的系列聚合为 0/0（不点亮徽章）', () => {
    const id = seedSeries('聚合C', [])
    expect(listSeries().find((s) => s.id === id)).toMatchObject({
      total_chapters: 0,
      read_chapters: 0
    })
  })
})
