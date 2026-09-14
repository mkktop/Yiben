import { readFile } from 'fs/promises'
import { protocol } from 'electron'
import { coverChapterFor, getChapter, getChapterSource } from './db'
import { getDriver, MAX_ARCHIVE_ENTRY_BYTES, UnsupportedFormatError } from './archives'
import { longPath, mimeOfImage } from './util/paths'
import { thumbPath, generateCloudCover } from './thumbnail'
import { buildPageThumb, pageThumbPath } from './pageThumb'
import { ensureChapterPage, ensureLocalChapterPath, readEnsuredPage } from './cloud189/ensure'

/**
 * 协议响应 CSP：内容只作为图片/文件消费，禁止一切脚本执行——
 * 恶意归档里的 SVG 等活动内容即使被顶层导航加载也无法在特权 origin 跑脚本
 */
const CSP = "default-src 'none'; style-src 'unsafe-inline'"

/**
 * yiben:// 自定义协议：
 *   yiben://thumb/{seriesId}               → 系列封面（WebP）
 *   yiben://page/{chapterId}/{index}       → 某话第 index 页原图
 *   yiben://page-thumb/{chapterId}/{index} → 某话第 index 页缩略图（缩略图条用，省流量）
 *   yiben://file/{chapterId}               → 整包原始字节（PDF 等）
 * 用 <img> 直接加载，吃满 Chromium 解码缓存，翻页零拷贝。
 */
export function registerProtocol(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'yiben', privileges: { standard: true, secure: true, supportFetchAPI: true } }
  ])
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

/**
 * 取某话第 index 页的原始字节：云端章节按需下载（散图按页、压缩包整包），本地章节走驱动解包。
 * 供 page 与 page-thumb 两条路由共用。
 * 同一页的并发请求共享一次读取（双页模式 + 缩略图条 + 预加载会同时打到同一页）。
 */
const pageInflight = new Map<string, Promise<{ buf: Buffer; name: string }>>()

function readChapterPageDedup(
  chapterId: number,
  index: number
): Promise<{ buf: Buffer; name: string }> {
  const key = `${chapterId}/${index}`
  const running = pageInflight.get(key)
  if (running) return running
  const task = readChapterPage(chapterId, index).finally(() => pageInflight.delete(key))
  pageInflight.set(key, task)
  return task
}

async function readChapterPage(
  chapterId: number,
  index: number
): Promise<{ buf: Buffer; name: string }> {
  const chapter = getChapter(chapterId)
  if (!chapter) throw new HttpError(404, 'chapter not found')

  // 云盘章节：按需下载（散图按页、压缩包整包/远程直读），分派在 ensure 层按书库类型走
  if (chapter.kind === 'cfolder' || chapter.cloud_file_id) {
    const result = await ensureChapterPage(chapterId, index)
    return { buf: await readEnsuredPage(result, index), name: result.name ?? result.path }
  }

  const driver = await getDriver(chapter.path, chapter.kind === 'folder')
  const buf = await driver.readPage(index)
  // 解压上限的最终防线：各驱动已按声明尺寸拦截，这里兜住谎报尺寸的实际产出
  if (buf.length > MAX_ARCHIVE_ENTRY_BYTES) {
    throw new HttpError(415, `页面过大（${buf.length} 字节）`)
  }
  const pages = await driver.listPages()
  return { buf, name: pages[index]?.name ?? 'page.jpg' }
}

export function attachProtocolHandlers(): void {
  protocol.handle('yiben', async (request) => {
    try {
      const url = new URL(request.url)
      // standard 协议下 yiben://page/3/0 → hostname=page, pathname=/3/0
      const kind = url.hostname
      const segments = url.pathname.split('/').filter(Boolean)

      if (kind === 'thumb') {
        const seriesId = Number(segments[0])
        const file = thumbPath(seriesId)
        try {
          const buf = await readFile(longPath(file))
          return new Response(new Uint8Array(buf), {
            headers: {
              'content-type': 'image/webp',
              'cache-control': 'max-age=3600',
              'content-security-policy': CSP
            }
          })
        } catch {
          // 本地无缩略图：云端系列按需下载首页生成
          const chapter = coverChapterFor(seriesId)
          if (!chapter) return new Response('no cover', { status: 404 })
          const src = getChapterSource(chapter.id)
          if (!src || src.libraryKind === 'local') return new Response('not found', { status: 404 })
          await generateCloudCover(seriesId, chapter)
          const buf = await readFile(longPath(file)).catch(() => null)
          if (!buf) return new Response('cover not ready', { status: 503 })
          return new Response(new Uint8Array(buf), {
            headers: {
              'content-type': 'image/webp',
              'cache-control': 'max-age=3600',
              'content-security-policy': CSP
            }
          })
        }
      }

      if (kind === 'page') {
        const { buf, name } = await readChapterPageDedup(Number(segments[0]), Number(segments[1]))
        return new Response(new Uint8Array(buf), {
          headers: {
            'content-type': mimeOfImage(name),
            'cache-control': 'max-age=86400',
            'content-security-policy': CSP
          }
        })
      }

      if (kind === 'page-thumb') {
        const chapterId = Number(segments[0])
        const index = Number(segments[1])
        const file = pageThumbPath(chapterId, index)
        let buf = await readFile(longPath(file)).catch(() => null)
        if (!buf) {
          // 首次请求：取原图后缩小落盘，之后直接命中缓存
          const page = await readChapterPageDedup(chapterId, index)
          await buildPageThumb(page.buf, chapterId, index)
          buf = await readFile(longPath(file))
        }
        return new Response(new Uint8Array(buf), {
          headers: {
            'content-type': 'image/webp',
            'cache-control': 'max-age=86400',
            'content-security-policy': CSP
          }
        })
      }

      if (kind === 'file') {
        // 原始文件流（PDF 渲染等场景）；云端章节先确保整包已缓存
        const chapterId = Number(segments[0])
        const chapter = getChapter(chapterId)
        if (!chapter) return new Response('chapter not found', { status: 404 })
        let path = chapter.path
        if (chapter.cloud_file_id || chapter.kind === 'cfolder') {
          path = await ensureLocalChapterPath(chapterId)
        }
        const buf = await readFile(longPath(path))
        return new Response(new Uint8Array(buf), {
          headers: {
            'content-type': chapter.kind === 'pdf' ? 'application/pdf' : 'application/octet-stream',
            'cache-control': 'max-age=86400',
            'content-security-policy': CSP
          }
        })
      }

      return new Response('bad request', { status: 400 })
    } catch (err) {
      const status =
        err instanceof HttpError ? err.status : err instanceof UnsupportedFormatError ? 415 : 502
      console.warn('[protocol]', request.url, err instanceof Error ? err.message : err)
      return new Response(status === 404 ? 'not found' : 'request failed', { status })
    }
  })
}
