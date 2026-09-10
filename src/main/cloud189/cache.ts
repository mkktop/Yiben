import { existsSync } from 'fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { createWriteStream } from 'fs'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { basename, dirname, join } from 'path'
import { cloudCacheDir, cloudDownloadUrl } from './client'
import { getSetting } from '../settings'
import { longPath } from '../util/paths'

interface CacheIndex {
  /** path → { size, at }，at 用于 LRU 淘汰 */
  [path: string]: { size: number; at: number }
}

/**
 * LRU 索引常驻内存：
 * 之前每次翻页都 loadIndex/saveIndex 整份读写 JSON，并发请求（双页 + 预加载）会互相覆盖，
 * 非原子写入还可能让下一次读取解析失败 → 索引被重置 → 容量上限静默失效。
 */
let indexCache: CacheIndex | null = null
let indexDirty = false
let flushChain: Promise<void> = Promise.resolve()

/** 同一目标的并发下载共用一个 promise，避免重复下载和写同一个文件 */
const inflight = new Map<string, Promise<string>>()

function indexPath(): string {
  return join(cloudCacheDir(), 'index.json')
}

async function loadIndex(): Promise<CacheIndex> {
  if (indexCache) return indexCache
  try {
    indexCache = JSON.parse(await readFile(longPath(indexPath()), 'utf-8')) as CacheIndex
  } catch {
    indexCache = {}
  }
  return indexCache
}

/** 串行 + 原子落盘（临时文件后 rename），避免读到写了一半的 JSON */
export function flushIndex(): Promise<void> {
  indexDirty = true
  flushChain = flushChain
    .then(async () => {
      if (!indexDirty || !indexCache) return
      indexDirty = false
      const dir = cloudCacheDir()
      await mkdir(longPath(dir), { recursive: true })
      const tmp = `${indexPath()}.tmp`
      await writeFile(longPath(tmp), JSON.stringify(indexCache), 'utf-8')
      await rename(longPath(tmp), longPath(indexPath()))
    })
    .catch(() => {})
  return flushChain
}

function touch(index: CacheIndex, path: string): void {
  const entry = index[path]
  if (entry) entry.at = Date.now()
}

/** 索引里删掉磁盘上已不存在的条目，避免幽灵体积占满配额 */
export async function pruneIndex(): Promise<void> {
  const index = await loadIndex()
  let changed = false
  for (const path of Object.keys(index)) {
    if (!existsSync(longPath(path))) {
      delete index[path]
      changed = true
    }
  }
  if (changed) await flushIndex()
}

/** 清空整个缓存目录后调用：丢弃内存索引 */
export function resetIndex(): void {
  indexCache = {}
  void flushIndex()
}

/** 容量上限（MB），可由设置调整 */
function capBytes(): number {
  return getSetting<number>('cloudCacheCapMb', 20 * 1024) * 1024 * 1024
}

/** 超限时按最久未访问淘汰，直到容量达标；正在下载的目标不参与淘汰 */
async function evict(index: CacheIndex, keepPath?: string): Promise<void> {
  const cap = capBytes()
  let total = Object.values(index).reduce((sum, entry) => sum + entry.size, 0)

  // 先丢掉磁盘上已经没了的条目
  for (const path of Object.keys(index)) {
    if (!existsSync(longPath(path))) {
      total -= index[path].size
      delete index[path]
    }
  }
  if (total <= cap) return

  const entries = Object.entries(index)
    .filter(([path]) => path !== keepPath && !inflight.has(path))
    .sort((a, b) => a[1].at - b[1].at)
  for (const [path, entry] of entries) {
    if (total <= cap) break
    try {
      await rm(longPath(path), { force: true })
      total -= entry.size
      delete index[path]
    } catch {
      /* ignore */
    }
  }
}

/** 已完整缓存则返回文件大小，否则 null；expectedSize 未知时以索引记录的大小为准 */
async function cachedSizeIfComplete(
  index: CacheIndex,
  destPath: string,
  expectedSize: number
): Promise<number | null> {
  try {
    const st = await stat(longPath(destPath))
    const recorded = index[destPath]
    const complete =
      expectedSize > 0 ? st.size === expectedSize : recorded !== undefined && recorded.size === st.size
    return complete ? st.size : null
  } catch {
    return null
  }
}

export interface DownloadProgress {
  fileId: string
  name: string
  loaded: number
  total: number
}

/**
 * 把云盘文件下载到本地缓存并返回缓存路径。
 * 已存在且大小吻合时直接复用；同一目标的并发调用共享同一次下载。
 */
export function ensureCached(
  fileId: string,
  familyId: string | undefined,
  destPath: string,
  expectedSize: number,
  onProgress?: (p: DownloadProgress) => void
): Promise<string> {
  const running = inflight.get(destPath)
  if (running) return running
  const task = download(fileId, familyId, destPath, expectedSize, onProgress).finally(() => {
    inflight.delete(destPath)
  })
  inflight.set(destPath, task)
  return task
}

async function download(
  fileId: string,
  familyId: string | undefined,
  destPath: string,
  expectedSize: number,
  onProgress?: (p: DownloadProgress) => void
): Promise<string> {
  const index = await loadIndex()
  touch(index, destPath)

  const cached = await cachedSizeIfComplete(index, destPath, expectedSize)
  if (cached !== null) {
    // 补登记：索引缺失时容量统计会漏算这个文件
    index[destPath] = { size: cached, at: Date.now() }
    await flushIndex()
    return destPath
  }

  await mkdir(longPath(dirname(destPath)), { recursive: true })

  const url = await cloudDownloadUrl(fileId, familyId)
  const resp = await fetch(url)
  if (!resp.ok || !resp.body) throw new Error(`云盘下载失败：HTTP ${resp.status}`)

  const total = Number(resp.headers.get('content-length') ?? expectedSize ?? 0)
  let loaded = 0
  const tmp = `${destPath}.part`
  try {
    await pipeline(
      Readable.fromWeb(resp.body),
      // 透传式统计进度；pipeline 负责背压，磁盘慢时不会把整个文件堆在内存里
      async function* (source: AsyncIterable<Buffer>) {
        for await (const chunk of source) {
          loaded += chunk.length
          onProgress?.({ fileId, name: basename(destPath), loaded, total })
          yield chunk
        }
      },
      createWriteStream(longPath(tmp))
    )
    // 下载完成才改名，残缺文件不会被当作缓存命中
    await rename(longPath(tmp), longPath(destPath))
  } catch (err) {
    await rm(longPath(tmp), { force: true }).catch(() => {})
    throw err
  }

  index[destPath] = { size: loaded, at: Date.now() }
  await evict(index, destPath)
  await flushIndex()
  return destPath
}

export async function cacheStats(): Promise<{ totalBytes: number; files: number }> {
  const root = cloudCacheDir()
  if (!existsSync(longPath(root))) return { totalBytes: 0, files: 0 }
  let totalBytes = 0
  let files = 0
  // 异步遍历：同步递归 statSync 在上万文件时会把主进程卡住（设置页明显掉帧）
  const walk = async (dir: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(longPath(dir), { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(path)
        continue
      }
      if (entry.name === 'index.json' || entry.name.endsWith('.tmp') || entry.name.endsWith('.part')) {
        continue
      }
      try {
        totalBytes += (await stat(longPath(path))).size
        files++
      } catch {
        /* ignore */
      }
    }
  }
  await walk(root)
  return { totalBytes, files }
}
