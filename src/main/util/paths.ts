import { readdir } from 'fs/promises'
import { join } from 'path'

/** 图片扩展名（Chromium 可直接渲染的） */
const IMAGE_EXTS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.apng',
  '.webp',
  '.gif',
  '.avif',
  '.bmp',
  '.svg'
])

/** 压缩包/PDF 扩展名 → 章节类型 */
const ARCHIVE_KINDS: Record<string, string> = {
  '.zip': 'zip',
  '.cbz': 'zip',
  '.epub': 'epub',
  '.rar': 'rar',
  '.cbr': 'rar',
  '.7z': '7z',
  '.cb7': '7z',
  '.tar': 'tar',
  '.cbt': 'tar',
  '.pdf': 'pdf'
}

export function extOf(path: string): string {
  const i = path.lastIndexOf('.')
  return i === -1 ? '' : path.slice(i).toLowerCase()
}

export function isImageFile(path: string): boolean {
  return IMAGE_EXTS.has(extOf(path))
}

export function archiveKindOf(path: string): string | null {
  return ARCHIVE_KINDS[extOf(path)] ?? null
}

/** 去掉压缩包扩展名：'第02话.zip' → '第02话' */
export function stripArchiveExt(name: string): string {
  const ext = extOf(name)
  return ARCHIVE_KINDS[ext] ? name.slice(0, -ext.length) : name
}

export function mimeOfImage(path: string): string {
  switch (extOf(path)) {
    case '.png':
      return 'image/png'
    case '.apng':
      return 'image/apng'
    case '.svg':
      return 'image/svg+xml'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    case '.avif':
      return 'image/avif'
    case '.bmp':
      return 'image/bmp'
    default:
      return 'image/jpeg'
  }
}

/** Windows 长路径前缀 */
export function longPath(p: string): string {
  if (process.platform !== 'win32') return p
  if (p.startsWith('\\\\?\\')) return p
  return p.startsWith('\\\\') ? `\\\\?\\UNC\\${p.slice(2)}` : `\\\\?\\${p}`
}

/** 自然排序比较：page2 < page10 */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

export interface DirEntry {
  name: string
  isDir: boolean
}

export async function readDirEntries(dir: string): Promise<DirEntry[]> {
  const raw = await readdir(longPath(dir), { withFileTypes: true })
  return raw.map((e) => ({ name: e.name, isDir: e.isDirectory() }))
}

export function joinPath(dir: string, name: string): string {
  return join(dir, name)
}

/**
 * 清洗云端文件名用于本地缓存路径：网盘目录列举出的名字是不可信输入，
 * 含路径分隔符（\ /）会逃出缓存子目录，Windows 保留字符/控制字符会导致写盘失败
 */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name
  const clean = base
    // 控制字符与 Windows 文件名保留字符
    .replace(/[\x00-\x1f<>:"|?*]/g, '_')
    // 结尾的点/空格在 Windows 上会被剥掉，导致同名文件互相覆盖索引键
    .replace(/[. ]+$/, '')
    .slice(0, 120)
  return clean || 'file'
}
