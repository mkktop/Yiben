import { readFile } from 'fs/promises'
import { join } from 'path'
import { getChapter, getChapterSource, getChapterPageFile, updateChapterPageCount } from '../db'
import { getDriver, withDriver } from '../archives'
import { RemoteZip } from '../archives/remoteZip'
import { ensureCached } from '../cloud189/cache'
import { broadcast } from '../events'
import { archiveKindOf, sanitizeFileName } from '../util/paths'
import {
  resourceUrl,
  webdavCredentials,
  webdavRequest,
  webdavCacheDir,
  limitedBuffer
} from './client'
import type { EnsureResult } from '../cloud189/ensure'
import { isCompleteFile } from '../util/cachedFile'

const remote = new Map<
  number,
  { zip: RemoteZip; size: number; fileId: string | null | undefined }
>()
async function rangeZip(id: number): Promise<RemoteZip> {
  const chapter = getChapter(id)!
  const hit = remote.get(id)
  if (hit && hit.size === chapter.size && hit.fileId === chapter.cloud_file_id) return hit.zip
  if (hit) {
    await hit.zip.close()
    remote.delete(id)
  }
  const libraryId = getChapterSource(id)!.libraryId
  const zip = await RemoteZip.create(
    chapter.size,
    async (start, end) => {
      const response = await webdavRequest(libraryId, chapter.cloud_file_id!, {
        headers: { Range: `bytes=${start}-${end}` }
      })
      if (response.status !== 206) {
        await response.body?.cancel()
        throw new Error('WebDAV 不支持 Range')
      }
      const contentRange = response.headers.get('content-range')
      if (contentRange !== `bytes ${start}-${end}/${chapter.size}`) {
        await response.body?.cancel()
        throw new Error('WebDAV 分段范围不符，请重新扫描')
      }
      const data = await limitedBuffer(response, end - start + 1)
      if (data.length !== end - start + 1) throw new Error('WebDAV 分段数据不完整')
      return data
    },
    async () => {}
  )
  remote.set(id, { zip, size: chapter.size, fileId: chapter.cloud_file_id })
  if (remote.size > 8) {
    const first = remote.keys().next().value!
    await remote.get(first)?.zip.close()
    remote.delete(first)
  }
  return zip
}

async function download(
  libraryId: number,
  resource: string,
  path: string,
  size: number,
  signal?: AbortSignal
): Promise<string> {
  const config = webdavCredentials(libraryId)
  return ensureCached(
    resource,
    undefined,
    path,
    size,
    undefined,
    signal,
    async () => resourceUrl(config.url, resource),
    config.headers
  )
}
export async function ensureWebDavLocalPath(id: number, signal?: AbortSignal): Promise<string> {
  const chapter = getChapter(id)
  if (!chapter) throw new Error('章节不存在')
  if (await isCompleteFile(chapter.path, chapter.size)) return chapter.path
  const libraryId = getChapterSource(id)!.libraryId
  if (!chapter.cloud_file_id) return (await ensureWebDavPage(id, 0, signal)).path
  return download(libraryId, chapter.cloud_file_id, chapter.path, chapter.size, signal)
}
export async function ensureWebDavPage(
  id: number,
  index: number,
  signal?: AbortSignal
): Promise<EnsureResult> {
  const chapter = getChapter(id)
  if (!chapter) throw new Error('章节不存在')
  const libraryId = getChapterSource(id)!.libraryId
  if (chapter.kind === 'cfolder') {
    const page = getChapterPageFile(id, index)
    if (!page) throw new Error('页码越界')
    const path = join(
      webdavCacheDir(libraryId),
      `f-${id}`,
      `${String(index).padStart(5, '0')}-${sanitizeFileName(page.name)}`
    )
    await download(libraryId, page.file_id, path, page.size, signal)
    return { chapterId: id, path, kind: 'file', pageCount: chapter.page_count }
  }
  if (
    !(await isCompleteFile(chapter.path, chapter.size)) &&
    archiveKindOf(chapter.path) === 'zip'
  ) {
    try {
      const zip = await rangeZip(id)
      if (chapter.page_count !== zip.pageCount) {
        updateChapterPageCount(id, zip.pageCount)
        broadcast('chapter:pageCount', { chapterId: id, pageCount: zip.pageCount })
      }
      return {
        chapterId: id,
        path: chapter.path,
        kind: 'webdav-remotezip',
        pageCount: zip.pageCount,
        name: zip.listPages()[index]?.name
      }
    } catch {
      signal?.throwIfAborted()
    }
  }
  const path = await ensureWebDavLocalPath(id, signal)
  const count =
    chapter.kind === 'pdf'
      ? chapter.page_count
      : (await withDriver(path, false, (driver) => driver.listPages())).length
  if (count !== chapter.page_count) {
    updateChapterPageCount(id, count)
    broadcast('chapter:pageCount', { chapterId: id, pageCount: count })
  }
  return { chapterId: id, path, kind: chapter.kind, pageCount: count }
}
export async function readWebDavPage(result: EnsureResult, index: number): Promise<Buffer> {
  if (result.kind === 'file') return readFile(result.path)
  if (result.kind === 'webdav-remotezip') return (await rangeZip(result.chapterId)).readPage(index)
  return (await getDriver(result.path, false)).readPage(index)
}
