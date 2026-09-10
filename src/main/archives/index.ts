import { stat } from 'fs/promises'
import { archiveKindOf, extOf, longPath } from '../util/paths'
import type { ArchiveDriver, DriverKind } from './types'
import { FolderDriver, ZipDriver } from './zip'
import { RarDriver } from './rar'
import { SevenZipDriver } from './sevenzip'
import { UnsupportedFormatError } from './types'

export * from './types'

function kindOf(path: string, isDir: boolean): DriverKind | null {
  if (isDir) return 'folder'
  return archiveKindOf(path) as DriverKind | null
}

async function open(path: string, kind: DriverKind): Promise<ArchiveDriver> {
  switch (kind) {
    case 'folder':
      return FolderDriver.create(path)
    case 'zip':
      return ZipDriver.create(path)
    case 'rar':
      return RarDriver.create(path)
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
 */
const CACHE_MAX = 6
const cache = new Map<string, { driver: ArchiveDriver; stamp: number }>()
let clock = 0

export async function getDriver(path: string, isDir: boolean): Promise<ArchiveDriver> {
  const kind = kindOf(path, isDir)
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
  const driver = await open(path, kindOf(path, isDir) as DriverKind)
  try {
    return await fn(driver)
  } finally {
    await driver.close().catch(() => {})
  }
}
