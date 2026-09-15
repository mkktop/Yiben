import { Fragment, memo, useLayoutEffect, useCallback, useEffect, useRef, useState } from 'react'
import { RotateCw } from 'lucide-react'
import { pageUrl } from '@shared/types'
import { spreadPages, useReaderStore } from '@/stores/reader'
import { useCurrentPageObserver } from './useCurrentPageObserver'

interface ImageViewerProps {
  chapterId: number
  /** 缩放按系列持久化需要 */
  seriesId: number
  /** 条漫模式：恢复/深链起始页（0 基）；单双页模式由 store 管理 */
  initialPage?: number
  /** 条漫模式用于回报当前页；单页/双页模式自行管理页码 */
  onCurrentPage?: (page: number) => void
  /** 条漫模式回报视口归属话（软切换进度用） */
  onPosition?: (pos: StripPos) => void
  /** 末屏再往后：进下一话；首页再往前：回上一话末页（单双页点击区、条漫滚动底共用） */
  onNext?: () => void
  onPrev?: () => void
}

/** 失败重试间隔：1s → 4s（指数退避），共 2 次后转手动重试 */
const RETRY_DELAYS = [1000, 4000]

/** 缩放按系列写入偏好（尾随防抖：滚轮连续缩放只在停手后落一次盘） */
let zoomPersistTimer: ReturnType<typeof setTimeout> | null = null
function persistZoom(seriesId: number, zoom: number): void {
  if (zoomPersistTimer) clearTimeout(zoomPersistTimer)
  zoomPersistTimer = setTimeout(() => {
    zoomPersistTimer = null
    if (seriesId > 0) void window.yiben.reader.setPrefs(seriesId, { zoom }).catch(() => {})
  }, 600)
}

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

/** 单页 / 双页（RTL）模式的图片视口：点击区翻页，末屏点击自然过渡到前后话 */
export const ImageViewer = memo(function ImageViewer({
  chapterId,
  seriesId,
  onNext,
  onPrev
}: ImageViewerProps) {
  // 选择器订阅：整库解构会让无关状态（immersive/thumbs 等）变化时也整树 reconcile
  const mode = useReaderStore((s) => s.mode)
  const fit = useReaderStore((s) => s.fit)
  const rtl = useReaderStore((s) => s.rtl)
  const rotate = useReaderStore((s) => s.rotate)
  const page = useReaderStore((s) => s.page)
  const pageCount = useReaderStore((s) => s.pageCount)
  const widePages = useReaderStore((s) => s.widePages)
  const spreadOffset = useReaderStore((s) => s.spreadOffset)
  const zoom = useReaderStore((s) => s.zoom)
  const next = useReaderStore((s) => s.next)
  const prev = useReaderStore((s) => s.prev)
  const setPage = useReaderStore((s) => s.setPage)
  const containerRef = useRef<HTMLDivElement>(null)

  /** 缩放锚点：ux/uy 是锚点在跨页布局坐标里的位置（连 m-auto 居中的边距一起
   *  实测进去），cx/cy 是锚点在视口内的落点；DOM 更新后把同一内容点拉回原地 */
  const zoomAnchorRef = useRef<{ ux: number; uy: number; cx: number; cy: number } | null>(null)
  const pairRef = useRef<HTMLDivElement | null>(null)
  const prevZoomRef = useRef(zoom)
  const layoutSizedRef = useRef(false)

  const applyZoom = useCallback(
    (next: number, cxIn?: number, cyIn?: number) => {
      const el = containerRef.current
      const pair = pairRef.current
      zoomAnchorRef.current = null
      if (el && pair && layoutSizedRef.current) {
        const cx = cxIn ?? el.clientWidth / 2
        const cy = cyIn ?? el.clientHeight / 2
        const pr = pair.getBoundingClientRect()
        const cr = el.getBoundingClientRect()
        zoomAnchorRef.current = {
          ux: cx - (pr.left - cr.left),
          uy: cy - (pr.top - cr.top),
          cx,
          cy
        }
      }
      const z = Math.min(4, Math.max(0.5, Math.round(next * 1000) / 1000))
      const s = useReaderStore.getState()
      if (z === s.zoom) return
      s.patch({ zoom: z })
      persistZoom(seriesId, z)
    },
    [seriesId]
  )

  // 缩放后（DOM 已更新、上屏前）按锚点补偿滚动：内容按 k=新/旧 缩放，
  // 把锚点处的内容点留在锚点屏幕位置。仅布局级缩放路径有锚
  // （原始尺寸适配走 transform，维持原行为）
  useLayoutEffect(() => {
    const el = containerRef.current
    const a = zoomAnchorRef.current
    const old = prevZoomRef.current
    prevZoomRef.current = zoom
    zoomAnchorRef.current = null
    if (!el || !a || old === zoom || old <= 0) return
    const k = zoom / old
    el.scrollLeft = Math.max(0, a.ux * k - a.cx)
    el.scrollTop = Math.max(0, a.uy * k - a.cy)
  }, [zoom])

  // 缩放跟随翻页/切话保持；只在换适配方式/阅读模式时复位（缩放语义变了）。
  // 组件因 key 切话重挂载，prevLayout 初值为 null：首挂载不复位，偏好恢复的缩放才能生效
  const prevLayout = useRef<string | null>(null)
  useEffect(() => {
    const key = `${mode}|${fit}`
    if (prevLayout.current !== null && prevLayout.current !== key) applyZoom(1)
    prevLayout.current = key
  }, [mode, fit, applyZoom])

  // Ctrl/⌘ + 滚轮缩放（监听器只挂一次，读 zoomRef 避免闭包过期）；
  // 以光标位置为锚点——指哪放大哪
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      applyZoom(
        zoomRef.current + (e.deltaY > 0 ? -0.1 : 0.1),
        e.clientX - rect.left,
        e.clientY - rect.top
      )
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [applyZoom])

  // 放大后按住左键拖动平移（滚轮之外的第二种平移方式）。
  // 移动超过阈值视为拖拽并吞掉随后的 click——否则拖完一松手顺手翻了页
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const dragMovedRef = useRef(false)
  const onMouseDown = (e: React.MouseEvent): void => {
    dragMovedRef.current = false
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
    const el = containerRef.current
    if (!el) return
    dragRef.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop }
    e.preventDefault()
  }
  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      const d = dragRef.current
      const el = containerRef.current
      if (!d || !el) return
      const dx = e.clientX - d.x
      const dy = e.clientY - d.y
      if (!dragMovedRef.current && Math.abs(dx) < 5 && Math.abs(dy) < 5) return
      dragMovedRef.current = true
      el.scrollLeft = d.left - dx
      el.scrollTop = d.top - dy
    }
    const onUp = (): void => {
      dragRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  const pagesToShow =
    mode === 'double' ? spreadPages(page, pageCount, rtl, widePages, spreadOffset) : [page]
  const isDouble = pagesToShow.length > 1

  // 双页两张图是一个整体：中缝无缝、缩放也不拆开。缩放统一放在包裹层按布局
  // 尺寸撑开（适高按高度、适宽按宽度；单页 width/height 适配同走这条路），
  // per-image transform 会绕各自中心放大——双页裂缝、且滚动区不含左/上溢出；
  // 只有单页「原始尺寸」保留 transform 缩放
  const layoutSized = isDouble || fit !== 'original'
  layoutSizedRef.current = layoutSized

  const fitImgStyle: React.CSSProperties = {
    transform: `rotate(${rotate}deg)`,
    transition: 'transform 120ms ease-out',
    flexShrink: 0,
    ...(fit === 'height'
      ? { height: '100%', width: 'auto' }
      : { width: isDouble ? '50%' : '100%', height: 'auto' })
  }
  const fitStyle: React.CSSProperties =
    fit === 'height' ? { height: `${zoom * 100}%` } : { width: `${zoom * 100}%` }

  const originalImgStyle: React.CSSProperties = {
    transform: `rotate(${rotate}deg) scale(${zoom})`,
    transition: 'transform 120ms ease-out',
    maxHeight: '100%',
    maxWidth: '100%',
    objectFit: 'contain' as const
  }

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full cursor-grab overflow-auto active:cursor-grabbing"
      onMouseDown={onMouseDown}
      onClick={(e) => {
        // 刚结束的拖拽平移不算点击，不翻页
        if (dragMovedRef.current) {
          dragMovedRef.current = false
          return
        }
        // 左 1/3 上一页，右 1/3 下一页（RTL 时方向相反）；末屏再翻由外层
        // 越界接管进前后话（goNext/goPrev），没有外层入口时退回章节内钳位
        const x = e.clientX / window.innerWidth
        const forward = rtl ? x < 0.33 : x > 0.66
        const back = rtl ? x > 0.66 : x < 0.33
        if (forward) (onNext ?? next)()
        else if (back) (onPrev ?? prev)()
      }}
    >
      {/* 居中交给 m-auto：内容小于视口时居中；大于视口时 auto 边距归零、靠齐
          起点，四个方向的溢出都落在滚动范围内（items/justify-center 会把左/上
          溢出留在滚不到的位置——拖动范围缩水、显示不全的根因）。
          shrink-0 禁止 flex 收缩，否则放大超过视口后被压回、Zoom 失效 */}
      {layoutSized ? (
        <div ref={pairRef} className="m-auto flex shrink-0 items-center" style={fitStyle}>
          {pagesToShow.map((p) => (
            <PageImage
              key={p}
              src={pageUrl(chapterId, p)}
              alt={`第 ${p + 1} 页`}
              eager
              style={fitImgStyle}
              className="select-none"
            />
          ))}
        </div>
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <PageImage
            key={pagesToShow[0]}
            src={pageUrl(chapterId, pagesToShow[0])}
            alt={`第 ${pagesToShow[0] + 1} 页`}
            eager
            style={originalImgStyle}
            className="select-none"
          />
        </div>
      )}

      {/* 悬浮缩放控制（右下，避开顶栏） */}
      <div className="absolute bottom-10 right-4 flex gap-1 rounded-lg bg-black/60 p-1 backdrop-blur">
        <ZoomBtn label="−" onClick={() => applyZoom(zoom - 0.1)} />
        <span className="grid w-12 place-items-center text-xs text-white/90">
          {Math.round(zoom * 100)}%
        </span>
        <ZoomBtn label="＋" onClick={() => applyZoom(zoom + 0.1)} />
        <ZoomBtn
          label="⟲"
          onClick={() => {
            setPage(page)
            applyZoom(1)
          }}
        />
      </div>
    </div>
  )
})

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
 * 切话由外层 key=chapterId 强制重挂（实例不保留，extras/scrollTop 全新开始）。
 */
export const WebtoonViewer = memo(function WebtoonViewer({
  chapterId,
  seriesId,
  initialPage = 0,
  onPosition = () => {},
  onNext
}: ImageViewerProps) {
  const storePageCount = useReaderStore((s) => s.pageCount)
  const zoom = useReaderStore((s) => s.zoom)
  const ref = useRef<HTMLDivElement>(null)

  /** Ctrl+滚轮/触控板捏合缩放（0.5–4x，视口中心锚定）。走宽度级缩放而非 transform：
   *  放大后图片按新显示尺寸重新解码，细节不糊（transform 只会拉伸已解码位图）。
   *  缩放值放 store 并按系列持久化：翻页/切话/跨话拼接都保持 */
  const stripRef = useRef<HTMLDivElement>(null)
  const pendingAnchor = useRef<{
    el: HTMLElement
    intra: number
    oldW: number
    contentX: number
    viewX: number
    viewY: number
  } | null>(null)

  /** 缩放前抓锚点：锚点（光标，缺省视口中心）落在条带的哪个子元素内、
   *  相对高度多少、内容坐标多少；viewX/viewY 是锚点在视口内的落点，
   *  缩放后把同一内容点拉回这个位置 */
  const zoomTo = (next: number, px?: number, py?: number): void => {
    const el = ref.current
    const strip = stripRef.current
    if (!el || !strip) return
    const z = Math.min(4, Math.max(0.5, Math.round(next * 1000) / 1000))
    const s = useReaderStore.getState()
    if (z === s.zoom) return
    const elRect = el.getBoundingClientRect()
    const stripRect = strip.getBoundingClientRect()
    const anchorX = px ?? elRect.left + el.clientWidth / 2
    const anchorY = py ?? elRect.top + el.clientHeight / 2
    const contentX = anchorX - stripRect.left
    const contentY = anchorY - stripRect.top
    const viewX = anchorX - elRect.left
    const viewY = anchorY - elRect.top
    // 找包含锚点的子元素（找不到就停在条带根部，锚定退化为按比例）
    let anchor: HTMLElement = strip
    let intra = 0
    for (const k of Array.from(strip.children) as HTMLElement[]) {
      const r = k.getBoundingClientRect()
      const top = r.top - stripRect.top
      if (r.height > 0 && contentY >= top && contentY <= top + r.height) {
        anchor = k
        intra = (contentY - top) / r.height
        break
      }
    }
    pendingAnchor.current = { el: anchor, intra, oldW: strip.offsetWidth, contentX, viewX, viewY }
    s.patch({ zoom: z })
    persistZoom(seriesId, z)
  }
  const zoomToRef = useRef(zoomTo)
  zoomToRef.current = zoomTo

  // 缩放后（DOM 已更新、上屏前）把锚点拉回视口中心：
  // y 用「元素内相对位置」换算——下方未加载的懒加载图高度为 0 不随缩放变，
  // 按整条带比例换算会漂；x 按条带宽度比例（宽度缩放是均匀的）即可
  useLayoutEffect(() => {
    const el = ref.current
    const strip = stripRef.current
    const a = pendingAnchor.current
    if (!el || !strip || !a) return
    pendingAnchor.current = null
    if (!a.el.isConnected) return
    const ratio = a.oldW > 0 ? strip.offsetWidth / a.oldW : 1
    el.scrollLeft = Math.max(
      0,
      Math.min(el.scrollWidth - el.clientWidth, a.contentX * ratio - a.viewX)
    )
    const stripRect = strip.getBoundingClientRect()
    const r = a.el.getBoundingClientRect()
    el.scrollTop = r.top - stripRect.top + a.intra * r.height - a.viewY
  }, [zoom])

  /** 拼接进来的后续话（key 重挂后必为空起步） */
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

  // 初始定位完成前不回报位置：懒加载图高度为 0 时视口中线会先命中第 0 页，
  // 把恢复页覆盖成 0 还节流落库（这正是条漫进度回退 bug 的根因）
  const readyForReport = useRef(initialPage <= 0)

  useCurrentPageObserver(ref, (global) => {
    if (!readyForReport.current) return
    onPosition(locate(global))
    // 距条带末尾（nextStart = 拼接话的全局起点）不足 2 页就提前拼接，滚动到分界时不顿挫
    if (baseCount > 0 && !noMoreRef.current && global >= nextStart - 2) {
      tryAppendRef.current()
    }
  })

  // 恢复起始页：占位高度下的粗定位 + 目标页图片真实加载后再校一次。
  // 页数未知（baseCount=0）时挂起，待回填后 effect 重跑
  const initialDone = useRef(false)
  useEffect(() => {
    if (initialDone.current || baseCount <= 0) return
    const t = Math.min(Math.max(initialPage, 0), baseCount - 1)
    if (t <= 0) {
      initialDone.current = true
      return
    }
    initialDone.current = true
    const container = ref.current
    if (!container) return
    const selector = `div[data-page="${t}"], img[data-page="${t}"]`
    const scrollToTarget = (): boolean => {
      const el = container.querySelector<HTMLElement>(selector)
      if (!el) return false
      el.scrollIntoView({ block: 'start' })
      return true
    }
    const open = (): void => {
      readyForReport.current = true
    }
    const settle = (): void => {
      if (scrollToTarget()) open()
    }
    settle()
    const img = container.querySelector<HTMLElement>(`${selector} img`)
    img?.addEventListener('load', settle, { once: true })
    const timer = setTimeout(() => {
      settle()
      open() // 兜底：任何路径都不能永久堵死位置回报
    }, 800)
    return () => {
      img?.removeEventListener('load', settle)
      clearTimeout(timer)
    }
  }, [baseCount, initialPage])

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
      if (e.ctrlKey) {
        // Ctrl+滚轮缩放（触控板双指捏合也以 ctrlKey wheel 派发），光标锚定；
        // 必须 preventDefault，否则 Electron 窗口会做整页缩放
        e.preventDefault()
        zoomToRef.current(
          useReaderStore.getState().zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1),
          e.clientX,
          e.clientY
        )
        return
      }
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
    <>
      <div ref={ref} className="h-full overflow-y-auto bg-black">
        {/* 缩放即改条带宽度（zoom=1 时等价于原来的 max-w-3xl）；放大超宽时
            overflow-y-auto 的另一轴按规范计算为 auto，横向滚动自动出现 */}
        <div
          ref={stripRef}
          className="mx-auto"
          style={{ width: `calc(min(100%, 768px) * ${zoom})`, maxWidth: 'none' }}
        >
          {Array.from({ length: baseCount }, (_, p) => (
            // 占位高度：懒加载图高度为 0，没有保底高度时恢复定位/缩放锚点全部失真；
            // 图片加载后真实高度大于占位自然撑开，条漫页通常远高于此值
            <div key={p} data-page={p} style={{ minHeight: '50vh' }}>
              <PageImage
                src={pageUrl(chapterId, p)}
                alt={`第 ${p + 1} 页`}
                eager={p >= initialPage - 6 && p <= initialPage + 2}
                className="block w-full"
              />
            </div>
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

      {/* 悬浮缩放控制（右下，与单双页模式一致；⟲ 复位缩放） */}
      <div className="absolute bottom-10 right-4 flex gap-1 rounded-lg bg-black/60 p-1 backdrop-blur">
        <ZoomBtn label="−" onClick={() => zoomTo(zoom - 0.1)} />
        <span className="grid w-12 place-items-center text-xs text-white/90">
          {Math.round(zoom * 100)}%
        </span>
        <ZoomBtn label="＋" onClick={() => zoomTo(zoom + 0.1)} />
        <ZoomBtn label="⟲" onClick={() => zoomTo(1)} />
      </div>
    </>
  )
})
