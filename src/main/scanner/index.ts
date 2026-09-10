import { stat } from 'fs/promises'
import { join } from 'path'
import {
  countByLibrary,
  deleteChaptersNotIn,
  getChapterMetaIfUnchanged,
  getLibrary,
  rebuildFts,
  retireSeriesNotIn,
  setSeriesCover,
  upsertChapter,
  upsertSeries
} from '../db'
import { withDriver } from '../archives'
import {
  archiveKindOf,
  isImageFile,
  longPath,
  naturalCompare,
  readDirEntries,
  stripArchiveExt
} from '../util/paths'
import { readComicInfo } from './comicinfo'
import { parseChapterName } from './parse'
import { coverStale, generateCover, removeSeriesArtifacts } from '../thumbnail'

export interface ScanProgress {
  libraryId: number
  phase: 'listing' | 'reading' | 'done'
  current?: number
  total?: number
  title?: string
}

export interface ScanSummary {
  libraryId: number
  series: number
  chapters: number
  ms: number
  /** 源目录里已不存在、但保留了阅读进度的系列数 */
  missing?: number
}

/**
 * 扫描一个本地库：
 *  - 根目录下每个文件夹 = 一个系列；压缩包直接放根下 = 单文件系列
 *  - 系列内的子文件夹与压缩包 = 章节；系列根下的散图 = 一个「本卷」章节
 *  - ComicInfo.xml > 文件名解析 的顺序取元数据
 *  - 按 mtime/size 增量：没变的章节跳过页数统计
 */
export async function scanLibrary(
  libraryId: number,
  onProgress?: (p: ScanProgress) => void
): Promise<ScanSummary> {
  const started = Date.now()
  const lib = getLibrary(libraryId)
  if (!lib) throw new Error(`书库不存在：${libraryId}`)

  const rootEntries = await readDirEntries(lib.path)
  const seriesDirs = rootEntries.filter((e) => e.isDir).map((e) => e.name)
  const looseArchives = rootEntries
    .filter((e) => !e.isDir && archiveKindOf(e.name))
    .map((e) => e.name)
    .sort(naturalCompare)

  // 展平成待处理的系列清单
  const seriesInputs: Array<{ folder: string; isSingleFile: boolean }> = seriesDirs.map((d) => ({
    folder: join(lib.path, d),
    isSingleFile: false
  }))
  for (const f of looseArchives) {
    seriesInputs.push({ folder: join(lib.path, f), isSingleFile: true })
  }

  let done = 0
  const seenSeriesPaths: string[] = []

  for (const input of seriesInputs) {
    onProgress?.({
      libraryId,
      phase: 'reading',
      current: done,
      total: seriesInputs.length,
      title: baseTitle(input.folder)
    })
    const folderPath = await scanOneLocalSeries(libraryId, input)
    seenSeriesPaths.push(folderPath)
    done++
  }

  const retired = retireSeriesNotIn(libraryId, seenSeriesPaths)
  if (retired.deletedSeries.length > 0) {
    await removeSeriesArtifacts(retired.deletedSeries, retired.deletedChapters)
  }
  rebuildFts()
  onProgress?.({ libraryId, phase: 'done', current: done, total: seriesInputs.length })

  const counts = countByLibrary(libraryId)
  return {
    libraryId,
    series: counts.series,
    chapters: counts.chapters,
    ms: Date.now() - started,
    missing: retired.missing
  }
}

function baseTitle(p: string): string {
  return stripArchiveExt(p.split(/[\\/]/).pop() ?? p)
}

export interface SeriesInput {
  folder: string
  isSingleFile: boolean
}

/**
 * 扫描单个本地系列（目录或单文件）：建系列行、章节行、封面。
 * 整库扫描与「单系列重扫」共用；返回系列目录路径（供整库扫描的 retire 对账）。
 */
export async function scanOneLocalSeries(
  libraryId: number,
  input: SeriesInput
): Promise<string> {
  const title0 = baseTitle(input.folder)

  let chapters: Array<{ path: string; isDir: boolean; name: string }>
  if (input.isSingleFile) {
    chapters = [{ path: input.folder, isDir: false, name: input.folder.split(/[\\/]/).pop() ?? input.folder }]
  } else {
    const children = await readDirEntries(input.folder)
    const dirs = children.filter((e) => e.isDir).map((e) => e.name)
    const files = children
      .filter((e) => !e.isDir && archiveKindOf(e.name))
      .map((e) => e.name)
      .sort(naturalCompare)
    chapters = [
      ...dirs.map((d) => ({ path: join(input.folder, d), isDir: true, name: d })),
      ...files.map((f) => ({ path: join(input.folder, f), isDir: false, name: f }))
    ]
    // 系列根下直接散图 → 整个系列根作为一章
    const hasLooseImages = children.some((e) => !e.isDir && isImageFile(e.name))
    if (hasLooseImages) {
      chapters.push({ path: input.folder, isDir: true, name: title0 })
    }
  }

  if (chapters.length === 0) {
    // 空目录也可能有散图根章节逻辑覆盖不到的情况，跳过
    return input.folder
  }

  const info = input.isSingleFile ? null : await readComicInfo(input.folder)
  const parsed = parseChapterName(info?.series ?? info?.title ?? title0)

  const seriesId = upsertSeries({
    library_id: libraryId,
    title: info?.series ?? info?.title ?? parsed.title,
    author: info?.author ?? null,
    description: info?.description ?? null,
    status: info?.status ?? null,
    tags: info?.tags ? JSON.stringify(info.tags) : null,
    folder_path: input.folder,
    is_single_file: input.isSingleFile ? 1 : 0
  })

  // 章节：解析命名 + 排序 + 页数（增量）
  const seenChapterPaths: string[] = []
  chapters.sort((a, b) => naturalCompare(a.name, b.name))

  const chapterMetas: Array<{
    path: string
    isDir: boolean
    title: string
    volume: string | null
    number: number | null
    kind: string
    page_count: number
    size: number
    mtime: number
  }> = []

  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i]
    const kind = ch.isDir ? 'folder' : (archiveKindOf(ch.name) as string)
    const parsedCh = parseChapterName(stripArchiveExt(ch.name))

    let page_count = 0
    let size = 0
    let mtime = 0
    try {
      const st = await stat(longPath(ch.path))
      size = st.size
      mtime = st.mtimeMs
    } catch {
      /* ignore */
    }

    const existing = getChapterMetaIfUnchanged(ch.path, size, mtime)
    if (existing !== null) {
      page_count = existing
    } else {
      try {
        const pages = await withDriver(ch.path, ch.isDir, (d) => d.listPages())
        page_count = pages.length
      } catch (err) {
        console.warn(`[scan] 列页失败 ${ch.path}:`, err instanceof Error ? err.message : err)
      }
    }

    chapterMetas.push({
      path: ch.path,
      isDir: ch.isDir,
      title: parsedCh.title,
      volume: parsedCh.volume != null ? String(parsedCh.volume) : null,
      number: parsedCh.number ?? parsedCh.volume ?? null,
      kind,
      page_count,
      size,
      mtime
    })
    seenChapterPaths.push(ch.path)
  }

  // 排序：有号按号，无号按名
  chapterMetas.sort((a, b) => {
    if (a.number != null && b.number != null) return a.number - b.number
    if (a.number != null) return -1
    if (b.number != null) return 1
    return naturalCompare(a.title, b.title)
  })

  for (let i = 0; i < chapterMetas.length; i++) {
    const m = chapterMetas[i]
    upsertChapter({
      series_id: seriesId,
      title: m.title,
      volume: m.volume,
      number: m.number,
      sort_index: i,
      path: m.path,
      kind: m.kind,
      page_count: m.page_count,
      size: m.size,
      mtime: m.mtime
    })
  }
  deleteChaptersNotIn(seriesId, seenChapterPaths)

  // 封面：取排序后第一章第一页（首章内容比封面新时重建）
  if (chapterMetas.length > 0) {
    const first = chapterMetas[0]
    if (await coverStale(seriesId, first.mtime)) {
      const cover = await generateCover(seriesId, first.path, first.isDir)
      setSeriesCover(seriesId, cover)
    }
  }

  return input.folder
}
