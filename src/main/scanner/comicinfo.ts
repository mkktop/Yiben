import { readFile } from 'fs/promises'
import { join } from 'path'
import { XMLParser } from 'fast-xml-parser'
import { longPath } from '../util/paths'

export interface ComicInfo {
  title?: string
  series?: string
  author?: string
  status?: string
  tags?: string[]
  description?: string
  /** 发表年份（ComicInfo 的 Year） */
  year?: number
  /** 语言代码（ComicInfo 的 LanguageISO，如 zh / ja） */
  language?: string
}

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true
})

function text(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t === '' ? undefined : t
}

/** 解析 ComicInfo.xml 文本；非 ComicInfo 结构返回 null（目录文件与压缩包内条目共用） */
export function parseComicInfoXml(xml: string): ComicInfo | null {
  try {
    const doc = parser.parse(xml)
    const info = doc?.ComicInfo
    if (!info || typeof info !== 'object') return null

    const genres = text(info.Genre)
    const tags = genres
      ? genres
          .split(/[,，]/)
          .map((g) => g.trim())
          .filter(Boolean)
      : undefined
    const year = Number(info.Year)

    return {
      title: text(info.Title),
      series: text(info.Series),
      author: text(info.Writer) ?? text(info.Penciller),
      status: text(info.Status),
      tags: tags && tags.length > 0 ? tags : undefined,
      description: text(info.Summary),
      year: Number.isFinite(year) && year > 0 ? year : undefined,
      language: text(info.LanguageISO)
    }
  } catch {
    return null
  }
}

/** 解析系列目录（或压缩包解压目录）下的 ComicInfo.xml */
export async function readComicInfo(dir: string): Promise<ComicInfo | null> {
  let xml: string
  try {
    xml = await readFile(join(longPath(dir), 'ComicInfo.xml'), 'utf-8')
  } catch {
    return null
  }
  return parseComicInfoXml(xml)
}
