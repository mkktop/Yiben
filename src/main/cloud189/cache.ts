import { existsSync } from 'fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { createWriteStream } from 'fs'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { basename, dirname, join, relative, isAbsolute } from 'path'
import { cloudCacheDir, cloudDownloadUrl, noteCloudError } from './client'
import { cloud115CacheDir } from '../cloud115/client'
import { webdavCacheRoot } from '../webdav/client'
import { getSetting } from '../settings'
import { cloudChapterRows } from '../db'
import { longPath } from '../util/paths'
import { backoffDelay, sleep } from '../util/backoff'
import { waitWithAbort } from '../util/abort'

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
let indexLoading: Promise<CacheIndex> | null = null
let indexDirty = false
let flushChain: Promise<void> = Promise.resolve()

/** 同一目标的并发下载共用一个 promise，避免重复下载和写同一个文件 */
const inflight = new Map<string, Promise<string>>()
const controllers = new Map<string, AbortController>()
let maintenance = false
let maintenanceChain: Promise<unknown> = Promise.resolve()
let commitChain: Promise<unknown> = Promise.resolve()
class CacheQuotaError extends Error {}
export function cacheMaintenanceActive(): boolean {
  return maintenance
}

/** 清理期间阻止新下载，并中止、等待所有在途写入后才允许删文件。 */
export function withCacheMaintenance<T>(fn: () => Promise<T>): Promise<T> {
  const task = maintenanceChain.then(async () => {
    maintenance = true
    try {
      for (const controller of controllers.values())
        controller.abort(new Error('下载已取消：缓存清理'))
      await Promise.allSettled([...inflight.values()])
      await flushChain
      return await fn()
    } finally {
      maintenance = false
    }
  })
  maintenanceChain = task.catch(() => {})
  return task
}

function protectedPaths(): string[] {
  const pinned = new Set(getSetting<number[]>('offlinePinnedSeries', []))
  // 从当前章节归属重新计算：保护之后的增量扫描、系列合并也要覆盖新增文件。
  return cloudChapterRows()
    .filter((row) => pinned.has(row.seriesId))
    .map((row) =>
      row.kind === 'cfolder' ? join(dirname(row.path), `f-${row.chapterId}`) : row.path
    )
    .filter((path) =>
      cloudCacheRoots().some((root) => {
        const rel = relative(root, path)
        return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
      })
    )
}

function protectedPath(path: string, roots: string[]): boolean {
  return roots.some((root) => {
    const rel = relative(root, path)
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  })
}

/** 全局并发下载上限：快速翻页/预取时不会同时开几十条连接挤爆带宽（与预载前向窗口 5 页对齐） */
const MAX_CONCURRENT_DOWNLOADS = 5
let activeDownloads = 0
const downloadQueue: Array<() => void> = []

/** 连接建立后持续无数据（静默挂起/代理黑洞）多久判定为死连接：3 条同时挂死会占死全部下载槽 */
const DOWNLOAD_IDLE_TIMEOUT_MS = 30_000

async function withDownloadSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeDownloads >= MAX_CONCURRENT_DOWNLOADS) {
    await new Promise<void>((resolve) => downloadQueue.push(resolve))
  } else {
    activeDownloads++
  }
  try {
    return await fn()
  } finally {
    activeDownloads--
    const next = downloadQueue.shift()
    if (next) {
      activeDownloads++
      next()
    }
  }
}

function indexPath(): string {
  return join(cloudCacheDir(), 'index.json')
}

async function loadIndex(): Promise<CacheIndex> {
  if (indexCache) return indexCache
  indexLoading ??= (async () => {
    try {
      indexCache = JSON.parse(await readFile(longPath(indexPath()), 'utf-8')) as CacheIndex
    } catch {
      indexCache = {}
    }
    return indexCache
  })().finally(() => {
    indexLoading = null
  })
  return indexLoading
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
export function resetIndex(): Promise<void> {
  indexCache = {}
  return flushIndex()
}

/** 容量上限（MB），可由设置调整 */
function capBytes(): number {
  return getSetting<number>('cloudCacheCapMb', 20 * 1024) * 1024 * 1024
}

/** 超限时按最久未访问淘汰，直到容量达标；正在下载的目标不参与淘汰。
 *  幽灵条目（磁盘上已不存在）只在确实需要淘汰时才顺带清理——本函数在每次
 *  下载完成后都会被调用，对全量索引做同步 existsSync 扫描在大缓存时会卡主进程 */
async function evict(index: CacheIndex, keepPath?: string): Promise<void> {
  const cap = capBytes()
  const total = Object.values(index).reduce((sum, entry) => sum + entry.size, 0)
  if (total <= cap) return

  // 先丢掉磁盘上已经没了的条目（虚高的记录体积可能正是超限的原因），再重新判定
  let real = total
  for (const path of Object.keys(index)) {
    if (!existsSync(longPath(path))) {
      real -= index[path].size
      delete index[path]
    }
  }
  if (real <= cap) return

  const roots = protectedPaths()
  const entries = Object.entries(index)
    .filter(([path]) => path !== keepPath && !inflight.has(path) && !protectedPath(path, roots))
    .sort((a, b) => a[1].at - b[1].at)
  for (const [path, entry] of entries) {
    if (real <= cap) break
    try {
      await rm(longPath(path), { force: true })
      real -= entry.size
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
      expectedSize > 0
        ? st.size === expectedSize
        : recorded !== undefined && recorded.size === st.size
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

/** 预取/外部取消路径的报错形态：fetch 的 abort reason 或重试链里的取消再抛 */
function isCancelledError(err: unknown): boolean {
  if (err instanceof Error && err.name === 'AbortError') return true
  return err instanceof Error && /已取消|aborted?/i.test(err.message)
}

/**
 * 把云盘文件下载到本地缓存并返回缓存路径。
 * 已存在且大小吻合时直接复用；同一目标的并发调用共享同一次下载。
 * signal 用于外部取消（离线预取的中止），触发后进行中的下载立即中断。
 * resolveUrl 由各网盘提供（直链有时效，重试时每次重新取）；缺省为天翼直链。
 */
export async function ensureCached(
  fileId: string,
  familyId: string | undefined,
  destPath: string,
  expectedSize: number,
  onProgress?: (p: DownloadProgress) => void,
  signal?: AbortSignal,
  resolveUrl?: (fileId: string) => Promise<string>,
  requestHeaders?: Record<string, string>
): Promise<string> {
  if (maintenance) throw new Error('缓存正在清理，请稍后重试')
  signal?.throwIfAborted()
  const resolve = resolveUrl ?? ((id: string) => cloudDownloadUrl(id, familyId))
  const running = inflight.get(destPath)
  if (running) {
    if (signal) return waitWithAbort(running, signal)
    // 前台（无取消信号）搭车预取发起的下载：预取被取消会连带中断这次下载，
    // 阅读中的页不该跟着挂——取消类错误自行重新发起
    try {
      return await running
    } catch (err) {
      if (!isCancelledError(err)) throw err
    }
  }
  if (maintenance) throw new Error('缓存正在清理，请稍后重试')
  signal?.throwIfAborted()
  const controller = new AbortController()
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
  controllers.set(destPath, controller)
  const task = download(
    fileId,
    resolve,
    destPath,
    expectedSize,
    onProgress,
    combined,
    requestHeaders
  ).finally(() => {
    inflight.delete(destPath)
    controllers.delete(destPath)
  })
  inflight.set(destPath, task)
  return task
}

async function download(
  fileId: string,
  resolveUrl: (fileId: string) => Promise<string>,
  destPath: string,
  expectedSize: number,
  onProgress?: (p: DownloadProgress) => void,
  signal?: AbortSignal,
  requestHeaders?: Record<string, string>
): Promise<string> {
  const index = await loadIndex()
  signal?.throwIfAborted()
  touch(index, destPath)

  const cached = await cachedSizeIfComplete(index, destPath, expectedSize)
  if (cached !== null) {
    // 补登记：索引缺失时容量统计会漏算这个文件
    index[destPath] = { size: cached, at: Date.now() }
    await flushIndex()
    return destPath
  }

  await mkdir(longPath(dirname(destPath)), { recursive: true })

  let loaded = 0
  await withDownloadSlot(async () => {
    // 瞬时失败（网络抖动/直链中途失效/空闲超时）按指数退避重试；会话失效交给 UI 引导
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted()
      // 空闲看门狗：连接建立或读流期间持续 30s 收不到数据就中断本次尝试。
      // fetch 的 signal 在响应头返回后仍然管着 body 流，所以能覆盖整个传输过程；
      // 每收到一个 chunk 就续期，慢速但活跃的连接不会被误杀。
      const ctrl = new AbortController()
      let idleTimer: ReturnType<typeof setTimeout> | null = null
      const armIdle = (): void => {
        if (idleTimer) clearTimeout(idleTimer)
        idleTimer = setTimeout(() => {
          ctrl.abort(
            new Error(`云盘下载连接空闲超时（${DOWNLOAD_IDLE_TIMEOUT_MS / 1000}s 无数据）`)
          )
        }, DOWNLOAD_IDLE_TIMEOUT_MS)
      }
      const onAbort = (): void => ctrl.abort(new Error('下载已取消'))
      if (signal) {
        if (signal.aborted) onAbort()
        else signal.addEventListener('abort', onAbort, { once: true })
      }
      try {
        armIdle()
        const url = await waitWithAbort(resolveUrl(fileId), ctrl.signal)
        signal?.throwIfAborted()
        const resp = await fetch(url, {
          signal: ctrl.signal,
          headers: requestHeaders,
          ...(requestHeaders ? { redirect: 'error' as const } : {})
        })
        if (!resp.ok || !resp.body) {
          const err = new Error(`云盘下载失败：HTTP ${resp.status}`)
          await resp.body?.cancel()
          throw err
        }

        const total = Number(resp.headers.get('content-length') ?? expectedSize ?? 0)
        const tmp = `${destPath}.part`
        try {
          await pipeline(
            Readable.fromWeb(resp.body),
            // 透传式统计进度；pipeline 负责背压，磁盘慢时不会把整个文件堆在内存里
            async function* (source: AsyncIterable<Buffer>) {
              for await (const chunk of source) {
                armIdle()
                loaded += chunk.length
                onProgress?.({ fileId, name: basename(destPath), loaded, total })
                yield chunk
              }
            },
            createWriteStream(longPath(tmp))
          )
          // 完整性校验：响应被静默截断时不能当成完整缓存落盘，
          // 否则 cachedSizeIfComplete 会永久命中这份毒化缓存
          if (total > 0 && loaded !== total) {
            throw new Error(`下载不完整：${loaded}/${total} 字节`)
          }
          if (expectedSize > 0 && loaded !== expectedSize)
            throw new Error(`文件大小与扫描记录不符：${loaded}/${expectedSize} 字节，请重新扫描`)
          // 下载完成才改名，残缺文件不会被当作缓存命中
          signal?.throwIfAborted()
          const commit = commitChain.then(async () => {
            signal?.throwIfAborted()
            const fresh = await loadIndex()
            const roots = protectedPaths()
            const pinnedBytes = Object.entries(fresh).reduce(
              (sum, [path, entry]) =>
                sum +
                (path !== destPath && protectedPath(path, roots) && existsSync(longPath(path))
                  ? entry.size
                  : 0),
              0
            )
            if (protectedPath(destPath, roots) && pinnedBytes + loaded > capBytes())
              throw new CacheQuotaError('离线保护内容超过缓存容量，请提高容量或解除其他系列保护')
            await rename(longPath(tmp), longPath(destPath))
            fresh[destPath] = { size: loaded, at: Date.now() }
            await evict(fresh, destPath)
            await flushIndex()
          })
          commitChain = commit.catch(() => {})
          await commit
          return
        } catch (err) {
          await rm(longPath(tmp), { force: true }).catch(() => {})
          if (signal?.aborted || err instanceof CacheQuotaError) throw err
          if (noteCloudError(err) === 'session' || attempt >= 2) throw err
          loaded = 0
          await sleep(backoffDelay(attempt), signal)
        }
      } catch (err) {
        if (
          signal?.aborted ||
          err instanceof CacheQuotaError ||
          noteCloudError(err) === 'session' ||
          attempt >= 2
        )
          throw err
        loaded = 0
        await sleep(backoffDelay(attempt), signal)
      } finally {
        if (idleTimer) clearTimeout(idleTimer)
        if (signal) signal.removeEventListener('abort', onAbort)
      }
    }
  })

  return destPath
}

/** 云端缓存根目录（天翼 + 115，共用一套容量上限与 LRU 索引） */
export function cloudCacheRoots(): string[] {
  return [cloudCacheDir(), cloud115CacheDir(), webdavCacheRoot()]
}

/** 启动清扫崩溃/强杀残留的半成品文件（cacheStats 与 evict 都看不见它们） */
export async function cleanupPartFiles(): Promise<void> {
  for (const root of cloudCacheRoots()) {
    if (!existsSync(longPath(root))) continue
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
        if (entry.name.endsWith('.part')) {
          await rm(longPath(path), { force: true }).catch(() => {})
        }
      }
    }
    await walk(root)
  }
}

export async function cacheStats(): Promise<{ totalBytes: number; files: number }> {
  let totalBytes = 0
  let files = 0
  for (const root of cloudCacheRoots()) {
    if (!existsSync(longPath(root))) continue
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
        if (
          entry.name === 'index.json' ||
          entry.name.endsWith('.tmp') ||
          entry.name.endsWith('.part')
        ) {
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
  }
  return { totalBytes, files }
}
