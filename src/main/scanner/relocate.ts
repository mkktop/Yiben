import {
  adoptSeriesData,
  localMissingSeriesChapters,
  localSeriesChaptersByPaths,
  type RelocationSeries
} from '../db'

/**
 * 系列「移动/改名」重定位：扫描把旧路径系列标成 missing 后，
 * 用章节指纹在本次扫描出的新系列里找回它，把进度/书签/页尺寸转移过去。
 *
 * 匹配规则（保守优先，认错比漏掉代价大——会把进度转移到别的系列并删旧系列）：
 *  - 强匹配：章节数相同，且每个「相对路径 → (size, mtime)」完全一致（文件夹挪位置、系列根改名）
 *  - 弱匹配（章节数 ≥ 2 才启用）：按排序后 (size, mtime) 序列逐项相等（单文件系列改名等 rel 全变场景；
 *    多章组合恰好全等的两个不同系列概率可忽略，单章则无法与「复制到两处」区分，宁可不做）
 *  - 一个新系列最多被一个旧系列认领
 */

export interface SeriesMatch {
  oldSeriesId: number
  newSeriesId: number
  /** 旧章节 id → 新章节 id */
  chapterMap: Map<number, number>
}

export function matchSeries(a: RelocationSeries, b: RelocationSeries): Map<number, number> | null {
  if (a.chapters.length === 0 || a.chapters.length !== b.chapters.length) return null

  // 强匹配：相对路径与 (size, mtime) 全等
  const byRel = new Map(b.chapters.map((c) => [c.rel, c]))
  if (a.chapters.every((c) => byRel.has(c.rel))) {
    const strong = new Map<number, number>()
    let ok = true
    for (const c of a.chapters) {
      const t = byRel.get(c.rel)!
      if (t.size !== c.size || t.mtime !== c.mtime) {
        ok = false
        break
      }
      strong.set(c.id, t.id)
    }
    if (ok) return strong
  }

  // 弱匹配：排序后 (size, mtime) 序列逐项相等
  if (a.chapters.length < 2) return null
  const fp = (c: { size: number; mtime: number }): string => `${c.size}|${c.mtime}`
  const sa = [...a.chapters].sort((x, y) => naturalCompare(x.rel, y.rel))
  const sb = [...b.chapters].sort((x, y) => naturalCompare(x.rel, y.rel))
  if (sa.every((c, i) => fp(c) === fp(sb[i]))) {
    return new Map(sa.map((c, i) => [c.id, sb[i].id]))
  }
  return null
}

function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

/** 对全局 missing 本地系列 × 本次扫描保留的本地系列做匹配并转移数据；返回转移的系列数 */
export function adoptRelocatedSeries(keepFolderPaths: string[]): number {
  const missing = localMissingSeriesChapters()
  if (missing.length === 0) return 0
  const candidates = localSeriesChaptersByPaths(keepFolderPaths)
  if (candidates.length === 0) return 0

  const claimed = new Set<number>()
  let adopted = 0
  for (const old of missing) {
    // 新系列所在库 ≠ 旧系列原库也算移动（换库重新添加到新路径），所以不限库匹配
    const hit = candidates.find(
      (c) => !claimed.has(c.seriesId) && c.folderPath !== old.folderPath && matchSeries(old, c)
    )
    if (!hit) continue
    const chapterMap = matchSeries(old, hit)
    if (!chapterMap) continue
    adoptSeriesData(old.seriesId, chapterMap)
    claimed.add(hit.seriesId)
    adopted++
    console.info(
      `[relocate] 系列移动/改名识别：${old.folderPath} → ${hit.folderPath}，已转移阅读进度`
    )
  }
  return adopted
}
