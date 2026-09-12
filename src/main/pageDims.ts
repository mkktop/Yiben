import sharp from 'sharp'
import { getChapter, getPageDims, savePageDims, type PageDim } from './db'
import { ensureChapterPage, readEnsuredPage } from './cloud189/ensure'
import { broadcast } from './events'

/** 每批探测页数，测完立即广播给渲染层（双页模式渐进校正排版） */
const BATCH = 8
const CONCURRENCY = 3

/** 同一章节只跑一个探测任务 */
const inflight = new Map<number, Promise<PageDim[]>>()

/**
 * 确保章节的页尺寸已知：读 page_dims 表，缺的页在后台按需解码页首探测。
 * 立即返回现有记录（可能为空）；探测完成后经 `chapter:pageDims` 广播补齐。
 * 双页模式的跨页大图（横宽比 >1 的扉页/彩页）靠它自动单页展示。
 * PDF 在渲染进程渲染，主进程探测不了，返回 pending=false。
 */
export function ensurePageDims(chapterId: number): { dims: PageDim[]; probing: boolean } {
  const ch = getChapter(chapterId)
  if (!ch || ch.kind === 'pdf' || ch.page_count <= 0) return { dims: [], probing: false }

  const dims = getPageDims(chapterId)
  const known = new Set(dims.map((d) => d.idx))
  const missing: number[] = []
  for (let i = 0; i < ch.page_count; i++) {
    if (!known.has(i)) missing.push(i)
  }
  if (missing.length === 0) return { dims, probing: false }

  if (!inflight.has(chapterId)) {
    const task = probe(chapterId, missing)
      .catch((err) => {
        console.warn(
          `[dims] 页尺寸探测失败 chapter=${chapterId}:`,
          err instanceof Error ? err.message : err
        )
        return [] as PageDim[]
      })
      .finally(() => inflight.delete(chapterId))
    inflight.set(chapterId, task)
  }
  return { dims, probing: true }
}

async function probe(chapterId: number, missing: number[]): Promise<PageDim[]> {
  const ch = getChapter(chapterId)
  if (!ch) return []
  const out: PageDim[] = []

  // 简单并发窗口：按 CONCURRENCY 分批顺序推进，每批落库 + 广播
  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH)
    const results = await mapLimited(batch, CONCURRENCY, async (idx) => {
      try {
        const ensured = await ensureChapterPage(chapterId, idx)
        const buf = await readEnsuredPage(ensured, idx)
        const meta = await sharp(buf).metadata()
        if (meta.width && meta.height) return { idx, w: meta.width, h: meta.height }
      } catch {
        /* 单页失败不影响其余页 */
      }
      return null
    })
    const ok = results.filter((d): d is PageDim => d !== null)
    if (ok.length > 0) {
      savePageDims(chapterId, ok)
      out.push(...ok)
      broadcast('chapter:pageDims', { chapterId, dims: getPageDims(chapterId) })
    }
  }
  return out
}

async function mapLimited<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return results
}
