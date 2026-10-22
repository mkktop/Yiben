import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import type { ShelfInfo, TagInfo } from '../../shared/types'

export interface LibraryRow {
  id: number
  name: string
  path: string
  kind: string
  created_at: number
  cloud_folder_id?: string | null
  family_id?: string | null
}

export interface SeriesRow {
  id: number
  library_id: number
  title: string
  author: string | null
  cover_path: string | null
  description: string | null
  status: string | null
  tags: string | null
  folder_path: string
  is_single_file: number
  added_at: number
  /** 用户移出书架的系列：扫描不复活；换库重新添加时自动取消隐藏 */
  hidden?: number
  /** 扫描时源目录不可用（移动硬盘未挂载 / 根目录改名）：保留阅读进度，列表不展示 */
  missing?: number
  /** 发表年份（ComicInfo Year） */
  year?: number | null
  /** 语言代码（ComicInfo LanguageISO） */
  language?: string | null
  /** 查询时聚合（listSeries），非表列：已读完章节数 / 章节总数 */
  read_chapters?: number
  total_chapters?: number
}

export interface ChapterRow {
  /** 合并展示前的扫描归属，用于本地元数据回写与稳定排序。 */
  origin_series_id?: number
  id: number
  series_id: number
  title: string
  volume: string | null
  number: number | null
  sort_index: number
  path: string
  kind: string
  page_count: number
  size: number
  mtime: number
  /** 云盘压缩包章节的文件 id（本地章节为 null） */
  cloud_file_id?: string | null
  /** 扫描列页失败的原因；成功为 null */
  scan_error?: string | null
}

export interface ChapterWithProgress extends ChapterRow {
  read_page: number | null
  completed: number | null
  read_updated_at: number | null
}

let db: Database.Database

export function openDb(): Database.Database {
  if (db) return db
  const file = join(app.getPath('userData'), 'yudu.db')
  db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

/** 关闭连接（单元测试收尾用；应用生命周期里 DB 常驻不关） */
export function closeDb(): void {
  db?.close()
  db = undefined as unknown as Database.Database
  upsertChapterStmt = null
  saveProgressStmt = null
  oldPageStmt = null
  chapterSeriesStmt = null
  logInsertStmt = null
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS libraries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL DEFAULT 'local',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS series (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      author TEXT,
      cover_path TEXT,
      description TEXT,
      status TEXT,
      tags TEXT,
      folder_path TEXT NOT NULL,
      is_single_file INTEGER NOT NULL DEFAULT 0,
      added_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_series_path ON series(folder_path);
    CREATE INDEX IF NOT EXISTS idx_series_library ON series(library_id);

    CREATE TABLE IF NOT EXISTS chapters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      volume TEXT,
      number REAL,
      sort_index INTEGER NOT NULL,
      path TEXT NOT NULL,
      kind TEXT NOT NULL,
      page_count INTEGER NOT NULL DEFAULT 0,
      size INTEGER NOT NULL DEFAULT 0,
      mtime INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_chapters_path ON chapters(path);
    CREATE INDEX IF NOT EXISTS idx_chapters_series ON chapters(series_id);

    CREATE TABLE IF NOT EXISTS progress (
      chapter_id INTEGER PRIMARY KEY REFERENCES chapters(id) ON DELETE CASCADE,
      page INTEGER NOT NULL DEFAULT 0,
      completed INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS series_fts USING fts5(
      title, author, tags, content='', contentless_delete=1
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chapter_pages (
      chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
      idx INTEGER NOT NULL,
      file_id TEXT NOT NULL,
      name TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (chapter_id, idx)
    );

    CREATE TABLE IF NOT EXISTS bookmarks (
      chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
      page INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (chapter_id, page)
    );

    CREATE TABLE IF NOT EXISTS page_dims (
      chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
      idx INTEGER NOT NULL,
      w INTEGER NOT NULL,
      h INTEGER NOT NULL,
      PRIMARY KEY (chapter_id, idx)
    );

    CREATE TABLE IF NOT EXISTS reading_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chapter_id INTEGER REFERENCES chapters(id) ON DELETE CASCADE,
      series_id INTEGER NOT NULL DEFAULT 0,
      day TEXT NOT NULL,
      pages INTEGER NOT NULL,
      ms INTEGER NOT NULL DEFAULT 0,
      at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_log_day ON reading_log(day);

    CREATE TABLE IF NOT EXISTS shelves (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      sort INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS series_shelves (
      series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
      shelf_id INTEGER NOT NULL REFERENCES shelves(id) ON DELETE CASCADE,
      added_at INTEGER NOT NULL,
      PRIMARY KEY (series_id, shelf_id)
    );
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS series_tags (
      series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (series_id, tag_id)
    );
    CREATE TABLE IF NOT EXISTS series_merges (
      source_id INTEGER PRIMARY KEY REFERENCES series(id) ON DELETE CASCADE,
      target_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_series_merges_target ON series_merges(target_id);
  `)

  // 云盘字段（渐进迁移）
  const tryAlter = (sql: string): void => {
    // 先查表结构：裸 catch 会把磁盘满/库被锁等真实错误也当成「列已存在」吞掉，
    // 迁移静默缺失后第一笔查询才以更晦涩的 no such column 失败
    const m = sql.match(/^ALTER TABLE (\w+) ADD COLUMN (\w+)/i)
    if (m) {
      const cols = db.prepare(`PRAGMA table_info(${m[1]})`).all() as Array<{ name: string }>
      if (cols.some((c) => c.name === m[2])) return
    }
    try {
      db.exec(sql)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!/duplicate column name/i.test(msg)) throw err
    }
  }
  tryAlter('ALTER TABLE libraries ADD COLUMN cloud_folder_id TEXT')
  tryAlter('ALTER TABLE libraries ADD COLUMN family_id TEXT')
  tryAlter('ALTER TABLE chapters ADD COLUMN cloud_file_id TEXT')
  tryAlter('ALTER TABLE series ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0')
  tryAlter('ALTER TABLE series ADD COLUMN missing INTEGER NOT NULL DEFAULT 0')
  // 用户手动编辑过元数据：之后的扫描不覆盖这些字段
  tryAlter('ALTER TABLE series ADD COLUMN meta_edited INTEGER NOT NULL DEFAULT 0')
  tryAlter('ALTER TABLE series ADD COLUMN year INTEGER')
  tryAlter('ALTER TABLE series ADD COLUMN language TEXT')
  /** 已探测过包内 ComicInfo/EPUB 元数据（无论成败，填空性质不重复劳动） */
  tryAlter('ALTER TABLE series ADD COLUMN meta_probed INTEGER NOT NULL DEFAULT 0')
  // 扫描列页失败的原因（损坏的压缩包等），成功时清空
  tryAlter('ALTER TABLE chapters ADD COLUMN scan_error TEXT')
  // 保留扫描归属与文件路径，仅在阅读查询中合并，重扫不会拆散系列。
  db.exec(`DROP VIEW IF EXISTS effective_chapters;
    CREATE VIEW effective_chapters AS
    SELECT c.id, c.series_id, c.title, c.volume,
      c.number, c.sort_index, c.path, c.kind, c.page_count, c.size, c.mtime,
      c.cloud_file_id, c.scan_error, c.series_id AS origin_series_id
    FROM chapters c WHERE c.series_id NOT IN (SELECT source_id FROM series_merges)
    UNION ALL
    SELECT c.id, m.target_id AS series_id, c.title, c.volume,
      c.number, c.sort_index, c.path, c.kind, c.page_count, c.size, c.mtime,
      c.cloud_file_id, c.scan_error, c.series_id AS origin_series_id
    FROM series_merges m JOIN chapters c ON c.series_id = m.source_id`)
}

/** 每次扫描后重建全文索引（藏书量级下重建成本可忽略） */
export function rebuildFts(): void {
  db.exec(`
    DELETE FROM series_fts;
    INSERT INTO series_fts(rowid, title, author, tags)
    SELECT id, title, COALESCE(author, ''), COALESCE(tags, '') FROM series;
  `)
}

// ---------- libraries ----------

export function listLibraries(): LibraryRow[] {
  return db.prepare('SELECT * FROM libraries ORDER BY created_at').all() as LibraryRow[]
}

export function getLibrary(id: number): LibraryRow | undefined {
  return db.prepare('SELECT * FROM libraries WHERE id = ?').get(id) as LibraryRow | undefined
}

export function addLibrary(name: string, path: string, kind = 'local'): LibraryRow {
  const row = db
    .prepare(
      `INSERT INTO libraries (name, path, kind, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET name = excluded.name
       RETURNING *`
    )
    .get(name, path, kind, Date.now()) as LibraryRow
  return row
}

export function removeLibrary(id: number): void {
  db.prepare('DELETE FROM libraries WHERE id = ?').run(id)
  db.prepare('DELETE FROM settings WHERE key = ?').run(`webdav:${id}`)
  // series/章节级联删除后，可能留下没人引用的标签行
  pruneOrphanTags()
}

export function setLibraryCloudMeta(
  id: number,
  cloudFolderId: string,
  familyId: string | null
): void {
  db.prepare('UPDATE libraries SET cloud_folder_id = ?, family_id = ? WHERE id = ?').run(
    cloudFolderId,
    familyId,
    id
  )
}

// ---------- series / chapters（扫描写入） ----------

export interface SeriesUpsert {
  library_id: number
  title: string
  author: string | null
  description: string | null
  status: string | null
  tags: string | null
  folder_path: string
  is_single_file: number
  year?: number | null
  language?: string | null
}

export function upsertSeries(s: SeriesUpsert): number {
  const row = db
    .prepare(
      `INSERT INTO series (library_id, title, author, description, status, tags, folder_path, is_single_file, added_at, year, language)
       VALUES (@library_id, @title, @author, @description, @status, @tags, @folder_path, @is_single_file, @added_at, @year, @language)
       ON CONFLICT(folder_path) DO UPDATE SET
         library_id = excluded.library_id,
         title = CASE WHEN series.meta_edited = 1 THEN series.title ELSE excluded.title END,
         author = CASE WHEN series.meta_edited = 1 THEN series.author ELSE excluded.author END,
         description = CASE WHEN series.meta_edited = 1 THEN series.description ELSE excluded.description END,
         status = CASE WHEN series.meta_edited = 1 THEN series.status ELSE excluded.status END,
         tags = CASE WHEN series.meta_edited = 1 THEN series.tags ELSE excluded.tags END,
         is_single_file = excluded.is_single_file,
         year = CASE WHEN series.meta_edited = 1 THEN series.year ELSE excluded.year END,
         language = CASE WHEN series.meta_edited = 1 THEN series.language ELSE excluded.language END,
         missing = 0,
         hidden = CASE WHEN series.library_id = excluded.library_id THEN series.hidden ELSE 0 END
       RETURNING id`
    )
    .get({ added_at: Date.now(), year: null, language: null, ...s }) as { id: number }
  return row.id
}

export interface SeriesMetaPatch {
  title?: string
  author?: string | null
  status?: string | null
  /** JSON 数组字符串 */
  tags?: string | null
  description?: string | null
}

/** patch key 白名单：key 会拼进 SQL 列名，渲染层传来的字段名必须先过这一关（纵深防御） */
const META_FIELDS = new Set(['title', 'author', 'status', 'tags', 'description'])

/** 手动编辑元数据：只改传入的字段，并打上 meta_edited 防止重扫覆盖 */
export function updateSeriesMeta(id: number, patch: SeriesMetaPatch): void {
  const fields: string[] = []
  const params: Record<string, unknown> = { id }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || !META_FIELDS.has(key)) continue
    fields.push(`${key} = @${key}`)
    params[key] = value
  }
  if (fields.length === 0) return
  db.prepare(`UPDATE series SET meta_edited = 1, ${fields.join(', ')} WHERE id = @id`).run(params)
}

export interface RetireResult {
  /** 因源目录消失而被标记 missing 的系列数（进度保留） */
  missing: number
  /** 本轮标 missing 的系列 id（重定位匹配用） */
  missingSeries: number[]
  deletedSeries: number[]
  deletedChapters: number[]
}

/**
 * 扫描后清理库里已不存在的系列。
 * 有阅读进度的系列只标记 missing（文件夹改名 / 移动硬盘未挂载时不丢进度），
 * 无进度的直接删除；返回被删 id 供调用方清理封面与页缩略图。
 */
export function retireSeriesNotIn(libraryId: number, keepPaths: string[]): RetireResult {
  const cond = keepPaths.length
    ? `AND folder_path NOT IN (${keepPaths.map(() => '?').join(',')})`
    : ''
  const gone = db
    .prepare(`SELECT id FROM series WHERE library_id = ? ${cond}`)
    .all(libraryId, ...keepPaths) as { id: number }[]

  const hasProgress = db.prepare(
    `SELECT 1 FROM progress p JOIN chapters c ON c.id = p.chapter_id WHERE c.series_id = ? LIMIT 1`
  )
  const chapterIds = db.prepare('SELECT id FROM chapters WHERE series_id = ?')
  const hasMerge = db.prepare(
    'SELECT 1 FROM series_merges WHERE source_id = ? OR target_id = ? LIMIT 1'
  )
  const markMissing = db.prepare('UPDATE series SET missing = 1 WHERE id = ?')
  const del = db.prepare('DELETE FROM series WHERE id = ?')

  const result: RetireResult = {
    missing: 0,
    missingSeries: [],
    deletedSeries: [],
    deletedChapters: []
  }
  for (const row of gone) {
    if (hasProgress.get(row.id) || hasMerge.get(row.id, row.id)) {
      markMissing.run(row.id)
      result.missing++
      result.missingSeries.push(row.id)
      continue
    }
    for (const c of chapterIds.all(row.id) as { id: number }[]) result.deletedChapters.push(c.id)
    del.run(row.id)
    result.deletedSeries.push(row.id)
  }
  pruneOrphanTags()
  return result
}

// ---------- 系列「移动/改名」重定位 ----------

/** 本地库全部 missing 系列及其章节指纹（重定位匹配输入） */
export function localMissingSeriesChapters(): RelocationSeries[] {
  return seriesChaptersOf(`WHERE s.missing = 1 AND l.kind = 'local'`)
}

/** 本轮扫描保留下来的本地系列的章节指纹 */
export function localSeriesChaptersByPaths(folderPaths: string[]): RelocationSeries[] {
  if (folderPaths.length === 0) return []
  return seriesChaptersOf(
    `WHERE s.folder_path IN (${folderPaths.map(() => '?').join(',')}) AND s.missing = 0 AND l.kind = 'local'`,
    ...folderPaths
  )
}

export interface RelocationSeries {
  seriesId: number
  folderPath: string
  chapters: Array<{ id: number; rel: string; size: number; mtime: number }>
}

function seriesChaptersOf(cond: string, ...params: unknown[]): RelocationSeries[] {
  const rows = db
    .prepare(
      `SELECT s.id AS seriesId, s.folder_path AS folderPath,
              c.id AS chapterId, c.path AS path, c.size AS size, c.mtime AS mtime
       FROM series s
       JOIN chapters c ON c.series_id = s.id
       JOIN libraries l ON l.id = s.library_id
       ${cond}
       ORDER BY s.id, c.sort_index`
    )
    .all(...params) as Array<{
    seriesId: number
    folderPath: string
    chapterId: number
    path: string
    size: number
    mtime: number
  }>
  const out: RelocationSeries[] = []
  let cur: RelocationSeries | null = null
  for (const r of rows) {
    if (!cur || cur.seriesId !== r.seriesId) {
      cur = { seriesId: r.seriesId, folderPath: r.folderPath, chapters: [] }
      out.push(cur)
    }
    // 章节相对系列根的路径：移动/改名后 folder_path 变了，rel 是不变量
    const rel = r.path.startsWith(r.folderPath)
      ? r.path.slice(r.folderPath.length).replace(/^[\\/]+/, '')
      : r.path
    cur.chapters.push({ id: r.chapterId, rel, size: r.size, mtime: r.mtime })
  }
  return out
}

/**
 * 把 missing 旧系列（移动/改名前的路径）的进度/书签/页尺寸按章节映射转移到新系列，
 * 然后删除旧系列。新章节行刚扫描生成、尚无进度，先清一遍目标再转移是防御性兜底。
 */
export function adoptSeriesData(oldSeriesId: number, chapterMap: Map<number, number>): void {
  const tx = db.transaction(() => {
    for (const [oldId, newId] of chapterMap) {
      for (const table of ['progress', 'bookmarks', 'page_dims']) {
        db.prepare(`DELETE FROM ${table} WHERE chapter_id = ?`).run(newId)
        db.prepare(`UPDATE ${table} SET chapter_id = ? WHERE chapter_id = ?`).run(newId, oldId)
      }
      db.prepare('UPDATE reading_log SET chapter_id = ? WHERE chapter_id = ?').run(newId, oldId)
    }
    const firstNewId = chapterMap.values().next().value as number | undefined
    const newSeriesId = firstNewId
      ? (
          db.prepare('SELECT series_id FROM chapters WHERE id = ?').get(firstNewId) as
            | { series_id: number }
            | undefined
        )?.series_id
      : undefined
    if (newSeriesId) {
      const old = getSeries(oldSeriesId)
      if (old)
        db.prepare('UPDATE series SET added_at = ?, hidden = ? WHERE id = ?').run(
          old.added_at,
          old.hidden ?? 0,
          newSeriesId
        )
      const edited = db
        .prepare(
          'SELECT title, author, description, status, tags FROM series WHERE id = ? AND meta_edited = 1'
        )
        .get(oldSeriesId) as Record<string, unknown> | undefined
      if (edited)
        db.prepare(
          'UPDATE series SET title = @title, author = @author, description = @description, status = @status, tags = @tags, meta_edited = 1 WHERE id = @id'
        ).run({ ...edited, id: newSeriesId })
      db.prepare(
        'INSERT OR IGNORE INTO series_shelves (series_id, shelf_id, added_at) SELECT ?, shelf_id, added_at FROM series_shelves WHERE series_id = ?'
      ).run(newSeriesId, oldSeriesId)
      db.prepare(
        'INSERT OR IGNORE INTO series_tags (series_id, tag_id) SELECT ?, tag_id FROM series_tags WHERE series_id = ?'
      ).run(newSeriesId, oldSeriesId)
      db.prepare('UPDATE series_merges SET source_id = ? WHERE source_id = ?').run(
        newSeriesId,
        oldSeriesId
      )
      db.prepare('UPDATE series_merges SET target_id = ? WHERE target_id = ?').run(
        newSeriesId,
        oldSeriesId
      )
      db.prepare('UPDATE reading_log SET series_id = ? WHERE series_id = ?').run(
        newSeriesId,
        oldSeriesId
      )
      // 设置以系列 id 为键；迁移后不能还指向即将删除的旧系列。
      for (const key of ['readerPrefs', 'offlinePinnedSeries']) {
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
          | { value: string }
          | undefined
        if (!row) continue
        let value: unknown
        try {
          value = JSON.parse(row.value)
        } catch {
          continue
        }
        if (key === 'readerPrefs' && value && typeof value === 'object' && !Array.isArray(value)) {
          const prefs = value as Record<string, unknown>
          if (prefs[oldSeriesId] !== undefined && prefs[newSeriesId] === undefined)
            prefs[newSeriesId] = prefs[oldSeriesId]
          delete prefs[oldSeriesId]
        } else if (key === 'offlinePinnedSeries' && Array.isArray(value)) {
          value = [...new Set(value.map((id) => (id === oldSeriesId ? newSeriesId : id)))]
        } else continue
        db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(JSON.stringify(value), key)
      }
    }
    db.prepare('DELETE FROM series WHERE id = ?').run(oldSeriesId)
  })
  tx()
}

/** 该路径的系列是否已探测过包内元数据（不存在视为未探测，新系列要探） */
export function seriesMetaProbed(folderPath: string): boolean {
  return Boolean(
    db.prepare('SELECT 1 FROM series WHERE folder_path = ? AND meta_probed = 1').get(folderPath)
  )
}

export function markSeriesMetaProbed(seriesId: number): void {
  db.prepare('UPDATE series SET meta_probed = 1 WHERE id = ?').run(seriesId)
}

/** 删除书库前收集产物清单：章节行会随级联删除，必须先取 */ export function libraryArtifacts(
  libraryId: number
): {
  seriesIds: number[]
  chapterIds: number[]
} {
  const seriesIds = (
    db.prepare('SELECT id FROM series WHERE library_id = ?').all(libraryId) as { id: number }[]
  ).map((r) => r.id)
  if (seriesIds.length === 0) return { seriesIds, chapterIds: [] }
  const placeholders = seriesIds.map(() => '?').join(',')
  const chapterIds = (
    db
      .prepare(`SELECT id FROM chapters WHERE series_id IN (${placeholders})`)
      .all(...seriesIds) as { id: number }[]
  ).map((r) => r.id)
  return { seriesIds, chapterIds }
}

let upsertChapterStmt: Database.Statement | null = null

export function upsertChapter(c: {
  series_id: number
  title: string
  volume: string | null
  number: number | null
  sort_index: number
  path: string
  kind: string
  page_count: number
  size: number
  mtime: number
  cloud_file_id?: string | null
  scan_error?: string | null
}): number {
  // 扫描时逐章调用：语句只编译一次（每次翻页/扫描重新 prepare 会白白阻塞事件循环）
  upsertChapterStmt ??= db.prepare(
    `INSERT INTO chapters (series_id, title, volume, number, sort_index, path, kind, page_count, size, mtime, cloud_file_id, scan_error)
     VALUES (@series_id, @title, @volume, @number, @sort_index, @path, @kind, @page_count, @size, @mtime, @cloud_file_id, @scan_error)
     ON CONFLICT(path) DO UPDATE SET
       series_id = excluded.series_id,
       title = excluded.title,
       volume = excluded.volume,
       number = excluded.number,
       sort_index = excluded.sort_index,
       kind = excluded.kind,
       page_count = excluded.page_count,
       size = excluded.size,
       mtime = excluded.mtime,
       cloud_file_id = excluded.cloud_file_id,
       scan_error = excluded.scan_error
     RETURNING id`
  )
  const row = upsertChapterStmt.get({ cloud_file_id: null, scan_error: null, ...c }) as {
    id: number
  }
  return row.id
}

/** 逐章 upsert 的批量版：整批包进一个事务，大库扫描不会一条一提交地刷盘 */
export function upsertChapters(list: Array<Parameters<typeof upsertChapter>[0]>): void {
  const tx = db.transaction((items: Array<Parameters<typeof upsertChapter>[0]>) => {
    for (const c of items) upsertChapter(c)
  })
  tx(list)
}

/** 删除系列下已不在 keepPaths 里的章节，返回被删章节 id（调用方据此清页缩略图等产物） */
export function deleteChaptersNotIn(seriesId: number, keepPaths: string[]): number[] {
  const stmt = db.prepare(
    `DELETE FROM chapters WHERE series_id = ? AND path NOT IN (${keepPaths.map(() => '?').join(',')}) RETURNING id`
  )
  return (stmt.all(seriesId, ...keepPaths) as { id: number }[]).map((r) => r.id)
}

export function setSeriesCover(seriesId: number, coverPath: string | null): void {
  db.prepare('UPDATE series SET cover_path = ? WHERE id = ?').run(coverPath, seriesId)
}

/** 移出/恢复书架：hidden 系列不出现在任何列表，扫描不会复活 */
export function setSeriesHidden(seriesId: number, hidden: boolean): void {
  db.prepare('UPDATE series SET hidden = ? WHERE id = ?').run(hidden ? 1 : 0, seriesId)
}

/** 批量移出书架 */
export function setSeriesHiddenMany(ids: number[]): void {
  const stmt = db.prepare('UPDATE series SET hidden = 1 WHERE id = ?')
  const tx = db.transaction((list: number[]) => {
    for (const id of list) stmt.run(id)
  })
  tx(ids)
}

// ---------- 云盘章节页映射 ----------

export function replaceChapterPages(
  chapterId: number,
  pages: Array<{ file_id: string; name: string; size: number }>
): void {
  const tx = db.transaction((list: Array<{ file_id: string; name: string; size: number }>) => {
    db.prepare('DELETE FROM chapter_pages WHERE chapter_id = ?').run(chapterId)
    const ins = db.prepare(
      'INSERT INTO chapter_pages (chapter_id, idx, file_id, name, size) VALUES (?, ?, ?, ?, ?)'
    )
    list.forEach((p, i) => ins.run(chapterId, i, p.file_id, p.name, p.size))
  })
  tx(pages)
}

export function getChapterPageFile(
  chapterId: number,
  idx: number
): { file_id: string; name: string; size: number } | undefined {
  return db
    .prepare('SELECT file_id, name, size FROM chapter_pages WHERE chapter_id = ? AND idx = ?')
    .get(chapterId, idx) as { file_id: string; name: string; size: number } | undefined
}

export function updateChapterPageCount(chapterId: number, pageCount: number): void {
  db.prepare('UPDATE chapters SET page_count = ? WHERE id = ?').run(pageCount, chapterId)
}

/** mtime+size 均未变时返回旧 page_count，否则 null（扫描增量用） */
export function getChapterMetaIfUnchanged(
  path: string,
  size: number,
  mtime: number
): number | null {
  const row = db
    .prepare('SELECT page_count FROM chapters WHERE path = ? AND size = ? AND mtime = ?')
    .get(path, size, mtime) as { page_count: number } | undefined
  return row ? row.page_count : null
}

/** 该 folder_path 的系列是否已入库（云端扫描增量用：判断上轮目录布局分类） */
export function seriesPathExists(folderPath: string): boolean {
  return (
    db.prepare('SELECT 1 FROM series WHERE folder_path = ? LIMIT 1').get(folderPath) !== undefined
  )
}

export function countByLibrary(libraryId: number): { series: number; chapters: number } {
  const series = (
    db
      .prepare(
        'SELECT COUNT(*) AS c FROM series WHERE library_id = ? AND hidden = 0 AND missing = 0'
      )
      .get(libraryId) as {
      c: number
    }
  ).c
  const chapters = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM chapters WHERE series_id IN (
           SELECT id FROM series WHERE library_id = ? AND hidden = 0 AND missing = 0
         )`
      )
      .get(libraryId) as { c: number }
  ).c
  return { series, chapters }
}

// ---------- 查询 ----------

/** 系列级进度聚合列（listSeries / recentlyAdded 共用）：章节总数 + 已读完章节数 */
const SERIES_AGG = `
  (SELECT COUNT(*) FROM effective_chapters c WHERE c.series_id = s.id) AS total_chapters,
  (SELECT COUNT(*) FROM progress p JOIN effective_chapters c ON c.id = p.chapter_id
     WHERE c.series_id = s.id AND p.completed = 1) AS read_chapters`

export interface SeriesListOptions {
  libraryId?: number
  query?: string
  filter?: 'all' | 'unread' | 'reading' | 'read' | 'recent'
  /** 归入某虚拟书架 */
  shelfId?: number
  /** 自定义标签（关联表），多个标签 AND 语义 */
  tags?: string[]
  limit?: number
  offset?: number
}

export function listSeries(opts: SeriesListOptions = {}): SeriesRow[] {
  const conds: string[] = [
    's.hidden = 0',
    's.missing = 0',
    's.id NOT IN (SELECT source_id FROM series_merges)'
  ]
  const params: Record<string, unknown> = {}

  if (opts.libraryId) {
    conds.push('s.library_id = @libraryId')
    params.libraryId = opts.libraryId
  }
  if (opts.shelfId) {
    conds.push('s.id IN (SELECT series_id FROM series_shelves WHERE shelf_id = @shelfId)')
    params.shelfId = opts.shelfId
  }
  if (opts.tags && opts.tags.length > 0) {
    // 每个标签一个 EXISTS 子查询：AND 语义（同时带有全部指定标签才算命中）
    opts.tags.forEach((tag, i) => {
      conds.push(
        `EXISTS (SELECT 1 FROM series_tags st JOIN tags tg ON tg.id = st.tag_id
                 WHERE st.series_id = s.id AND tg.name = @tagName${i})`
      )
      params[`tagName${i}`] = tag
    })
  }
  if (opts.query) {
    const words = opts.query
      .split(/\s+/)
      .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
      .filter(Boolean)
      .map((w) => `${w}*`)
    if (words.length > 0) {
      conds.push('s.id IN (SELECT rowid FROM series_fts WHERE series_fts MATCH @query)')
      params.query = words.join(' ')
    }
  }
  if (opts.filter === 'unread') {
    conds.push(
      'NOT EXISTS (SELECT 1 FROM progress p JOIN effective_chapters c ON c.id = p.chapter_id WHERE c.series_id = s.id AND p.completed = 1)'
    )
  } else if (opts.filter === 'reading') {
    conds.push(
      'EXISTS (SELECT 1 FROM progress p JOIN effective_chapters c ON c.id = p.chapter_id WHERE c.series_id = s.id AND p.completed = 0)'
    )
  } else if (opts.filter === 'read') {
    conds.push(
      'EXISTS (SELECT 1 FROM progress p JOIN effective_chapters c ON c.id = p.chapter_id WHERE c.series_id = s.id)'
    )
  }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  // 最近阅读：按该系列最近一次进度更新时间倒排（从未读过的排最后）
  const order =
    opts.filter === 'read'
      ? `ORDER BY (SELECT MAX(p.updated_at) FROM progress p
           JOIN effective_chapters c ON c.id = p.chapter_id WHERE c.series_id = s.id) DESC`
      : opts.filter === 'recent'
        ? 'ORDER BY s.added_at DESC'
        : 'ORDER BY s.title COLLATE NOCASE'
  const limit = opts.limit ? `LIMIT @limit OFFSET @offset` : ''
  if (opts.limit) {
    params.limit = opts.limit
    params.offset = opts.offset ?? 0
  }
  return db
    .prepare(
      `SELECT s.*, ${SERIES_AGG}
       FROM series s ${where} ${order} ${limit}`
    )
    .all(params) as SeriesRow[]
}

export function getSeries(id: number): SeriesRow | undefined {
  return db.prepare('SELECT * FROM series WHERE id = ?').get(id) as SeriesRow | undefined
}

export function chaptersBySeries(seriesId: number): ChapterWithProgress[] {
  const rows = db
    .prepare(
      `SELECT c.*, p.page AS read_page, p.completed AS completed, p.updated_at AS read_updated_at
       FROM effective_chapters c LEFT JOIN progress p ON p.chapter_id = c.id
       WHERE c.series_id = ? ORDER BY c.sort_index, c.id`
    )
    .all(seriesId) as ChapterWithProgress[]
  if (new Set(rows.map((row) => row.origin_series_id)).size > 1) {
    rows.sort(
      (a, b) =>
        (a.volume ?? '').localeCompare(b.volume ?? '', undefined, { numeric: true }) ||
        (a.number ?? 0) - (b.number ?? 0) ||
        a.title.localeCompare(b.title, undefined, { numeric: true }) ||
        a.sort_index - b.sort_index ||
        a.id - b.id
    )
  }
  return rows
}

/** 备份按真实来源路径对账，避免合并显示把 JSON 进度归到错误目录。 */
export function sourceChaptersBySeries(seriesId: number): ChapterWithProgress[] {
  return db
    .prepare(
      'SELECT c.*, p.page AS read_page, p.completed, p.updated_at AS read_updated_at FROM chapters c LEFT JOIN progress p ON p.chapter_id = c.id WHERE c.series_id = ? ORDER BY c.sort_index, c.id'
    )
    .all(seriesId) as ChapterWithProgress[]
}

export function getChapter(id: number): (ChapterRow & { series_title: string }) | undefined {
  return db
    .prepare(
      `SELECT c.*, s.title AS series_title FROM effective_chapters c JOIN series s ON s.id = c.series_id WHERE c.id = ?`
    )
    .get(id) as (ChapterRow & { series_title: string }) | undefined
}

/** 按文件路径找章节（系统文件关联：双击文件扫描入库后取章节 id） */
export function getChapterByPath(path: string): ChapterRow | undefined {
  return db.prepare('SELECT * FROM effective_chapters WHERE path = ?').get(path) as
    | ChapterRow
    | undefined
}

export interface ChapterSource {
  libraryId: number
  libraryKind: string
  familyId: string | null
}

/** 章节 → 所属书库的云信息（familyId / 是否云盘库） */
export function getChapterSource(chapterId: number): ChapterSource | undefined {
  return db
    .prepare(
      `SELECT l.id AS libraryId, l.kind AS libraryKind, l.family_id AS familyId
       FROM chapters c JOIN series s ON s.id = c.series_id JOIN libraries l ON l.id = s.library_id
       WHERE c.id = ?`
    )
    .get(chapterId) as ChapterSource | undefined
}

/** 系列的封面章节：优先云端散图（按页下载最省），否则第一个章节 */
export function coverChapterFor(seriesId: number): ChapterRow | undefined {
  return db
    .prepare(
      `SELECT * FROM effective_chapters WHERE series_id = ?
       ORDER BY CASE WHEN kind = 'cfolder' THEN 0 ELSE 1 END, sort_index LIMIT 1`
    )
    .get(seriesId) as ChapterRow | undefined
}

export interface CloudChapterCacheRow {
  libraryId: number
  chapterId: number
  seriesId: number
  seriesTitle: string
  kind: string
  path: string
  cloudFileId: string | null
}

/** 云盘书库的全部章节（缓存统计/清理用）：天翼云盘与 115 网盘 */
export function cloudChapterRows(): CloudChapterCacheRow[] {
  return db
    .prepare(
      `SELECT l.id AS libraryId, c.id AS chapterId, COALESCE(m.target_id, c.series_id) AS seriesId, COALESCE(t.title, s.title) AS seriesTitle,
              c.kind, c.path, c.cloud_file_id AS cloudFileId
       FROM chapters c
       JOIN series s ON s.id = c.series_id
       JOIN libraries l ON l.id = s.library_id
       LEFT JOIN series_merges m ON m.source_id = c.series_id
       LEFT JOIN series t ON t.id = m.target_id
       WHERE l.kind IN ('cloud189', '115', 'webdav')`
    )
    .all() as CloudChapterCacheRow[]
}

// ---------- 进度 ----------

export interface ProgressRow {
  chapter_id: number
  page: number
  completed: number
  updated_at: number
}

let saveProgressStmt: Database.Statement | null = null
let oldPageStmt: Database.Statement | null = null
let chapterSeriesStmt: Database.Statement | null = null
let logInsertStmt: Database.Statement | null = null

/** 本地时区的 YYYY-MM-DD（toLocaleDateString('sv') 恰好输出 ISO 形态） */
function localDay(d: Date = new Date()): string {
  return d.toLocaleDateString('sv')
}

/** 重扫中章节行被级联删除时，进度写入会撞 FK——该进度已无意义，静默跳过 */
function isFkError(err: unknown): boolean {
  const e = err as { code?: string; message?: string }
  return (
    e?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY' ||
    /FOREIGN KEY constraint failed/i.test(e?.message ?? '')
  )
}

export function saveProgress(
  chapterId: number,
  page: number,
  completed: boolean,
  options: { updatedAt?: number; trackReading?: boolean } = {}
): void {
  // 翻页即触发（节流后仍然高频）：语句只编译一次
  saveProgressStmt ??= db.prepare(
    `INSERT INTO progress (chapter_id, page, completed, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(chapter_id) DO UPDATE SET
       page = excluded.page,
       completed = excluded.completed,
       updated_at = excluded.updated_at`
  )
  // 阅读日志埋点：progress 只留每话最新页码，「上周读了多少页」只能靠埋点。
  // 先取旧页算本次净翻页数（往回翻 delta <= 0 不计）
  oldPageStmt ??= db.prepare('SELECT page FROM progress WHERE chapter_id = ?')
  const old = oldPageStmt.get(chapterId) as { page: number } | undefined
  // 首次记录该话：读到第 page 页（0 基）意味着看了 page+1 页
  const delta = old ? page - old.page : page + 1

  try {
    saveProgressStmt.run(chapterId, page, completed ? 1 : 0, options.updatedAt ?? Date.now())
  } catch (err) {
    if (isFkError(err)) return
    throw err
  }

  if (delta > 0 && options.trackReading !== false) {
    chapterSeriesStmt ??= db.prepare('SELECT series_id FROM effective_chapters WHERE id = ?')
    logInsertStmt ??= db.prepare(
      `INSERT INTO reading_log (chapter_id, series_id, day, pages, ms, at) VALUES (?, ?, ?, ?, ?, ?)`
    )
    const ch = chapterSeriesStmt.get(chapterId) as { series_id: number } | undefined
    // 翻页事件只记页数；活跃时长由独立心跳采集，避免重复累计。
    try {
      logInsertStmt.run(chapterId, ch?.series_id ?? 0, localDay(), delta, 0, Date.now())
    } catch (err) {
      if (!isFkError(err)) throw err
    }
  }
}

export function getProgress(chapterIds: number[]): ProgressRow[] {
  if (chapterIds.length === 0) return []
  const placeholders = chapterIds.map(() => '?').join(',')
  return db
    .prepare(`SELECT * FROM progress WHERE chapter_id IN (${placeholders})`)
    .all(...chapterIds) as ProgressRow[]
}

export interface ContinueRow {
  chapter_id: number
  chapter_title: string
  read_page: number
  completed: number
  updated_at: number
  series_id: number
  series_title: string
  cover_path: string | null
  page_count: number
}

/** 首页「继续阅读」：每个系列取最近更新进度的一话，且该话未读完 */
export function continueReading(limit: number): ContinueRow[] {
  // 窗口函数取每系列 updated_at 最新（并列时取章节 id 大的）的未完话；
  // 不用 GROUP BY + HAVING 裸列 = MAX：那依赖 SQLite 的特殊扩展行为，语义脆弱
  return db
    .prepare(
      `SELECT c.id AS chapter_id, c.title AS chapter_title, p.page AS read_page,
              p.completed, p.updated_at, c.page_count,
              s.id AS series_id, s.title AS series_title, s.cover_path
       FROM (
         SELECT p2.chapter_id AS cid,
                ROW_NUMBER() OVER (
                  PARTITION BY c2.series_id
                  ORDER BY p2.updated_at DESC, p2.chapter_id DESC
                ) AS rn
         FROM progress p2
         JOIN effective_chapters c2 ON c2.id = p2.chapter_id
         WHERE p2.completed = 0
       ) latest
       JOIN progress p ON p.chapter_id = latest.cid
       JOIN effective_chapters c ON c.id = latest.cid
       JOIN series s ON s.id = c.series_id
       WHERE latest.rn = 1 AND s.hidden = 0 AND s.missing = 0
       ORDER BY p.updated_at DESC
       LIMIT ?`
    )
    .all(limit) as ContinueRow[]
}

/** 首页「最近添加」 */
export function recentlyAdded(limit: number): SeriesRow[] {
  return db
    .prepare(
      `SELECT s.*, ${SERIES_AGG}
       FROM series s WHERE s.hidden = 0 AND s.missing = 0 AND s.id NOT IN (SELECT source_id FROM series_merges) ORDER BY s.added_at DESC LIMIT ?`
    )
    .all(limit) as SeriesRow[]
}

// ---------- 虚拟书架（分组）与自定义标签 ----------
// 二者都走关联表，与 ComicInfo 导入的 series.tags 列是两套体系，UI 上分开显示。

export function listShelves(): ShelfInfo[] {
  return db.prepare('SELECT id, name, sort FROM shelves ORDER BY sort, id').all() as ShelfInfo[]
}

export function createShelf(name: string): ShelfInfo {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('书架名称不能为空')
  const sort = (
    db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS next FROM shelves').get() as { next: number }
  ).next
  // 同名创建幂等：直接返回已有书架
  db.prepare('INSERT INTO shelves (name, sort) VALUES (?, ?) ON CONFLICT(name) DO NOTHING').run(
    trimmed,
    sort
  )
  return db.prepare('SELECT id, name, sort FROM shelves WHERE name = ?').get(trimmed) as ShelfInfo
}

export function renameShelf(id: number, name: string): void {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('书架名称不能为空')
  try {
    const r = db.prepare('UPDATE shelves SET name = ? WHERE id = ?').run(trimmed, id)
    if (r.changes === 0) throw new Error(`书架不存在：${id}`)
  } catch (err) {
    if (err instanceof Error && /UNIQUE/i.test(err.message)) {
      throw new Error(`书架「${trimmed}」已存在`)
    }
    throw err
  }
}

/** 删除书架；series_shelves 关联行由外键级联清理 */
export function removeShelf(id: number): void {
  db.prepare('DELETE FROM shelves WHERE id = ?').run(id)
}

/** 系列当前归入的书架 id（弹层回显用） */
export function seriesShelfIds(seriesId: number): number[] {
  return (
    db
      .prepare('SELECT shelf_id FROM series_shelves WHERE series_id = ? ORDER BY shelf_id')
      .all(seriesId) as Array<{ shelf_id: number }>
  ).map((r) => r.shelf_id)
}

/** 全量替换系列的书架归属：以传入清单为准（空数组 = 全部移出） */
export function setSeriesShelves(seriesId: number, shelfIds: number[]): void {
  const ids = [...new Set(shelfIds)]
  const tx = db.transaction((list: number[]) => {
    db.prepare('DELETE FROM series_shelves WHERE series_id = ?').run(seriesId)
    const ins = db.prepare(
      'INSERT OR IGNORE INTO series_shelves (series_id, shelf_id, added_at) VALUES (?, ?, ?)'
    )
    for (const id of list) ins.run(seriesId, id, Date.now())
  })
  tx(ids)
}

export function listTags(): TagInfo[] {
  return db.prepare('SELECT id, name FROM tags ORDER BY name').all() as TagInfo[]
}

/** 系列当前的自定义标签名（弹层回显用） */
export function seriesTagNames(seriesId: number): string[] {
  return (
    db
      .prepare(
        `SELECT tg.name AS name FROM series_tags st JOIN tags tg ON tg.id = st.tag_id
         WHERE st.series_id = ? ORDER BY tg.name`
      )
      .all(seriesId) as Array<{ name: string }>
  ).map((r) => r.name)
}

/** 不再被任何系列引用的标签行清理（防 listTags 越积越多） */
function pruneOrphanTags(): void {
  db.prepare('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM series_tags)').run()
}

/** 全量替换系列的自定义标签：不存在的 name 自动创建；替换后清孤儿标签 */
export function setSeriesTags(seriesId: number, names: string[]): void {
  const cleaned = [...new Set(names.map((n) => n.trim()).filter(Boolean))]
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM series_tags WHERE series_id = ?').run(seriesId)
    const insTag = db.prepare('INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING')
    const getTag = db.prepare('SELECT id FROM tags WHERE name = ?')
    const insLink = db.prepare(
      'INSERT OR IGNORE INTO series_tags (series_id, tag_id) VALUES (?, ?)'
    )
    for (const name of cleaned) {
      insTag.run(name)
      const tag = getTag.get(name) as { id: number }
      insLink.run(seriesId, tag.id)
    }
    pruneOrphanTags()
  })
  tx()
}

// ---------- 阅读统计 ----------

export interface ReadingStats {
  totalMinutes: number
  /** 有阅读记录的日期及其当日页数（升序；只含最近 days 天） */
  days: Array<{ day: string; pages: number; minutes: number }>
  /** 截至今天（或昨天）的连续阅读天数 */
  streak: number
  totalPages: number
  totalDays: number
  bestDay: { day: string; pages: number } | null
}

/** 阅读统计：热力图与指标卡的数据源。只统计最近 days 天（默认 365） */
export function readingStats(days = 365): ReadingStats {
  const windowDays = Number.isFinite(days) && days > 0 ? Math.floor(days) : 365
  const start = new Date()
  start.setDate(start.getDate() - (windowDays - 1))
  const rows = db
    .prepare(
      `SELECT day, SUM(pages) AS pages, SUM(ms) / 60000.0 AS minutes FROM reading_log WHERE day >= ? AND day <= ? GROUP BY day ORDER BY day`
    )
    .all(localDay(start), localDay()) as Array<{ day: string; pages: number; minutes: number }>

  const totalPages = rows.reduce((sum, r) => sum + r.pages, 0)
  let bestDay: { day: string; pages: number } | null = null
  for (const r of rows) {
    if (!bestDay || r.pages > bestDay.pages) bestDay = { day: r.day, pages: r.pages }
  }

  // 连续天数从今天往回数；今天还没读时从昨天起算（「昨天读了、今天还没翻」不算断）
  const daySet = new Set(rows.map((r) => r.day))
  let cursor = new Date()
  if (!daySet.has(localDay(cursor))) cursor.setDate(cursor.getDate() - 1)
  let streak = 0
  while (daySet.has(localDay(cursor))) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }

  return {
    days: rows,
    streak,
    totalPages,
    totalDays: rows.length,
    bestDay,
    totalMinutes: rows.reduce((sum, row) => sum + row.minutes, 0)
  }
}

/** 时长独立于翻页增量，静止阅读也记入，但单次最多两分钟。 */
export function logReadingTime(chapterId: number, ms: number): void {
  if (!Number.isSafeInteger(ms) || ms <= 0 || ms > 120000) throw new Error('阅读时长参数无效')
  const chapter = getChapter(chapterId)
  if (!chapter) return
  db.prepare(
    'INSERT INTO reading_log (chapter_id, series_id, day, pages, ms, at) VALUES (?, ?, ?, 0, ?, ?)'
  ).run(chapterId, chapter.series_id, localDay(), ms, Date.now())
}

// ---------- 跨话导航 ----------

export interface NeighborChapter {
  id: number
  title: string
  page_count: number
  /** 章节类型（local/archive/pdf…），邻话预取时跳过 pdf */
  kind: string
}

export interface Neighbors {
  index: number
  total: number
  prev: NeighborChapter | null
  next: NeighborChapter | null
}

/** 同系列内按 sort_index 的前后话（阅读器末页进下一话用） */
export function neighborChapters(chapterId: number): Neighbors | null {
  const row = db
    .prepare('SELECT series_id, sort_index FROM effective_chapters WHERE id = ?')
    .get(chapterId) as { series_id: number; sort_index: number } | undefined
  if (!row) return null
  const all: NeighborChapter[] = chaptersBySeries(row.series_id).map(
    ({ id, title, page_count, kind }) => ({ id, title, page_count, kind })
  )
  const index = all.findIndex((c) => c.id === chapterId)
  return {
    index,
    total: all.length,
    prev: index > 0 ? all[index - 1] : null,
    next: index >= 0 && index < all.length - 1 ? all[index + 1] : null
  }
}

// ---------- 书签 ----------

export function toggleBookmark(chapterId: number, page: number): boolean {
  const existing = db
    .prepare('SELECT 1 FROM bookmarks WHERE chapter_id = ? AND page = ?')
    .get(chapterId, page)
  if (existing) {
    db.prepare('DELETE FROM bookmarks WHERE chapter_id = ? AND page = ?').run(chapterId, page)
    return false
  }
  db.prepare('INSERT INTO bookmarks (chapter_id, page, created_at) VALUES (?, ?, ?)').run(
    chapterId,
    page,
    Date.now()
  )
  return true
}

export interface BookmarkRow {
  chapter_id: number
  chapter_title: string
  page: number
  created_at: number
}

/** 系列的全部书签（跨话），按添加时间倒序 */
export function bookmarksForSeries(seriesId: number): BookmarkRow[] {
  return db
    .prepare(
      `SELECT b.chapter_id, c.title AS chapter_title, b.page, b.created_at
       FROM bookmarks b JOIN effective_chapters c ON c.id = b.chapter_id
       WHERE c.series_id = ? ORDER BY b.created_at DESC`
    )
    .all(seriesId) as BookmarkRow[]
}

/** 某话已加书签的页码列表（升序，导出用） */
export function bookmarkPages(chapterId: number): number[] {
  return (
    db
      .prepare('SELECT page FROM bookmarks WHERE chapter_id = ? ORDER BY page')
      .all(chapterId) as Array<{ page: number }>
  ).map((r) => r.page)
}

/** 加书签（已存在则忽略）；返回是否新插入 */
export function addBookmark(chapterId: number, page: number): boolean {
  const r = db
    .prepare('INSERT OR IGNORE INTO bookmarks (chapter_id, page, created_at) VALUES (?, ?, ?)')
    .run(chapterId, page, Date.now())
  return r.changes > 0
}

/** 按目录路径找系列 id（进度导入对账用） */
export function findSeriesIdByPath(folderPath: string): number | null {
  const row = db.prepare('SELECT id FROM series WHERE folder_path = ?').get(folderPath) as
    | { id: number }
    | undefined
  return row?.id ?? null
}

// ---------- 页尺寸（双页模式的跨页大图识别） ----------

export interface PageDim {
  idx: number
  w: number
  h: number
}

export function getPageDims(chapterId: number): PageDim[] {
  return db
    .prepare('SELECT idx, w, h FROM page_dims WHERE chapter_id = ? ORDER BY idx')
    .all(chapterId) as PageDim[]
}

export function savePageDims(chapterId: number, dims: PageDim[]): void {
  const tx = db.transaction((list: PageDim[]) => {
    const ins = db.prepare(
      'INSERT INTO page_dims (chapter_id, idx, w, h) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(chapter_id, idx) DO UPDATE SET w = excluded.w, h = excluded.h'
    )
    for (const d of list) ins.run(chapterId, d.idx, d.w, d.h)
  })
  tx(dims)
}

// ---------- 进度管理（标记已读 / 重置） ----------

/** 整系列标记已读/未读：已读时页码落在末页（页数未知则保持原页码） */
export function setSeriesProgress(seriesId: number, read: boolean): void {
  const chapters = db
    .prepare('SELECT id, page_count FROM effective_chapters WHERE series_id = ?')
    .all(seriesId) as Array<{ id: number; page_count: number }>
  const tx = db.transaction(() => {
    for (const c of chapters) {
      if (!read) {
        db.prepare('DELETE FROM progress WHERE chapter_id = ?').run(c.id)
        continue
      }
      const [p] = getProgress([c.id])
      const page = c.page_count > 0 ? c.page_count - 1 : (p?.page ?? 0)
      saveProgress(c.id, page, true, { trackReading: false })
    }
  })
  tx()
}

/** 重置整系列进度 */
export function resetSeriesProgress(seriesId: number): void {
  db.prepare(
    'DELETE FROM progress WHERE chapter_id IN (SELECT id FROM effective_chapters WHERE series_id = ?)'
  ).run(seriesId)
}

/** 单话标记已读/未读（章节列表的勾选） */
export function setChapterCompleted(chapterId: number, completed: boolean): void {
  const ch = db.prepare('SELECT page_count FROM chapters WHERE id = ?').get(chapterId) as
    | { page_count: number }
    | undefined
  if (!ch) return
  if (!completed) {
    db.prepare('UPDATE progress SET completed = 0 WHERE chapter_id = ?').run(chapterId)
    return
  }
  const [p] = getProgress([chapterId])
  const page = ch.page_count > 0 ? ch.page_count - 1 : (p?.page ?? 0)
  saveProgress(chapterId, page, true, { trackReading: false })
}
