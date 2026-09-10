import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'

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
}

export interface ChapterRow {
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
}

export interface ChapterWithProgress extends ChapterRow {
  read_page: number | null
  completed: number | null
}

let db: Database.Database

export function openDb(): Database.Database {
  if (db) return db
  const file = join(app.getPath('userData'), 'yiben.db')
  db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
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
  `)

  // 云盘字段（渐进迁移）
  const tryAlter = (sql: string): void => {
    try {
      db.exec(sql)
    } catch {
      /* 列已存在 */
    }
  }
  tryAlter('ALTER TABLE libraries ADD COLUMN cloud_folder_id TEXT')
  tryAlter('ALTER TABLE libraries ADD COLUMN family_id TEXT')
  tryAlter('ALTER TABLE chapters ADD COLUMN cloud_file_id TEXT')
  tryAlter('ALTER TABLE series ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0')
  tryAlter('ALTER TABLE series ADD COLUMN missing INTEGER NOT NULL DEFAULT 0')
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
}

export function upsertSeries(s: SeriesUpsert): number {
  const row = db
    .prepare(
      `INSERT INTO series (library_id, title, author, description, status, tags, folder_path, is_single_file, added_at)
       VALUES (@library_id, @title, @author, @description, @status, @tags, @folder_path, @is_single_file, @added_at)
       ON CONFLICT(folder_path) DO UPDATE SET
         library_id = excluded.library_id,
         title = excluded.title,
         author = excluded.author,
         description = excluded.description,
         status = excluded.status,
         tags = excluded.tags,
         is_single_file = excluded.is_single_file,
         missing = 0,
         hidden = CASE WHEN series.library_id = excluded.library_id THEN series.hidden ELSE 0 END
       RETURNING id`
    )
    .get({ added_at: Date.now(), ...s }) as { id: number }
  return row.id
}

export interface RetireResult {
  /** 因源目录消失而被标记 missing 的系列数（进度保留） */
  missing: number
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
  const markMissing = db.prepare('UPDATE series SET missing = 1 WHERE id = ?')
  const del = db.prepare('DELETE FROM series WHERE id = ?')

  const result: RetireResult = { missing: 0, deletedSeries: [], deletedChapters: [] }
  for (const row of gone) {
    if (hasProgress.get(row.id)) {
      markMissing.run(row.id)
      result.missing++
      continue
    }
    for (const c of chapterIds.all(row.id) as { id: number }[]) result.deletedChapters.push(c.id)
    del.run(row.id)
    result.deletedSeries.push(row.id)
  }
  return result
}

/** 删除书库前收集产物清单：章节行会随级联删除，必须先取 */
export function libraryArtifacts(libraryId: number): {
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
}): number {
  const row = db
    .prepare(
      `INSERT INTO chapters (series_id, title, volume, number, sort_index, path, kind, page_count, size, mtime, cloud_file_id)
       VALUES (@series_id, @title, @volume, @number, @sort_index, @path, @kind, @page_count, @size, @mtime, @cloud_file_id)
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
         cloud_file_id = excluded.cloud_file_id
       RETURNING id`
    )
    .get({ cloud_file_id: null, ...c }) as { id: number }
  return row.id
}

export function deleteChaptersNotIn(seriesId: number, keepPaths: string[]): void {
  const stmt = db.prepare(
    `DELETE FROM chapters WHERE series_id = ? AND path NOT IN (${keepPaths.map(() => '?').join(',')})`
  )
  stmt.run(seriesId, ...keepPaths)
}

export function setSeriesCover(seriesId: number, coverPath: string | null): void {
  db.prepare('UPDATE series SET cover_path = ? WHERE id = ?').run(coverPath, seriesId)
}

/** 移出/恢复书架：hidden 系列不出现在任何列表，扫描不会复活 */
export function setSeriesHidden(seriesId: number, hidden: boolean): void {
  db.prepare('UPDATE series SET hidden = ? WHERE id = ?').run(hidden ? 1 : 0, seriesId)
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

export function countByLibrary(libraryId: number): { series: number; chapters: number } {
  const series = (
    db
      .prepare('SELECT COUNT(*) AS c FROM series WHERE library_id = ? AND hidden = 0 AND missing = 0')
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

export interface SeriesListOptions {
  libraryId?: number
  query?: string
  filter?: 'all' | 'unread' | 'reading' | 'recent'
  limit?: number
  offset?: number
}

export function listSeries(opts: SeriesListOptions = {}): SeriesRow[] {
  const conds: string[] = ['s.hidden = 0', 's.missing = 0']
  const params: Record<string, unknown> = {}

  if (opts.libraryId) {
    conds.push('s.library_id = @libraryId')
    params.libraryId = opts.libraryId
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
      'NOT EXISTS (SELECT 1 FROM progress p JOIN chapters c ON c.id = p.chapter_id WHERE c.series_id = s.id AND p.completed = 1)'
    )
  } else if (opts.filter === 'reading') {
    conds.push(
      'EXISTS (SELECT 1 FROM progress p JOIN chapters c ON c.id = p.chapter_id WHERE c.series_id = s.id AND p.completed = 0)'
    )
  }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  const order =
    opts.filter === 'recent' ? 'ORDER BY s.added_at DESC' : 'ORDER BY s.title COLLATE NOCASE'
  const limit = opts.limit ? `LIMIT @limit OFFSET @offset` : ''
  if (opts.limit) {
    params.limit = opts.limit
    params.offset = opts.offset ?? 0
  }
  return db
    .prepare(`SELECT s.* FROM series s ${where} ${order} ${limit}`)
    .all(params) as SeriesRow[]
}

export function getSeries(id: number): SeriesRow | undefined {
  return db.prepare('SELECT * FROM series WHERE id = ?').get(id) as SeriesRow | undefined
}

export function chaptersBySeries(seriesId: number): ChapterWithProgress[] {
  return db
    .prepare(
      `SELECT c.*, p.page AS read_page, p.completed AS completed
       FROM chapters c LEFT JOIN progress p ON p.chapter_id = c.id
       WHERE c.series_id = ? ORDER BY c.sort_index`
    )
    .all(seriesId) as ChapterWithProgress[]
}

export function getChapter(id: number): (ChapterRow & { series_title: string }) | undefined {
  return db
    .prepare(
      `SELECT c.*, s.title AS series_title FROM chapters c JOIN series s ON s.id = c.series_id WHERE c.id = ?`
    )
    .get(id) as (ChapterRow & { series_title: string }) | undefined
}

export interface ChapterSource {
  libraryKind: string
  familyId: string | null
}

/** 章节 → 所属书库的云信息（familyId / 是否云盘库） */
export function getChapterSource(chapterId: number): ChapterSource | undefined {
  return db
    .prepare(
      `SELECT l.kind AS libraryKind, l.family_id AS familyId
       FROM chapters c JOIN series s ON s.id = c.series_id JOIN libraries l ON l.id = s.library_id
       WHERE c.id = ?`
    )
    .get(chapterId) as ChapterSource | undefined
}

/** 系列的封面章节：优先云端散图（按页下载最省），否则第一个章节 */
export function coverChapterFor(seriesId: number): ChapterRow | undefined {
  return db
    .prepare(
      `SELECT * FROM chapters WHERE series_id = ?
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

/** 云盘书库的全部章节（缓存统计/清理用） */
export function cloudChapterRows(): CloudChapterCacheRow[] {
  return db
    .prepare(
      `SELECT l.id AS libraryId, c.id AS chapterId, c.series_id AS seriesId, s.title AS seriesTitle,
              c.kind, c.path, c.cloud_file_id AS cloudFileId
       FROM chapters c
       JOIN series s ON s.id = c.series_id
       JOIN libraries l ON l.id = s.library_id
       WHERE l.kind = 'cloud189'`
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

export function saveProgress(chapterId: number, page: number, completed: boolean): void {
  db.prepare(
    `INSERT INTO progress (chapter_id, page, completed, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(chapter_id) DO UPDATE SET
       page = excluded.page,
       completed = excluded.completed,
       updated_at = excluded.updated_at`
  ).run(chapterId, page, completed ? 1 : 0, Date.now())
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
  return db
    .prepare(
      `SELECT c.id AS chapter_id, c.title AS chapter_title, p.page AS read_page,
              p.completed, p.updated_at, c.page_count,
              s.id AS series_id, s.title AS series_title, s.cover_path
       FROM progress p
       JOIN chapters c ON c.id = p.chapter_id
       JOIN series s ON s.id = c.series_id
       WHERE s.hidden = 0 AND s.missing = 0 AND p.chapter_id IN (
         SELECT p2.chapter_id FROM progress p2
         JOIN chapters c2 ON c2.id = p2.chapter_id
         WHERE p2.completed = 0
         GROUP BY c2.series_id HAVING p2.updated_at = MAX(p2.updated_at)
       )
       ORDER BY p.updated_at DESC
       LIMIT ?`
    )
    .all(limit) as ContinueRow[]
}

/** 首页「最近添加」 */
export function recentlyAdded(limit: number): SeriesRow[] {
  return db
    .prepare(
      'SELECT * FROM series WHERE hidden = 0 AND missing = 0 ORDER BY added_at DESC LIMIT ?'
    )
    .all(limit) as SeriesRow[]
}
