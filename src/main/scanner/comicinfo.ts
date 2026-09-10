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

/** 解析系列目录（或压缩包解压目录）下的 ComicInfo.xml */
export async function readComicInfo(dir: string): Promise<ComicInfo | null> {
  let xml: string
  try {
    xml = await readFile(join(longPath(dir), 'ComicInfo.xml'), 'utf-8')
  } catch {
    return null
  }
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

    return {
      title: text(info.Title),
      series: text(info.Series),
      author: text(info.Writer) ?? text(info.Penciller),
      status: text(info.Status),
      tags: tags && tags.length > 0 ? tags : undefined,
      description: text(info.Summary)
    }
  } catch {
    return null
  }
}
