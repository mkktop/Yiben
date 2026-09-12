import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { getChapter, getChapterPageFile, getChapterSource, updateChapterPageCount } from '../db'
import { getDriver } from '../archives'
import { withDriver } from '../archives'
import { RangeUnsupportedError } from '../archives/remoteZip'
import { cloudCacheDir, cloudDownloadUrl, waitCloudReady } from './client'
import { ensureCached } from './cache'
import { dropRemoteZip, getRemoteZip } from './remoteZipManager'
import { ensure115ChapterPage, ensure115LocalPath, read115EnsuredPage } from '../cloud115/reader'
import { broadcast } from '../events'
import { archiveKindOf, longPath } from '../util/paths'

export interface EnsureResult {
  chapterId: number
  /** 本地可读路径（缓存文件/缓存目录），或云端 zip 的远程直读标记路径 */
  path: string
  kind: string
  pageCount: number
  /** 远程直读时用于 content-type 的真实页名 */
  name?: string
}

/**
 * 确保某一页可读（按章节所属书库分派：本地 / 天翼云盘 / 115 网盘）：
 *  - 云端散图章节：按页下载（只取当前页）
 *  - 云端 zip 压缩包：直链支持 Range 时远程直读（零下载秒开），否则整包下载
 *  - 云端 PDF / 其他压缩包：整包下载；PDF 页数由渲染进程回填
 *  - 本地章节：原样返回
 * signal 用于外部取消（离线预取中止）：已在下载的任务会立即中断。
 */
export async function ensureChapterPage(
  chapterId: number,
  pageIndex: number,
  signal?: AbortSignal
): Promise<EnsureResult> {
  const src = getChapterSource(chapterId)
  if (src?.libraryKind === '115') return ensure115ChapterPage(chapterId, pageIndex, signal)

  const ch = getChapter(chapterId)
  if (!ch) throw new Error(`章节不存在：${chapterId}`)
  const familyId = src?.familyId ?? undefined

  if (ch.kind === 'cfolder' || ch.cloud_file_id) await waitCloudReady()

  if (ch.kind === 'cfolder') {
    const page = getChapterPageFile(chapterId, pageIndex)
    if (!page) throw new Error(`页码越界：${pageIndex}`)
    const dest = join(cloudCacheDir(), `f-${chapterId}`, `${String(pageIndex).padStart(5, '0')}-${page.name}`)
    await ensureCached(page.file_id, familyId, dest, page.size, undefined, signal)
    return { chapterId, path: dest, kind: 'file', pageCount: ch.page_count }
  }

  if (ch.cloud_file_id) {
    const fileId = ch.cloud_file_id
    if (!existsSync(longPath(ch.path))) {
      // 云端 zip：探测 Range 直读，失败（不支持/目录解析不出）回退整包下载
      if (archiveKindOf(ch.path) === 'zip') {
        try {
          const zip = await getRemoteZip(
            chapterId,
            () => cloudDownloadUrl(fileId, familyId),
            ch.size
          )
          let pageCount = ch.page_count
          if (pageCount === 0 && zip.pageCount > 0) {
            pageCount = zip.pageCount
            updateChapterPageCount(chapterId, pageCount)
            // 渲染进程打开章节时拿到的是旧值 0，必须推一次，否则页码钳位会失效
            broadcast('chapter:pageCount', { chapterId, pageCount })
          }
          const name = zip.listPages()[pageIndex]?.name
          return { chapterId, path: ch.path, kind: 'remotezip', pageCount, name }
        } catch (err) {
          dropRemoteZip(chapterId)
          if (!(err instanceof RangeUnsupportedError)) {
            console.warn(
              '[ensure] Range 直读失败，回退整包下载:',
              err instanceof Error ? err.message : err
            )
          }
        }
      }
      await ensureCached(ch.cloud_file_id, familyId, ch.path, ch.size, undefined, signal)
    }
    let pageCount = ch.page_count
    // PDF 由渲染进程 pdfjs 渲染并统计页数，主进程驱动层不支持，跳过回填
    if (pageCount === 0 && ch.kind !== 'pdf') {
      pageCount = (await withDriver(ch.path, false, (d) => d.listPages())).length
      updateChapterPageCount(chapterId, pageCount)
      // 渲染进程打开章节时拿到的是旧值 0，必须推一次，否则页码钳位会失效
      broadcast('chapter:pageCount', { chapterId, pageCount })
    }
    return { chapterId, path: ch.path, kind: ch.kind, pageCount }
  }

  return { chapterId, path: ch.path, kind: ch.kind, pageCount: ch.page_count }
}

/**
 * 确保章节的本地路径可读（PDF 渲染、整包访问、离线预取等场景）：
 * 云端压缩包/PDF 在文件未缓存时触发整包下载（Range 直读不落盘，这里不走），本地章节原样返回。
 */
export async function ensureLocalChapterPath(
  chapterId: number,
  signal?: AbortSignal
): Promise<string> {
  const src = getChapterSource(chapterId)
  if (src?.libraryKind === '115') return ensure115LocalPath(chapterId, signal)

  const ch = getChapter(chapterId)
  if (!ch) throw new Error(`章节不存在：${chapterId}`)
  if (existsSync(longPath(ch.path))) return ch.path
  if (src?.libraryKind !== 'cloud189') return ch.path
  const familyId = src.familyId ?? undefined
  if (ch.cloud_file_id) {
    await waitCloudReady()
    await ensureCached(ch.cloud_file_id, familyId, ch.path, ch.size, undefined, signal)
    return ch.path
  }
  const result = await ensureChapterPage(chapterId, 0, signal)
  return result.path
}

/** 读取已确保存在的页（协议层调用） */
export async function readEnsuredPage(result: EnsureResult, pageIndex: number): Promise<Buffer> {
  if (result.kind === 'file') return readFile(result.path)
  const src = getChapterSource(result.chapterId)
  if (src?.libraryKind === '115') return read115EnsuredPage(result, pageIndex)
  if (result.kind === 'remotezip') {
    const ch = getChapter(result.chapterId)
    if (!ch?.cloud_file_id) throw new Error(`章节缺少云端文件 id：${result.chapterId}`)
    const fileId = ch.cloud_file_id
    const zip = await getRemoteZip(
      result.chapterId,
      () => cloudDownloadUrl(fileId, src?.familyId ?? undefined),
      ch.size
    )
    return zip.readPage(pageIndex)
  }
  const driver = await getDriver(result.path, result.kind === 'folder')
  return driver.readPage(pageIndex)
}
