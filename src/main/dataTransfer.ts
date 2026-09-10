import { dialog } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import {
  addBookmark,
  bookmarkPages,
  chaptersBySeries,
  findSeriesIdByPath,
  getProgress,
  listSeries,
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
  app: 'yiben'
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
    defaultPath: `yiben-progress-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  if (result.canceled || !result.filePath) return null

  const out: ExportFile = { app: 'yiben', version: 1, exportedAt: Date.now(), series: [] }
  let progressCount = 0
  let bookmarkCount = 0

  for (const s of listSeries({ limit: 1_000_000 })) {
    // 含 hidden（用户主动移出的系列），missing 的没有源目录无从对账
    const chapters = chaptersBySeries(s.id)
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
        progress: p
          ? { page: p.page, completed: p.completed, updatedAt: p.updated_at }
          : undefined,
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
  return { file: result.filePath, series: out.series.length, progress: progressCount, bookmarks: bookmarkCount }
}

export interface ImportResult {
  series: number
  matched: number
  progress: number
  bookmarks: number
  /** 未找到对应系列的条目数（本机没有这个目录） */
  skipped: number
}

/** 从导出的 JSON 恢复进度/书签：按系列目录路径对账，进度只在更新时合入 */
export async function importData(): Promise<ImportResult | null> {
  const result = await dialog.showOpenDialog({
    title: '导入阅读进度',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile']
  })
  if (result.canceled || result.filePaths.length === 0) return null

  let parsed: ExportFile
  try {
    parsed = JSON.parse(await readFile(result.filePaths[0], 'utf-8')) as ExportFile
  } catch {
    throw new Error('文件不是有效的 JSON')
  }
  if (parsed?.app !== 'yiben' || !Array.isArray(parsed.series)) {
    throw new Error('不是一本 Yiben 导出的进度文件')
  }

  const stat: ImportResult = { series: 0, matched: 0, progress: 0, bookmarks: 0, skipped: 0 }
  for (const es of parsed.series) {
    stat.series++
    const seriesId = findSeriesIdByPath(es.folderPath)
    if (!seriesId) {
      stat.skipped += es.chapters.length
      continue
    }
    stat.matched++
    const chapters = chaptersBySeries(seriesId)
    for (const ec of es.chapters) {
      const ch =
        chapters.find((c) => c.path === ec.path) ??
        chapters.find((c) => c.title === ec.title && c.sort_index === ec.sortIndex)
      if (!ch) {
        stat.skipped++
        continue
      }
      if (ec.progress) {
        const [cur] = getProgress([ch.id])
        // 只用更新的进度覆盖，避免导入旧备份回退当前阅读位置
        if (!cur || ec.progress.updatedAt > cur.updated_at) {
          saveProgress(ch.id, ec.progress.page, ec.progress.completed === 1)
          stat.progress++
        }
      }
      for (const page of ec.bookmarks ?? []) {
        if (addBookmark(ch.id, page)) stat.bookmarks++
      }
    }
  }
  return stat
}
