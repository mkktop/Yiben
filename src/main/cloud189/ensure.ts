import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { getChapter, getChapterPageFile, getChapterSource, updateChapterPageCount } from '../db'
import { getDriver } from '../archives'
import { withDriver } from '../archives'
import { cloudCacheDir, waitCloudReady } from './client'
import { ensureCached } from './cache'
import { broadcast } from '../events'
import { longPath } from '../util/paths'

export interface EnsureResult {
  /** 本地可读路径（缓存文件或缓存目录） */
  path: string
  kind: string
  pageCount: number
}

/**
 * 确保某一页可读：
 *  - 云端散图章节：按页下载（只取当前页）
 *  - 云端压缩包章节：整包下载（首次打开时），并补齐 page_count
 *  - 本地章节：原样返回
 */
export async function ensureChapterPage(
  chapterId: number,
  pageIndex: number,
  familyId?: string
): Promise<EnsureResult> {
  const ch = getChapter(chapterId)
  if (!ch) throw new Error(`章节不存在：${chapterId}`)

  if (ch.kind === 'cfolder' || ch.cloud_file_id) await waitCloudReady()

  if (ch.kind === 'cfolder') {
    const page = getChapterPageFile(chapterId, pageIndex)
    if (!page) throw new Error(`页码越界：${pageIndex}`)
    const dest = join(cloudCacheDir(), `f-${chapterId}`, `${String(pageIndex).padStart(5, '0')}-${page.name}`)
    await ensureCached(page.file_id, familyId, dest, page.size)
    return { path: dest, kind: 'file', pageCount: ch.page_count }
  }

  if (ch.cloud_file_id) {
    // 云端压缩包/PDF：首次访问整包下载到缓存
    if (!existsSync(longPath(ch.path))) {
      await ensureCached(ch.cloud_file_id, familyId, ch.path, ch.size)
    }
    let pageCount = ch.page_count
    // PDF 由渲染进程 pdfjs 渲染并统计页数，主进程驱动层不支持，跳过回填
    if (pageCount === 0 && ch.kind !== 'pdf') {
      pageCount = (await withDriver(ch.path, false, (d) => d.listPages())).length
      updateChapterPageCount(chapterId, pageCount)
      // 渲染进程打开章节时拿到的是旧值 0，必须推一次，否则页码钳位会失效
      broadcast('chapter:pageCount', { chapterId, pageCount })
    }
    return { path: ch.path, kind: ch.kind, pageCount }
  }

  return { path: ch.path, kind: ch.kind, pageCount: ch.page_count }
}

/**
 * 确保章节的本地路径可读（PDF 渲染、整包访问等场景）：
 * 云端压缩包/PDF 在文件未缓存时触发整包下载，本地章节原样返回。
 */
export async function ensureLocalChapterPath(chapterId: number): Promise<string> {
  const ch = getChapter(chapterId)
  if (!ch) throw new Error(`章节不存在：${chapterId}`)
  if (existsSync(longPath(ch.path))) return ch.path
  const src = getChapterSource(chapterId)
  if (src?.libraryKind !== 'cloud189') return ch.path
  const result = await ensureChapterPage(chapterId, 0, src.familyId ?? undefined)
  return result.path
}

/** 读取已确保存在的页（协议层调用） */
export async function readEnsuredPage(result: EnsureResult, pageIndex: number): Promise<Buffer> {
  if (result.kind === 'file') return readFile(result.path)
  const driver = await getDriver(result.path, result.kind === 'folder')
  return driver.readPage(pageIndex)
}
