import { dialog } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import {
  addBookmark,
  bookmarkPages,
  sourceChaptersBySeries,
  findSeriesIdByPath,
  getProgress,
  openDb,
  saveProgress
} from './db'

interface ExportChapter {
  path: string
  title: string
  sortIndex: number
  progress?: { page: number; completed: number; updatedAt: number }
  bookmarks: number[]
}

interface ExportSeries {
  folderPath: string
  title: string
  hidden: number
  chapters: ExportChapter[]
}

interface ExportFile {
  app: 'yudu'
  version: 1
  exportedAt: number
  series: ExportSeries[]
}

/** 导出全部阅读进度与书签为 JSON（章节以 路径+标题 双重标识，跨机器按路径对账） */
export async function exportData(): Promise<null | {
  file: string
  series: number
  progress: number
  bookmarks: number
}> {
  const result = await dialog.showSaveDialog({
    title: '导出阅读进度',
    defaultPath: `yudu-progress-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  if (result.canceled || !result.filePath) return null

  const out: ExportFile = { app: 'yudu', version: 1, exportedAt: Date.now(), series: [] }
  let progressCount = 0
  let bookmarkCount = 0

  // 备份包含隐藏与暂时离线的系列，不能复用书架查询的可见性过滤。
  const series = openDb()
    .prepare('SELECT folder_path, title, hidden, id FROM series ORDER BY id')
    .all() as Array<{ folder_path: string; title: string; hidden: number; id: number }>
  for (const s of series) {
    const chapters = sourceChaptersBySeries(s.id)
    const exportChapters: ExportChapter[] = []
    for (const c of chapters) {
      const [p] = getProgress([c.id])
      const marks = bookmarkPages(c.id)
      if (!p && marks.length === 0) continue
      if (p) progressCount++
      bookmarkCount += marks.length
      exportChapters.push({
        path: c.path,
        title: c.title,
        sortIndex: c.sort_index,
        progress: p ? { page: p.page, completed: p.completed, updatedAt: p.updated_at } : undefined,
        bookmarks: marks
      })
    }
    out.series.push({
      folderPath: s.folder_path,
      title: s.title,
      hidden: s.hidden ?? 0,
      chapters: exportChapters
    })
  }

  await writeFile(result.filePath, JSON.stringify(out, null, 2), 'utf-8')
  return {
    file: result.filePath,
    series: out.series.length,
    progress: progressCount,
    bookmarks: bookmarkCount
  }
}

export interface ImportResult {
  series: number
  matched: number
  progress: number
  bookmarks: number
  /** 未找到对应系列的条目数（本机没有这个目录） */
  skipped: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPage(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** 写库前校验整份备份，避免损坏条目让导入只完成一半。 */
function validateExport(value: unknown): asserts value is ExportFile {
  if (
    !isRecord(value) ||
    value.app !== 'yudu' ||
    value.version !== 1 ||
    !Array.isArray(value.series)
  ) {
    throw new Error('不是支持的雨读 Yudu 进度文件（需要版本 1）')
  }
  for (const series of value.series) {
    if (
      !isRecord(series) ||
      typeof series.folderPath !== 'string' ||
      !Array.isArray(series.chapters)
    ) {
      throw new Error('进度文件中的系列信息不完整')
    }
    for (const chapter of series.chapters) {
      if (
        !isRecord(chapter) ||
        typeof chapter.path !== 'string' ||
        typeof chapter.title !== 'string' ||
        typeof chapter.sortIndex !== 'number' ||
        !Number.isFinite(chapter.sortIndex) ||
        !Array.isArray(chapter.bookmarks) ||
        !chapter.bookmarks.every(isPage)
      ) {
        throw new Error('进度文件中的章节或书签格式不正确')
      }
      const progress = chapter.progress
      if (
        progress !== undefined &&
        (!isRecord(progress) ||
          !isPage(progress.page) ||
          !isPage(progress.updatedAt) ||
          (progress.completed !== 0 && progress.completed !== 1))
      ) {
        throw new Error('进度文件中的页码或时间戳不正确')
      }
    }
  }
}

/** 从导出的 JSON 恢复进度/书签：按系列目录路径对账，进度只在更新时合入 */
export async function importData(): Promise<ImportResult | null> {
  const result = await dialog.showOpenDialog({
    title: '导入阅读进度',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile']
  })
  if (result.canceled || result.filePaths.length === 0) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(result.filePaths[0], 'utf-8')) as unknown
  } catch {
    throw new Error('文件不是有效的 JSON')
  }
  validateExport(parsed)

  const stat: ImportResult = { series: 0, matched: 0, progress: 0, bookmarks: 0, skipped: 0 }
  openDb().transaction(() => {
    for (const es of parsed.series) {
      stat.series++
      const seriesId = findSeriesIdByPath(es.folderPath)
      if (!seriesId) {
        stat.skipped += es.chapters.length
        continue
      }
      stat.matched++
      const chapters = sourceChaptersBySeries(seriesId)
      const byPath = new Map(chapters.map((c) => [c.path, c]))
      const byTitle = new Map<string, (typeof chapters)[number]>()
      // 保持原先同名条目优先取第一项的行为，大系列对账改为线性复杂度。
      for (const c of chapters) {
        const key = JSON.stringify([c.title, c.sort_index])
        if (!byTitle.has(key)) byTitle.set(key, c)
      }
      for (const ec of es.chapters) {
        const ch = byPath.get(ec.path) ?? byTitle.get(JSON.stringify([ec.title, ec.sortIndex]))
        if (!ch) {
          stat.skipped++
          continue
        }
        if (ec.progress) {
          const [cur] = getProgress([ch.id])
          // 只用更新的进度覆盖，避免导入旧备份回退当前阅读位置。
          if (!cur || ec.progress.updatedAt > cur.updated_at) {
            const page = ec.progress.page
            const boundedPage = ch.page_count > 0 ? Math.min(page, ch.page_count - 1) : page
            // 保留备份原时间戳，重复导入与多设备合并才不会把旧进度伪装成最新。
            // 恢复历史进度不计入当天阅读统计。
            saveProgress(ch.id, boundedPage, ec.progress.completed === 1, {
              updatedAt: ec.progress.updatedAt,
              trackReading: false
            })
            stat.progress++
          }
        }
        for (const page of ec.bookmarks) {
          if ((ch.page_count === 0 || page < ch.page_count) && addBookmark(ch.id, page))
            stat.bookmarks++
        }
      }
    }
  })()
  return stat
}
