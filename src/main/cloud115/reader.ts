import { readFile } from 'fs/promises'
import { join } from 'path'
import { getChapter, getChapterPageFile, updateChapterPageCount } from '../db'
import type { ChapterRow } from '../db'
import { getDriver, withDriver } from '../archives'
import { RangeUnsupportedError } from '../archives/remoteZip'
import { getRemoteZip, dropRemoteZip } from '../cloud189/remoteZipManager'
import { ensureCached } from '../cloud189/cache'
import { broadcast } from '../events'
import { archiveKindOf, sanitizeFileName } from '../util/paths'
import { isCompleteFile } from '../util/cachedFile'
import { cloud115CacheDir, cloud115DownloadUrl } from './client'
import type { EnsureResult } from '../cloud189/ensure'

/** 115 网盘文件 id 即 pickcode，直链解析统一走这里 */
const resolve115Url = (pickcode: string): Promise<string> => cloud115DownloadUrl(pickcode)

/**
 * 确保某一页可读（115 章节）：
 *  - 散图章节：按页下载（只取当前页，页映射在扫描时入库）
 *  - zip 压缩包：直链支持 Range 时远程直读（零下载秒开），失败回退整包下载
 *  - 其他压缩包 / PDF：整包下载；PDF 页数由渲染进程回填
 */
export async function ensure115ChapterPage(
  chapterId: number,
  pageIndex: number,
  signal?: AbortSignal
): Promise<EnsureResult> {
  const ch = getChapter(chapterId)
  if (!ch) throw new Error(`章节不存在：${chapterId}`)

  if (ch.kind === 'cfolder') {
    const page = getChapterPageFile(chapterId, pageIndex)
    if (!page) throw new Error(`页码越界：${pageIndex}`)
    // 网盘侧文件名不可信：清洗后才允许 join 进缓存子目录（防 \ 分隔符/.. 逃逸）
    const dest = join(
      cloud115CacheDir(),
      `f-${chapterId}`,
      `${String(pageIndex).padStart(5, '0')}-${sanitizeFileName(page.name)}`
    )
    await ensureCached(page.file_id, undefined, dest, page.size, undefined, signal, (id) =>
      cloud115DownloadUrl(id)
    )
    return { chapterId, path: dest, kind: 'file', pageCount: ch.page_count }
  }

  if (ch.cloud_file_id) {
    const pickcode = ch.cloud_file_id
    if (!(await isCompleteFile(ch.path, ch.size))) {
      // 云端 zip：探测 Range 直读，失败（不支持/目录解析不出）回退整包下载
      if (archiveKindOf(ch.path) === 'zip') {
        try {
          const zip = await getRemoteZip(chapterId, () => resolve115Url(pickcode), ch.size)
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
              '[ensure115] Range 直读失败，回退整包下载:',
              err instanceof Error ? err.message : err
            )
          }
        }
      }
      await ensureCached(pickcode, undefined, ch.path, ch.size, undefined, signal, (id) =>
        cloud115DownloadUrl(id)
      )
    }
    return { chapterId, path: ch.path, kind: ch.kind, pageCount: await backfillPageCount(ch) }
  }

  return { chapterId, path: ch.path, kind: ch.kind, pageCount: ch.page_count }
}

/** 确保章节的本地路径可读（PDF 渲染、整包访问、离线预取场景）；散图章节返回首页缓存路径 */
export async function ensure115LocalPath(chapterId: number, signal?: AbortSignal): Promise<string> {
  const ch = getChapter(chapterId)
  if (!ch) throw new Error(`章节不存在：${chapterId}`)
  if (await isCompleteFile(ch.path, ch.size)) return ch.path
  if (ch.cloud_file_id) {
    const pickcode = ch.cloud_file_id
    await ensureCached(pickcode, undefined, ch.path, ch.size, undefined, signal, (id) =>
      cloud115DownloadUrl(id)
    )
    return ch.path
  }
  const result = await ensure115ChapterPage(chapterId, 0, signal)
  return result.path
}

/** 读取已确保存在的页（协议层调用） */
export async function read115EnsuredPage(result: EnsureResult, pageIndex: number): Promise<Buffer> {
  if (result.kind === 'file') return readFile(result.path)
  if (result.kind === 'remotezip') {
    const ch = getChapter(result.chapterId)
    if (!ch?.cloud_file_id) throw new Error(`章节缺少云端文件 id：${result.chapterId}`)
    const pickcode = ch.cloud_file_id
    const zip = await getRemoteZip(result.chapterId, () => resolve115Url(pickcode), ch.size)
    return zip.readPage(pageIndex)
  }
  const driver = await getDriver(result.path, result.kind === 'folder')
  return driver.readPage(pageIndex)
}

/** 整包打开后页数仍为 0 时由驱动层统计并回填（PDF 由渲染进程统计，跳过） */
async function backfillPageCount(ch: ChapterRow): Promise<number> {
  let pageCount = ch.page_count
  if (pageCount === 0 && ch.kind !== 'pdf') {
    pageCount = (await withDriver(ch.path, false, (d) => d.listPages())).length
    updateChapterPageCount(ch.id, pageCount)
    broadcast('chapter:pageCount', { chapterId: ch.id, pageCount })
  }
  return pageCount
}
