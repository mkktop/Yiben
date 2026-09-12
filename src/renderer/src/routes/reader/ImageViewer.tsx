import { Fragment, useEffect, useRef, useState } from 'react'
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

/** 失败重试间隔：1s → 4s（指数退避），共 2 次后转手动重试 */
const RETRY_DELAYS = [1000, 4000]

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
        if (attempt < RETRY_DELAYS.length) {
          window.setTimeout(() => setAttempt((a) => a + 1), RETRY_DELAYS[attempt])
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
  const { mode, fit, rtl, rotate, page, pageCount, widePages, spreadOffset, next, prev, setPage } =
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
    mode === 'double' ? spreadPages(page, pageCount, rtl, widePages, spreadOffset) : [page]
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

/** 条漫条带里一话的占位信息（拼接话从其前一话的末尾起算全局页号） */
interface StripChapter {
  id: number
  title: string
  pageCount: number
  /** 本话在条带里的全局起始页号 */
  start: number
}

/** 视口当前落在哪一话的哪一页（跨话连续滚动的进度归属依据） */
interface StripPos {
  chapterId: number
  title: string
  page: number
  pageCount: number
  start: number
}

/**
 * 条漫（Webtoon）模式：垂直连续滚动。
 * 临近本话末尾（差 2 页）自动经 neighbors 拼接下一话到同一条带里，滚动不中断、
 * 可跨多话链式拼接；视口跨过分界时回报新的章节归属，外层据此软切换进度话。
 * data-page 用条带全局页号（观察者跨话取「最小跨越页」需要单调序）。
 */
export function WebtoonViewer({
  chapterId,
  onPosition = () => {},
  onNext
}: {
  chapterId: number
  onPosition?: (pos: StripPos) => void
  onNext?: () => void
}) {
  const storePageCount = useReaderStore((s) => s.pageCount)
  const ref = useRef<HTMLDivElement>(null)

  /** 拼接进来的后续话；换话（路由变化）时清空重来 */
  const [extras, setExtras] = useState<StripChapter[]>([])
  const [fetching, setFetching] = useState(false)
  const extrasRef = useRef(extras)
  extrasRef.current = extras
  /** 条带末话确认拼不出下一话（没有下一话/PDF/页数未知） */
  const noMoreRef = useRef(false)

  // 基准话页数：软切换后 store 的 pageCount 会变成拼接话的，条带布局要用冻结值
  const baseRef = useRef(storePageCount)
  if (extras.length === 0) baseRef.current = storePageCount
  const baseCount = extras.length > 0 ? baseRef.current : storePageCount

  useEffect(() => {
    setExtras([])
    noMoreRef.current = false
  }, [chapterId])

  const tail = extras.length > 0 ? extras[extras.length - 1] : null
  const tailId = tail ? tail.id : chapterId
  const nextStart = tail ? tail.start + tail.pageCount : baseCount

  const tryAppend = (): void => {
    if (fetching) return
    setFetching(true)
    void window.yiben.reader
      .neighbors(tailId)
      .then((n) => {
        const nx = n?.next
        // PDF 与页数未知（云端未下载）的话拼不进条带，标记到底并走外层的进下一话
        if (!nx || nx.kind === 'pdf' || nx.page_count <= 0) {
          noMoreRef.current = true
          return
        }
        setExtras((list) => {
          if (list.some((c) => c.id === nx.id)) return list // 重复触发防御
          return [...list, { id: nx.id, title: nx.title, pageCount: nx.page_count, start: nextStart }]
        })
        noMoreRef.current = false
      })
      .catch(() => {})
      .finally(() => setFetching(false))
  }
  const tryAppendRef = useRef(tryAppend)
  tryAppendRef.current = tryAppend

  /** 条带全局页号 → 视口所在话与话内局部页码 */
  const locate = (global: number): StripPos => {
    for (let i = extras.length - 1; i >= 0; i--) {
      const c = extras[i]
      if (global >= c.start) {
        return {
          chapterId: c.id,
          title: c.title,
          page: global - c.start,
          pageCount: c.pageCount,
          start: c.start
        }
      }
    }
    return { chapterId, title: '', page: global, pageCount: baseCount, start: 0 }
  }

  useCurrentPageObserver(ref, (global) => {
    onPosition(locate(global))
    // 距条带末尾（nextStart = 拼接话的全局起点）不足 2 页就提前拼接，滚动到分界时不顿挫
    if (baseCount > 0 && !noMoreRef.current && global >= nextStart - 2) {
      tryAppendRef.current()
    }
  })

  // 滚到底部再往下滚：还能拼就拼；确实没有可拼的话时交由外层（仅限尚未拼接过，
  // 否则条带末话的下一话与路由话的下一话不是同一话，交给外层会跳错）
  const atBottom = useRef(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onScroll = (): void => {
      atBottom.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 4
    }
    const onWheel = (e: WheelEvent): void => {
      if (e.deltaY <= 0 || !atBottom.current) return
      e.preventDefault()
      if (noMoreRef.current) {
        if (extrasRef.current.length === 0) onNext?.()
        return
      }
      tryAppendRef.current()
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
        {Array.from({ length: baseCount }, (_, p) => (
          <PageImage
            key={p}
            src={pageUrl(chapterId, p)}
            alt={`第 ${p + 1} 页`}
            dataPage={p}
            className="block w-full"
          />
        ))}
        {extras.map((c) => (
          <Fragment key={c.id}>
            <div className="my-8 flex items-center gap-3 px-8 text-xs text-white/40">
              <span className="h-px flex-1 bg-white/10" />
              下一话 · {c.title}
              <span className="h-px flex-1 bg-white/10" />
            </div>
            {Array.from({ length: c.pageCount }, (_, j) => (
              <PageImage
                key={`${c.id}-${j}`}
                src={pageUrl(c.id, j)}
                alt={`${c.title} 第 ${j + 1} 页`}
                dataPage={c.start + j}
                className="block w-full"
              />
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  )
}
