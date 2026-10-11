import { readFile, stat } from 'fs/promises'
import { join } from 'path'
import {
  countByLibrary,
  deleteChaptersNotIn,
  getChapterMetaIfUnchanged,
  getLibrary,
  markSeriesMetaProbed,
  rebuildFts,
  retireSeriesNotIn,
  seriesMetaProbed,
  setSeriesCover,
  upsertChapters,
  upsertSeries
} from '../db'
import { withDriver, sniffArchiveKind, type DriverKind } from '../archives'
import {
  archiveKindOf,
  isImageFile,
  longPath,
  naturalCompare,
  readDirEntries,
  stripArchiveExt
} from '../util/paths'
import { readComicInfo, parseComicInfoXml, type ComicInfo } from './comicinfo'
import { parseChapterName } from './parse'
import { adoptRelocatedSeries } from './relocate'
import { coverStale, generateCover, removeSeriesArtifacts } from '../thumbnail'
import { removePageThumbs } from '../pageThumb'

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
  /** 通过章节指纹识别为「移动/改名」并转移了进度的系列数 */
  relocated?: number
}

/** 系列级扫描并发：开包列页数是 IO 等待，并行提速；better-sqlite3 写在单线程内天然不交错 */
const SCAN_CONCURRENCY = 4

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

  let cursor = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = cursor++
      if (i >= seriesInputs.length) return
      onProgress?.({
        libraryId,
        phase: 'reading',
        current: done,
        total: seriesInputs.length,
        title: baseTitle(seriesInputs[i].folder)
      })
      const folderPath = await scanOneLocalSeries(libraryId, seriesInputs[i])
      seenSeriesPaths.push(folderPath)
      done++
    }
  }
  // 一路失败时其余 worker 仍可能写库，必须全部收尾后才能让外层释放扫描锁。
  const results = await Promise.allSettled(
    Array.from({ length: Math.min(SCAN_CONCURRENCY, seriesInputs.length) }, () => worker())
  )
  for (const result of results) {
    // 任何一路失败都不进行 retire 对账，避免用不完整的清单标记/删除系列。
    if (result.status === 'rejected') throw result.reason
  }

  const retired = retireSeriesNotIn(libraryId, seenSeriesPaths)
  if (retired.deletedSeries.length > 0) {
    await removeSeriesArtifacts(retired.deletedSeries, retired.deletedChapters)
  }
  // 旧路径标 missing 的系列里，找回移动/改名后的新路径并转移进度
  const relocated = adoptRelocatedSeries(seenSeriesPaths)
  rebuildFts()
  onProgress?.({ libraryId, phase: 'done', current: done, total: seriesInputs.length })

  const counts = countByLibrary(libraryId)
  return {
    libraryId,
    series: counts.series,
    chapters: counts.chapters,
    ms: Date.now() - started,
    missing: retired.missing,
    relocated
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
export async function scanOneLocalSeries(libraryId: number, input: SeriesInput): Promise<string> {
  const title0 = baseTitle(input.folder)

  let chapters: Array<{ path: string; isDir: boolean; name: string }>
  if (input.isSingleFile) {
    chapters = [
      { path: input.folder, isDir: false, name: input.folder.split(/[\\/]/).pop() ?? input.folder }
    ]
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

  // 系列元数据兜底链：目录 ComicInfo.xml > 压缩包内 ComicInfo.xml > EPUB 的 OPF 书名/作者。
  // 包内探测是填空性质（meta_probed 一次即止），避免每轮扫描重复开包
  const dirInfo = input.isSingleFile
    ? await readFile(`${input.folder}.ComicInfo.xml`, 'utf8')
        .then(parseComicInfoXml)
        .catch(() => null)
    : await readComicInfo(input.folder)
  const probed = dirInfo !== null || seriesMetaProbed(input.folder)
  let info = dirInfo
  if (!info && !probed) info = await readComicInfoFromArchives(chapters)
  if (!info && !probed) info = await readEpubChapterMetadata(chapters)
  const parsed = parseChapterName(info?.series ?? info?.title ?? title0)

  const seriesId = upsertSeries({
    library_id: libraryId,
    title: info?.series ?? info?.title ?? parsed.title,
    author: info?.author ?? null,
    description: info?.description ?? null,
    status: info?.status ?? null,
    tags: info?.tags ? JSON.stringify(info.tags) : null,
    folder_path: input.folder,
    is_single_file: input.isSingleFile ? 1 : 0,
    year: info?.year ?? null,
    language: info?.language ?? null
  })
  if (!probed) markSeriesMetaProbed(seriesId)

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
    scan_error: string | null
  }> = []

  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i]
    const extKind = ch.isDir ? 'folder' : (archiveKindOf(ch.name) as string | null)
    // 伪装包（.cbr 实为 zip 等）按魔数纠正写库；被纠正过的文件无视增量缓存重列页数
    let kind = (extKind ?? '') as string
    if (!ch.isDir && extKind) {
      kind = ((await sniffArchiveKind(ch.path, extKind as DriverKind)) ?? extKind) as string
    }
    const kindCorrected = kind !== extKind
    const parsedCh = parseChapterName(stripArchiveExt(ch.name))

    let page_count = 0
    let size = 0
    let mtime = 0
    let scan_error: string | null = null
    try {
      const st = await stat(longPath(ch.path))
      size = st.size
      mtime = st.mtimeMs
    } catch {
      /* ignore */
    }

    const existing = kindCorrected ? null : getChapterMetaIfUnchanged(ch.path, size, mtime)
    if (existing !== null && (existing > 0 || kind === 'pdf')) {
      // 增量沿用：>0 页是已验证的成功态；PDF 页数由渲染进程回填
      page_count = existing
    } else {
      // 未扫过 / 上次失败（0 页：损坏包，每轮重试直到成功或文件被替换）
      try {
        const pages = await withDriver(ch.path, ch.isDir, (d) => d.listPages())
        page_count = pages.length
      } catch (err) {
        scan_error = err instanceof Error ? err.message : String(err)
        console.warn(`[scan] 列页失败 ${ch.path}:`, scan_error)
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
      mtime,
      scan_error
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

  // 整批包进一个事务：逐条自动提交在大库扫描时会把事件循环拖住
  upsertChapters(
    chapterMetas.map((m, i) => ({
      series_id: seriesId,
      title: m.title,
      volume: m.volume,
      number: m.number,
      sort_index: i,
      path: m.path,
      kind: m.kind,
      page_count: m.page_count,
      size: m.size,
      mtime: m.mtime,
      scan_error: m.scan_error
    }))
  )
  // 被删除的章节行会级联清掉进度，但页缩略图目录在文件系统里，得手动跟删
  const removedChapterIds = deleteChaptersNotIn(seriesId, seenChapterPaths)
  if (removedChapterIds.length > 0) await removePageThumbs(removedChapterIds)

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

/** 压缩包内找 ComicInfo.xml（每包一份的常见写法）；最多试前 3 个包控制扫描开销 */
async function readComicInfoFromArchives(
  chapters: Array<{ path: string; isDir: boolean; name: string }>
): Promise<ComicInfo | null> {
  // PDF 主进程驱动层不支持（会抛 UnsupportedFormatError），元数据探测直接跳过
  const archives = chapters.filter(
    (c) => !c.isDir && archiveKindOf(c.name) && archiveKindOf(c.name) !== 'pdf'
  )
  for (const ch of archives.slice(0, 3)) {
    let xml: Buffer | null = null
    try {
      xml = await withDriver(
        ch.path,
        false,
        async (d) => (await d.readEntry?.('ComicInfo.xml')) ?? null
      )
    } catch (err) {
      // 单个包损坏不该让整个系列的扫描失败
      console.warn(
        `[scan] ComicInfo 探测失败 ${ch.path}:`,
        err instanceof Error ? err.message : err
      )
      continue
    }
    if (!xml) continue
    const info = parseComicInfoXml(xml.toString('utf-8'))
    if (info) return info
  }
  return null
}

/** EPUB 章节的 OPF 书名/作者（单文件 EPUB 系列的系列元数据来源） */
async function readEpubChapterMetadata(
  chapters: Array<{ path: string; isDir: boolean; name: string }>
): Promise<ComicInfo | null> {
  const epub = chapters.find((c) => !c.isDir && archiveKindOf(c.name) === 'epub')
  if (!epub) return null
  return withDriver<ComicInfo | null>(epub.path, false, async (d) => {
    const meta = (d as { metadata?: { title?: string; author?: string } }).metadata
    return meta?.title || meta?.author ? { title: meta.title, author: meta.author } : null
  })
}
