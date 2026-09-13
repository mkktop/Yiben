import { useEffect } from 'react'
import { pageUrl } from '@shared/types'

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
    for (let d = 1; d <= ahead || d <= behind; d++) {
      // 由近及远：先 +d 再 -d，快速连翻时最近的页最先发起请求
      for (const p of [d <= ahead ? page + d : -1, d <= behind ? page - d : -1]) {
        if (p < 0 || p >= pageCount) continue
        const img = new Image()
        img.src = pageUrl(chapterId, p)
      }
    }
  }, [chapterId, page, pageCount, ahead, behind, enabled])
}
