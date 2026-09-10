import { useEffect, useRef, useState } from 'react'
import { RotateCw } from 'lucide-react'
import { pageUrl } from '@shared/types'
import { spreadPages, useReaderStore } from '@/stores/reader'
import { useCurrentPageObserver } from './useCurrentPageObserver'

interface ImageViewerProps {
  chapterId: number
  /** 条漫模式用于回报当前页；单页/双页模式自行管理页码 */
  onCurrentPage?: (page: number) => void
  /** 条漫滚到底部再往下时由外层接管（进下一话） */
  onNext?: () => void
}

const PAGE_RETRIES = 2
const RETRY_MS = 1500

/**
 * 单页图片：加载失败后先静默重试（云端 502/超时多数是瞬时的，换查询串强制重发），
 * 仍失败则展示手动重试占位，不再留下裂图。
 */
function PageImage({
  src,
  alt,
  className,
  style,
  dataPage,
  eager
}: {
  src: string
  alt: string
  className?: string
  style?: React.CSSProperties
  dataPage?: number
  eager?: boolean
}) {
  const [attempt, setAttempt] = useState(0)
  const [failed, setFailed] = useState(false)

  // 翻页/重试换地址时复位
  useEffect(() => {
    setAttempt(0)
    setFailed(false)
  }, [src])

  if (failed) {
    return (
      <div
        data-page={dataPage}
        className="grid place-items-center gap-2 bg-white/5 text-white/70"
        style={{ aspectRatio: '2 / 3', ...style }}
      >
        <RotateCw className="size-6" />
        <button
          className="rounded-md border border-white/30 px-3 py-1.5 text-xs hover:bg-white/10"
          onClick={() => {
            setFailed(false)
            setAttempt((a) => a + 1)
          }}
        >
          加载失败，点击重试
        </button>
      </div>
    )
  }

  return (
    <img
      key={attempt}
      src={attempt > 0 ? `${src}?r=${attempt}` : src}
      data-page={dataPage}
      alt={alt}
      draggable={false}
      loading={eager ? 'eager' : 'lazy'}
      onError={() => {
        if (attempt < PAGE_RETRIES) {
          window.setTimeout(() => setAttempt((a) => a + 1), RETRY_MS)
        } else {
          setFailed(true)
        }
      }}
      className={className}
      style={style}
    />
  )
}

/** 单页 / 双页（RTL）模式的图片视口：点击区只在章节内翻页，不跨话 */
export function ImageViewer({ chapterId }: ImageViewerProps) {
  const { mode, fit, rtl, rotate, page, pageCount, widePages, next, prev, setPage } =
    useReaderStore()
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

  const pagesToShow =
    mode === 'double' ? spreadPages(page, pageCount, rtl, widePages) : [page]
  const isDouble = pagesToShow.length > 1

  // 双页永远并排；单页按适配方式铺排
  const layoutClass = isDouble
    ? 'flex h-full w-full items-center justify-center gap-0'
    : fit === 'width'
      ? 'flex w-full flex-col items-center'
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
        // 左 1/3 上一页，右 1/3 下一页（RTL 时方向相反）；只在章节内翻页，
        // 跨话走顶栏按钮 / 末页卡片 / 键盘（store 的 next/prev 自带钳位）
        const x = e.clientX / window.innerWidth
        const forward = rtl ? x < 0.33 : x > 0.66
        const back = rtl ? x > 0.66 : x < 0.33
        if (forward) next()
        else if (back) prev()
      }}
    >
      <div className={layoutClass}>
        {pagesToShow.map((p) => (
          <PageImage
            key={p}
            src={pageUrl(chapterId, p)}
            alt={`第 ${p + 1} 页`}
            eager
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
export function WebtoonViewer({
  chapterId,
  onCurrentPage = () => {},
  onNext
}: ImageViewerProps) {
  const pageCount = useReaderStore((s) => s.pageCount)
  const ref = useRef<HTMLDivElement>(null)

  useCurrentPageObserver(ref, onCurrentPage)

  // 滚到底部再往下滚 → 交由外层进下一话
  const atBottom = useRef(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onScroll = (): void => {
      atBottom.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 4
    }
    const onWheel = (e: WheelEvent): void => {
      if (e.deltaY > 0 && atBottom.current && onNext) {
        e.preventDefault()
        onNext()
      }
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('wheel', onWheel)
    }
  }, [onNext])

  return (
    <div ref={ref} className="h-full overflow-y-auto bg-black">
      <div className="mx-auto max-w-3xl">
        {Array.from({ length: pageCount }, (_, p) => (
          <PageImage
            key={p}
            src={pageUrl(chapterId, p)}
            alt={`第 ${p + 1} 页`}
            dataPage={p}
            className="block w-full"
          />
        ))}
      </div>
    </div>
  )
}
