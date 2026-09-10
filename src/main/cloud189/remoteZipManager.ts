import { RemoteZip } from '../archives/remoteZip'
import { rangeFetch } from '../archives/remoteZip'
import { cloudDownloadUrl } from './client'

/**
 * 按章节缓存 RemoteZip 实例（含已解析的中央目录）。
 * 容量小即可：一个实例只有目录表；直链过期时实例内部会经 refresh 换新链接，
 * 淘汰只是为了章节切换频繁时少解析几次目录。
 */
const MAX_INSTANCES = 8
const cache = new Map<number, RemoteZip>()

export async function getRemoteZip(
  chapterId: number,
  fileId: string,
  familyId: string | undefined,
  expectedSize: number
): Promise<RemoteZip> {
  const hit = cache.get(chapterId)
  if (hit) {
    // Map 按插入序淘汰，重新插入实现 LRU touch
    cache.delete(chapterId)
    cache.set(chapterId, hit)
    return hit
  }

  // fetchRange 每次调用都读当前 url：refresh() 重新赋值后，后续读取自动用新直链
  let url = await cloudDownloadUrl(fileId, familyId)
  const zip = await RemoteZip.create(
    expectedSize,
    (start, end) => rangeFetch(url, start, end),
    async () => {
      url = await cloudDownloadUrl(fileId, familyId)
    }
  )
  cache.set(chapterId, zip)
  while (cache.size > MAX_INSTANCES) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    const evicted = cache.get(oldest)
    cache.delete(oldest)
    void evicted?.close().catch(() => {})
  }
  return zip
}

export function dropRemoteZip(chapterId: number): void {
  const zip = cache.get(chapterId)
  if (zip) {
    cache.delete(chapterId)
    void zip.close().catch(() => {})
  }
}
