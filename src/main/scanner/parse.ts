export interface ParsedName {
  /** 清理后的标题 */
  title: string
  /** 卷号（第X卷 / v01 / Vol.2） */
  volume?: number
  /** 话数/章节号（第X话 / c005 / Chapter 3 / 结尾数字） */
  number?: number
}

/**
 * 从文件/文件夹名解析 卷号、话数 与 标题。
 * 参考 Komga / Mihon 的解析规则，覆盖中日文常见命名：
 *  - 海贼王 第01卷
 *  - 进击的巨人 第05话
 *  - One Piece v02
 *  - [Group] Title c005
 *  - Chapter 12 - Special
 *  - 完结长篇 013
 */
export function parseChapterName(raw: string): ParsedName {
  let s = raw.replace(/[_]+/g, ' ').trim()

  let volume: number | undefined
  let number: number | undefined
  const consumed: Array<[string, string]> = []

  // 第 X 卷 / 巻 / 冊
  const volZh = s.match(/第\s*(\d+(?:\.\d+)?)\s*[卷巻冊]/)
  if (volZh) {
    volume = Number(volZh[1])
    consumed.push([volZh[0], ' '])
  }

  // 第 X 话 / 話 / 回
  const numZh = s.match(/第\s*(\d+(?:\.\d+)?)\s*[話话回]/)
  if (numZh) {
    number = Number(numZh[1])
    consumed.push([numZh[0], ' '])
  }

  // v01 / Vol. 2 / Volume 3
  if (volume === undefined) {
    const volEn = s.match(/(?:^|[\s.(\-])(?:v|vol|volume)[.\s_-]*(\d+(?:\.\d+)?)(?=$|[\s)\-])/i)
    if (volEn) {
      volume = Number(volEn[1])
      consumed.push([volEn[0], volEn[1]])
    }
  }

  // c005 / ch.12 / chap 3 / chapter 4 / episode 2 / ep05
  if (number === undefined) {
    const numEn = s.match(/(?:^|[\s.(\-])(?:c|ch|chap|chapter|episode|ep)[.\s_-]*(\d+(?:\.\d+)?)(?=$|[\s)\-])/i)
    if (numEn) {
      number = Number(numEn[1])
      consumed.push([numEn[0], numEn[1]])
    }
  }

  // 结尾独立数字（排除已被上面匹配过的部分）
  if (number === undefined && volume === undefined) {
    const tail = s.match(/[\s-](\d+(?:\.\d+)?)\s*$/)
    if (tail) {
      const n = Number(tail[1])
      if (Number.isFinite(n)) {
        // 卷/话由标题语义决定不了，纯尾数按话数处理
        number = n
        consumed.push([tail[0], ''])
      }
    }
  }

  // 移除已匹配片段
  for (const [frag] of consumed) s = s.replace(frag, ' ')

  // 去掉开头的 [] {} 组名/元信息（最多两层）
  s = s.replace(/^\s*[[({](?:[^[\]()}]*?)[\])}]\s*/, '')
  s = s.replace(/^\s*[[({](?:[^[\]()}]*?)[\])}]\s*/, '')

  // 清理分隔符与空白
  s = s.replace(/^[\s\-–—.:：、~～]+/, '')
  s = s.replace(/[\s\-–—.:：、~～]+$/, '')
  s = s.replace(/\s{2,}/g, ' ').trim()

  return {
    title: s || raw.trim(),
    volume,
    number
  }
}
