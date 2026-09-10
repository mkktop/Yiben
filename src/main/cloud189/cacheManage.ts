import { isAbsolute, join, relative } from 'path'
import { mkdir, readdir, rm, stat } from 'fs/promises'
import { cloudChapterRows, type CloudChapterCacheRow } from '../db'
import { cloudCacheDir } from './client'
import { pruneIndex, resetIndex } from './cache'
import { longPath } from '../util/paths'

export interface SeriesCache {
  seriesId: number
  title: string
  bytes: number
}

/** 单文件或整目录递归求大小；不存在返回 0。
 *  异步实现：同步 statSync 递归在上万文件时会把主进程卡住。 */
async function pathSize(p: string): Promise<number> {
  let st
  try {
    st = await stat(longPath(p))
  } catch {
    return 0
  }
  if (!st.isDirectory()) return st.size

  let names: string[]
  try {
    names = await readdir(longPath(p))
  } catch {
    return 0
  }
  let total = 0
  for (const name of names) total += await pathSize(join(p, name))
  return total
}

/** 路径是否在缓存目录内（斜杠方向差异由 relative 归一化处理） */
function insideCache(p: string): boolean {
  const r = relative(cloudCacheDir(), p)
  return r !== '' && !r.startsWith('..') && !isAbsolute(r)
}

/** 章节对应的缓存产物：散图=页目录，压缩包/PDF=整包文件 */
function artifactsOf(row: CloudChapterCacheRow): string[] {
  if (row.kind === 'cfolder') return [join(cloudCacheDir(), `f-${row.chapterId}`)]
  if (row.cloudFileId && insideCache(row.path)) return [row.path]
  return []
}

/** 各系列的缓存占用（按大小降序，不含 0 字节的系列） */
export async function seriesCacheSizes(): Promise<SeriesCache[]> {
  const byId = new Map<number, SeriesCache>()
  for (const row of cloudChapterRows()) {
    let entry = byId.get(row.seriesId)
    if (!entry) {
      entry = { seriesId: row.seriesId, title: row.seriesTitle, bytes: 0 }
      byId.set(row.seriesId, entry)
    }
    for (const path of artifactsOf(row)) entry.bytes += await pathSize(path)
  }
  return [...byId.values()].filter((e) => e.bytes > 0).sort((a, b) => b.bytes - a.bytes)
}

/** 删除某系列的全部缓存，返回清掉的字节数（封面缩略图不受影响） */
export async function clearSeriesCache(seriesId: number): Promise<number> {
  let cleared = 0
  for (const row of cloudChapterRows()) {
    if (row.seriesId !== seriesId) continue
    for (const path of artifactsOf(row)) {
      cleared += await pathSize(path)
      await rm(longPath(path), { recursive: true, force: true }).catch(() => {})
    }
  }
  await pruneIndex()
  return cleared
}

/** 清空整个云端缓存目录，返回清掉的字节数 */
export async function clearAllCache(): Promise<number> {
  const dir = cloudCacheDir()
  const cleared = await pathSize(dir)
  await rm(longPath(dir), { recursive: true, force: true }).catch(() => {})
  await mkdir(longPath(dir), { recursive: true })
  resetIndex()
  return cleared
}

/** 删除书库前调用：清掉该库全部章节的缓存产物，返回清掉的字节数 */
export async function clearLibraryCache(libraryId: number): Promise<number> {
  let cleared = 0
  for (const row of cloudChapterRows()) {
    if (row.libraryId !== libraryId) continue
    for (const path of artifactsOf(row)) {
      cleared += await pathSize(path)
      await rm(longPath(path), { recursive: true, force: true }).catch(() => {})
    }
  }
  await pruneIndex()
  return cleared
}
