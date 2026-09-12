import { mkdir, rm, stat } from 'fs/promises'
import { join } from 'path'
import { app } from 'electron'
import sharp from 'sharp'
import { withDriver } from './archives'
import { removePageThumbs } from './pageThumb'
import { ensureChapterPage, readEnsuredPage } from './cloud189/ensure'
import { longPath } from './util/paths'

let thumbsDir: string

function getThumbsDir(): string {
  if (!thumbsDir) thumbsDir = join(app.getPath('userData'), 'thumbs')
  return thumbsDir
}

export function thumbPath(seriesId: number): string {
  return join(getThumbsDir(), `series-${seriesId}.webp`)
}

/** 提取某话第一页生成系列封面（400px WebP），返回缩略图绝对路径 */
export async function generateCover(
  seriesId: number,
  chapterPath: string,
  isDir: boolean
): Promise<string | null> {
  try {
    // withDriver（开即关）而非 getDriver（LRU 常驻）：封面批量生成时
    // 不把压缩包句柄和 RAR 整包 Buffer 长期留在缓存里推高 fd/内存峰值
    return await withDriver(chapterPath, isDir, async (driver): Promise<string | null> => {
      const pages = await driver.listPages()
      if (pages.length === 0) return null
      const buf = await driver.readPage(0)

      const dir = getThumbsDir()
      await mkdir(dir, { recursive: true })
      const out = thumbPath(seriesId)
      await sharp(buf)
        .resize(400, 560, { fit: 'cover', position: 'top', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(longPath(out))
      return out
    })
  } catch (err) {
    console.warn(`[thumb] 封面生成失败 series=${seriesId}:`, err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * 封面是否需要重建：封面不存在，或首章内容比封面新。
 * 只看「存在与否」会让改编章节后的封面永远停在被删掉的那一页。
 */
export async function coverStale(seriesId: number, chapterMtime: number): Promise<boolean> {
  try {
    const st = await stat(longPath(thumbPath(seriesId)))
    return chapterMtime > 0 && st.mtimeMs < chapterMtime
  } catch {
    return true
  }
}

/**
 * 删除系列产物：封面 + 各章节的页缩略图。
 * 仅在系列被彻底删除（而非「移出书架」标记隐藏）时调用。
 */
export async function removeSeriesArtifacts(
  seriesIds: number[],
  chapterIds: number[]
): Promise<void> {
  for (const seriesId of seriesIds) {
    await rm(longPath(thumbPath(seriesId)), { force: true }).catch(() => {})
  }
  await removePageThumbs(chapterIds)
}

/** 压缩包/PDF 类云端章节自动下整包生成封面的体积上限（超过则留待首次打开） */
const CLOUD_COVER_MAX_BYTES = 64 * 1024 * 1024

/**
 * 云端系列封面：取封面章节第 0 页（散图按页下载；压缩包/PDF 限体积整包下载后取首页）。
 * 返回缩略图路径，失败返回 null。
 */
export async function generateCloudCover(
  seriesId: number,
  chapter: { id: number; kind: string; size: number }
): Promise<string | null> {
  if (chapter.kind !== 'cfolder' && chapter.size > CLOUD_COVER_MAX_BYTES) return null
  try {
    const result = await ensureChapterPage(chapter.id, 0)
    const buf = await readEnsuredPage(result, 0)

    const dir = getThumbsDir()
    await mkdir(dir, { recursive: true })
    const out = thumbPath(seriesId)
    await sharp(buf)
      .resize(400, 560, { fit: 'cover', position: 'top', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(longPath(out))
    return out
  } catch (err) {
    console.warn(
      `[thumb] 云端封面生成失败 series=${seriesId}:`,
      err instanceof Error ? err.message : err
    )
    return null
  }
}
