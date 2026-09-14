import { posix } from 'path'
import StreamZip from 'node-stream-zip'
import { XMLParser } from 'fast-xml-parser'
import { isImageFile, longPath, naturalCompare } from '../util/paths'
import { MAX_ARCHIVE_ENTRY_BYTES } from './types'
import type { ArchiveDriver, PageEntry } from './types'

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true
})

/** fast-xml-parser 对唯一子元素输出对象、多个才输出数组，统一成数组遍历 */
function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return []
  return Array.isArray(v) ? v : [v]
}

/** zip 内路径 dirname（posix）：'OEBPS/text/p1.xhtml' → 'OEBPS/text' */
function posixDirname(p: string): string {
  const i = p.lastIndexOf('/')
  return i === -1 ? '' : p.slice(0, i)
}

/** href（相对 baseDir，可能带 #fragment / ?query / 百分号编码 / ../）→ zip 内规范路径 */
function resolveZipPath(baseDir: string, href: string): string {
  const clean = href.split('#')[0].split('?')[0]
  let decoded: string
  try {
    decoded = decodeURIComponent(clean)
  } catch {
    decoded = clean
  }
  const joined = baseDir ? `${baseDir}/${decoded}` : decoded
  return posix.normalize(joined)
}

/** 从 xhtml 提取图片引用，img(image) 混排时保持文档出现顺序 */
const IMG_TAG_RE = /<(img|image)\b[^>]*>/gi
const SRC_ATTR_RE = /(?:xlink:)?(?:src|href)\s*=\s*["']([^"']+)["']/i

function extractImageSrcs(html: string): string[] {
  const out: string[] = []
  for (const m of html.matchAll(IMG_TAG_RE)) {
    const attr = SRC_ATTR_RE.exec(m[0])
    if (attr) out.push(attr[1])
  }
  return out
}

/**
 * EPUB：zip 容器 + OPF spine 阅读顺序。
 * 漫画/条漫 EPUB 的 spine item 要么直接是图片，要么是图片壳 xhtml（<img src> 或 svg 的 <image xlink:href>）。
 * container.xml / OPF 缺失或解析不出任何图时，退化为包内全部图片自然排序（与 ZipDriver 一致），
 * 以兼容各种非标准生成器输出。
 */
export class EpubDriver implements ArchiveDriver {
  private pages: PageEntry[] = []
  /** 全部条目的声明尺寸（防解压炸弹） */
  private allSizes = new Map<string, number>()
  /** OPF 元数据（dc:title / dc:creator），供扫描入系列；解析失败为空 */
  readonly metadata: { title?: string; author?: string } = {}
  private zip!: StreamZip.StreamZipAsync

  private constructor() {}

  static async create(file: string): Promise<EpubDriver> {
    const driver = new EpubDriver()
    driver.zip = new StreamZip.async({ file: longPath(file), storeEntries: true })
    const entries = await driver.zip.entries()
    const entryMap = new Map<string, { size: number }>()
    for (const [name, e] of Object.entries(entries)) {
      if (!e.isDirectory) {
        entryMap.set(name, { size: e.size })
        driver.allSizes.set(name, e.size)
      }
    }

    let pages: PageEntry[] = []
    try {
      const spine = await collectSpinePages(driver.zip, entryMap)
      pages = spine.pages
      driver.metadata.title = spine.title
      driver.metadata.author = spine.author
    } catch {
      /* 非标准 EPUB → 走散图兜底 */
    }
    if (pages.length === 0) {
      pages = [...entryMap.keys()]
        .filter((name) => isImageFile(name))
        .sort(naturalCompare)
        .map((name) => ({ name, size: entryMap.get(name)?.size ?? 0 }))
    }
    driver.pages = pages
    return driver
  }

  async listPages(): Promise<PageEntry[]> {
    return this.pages
  }

  async readPage(index: number): Promise<Buffer> {
    const page = this.pages[index]
    if (!page) throw new Error(`页码越界：${index}`)
    // 声明尺寸超限直接拒绝（同 ZipDriver：entryData 无增量上限）
    if (page.size > MAX_ARCHIVE_ENTRY_BYTES) {
      throw new Error(`条目过大（${page.size} 字节）：${page.name}`)
    }
    const data = await this.zip.entryData(page.name)
    return Buffer.from(data)
  }

  async readEntry(name: string): Promise<Buffer | null> {
    try {
      if ((this.allSizes.get(name) ?? 0) > MAX_ARCHIVE_ENTRY_BYTES) return null
      return Buffer.from(await this.zip.entryData(name))
    } catch {
      return null
    }
  }

  async close(): Promise<void> {
    await this.zip.close()
  }
}

interface SpineResult {
  pages: PageEntry[]
  title?: string
  author?: string
}

async function collectSpinePages(
  zip: StreamZip.StreamZipAsync,
  entryMap: Map<string, { size: number }>
): Promise<SpineResult> {
  // 元数据文本也过尺寸闸（恶意的巨型 xhtml 同样能打爆内存）
  const readText = async (name: string): Promise<string> => {
    if ((entryMap.get(name)?.size ?? 0) > MAX_ARCHIVE_ENTRY_BYTES) {
      throw new Error(`条目过大：${name}`)
    }
    return (await zip.entryData(name)).toString('utf-8')
  }

  // container.xml → OPF 路径
  const containerXml = await readText('META-INF/container.xml')
  const container = xmlParser.parse(containerXml)
  const rootfile = asArray(container?.container?.rootfiles?.rootfile)[0]
  const opfPath = typeof rootfile?.['@_full-path'] === 'string' ? rootfile['@_full-path'] : ''
  if (!opfPath) throw new Error('container.xml 缺少 rootfile')

  const opf = xmlParser.parse(await readText(opfPath))
  const meta = opf?.package?.metadata
  const result: SpineResult = {
    pages: [],
    title: firstText(meta?.['dc:title'] ?? meta?.title),
    author: firstText(meta?.['dc:creator'] ?? meta?.creator)
  }
  const manifest = new Map<string, { href: string; mediaType: string }>()
  for (const item of asArray(opf?.package?.manifest?.item)) {
    const id = item?.['@_id']
    const href = item?.['@_href']
    const mediaType = item?.['@_media-type']
    if (id != null && typeof href === 'string' && typeof mediaType === 'string') {
      manifest.set(String(id), { href, mediaType })
    }
  }

  const opfDir = posixDirname(opfPath)
  const pages: PageEntry[] = []
  const pushPage = (name: string): void => {
    const e = entryMap.get(name)
    if (e && isImageFile(name)) pages.push({ name, size: e.size })
  }

  for (const ref of asArray(opf?.package?.spine?.itemref)) {
    const item = manifest.get(String(ref?.['@_idref']))
    if (!item) continue

    if (item.mediaType.startsWith('image/')) {
      pushPage(resolveZipPath(opfDir, item.href))
    } else if (/xhtml|html/i.test(item.mediaType)) {
      const docName = resolveZipPath(opfDir, item.href)
      if (!entryMap.has(docName)) continue
      const html = await readText(docName)
      const docDir = posixDirname(docName)
      for (const src of extractImageSrcs(html)) {
        pushPage(resolveZipPath(docDir, src))
      }
    }
  }
  result.pages = pages
  return result
}

/** 取首个非空文本；数组取首项，带属性的元素取 #text */
function firstText(v: unknown): string | undefined {
  if (typeof v === 'string') {
    const t = v.trim()
    return t === '' ? undefined : t
  }
  if (Array.isArray(v)) return firstText(v[0])
  if (v != null && typeof v === 'object') return firstText((v as Record<string, unknown>)['#text'])
  return undefined
}
