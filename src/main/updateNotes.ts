/** Release 正文清洗与版本号比较（不依赖 Electron，可单测）。
 *  发布链约定：GitHub Release 正文 = 仓库根 RELEASE_NOTES.md 全量，按 "## vX.Y.Z"
 *  分节；electron-updater 的 GitHub provider 会把正文渲染成 HTML，这里统一还原成
 *  干净文本并只取目标版本那一节。 */

/** releaseNotes 归一化成字符串（GitHub provider 给 release 正文） */
export function normalizeNotes(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim()
  if (Array.isArray(raw)) {
    return raw
      .map((x) => (x && typeof x === 'object' ? String((x as { note?: string }).note ?? '') : String(x ?? '')))
      .join('\n')
      .trim()
  }
  return ''
}

/** 按 "## vX.Y.Z" 分节只取目标版本那一节 */
export function sliceNotes(notes: string, version: string): string {
  // 版本号后必须紧跟空白/结尾：找 v0.2.3 不能命中 v0.2.30 开头的节
  const re = new RegExp(`^v${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`)
  const section = notes.split('\n## ').find((s) => re.test(s))
  if (!section) return notes
  return section.slice(`v${version}`.length).trim()
}

/** 语义化版本解析：支持预发布段（0.2.0-preview.1），预发布 < 同号正式版 */
export function parseSemver(v: string): { base: number[]; pre: string[] } {
  const s = v.replace(/^v/, '')
  const dash = s.indexOf('-')
  return {
    base: (dash === -1 ? s : s.slice(0, dash)).split('.').map((x) => parseInt(x, 10) || 0),
    pre: dash === -1 || dash === s.length - 1 ? [] : s.slice(dash + 1).split('.')
  }
}

function cmpPreIds(a: string, b: string): number {
  const na = /^\d+$/.test(a) ? parseInt(a, 10) : null
  const nb = /^\d+$/.test(b) ? parseInt(b, 10) : null
  if (na !== null && nb !== null) return na - nb
  if (na !== null) return -1 // 纯数字段 < 字母段——semver 规则
  if (nb !== null) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

/** a 是否比 b 新：远端更旧时不得提示「可更新」，否则成了降级安装 */
export function newerVersion(a: string, b: string): boolean {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  for (let i = 0; i < 3; i++) {
    const d = (pa.base[i] ?? 0) - (pb.base[i] ?? 0)
    if (d !== 0) return d > 0
  }
  const n = Math.max(pa.pre.length, pb.pre.length)
  for (let i = 0; i < n; i++) {
    const x = pa.pre[i]
    const y = pb.pre[i]
    if (x === undefined) return pa.pre.length === 0 // a 是正式版则更大；pre 段更少则更小
    if (y === undefined) return pb.pre.length > 0
    const d = cmpPreIds(x, y)
    if (d !== 0) return d > 0
  }
  return false
}

/** HTML（GitHub provider 渲染后的 release 正文）无依赖地转成干净文本行 */
export function htmlToText(html: string): string {
  const s = html
    .replace(/>\s+</g, '><') // 去掉标签间源码换行，避免块级标签换行后叠加出空行
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|h1|h2|h3|h4|ul|ol|div)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&')
  return s
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 正文清洗：HTML→文本（去掉文档标题/版本号行，弹窗已单独显示版本）；markdown 则按版本分节 */
export function cleanNotes(raw: unknown, version: string): string {
  const notes = normalizeNotes(raw)
  if (/<\/(p|li|ul|h\d|div)>/i.test(notes)) {
    const lines = htmlToText(notes).split('\n')
    while (
      lines.length &&
      (!lines[0] || lines[0] === '更新说明' || /^v?\d+\.\d+\.\d+(-[\w.]+)?$/.test(lines[0]))
    ) {
      lines.shift()
    }
    return lines.join('\n')
  }
  return sliceNotes(notes, version)
}
