import { useEffect, useRef, useState } from 'react'
import { pageUrl } from '@shared/types'
import { spreadPages, useReaderStore } from '@/stores/reader'
import { useCurrentPageObserver } from './useCurrentPageObserver'

interface ImageViewerProps {
  chapterId: number
  /** 条漫模式用于回报当前页；单页/双页模式自行管理页码 */
  onCurrentPage?: (page: number) => void
}

/** 单页 / 双页（RTL）模式的图片视口 */
export function ImageViewer({ chapterId }: ImageViewerProps) {
  const { mode, fit, rtl, rotate, page, pageCount, next, prev, setPage } = useReaderStore()
  const [zoom, setZoom] = useState(1)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setZoom(1)
  }, [page, mode, fit])

  // Ctrl/⌘ + 滚轮缩放
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      setZoom((z) => Math.min(4, Math.max(0.5, z + (e.deltaY > 0 ? -0.1 : 0.1))))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const pagesToShow = mode === 'double' ? spreadPages(page, pageCount, rtl) : [page]
  const isDouble = pagesToShow.length > 1

  // 双页永远并排；单页按适配方式铺排
  const layoutClass = isDouble
    ? 'flex h-full w-full items-center justify-center gap-0'
    : fit === 'width'
      ? 'flex w-full flex-col items-center'
      : fit === 'height'
        ? 'flex h-full items-center justify-center'
        : 'flex h-full items-center justify-center'

  const imgStyle: React.CSSProperties = {
    transform: `rotate(${rotate}deg) scale(${zoom})`,
    transition: 'transform 120ms ease-out',
    ...(isDouble
      ? fit === 'height'
        ? { height: '100%', width: 'auto', maxWidth: '50%', objectFit: 'contain' as const }
        : { width: '50%', height: 'auto', maxHeight: '100%', objectFit: 'contain' as const }
      : fit === 'width'
        ? { width: '100%', height: 'auto' }
        : fit === 'height'
          ? { height: '100%', width: 'auto' }
          : { maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' as const })
  }

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full items-center justify-center overflow-auto"
      onClick={(e) => {
        // 左 1/3 上一页，右 1/3 下一页（RTL 时方向相反）
        const x = e.clientX / window.innerWidth
        const forward = rtl ? x < 0.33 : x > 0.66
        const back = rtl ? x > 0.66 : x < 0.33
        if (forward) next()
        else if (back) prev()
      }}
    >
      <div className={layoutClass}>
        {pagesToShow.map((p) => (
          <img
            key={p}
            src={pageUrl(chapterId, p)}
            alt={`第 ${p + 1} 页`}
            draggable={false}
            style={imgStyle}
            className="select-none"
          />
        ))}
      </div>

      {/* 悬浮缩放控制（右下，避开顶栏） */}
      <div className="absolute bottom-10 right-4 flex gap-1 rounded-lg bg-black/60 p-1 backdrop-blur">
        <ZoomBtn label="−" onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))} />
        <span className="grid w-12 place-items-center text-xs text-white/90">
          {Math.round(zoom * 100)}%
        </span>
        <ZoomBtn label="＋" onClick={() => setZoom((z) => Math.min(4, z + 0.1))} />
        <ZoomBtn
          label="⟲"
          onClick={() => {
            setPage(page)
            setZoom(1)
          }}
        />
      </div>
    </div>
  )
}

function ZoomBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="grid size-7 place-items-center rounded text-white/90 hover:bg-white/10"
    >
      {label}
    </button>
  )
}

/** 条漫（Webtoon）模式：垂直连续滚动 */
export function WebtoonViewer({ chapterId, onCurrentPage = () => {} }: ImageViewerProps) {
  const pageCount = useReaderStore((s) => s.pageCount)
  const ref = useRef<HTMLDivElement>(null)

  useCurrentPageObserver(ref, onCurrentPage)

  return (
    <div ref={ref} className="h-full overflow-y-auto bg-black">
      <div className="mx-auto max-w-3xl">
        {Array.from({ length: pageCount }, (_, p) => (
          <img
            key={p}
            data-page={p}
            src={pageUrl(chapterId, p)}
            alt={`第 ${p + 1} 页`}
            loading="lazy"
            draggable={false}
            className="block w-full"
          />
        ))}
      </div>
    </div>
  )
}
