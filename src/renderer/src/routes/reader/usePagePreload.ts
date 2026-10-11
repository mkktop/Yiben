import { useEffect } from 'react'
import { pageUrl } from '@shared/types'

/** 已发起过预载的 URL：条漫快速滚动时 page 每变一次都会分配 ahead+behind 个
 *  Image 对象，绝大多数 src 重复；浏览器/协议缓存兜底正确性，这里只省对象分配 */
const queued = new Set<string>()

/**
 * 预加载当前页前后窗口的图片（翻页零等待的关键）；PDF 由 pdfjs 自行按需渲染。
 * 前向窗口大于后向：向后翻是主路径；刚看过的页缓存命中的概率也更高。
 */
export function usePagePreload(
  chapterId: number,
  page: number,
  pageCount: number,
  ahead = 5,
  behind = 2,
  enabled = true
): void {
  useEffect(() => {
    // 章节尚未加载（chapterId=0）时跳过，否则协议层会刷一堆 chapter not found
    if (!enabled || chapterId <= 0) return
    // 上限兜底：极长会话里避免集合无界增长（清掉只是退回「按需分配 Image 对象」）
    if (queued.size > 4000) queued.clear()
    for (let d = 1; d <= ahead || d <= behind; d++) {
      // 由近及远：先 +d 再 -d，快速连翻时最近的页最先发起请求
      for (const p of [d <= ahead ? page + d : -1, d <= behind ? page - d : -1]) {
        if (p < 0 || p >= pageCount) continue
        const url = pageUrl(chapterId, p)
        if (queued.has(url)) continue
        queued.add(url)
        const img = new Image()
        img.src = url
      }
    }
  }, [chapterId, page, pageCount, ahead, behind, enabled])
}
