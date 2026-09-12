import { stat } from 'fs/promises'
import { archiveKindOf, extOf, longPath } from '../util/paths'
import type { ArchiveDriver, DriverKind } from './types'
import { FolderDriver, ZipDriver } from './zip'
import { RarDriver } from './rar'
import { SevenZipDriver } from './sevenzip'
import { EpubDriver } from './epub'
import { UnsupportedFormatError } from './types'
import { sniffArchiveKind } from './sniff'

export * from './types'
export { sniffArchiveKind } from './sniff'

async function resolveKind(path: string, isDir: boolean): Promise<DriverKind | null> {
  if (isDir) return 'folder'
  const extKind = archiveKindOf(path) as DriverKind | null
  if (!extKind) return null
  return sniffArchiveKind(path, extKind)
}

async function open(path: string, kind: DriverKind): Promise<ArchiveDriver> {
  switch (kind) {
    case 'folder':
      return FolderDriver.create(path)
    case 'zip':
      return ZipDriver.create(path)
    case 'rar':
      return RarDriver.create(path)
    case 'epub':
      return EpubDriver.create(path)
    case '7z':
    case 'tar':
      return SevenZipDriver.create(path)
    case 'pdf':
      throw new UnsupportedFormatError('pdf')
    default:
      throw new UnsupportedFormatError(String(kind))
  }
}

/**
 * 驱动实例缓存（LRU）：yiben:// 协议的每次请求相互独立，
 * 靠这里避免重复打开压缩包。超限时关闭最久未用的驱动。
 * RAR/7Z 单实例要整包读内存（RAR 尤甚），设更小的同类上限控制内存峰值。
 */
const CACHE_MAX = 6
const CACHE_MAX_BY_KIND: Partial<Record<DriverKind, number>> = { rar: 2, '7z': 4, epub: 4 }
const cache = new Map<string, { driver: ArchiveDriver; stamp: number }>()
let clock = 0

export async function getDriver(path: string, isDir: boolean): Promise<ArchiveDriver> {
  const kind = await resolveKind(path, isDir)
  if (!kind) throw new UnsupportedFormatError(extOf(path) || 'unknown')

  let stamp = 0
  if (kind !== 'folder') {
    try {
      stamp = (await stat(longPath(path))).mtimeMs
    } catch {
      /* 文件可能已被移动/删除，仍尝试按原样打开 */
    }
  }

  const key = `${kind}|${path}|${stamp}`
  const hit = cache.get(key)
  if (hit) {
    hit.stamp = ++clock
    return hit.driver
  }

  const driver = await open(path, kind)
  cache.set(key, { driver, stamp: ++clock })

  // 同类上限：先淘汰超出该类型配额的最旧实例（RAR 常驻 6 个大包就是数 GB 内存）
  const kindLimit = CACHE_MAX_BY_KIND[kind]
  if (kindLimit !== undefined) {
    const prefix = `${kind}|`
    const sameKind = [...cache.entries()].filter(([k]) => k.startsWith(prefix))
    if (sameKind.length > kindLimit) {
      sameKind.sort((a, b) => a[1].stamp - b[1].stamp)
      for (const [k, v] of sameKind.slice(0, sameKind.length - kindLimit)) {
        cache.delete(k)
        void v.driver.close().catch(() => {})
      }
    }
  }

  if (cache.size > CACHE_MAX) {
    let oldestKey: string | null = null
    let oldest = Infinity
    for (const [k, v] of cache) {
      if (v.stamp < oldest) {
        oldest = v.stamp
        oldestKey = k
      }
    }
    if (oldestKey) {
      const evicted = cache.get(oldestKey)
      cache.delete(oldestKey)
      void evicted?.driver.close().catch(() => {})
    }
  }
  return driver
}

/** 仅用于列出页数（扫描），用完即关 */
export async function withDriver<T>(
  path: string,
  isDir: boolean,
  fn: (driver: ArchiveDriver) => Promise<T>
): Promise<T> {
  const driver = await open(path, (await resolveKind(path, isDir)) as DriverKind)
  try {
    return await fn(driver)
  } finally {
    await driver.close().catch(() => {})
  }
}
