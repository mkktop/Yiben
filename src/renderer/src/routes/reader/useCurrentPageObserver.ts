import { useEffect, useRef, type RefObject } from 'react'

/**
 * 跟踪长滚动容器里「当前页」：以容器垂直中线为准，取跨过中线的页码最小的元素。
 *
 * 相比在每个滚动帧里 querySelectorAll + 读 offsetTop（强制 reflow，页数多时每帧 O(n)），
 * IntersectionObserver 只在页面进出中线时才回调，滚动期间不产生任何布局读取。
 * 回调存在 ref 里，所以调用方不必为了稳定引用而包 useCallback。
 */
export function useCurrentPageObserver(
  containerRef: RefObject<HTMLElement | null>,
  onCurrentPage: (page: number) => void
): void {
  const callback = useRef(onCurrentPage)
  callback.current = onCurrentPage

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    let current = -1
    const crossing = new Set<number>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const page = Number((entry.target as HTMLElement).dataset.page)
          if (!Number.isFinite(page)) continue
          if (entry.isIntersecting) crossing.add(page)
          else crossing.delete(page)
        }
        let first = -1
        for (const page of crossing) if (first === -1 || page < first) first = page
        if (first !== -1 && first !== current) {
          current = first
          callback.current(first)
        }
      },
      { root: el, rootMargin: '-50% 0px -50% 0px', threshold: 0 }
    )

    const observePages = (): void => {
      el.querySelectorAll<HTMLElement>('[data-page]').forEach((node) => observer.observe(node))
    }
    observePages()
    // 页节点是渐进出现的（PDF 逐页渲染、条漫图片懒加载）
    const mutations = new MutationObserver(observePages)
    mutations.observe(el, { childList: true, subtree: true })

    return () => {
      observer.disconnect()
      mutations.disconnect()
    }
  }, [containerRef])
}
