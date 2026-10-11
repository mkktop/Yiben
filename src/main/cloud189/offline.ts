import { stat } from 'fs/promises'
import { dirname, isAbsolute, join, relative } from 'path'
import { chaptersBySeries, cloudChapterRows, getChapterPageFile, getSeries } from '../db'
import { getSetting, setSetting } from '../settings'
import { cloudCacheRoots } from './cache'
import { longPath, sanitizeFileName } from '../util/paths'
import type { OfflineStatus } from '../../shared/types'

export function cacheArtifacts(seriesId: number): string[] {
  return cloudChapterRows()
    .filter((row) => row.seriesId === seriesId)
    .flatMap((row) => {
      const path = row.kind === 'cfolder' ? join(dirname(row.path), `f-${row.chapterId}`) : row.path
      return cloudCacheRoots().some((root) => {
        const rel = relative(root, path)
        return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
      })
        ? [path]
        : []
    })
}

export function setOfflinePinned(seriesId: number, pinned: boolean): void {
  if (!getSeries(seriesId)) throw new Error('系列不存在')
  const ids = new Set(getSetting<number[]>('offlinePinnedSeries', []))
  if (pinned) ids.add(seriesId)
  else ids.delete(seriesId)
  if (pinned) {
    const required = [...ids].reduce((sum, id) => sum + estimatedBytes(id), 0)
    if (required > getSetting<number>('cloudCacheCapMb', 20 * 1024) * 1024 * 1024)
      throw new Error('已保护内容与当前系列总大小超过缓存上限，请解除其他系列保护或提高容量')
  }
  setSetting('offlinePinnedSeries', [...ids])
  setSetting('offlinePinPaths', [...ids].flatMap(cacheArtifacts))
}

function estimatedBytes(seriesId: number): number {
  return chaptersBySeries(seriesId).reduce((sum, chapter) => {
    if (chapter.kind !== 'cfolder') return sum + chapter.size
    for (let index = 0; index < chapter.page_count; index++)
      sum += getChapterPageFile(chapter.id, index)?.size ?? 0
    return sum
  }, 0)
}

/** 从实际文件核验，重启或手动删除缓存后不会保留虚假的完成状态。 */
export async function offlineStatus(seriesId: number): Promise<OfflineStatus> {
  const chapters = chaptersBySeries(seriesId)
  const rows = cloudChapterRows().filter((row) => row.seriesId === seriesId)
  const byChapter = new Map(rows.map((row) => [row.chapterId, row]))
  let bytes = 0
  let requiredBytes = 0
  let complete = 0
  const missing: string[] = []
  for (const chapter of chapters) {
    const row = byChapter.get(chapter.id)
    if (!row) continue
    let ok = true
    const files: Array<{ path: string; size: number }> = []
    if (chapter.kind === 'cfolder') {
      if (chapter.page_count <= 0) ok = false
      for (let index = 0; index < chapter.page_count; index++) {
        const page = getChapterPageFile(chapter.id, index)
        if (!page) {
          ok = false
          continue
        }
        files.push({
          path: join(
            dirname(row.path),
            `f-${chapter.id}`,
            `${String(index).padStart(5, '0')}-${sanitizeFileName(page.name)}`
          ),
          size: page.size
        })
      }
    } else files.push({ path: chapter.path, size: chapter.size })
    for (const file of files) {
      requiredBytes += file.size
      const info = await stat(longPath(file.path)).catch(() => null)
      if (!info?.isFile() || (file.size > 0 ? info.size !== file.size : info.size <= 0)) ok = false
      if (info?.isFile()) bytes += info.size
    }
    if (ok) complete++
    else missing.push(chapter.title)
  }
  const cap = getSetting<number>('cloudCacheCapMb', 20 * 1024) * 1024 * 1024
  return {
    seriesId,
    total: rows.length,
    complete,
    bytes,
    requiredBytes,
    missing,
    pinned: getSetting<number[]>('offlinePinnedSeries', []).includes(seriesId),
    capacityExceeded: requiredBytes > cap
  }
}
