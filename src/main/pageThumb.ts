import { mkdir, readdir, rename, rm, stat, unlink } from 'fs/promises'
import { join } from 'path'
import { app } from 'electron'
import sharp from 'sharp'
import { longPath } from './util/paths'

/** 缩略图宽度：阅读器缩略图条按约 80px 高展示，240 宽在 2x 屏上依然清晰 */
const THUMB_WIDTH = 240
/** 页缩略图目录总容量上限，超出后按最久未写入淘汰 */
const MAX_BYTES = 256 * 1024 * 1024
/** 每生成多少张做一次容量检查（避免每次构建都全目录遍历） */
const PRUNE_EVERY = 64

let root: string
let built = 0

function pagesRoot(): string {
  if (!root) root = join(app.getPath('userData'), 'thumbs', 'pages')
  return root
}

export function pageThumbDir(chapterId: number): string {
  return join(pagesRoot(), String(chapterId))
}

export function pageThumbPath(chapterId: number, index: number): string {
  return join(pageThumbDir(chapterId), `${index}.webp`)
}

/**
 * 由原图字节生成页缩略图并落盘（先写临时文件再改名，避免残缺文件被当成缓存命中）。
 * 返回可读路径。
 */
export async function buildPageThumb(
  src: Buffer,
  chapterId: number,
  index: number
): Promise<string> {
  const dir = pageThumbDir(chapterId)
  await mkdir(longPath(dir), { recursive: true })
  const out = pageThumbPath(chapterId, index)
  const tmp = `${out}.part.webp`
  await sharp(src)
    .resize(THUMB_WIDTH, null, { withoutEnlargement: true })
    .webp({ quality: 70 })
    .toFile(longPath(tmp))
  await rename(longPath(tmp), longPath(out))

  if (++built >= PRUNE_EVERY) {
    built = 0
    void prune().catch(() => {})
  }
  return out
}

/** 章节删除后清掉它的页缩略图 */
export async function removePageThumbs(chapterIds: number[]): Promise<void> {
  for (const id of chapterIds) {
    await rm(longPath(pageThumbDir(id)), { recursive: true, force: true }).catch(() => {})
  }
}

/** 超出容量上限时按最久未写入淘汰，并清掉空目录 */
async function prune(): Promise<void> {
  let chapters: string[]
  try {
    chapters = await readdir(longPath(pagesRoot()))
  } catch {
    return
  }

  const files: Array<{ path: string; size: number; at: number }> = []
  for (const chapter of chapters) {
    const dir = join(pagesRoot(), chapter)
    let names: string[]
    try {
      names = await readdir(longPath(dir))
    } catch {
      continue
    }
    for (const name of names) {
      const path = join(dir, name)
      try {
        const st = await stat(longPath(path))
        files.push({ path, size: st.size, at: st.mtimeMs })
      } catch {
        /* ignore */
      }
    }
  }

  let total = files.reduce((sum, f) => sum + f.size, 0)
  if (total <= MAX_BYTES) return

  files.sort((a, b) => a.at - b.at)
  for (const file of files) {
    if (total <= MAX_BYTES) break
    try {
      await unlink(longPath(file.path))
      total -= file.size
    } catch {
      /* ignore */
    }
  }
}
