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
  /** 发表年份（ComicInfo Year） */
  year?: number | null
  /** 语言代码（ComicInfo LanguageISO） */
  language?: string | null
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
  /** 扫描列页失败的原因；成功为 null */
  scan_error?: string | null
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
  // 用户手动编辑过元数据：之后的扫描不覆盖这些字段
  tryAlter('ALTER TABLE series ADD COLUMN meta_edited INTEGER NOT NULL DEFAULT 0')
  tryAlter('ALTER TABLE series ADD COLUMN year INTEGER')
  tryAlter('ALTER TABLE series ADD COLUMN language TEXT')
  /** 已探测过包内 ComicInfo/EPUB 元数据（无论成败，填空性质不重复劳动） */
  tryAlter('ALTER TABLE series ADD COLUMN meta_probed INTEGER NOT NULL DEFAULT 0')
  // 扫描列页失败的原因（损坏的压缩包等），成功时清空
  tryAlter('ALTER TABLE chapters ADD COLUMN scan_error TEXT')
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

/** 手动编辑元数据：只改传入的字段，并打上 meta_edited 防止重扫覆盖 */
export function updateSeriesMeta(id: number, patch: SeriesMetaPatch): void {
  const fields: string[] = []
  const params: Record<string, unknown> = { id }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
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
  const markMissing = db.prepare('UPDATE series SET missing = 1 WHERE id = ?')
  const del = db.prepare('DELETE FROM series WHERE id = ?')

  const result: RetireResult = { missing: 0, missingSeries: [], deletedSeries: [], deletedChapters: [] }
  for (const row of gone) {
    if (hasProgress.get(row.id)) {
      markMissing.run(row.id)
      result.missing++
      result.missingSeries.push(row.id)
      continue
    }
    for (const c of chapterIds.all(row.id) as { id: number }[]) result.deletedChapters.push(c.id)
    del.run(row.id)
    result.deletedSeries.push(row.id)
  }
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

/** 删除书库前收集产物清单：章节行会随级联删除，必须先取 */export function libraryArtifacts(libraryId: number): {
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
  scan_error?: string | null
}): number {
  const row = db
    .prepare(
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
    .get({ cloud_file_id: null, scan_error: null, ...c }) as { id: number }
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
  filter?: 'all' | 'unread' | 'reading' | 'read' | 'recent'
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
  } else if (opts.filter === 'read') {
    conds.push(
      'EXISTS (SELECT 1 FROM progress p JOIN chapters c ON c.id = p.chapter_id WHERE c.series_id = s.id)'
    )
  }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  // 最近阅读：按该系列最近一次进度更新时间倒排（从未读过的排最后）
  const order =
    opts.filter === 'read'
      ? `ORDER BY (SELECT MAX(p.updated_at) FROM progress p
           JOIN chapters c ON c.id = p.chapter_id WHERE c.series_id = s.id) DESC`
      : opts.filter === 'recent'
        ? 'ORDER BY s.added_at DESC'
        : 'ORDER BY s.title COLLATE NOCASE'
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
    .prepare('SELECT series_id, sort_index FROM chapters WHERE id = ?')
    .get(chapterId) as { series_id: number; sort_index: number } | undefined
  if (!row) return null
  const all = db
    .prepare(
      'SELECT id, title, page_count, kind FROM chapters WHERE series_id = ? ORDER BY sort_index'
    )
    .all(row.series_id) as NeighborChapter[]
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
       FROM bookmarks b JOIN chapters c ON c.id = b.chapter_id
       WHERE c.series_id = ? ORDER BY b.created_at DESC`
    )
    .all(seriesId) as BookmarkRow[]
}

/** 某话已加书签的页码列表（升序，导出用） */
export function bookmarkPages(chapterId: number): number[] {
  return (
    db.prepare('SELECT page FROM bookmarks WHERE chapter_id = ? ORDER BY page').all(chapterId) as Array<{ page: number }>
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
    .prepare('SELECT id, page_count FROM chapters WHERE series_id = ?')
    .all(seriesId) as Array<{ id: number; page_count: number }>
  const tx = db.transaction(() => {
    for (const c of chapters) {
      if (!read) {
        db.prepare('DELETE FROM progress WHERE chapter_id = ?').run(c.id)
        continue
      }
      const [p] = getProgress([c.id])
      const page = c.page_count > 0 ? c.page_count - 1 : (p?.page ?? 0)
      saveProgress(c.id, page, true)
    }
  })
  tx()
}

/** 重置整系列进度 */
export function resetSeriesProgress(seriesId: number): void {
  db.prepare(
    'DELETE FROM progress WHERE chapter_id IN (SELECT id FROM chapters WHERE series_id = ?)'
  ).run(seriesId)
}

/** 单话标记已读/未读（章节列表的勾选） */
export function setChapterCompleted(chapterId: number, completed: boolean): void {
  const ch = db
    .prepare('SELECT page_count FROM chapters WHERE id = ?')
    .get(chapterId) as { page_count: number } | undefined
  if (!ch) return
  if (!completed) {
    db.prepare('UPDATE progress SET completed = 0 WHERE chapter_id = ?').run(chapterId)
    return
  }
  const [p] = getProgress([chapterId])
  const page = ch.page_count > 0 ? ch.page_count - 1 : (p?.page ?? 0)
  saveProgress(chapterId, page, true)
}
