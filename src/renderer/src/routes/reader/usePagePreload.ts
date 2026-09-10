import { useEffect } from 'react'
import { pageUrl } from '@shared/types'

/** 预加载当前页 ±range 的图片（翻页零等待的关键）；PDF 由 pdfjs 自行按需渲染 */
export function usePagePreload(
  chapterId: number,
  page: number,
  pageCount: number,
  range = 3,
  enabled = true
): void {
  useEffect(() => {
    if (!enabled) return
    for (let d = 1; d <= range; d++) {
      for (const p of [page + d, page - d]) {
        if (p < 0 || p >= pageCount) continue
        const img = new Image()
        img.src = pageUrl(chapterId, p)
      }
    }
  }, [chapterId, page, pageCount, range, enabled])
}
