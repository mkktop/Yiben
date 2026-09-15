import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAsync } from '@/hooks/useAsync'
import { usePagePreload } from './usePagePreload'
import { ImageViewer, WebtoonViewer } from './ImageViewer'
import { PdfViewer } from './PdfViewer'
import { ReaderChrome } from './ReaderChrome'
import {
  useReaderStore,
  atLastScreen,
  patchReaderPrefs,
  resumeStartPage,
  type ReaderMode
} from '@/stores/reader'
import { useDataStore } from '@/stores/data'
import { pageUrl, type BookmarkInfo, type ReaderChapterInfo } from '@shared/types'

const IDLE_MS = 2200

interface Neighbors {
  index: number
  total: number
  prev: { id: number; title: string; page_count: number; kind: string } | null
  next: { id: number; title: string; page_count: number; kind: string } | null
}

/** 底部短暂浮出的提示（方向提示 / 跨页配对反馈） */
export interface ReaderHint {
  kind: 'direction' | 'text'
  rtl?: boolean
  text?: string
}

export function ReaderPage() {
  const { chapterId } = useParams()
  const navigate = useNavigate()
  const [search, setSearch] = useSearchParams()
  const { data: info, error } = useAsync<ReaderChapterInfo | null>(
    () => window.yiben.reader.chapter(Number(chapterId)),
    [chapterId]
  )
  // 细粒度订阅：setPage 在条漫滚动/翻页时极高频，订阅整个 store 会让阅读器子树跟着整帧 reconcile
  const mode = useReaderStore((s) => s.mode)
  const page = useReaderStore((s) => s.page)
  const pageCount = useReaderStore((s) => s.pageCount)
  const setPage = useReaderStore((s) => s.setPage)

  /**
   * 返回：能 back 就 back。
   * navigate(-1) 在个别环境（dev/HMR）下可能静默无效，250ms 后若仍在阅读器则显式回主页兜底；
   * back 成功时本组件卸载，定时器被清理，兜底不会触发。
   */
  const backTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const goBack = useCallback(() => {
    if (backTimer.current) clearTimeout(backTimer.current)
    const state = window.history.state as { idx?: number } | null
    const idx = typeof state?.idx === 'number' ? state.idx : -1
    if (idx > 0) {
      backTimer.current = setTimeout(() => {
        if (window.location.hash.includes('/reader/')) navigate('/', { replace: true })
      }, 250)
      navigate(-1)
      return
    }
    navigate('/')
  }, [navigate])

  useEffect(() => () => { if (backTimer.current) clearTimeout(backTimer.current) }, [])

  /** 已发起初始化的章节（按章节各初始化一次） */
  const initFor = useRef<number | null>(null)
  /** 初始化完成的章节：在此之前不写进度，避免用默认页数误判「已读完」 */
  const readyFor = useRef<number | null>(null)
  /** 方向提示每次进入阅读器只展示一次 */
  const dirHintShown = useRef(false)
  /** 底部提示浮层（阅读方向 / 跨页配对反馈） */
  const [hint, setHint] = useState<ReaderHint | null>(null)

  const chapter = info?.chapter ?? null
  const activeId = chapter?.id ?? 0
  const seriesId = chapter?.series_id ?? 0

  /**
   * 条漫跨话连续滚动：视口滚进拼接的下一话时，进度/页码归属软切换到那一话
   * （不导航不重载）；滚回上一话则切回。null = 仍在路由话。
   */
  const [embedded, setEmbedded] = useState<{
    id: number
    title: string
    pageCount: number
    start: number
  } | null>(null)
  const embeddedRef = useRef(embedded)
  embeddedRef.current = embedded
  /** 进度/书签/页码指示的归属话：嵌入话优先 */
  const positionId = embedded?.id ?? activeId
  const positionCount = embedded?.pageCount ?? pageCount

  /** 视口位置回报（条漫观察者驱动）：软切换 store 的页码与页数归属 */
  const onPosition = useCallback(
    (pos: { chapterId: number; title: string; page: number; pageCount: number; start: number }) => {
      setEmbedded(
        pos.chapterId === chapter?.id
          ? null
          : { id: pos.chapterId, title: pos.title, pageCount: pos.pageCount, start: pos.start }
      )
      useReaderStore.setState({ page: pos.page, pageCount: pos.pageCount })
    },
    [chapter?.id]
  )

  /** 条带内按「当前话局部页码」滚动（嵌入话要加上其全局起始偏移） */
  const scrollStripTo = useCallback((localPage: number, absolute = false): void => {
    const offset = absolute ? 0 : embeddedRef.current?.start ?? 0
    document
      .querySelector(`img[data-page="${localPage + offset}"], div[data-page="${localPage + offset}"]`)
      ?.scrollIntoView({ block: 'start' })
  }, [])

  // 书签深链（/reader/:id?p=N）；普通进入时未读完恢复进度、已读完从头开始
  const deepParam = search.get('p')
  const deepPage =
    deepParam != null && Number.isFinite(Number(deepParam)) ? Math.max(0, Number(deepParam) - 1) : null
  const startPage =
    deepPage ?? resumeStartPage(info?.progress ?? null, chapter?.page_count ?? 0)

  useEffect(() => {
    if (!chapter || initFor.current === chapter.id) return
    // await 之后章节可能已被切走（快速切话/深链跳转），apply 前必须校验，
    // 否则旧话的结果会覆盖新话的页数/起始页，还把 readyFor 写成旧 id 导致新话进度永不落库
    const myId = chapter.id
    const mySeriesId = chapter.series_id
    const myPageCount = chapter.page_count
    initFor.current = myId
    void (async () => {
      // 全局默认 < 按系列记忆
      const [prefs, defaults] = await Promise.all([
        window.yiben.reader.getPrefs(mySeriesId),
        window.yiben.reader.getDefaults().catch(() => ({}))
      ])
      if (initFor.current !== myId) return
      useReaderStore.getState().init({ ...defaults, ...prefs }, myPageCount, startPage)
      readyFor.current = myId
      // 方向提示：每次进入阅读器提示一次；条漫纵向阅读没有方向
      if (!dirHintShown.current) {
        dirHintShown.current = true
        const s = useReaderStore.getState()
        if (s.mode !== 'webtoon') setHint({ kind: 'direction', rtl: s.rtl })
      }
      // 用完即清，避免返回再进时又跳到深链页
      if (deepPage != null) {
        search.delete('p')
        setSearch(search, { replace: true })
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter?.id])

  // 云端压缩包整包下载后主进程才知道真实页数，收到推送后刷新并重新钳位页码
  useEffect(() => {
    if (!activeId) return
    return window.yiben.events.onChapterPageCount(({ chapterId: id, pageCount: count }) => {
      if (id !== activeId || count <= 0) return
      // 正读着拼接话时 store 的页数属于拼接话，路由话的回填不能覆盖
      if (embeddedRef.current) return
      const s = useReaderStore.getState()
      useReaderStore.setState({ pageCount: count })
      s.setPage(s.page)
      // 系列页/书架的页数展示也跟着刷新
      useDataStore.getState().bump()
    })
  }, [activeId])

  // ---------- 进度 ----------

  // 进度节流写入；pending 自带章节信息，避免切章节时把进度写到错误的话
  const pending = useRef<{ chapterId: number; page: number; pageCount: number } | null>(null)
  const flush = useCallback(() => {
    const p = pending.current
    if (!p) return
    pending.current = null
    // 页数未知（0）时不判定完成，避免 PDF/云端压缩包一打开就被标记已读
    const completed = p.pageCount > 0 && p.page >= p.pageCount - 1
    void window.yiben.progress.save(p.chapterId, p.page, completed).catch(() => {})
  }, [])

  // ---------- 跨话导航 ----------

  const [neighbors, setNeighbors] = useState<Neighbors | null>(null)
  useEffect(() => {
    setNeighbors(null)
    if (!activeId) return
    void window.yiben.reader
      .neighbors(activeId)
      .then((n) => setNeighbors(n))
      .catch(() => {})
  }, [activeId])

  const openChapter = useCallback(
    (id: number, atPage1based?: number) => {
      // flush 由卸载兜底；先清 init 标记让新章节重新初始化
      flush()
      navigate(atPage1based != null ? `/reader/${id}?p=${atPage1based}` : `/reader/${id}`)
    },
    [navigate, flush]
  )

  /** 越界感知的下一页：当前屏已含末页时进下一话（双页模式最后一屏可能是两页） */
  const goNext = useCallback(() => {
    const s = useReaderStore.getState()
    if (
      atLastScreen(s.page, s.pageCount, s.mode, s.widePages, s.spreadOffset) &&
      neighborsRef.current?.next
    ) {
      openChapter(neighborsRef.current.next.id)
      return
    }
    s.next()
  }, [openChapter])

  /**
   * 越界感知的上一页：首页回上一话。
   * 回退跨话落在上一话末页（?p= 深链），倒着读才连贯；页数未知时退回普通入口。
   */
  const goPrev = useCallback(() => {
    const s = useReaderStore.getState()
    const prev = neighborsRef.current?.prev
    if (s.page <= 0 && prev) {
      openChapter(prev.id, prev.page_count > 0 ? prev.page_count : undefined)
      return
    }
    s.prev()
  }, [openChapter])

  /** 显式跳话（顶栏按钮）：不管当前读到哪，直接进前后话 */
  const goNextChapter = useCallback(() => {
    const n = neighborsRef.current?.next
    if (n) openChapter(n.id)
  }, [openChapter])
  const goPrevChapter = useCallback(() => {
    const n = neighborsRef.current?.prev
    if (n) openChapter(n.id)
  }, [openChapter])

  const neighborsRef = useRef<Neighbors | null>(null)
  neighborsRef.current = neighbors

  // ---------- 双页模式的跨页识别 ----------

  useEffect(() => {
    if (!activeId || mode !== 'double') return
    const apply = (id: number, dims: Array<{ idx: number; w: number; h: number }>): void => {
      if (id !== activeId) return
      useReaderStore.getState().setWidePages(dims.filter((d) => d.w > d.h).map((d) => d.idx))
    }
    void window.yiben.reader.pageDims(activeId).then((r) => apply(activeId, r.dims)).catch(() => {})
    return window.yiben.events.onChapterPageDims(({ chapterId: id, dims }) => apply(id, dims))
  }, [activeId, mode])

  // 页数回填（云端整包下载完成）后可能又多了待探测的页，双页模式下补一次
  useEffect(() => {
    if (!activeId || mode !== 'double' || pageCount <= 0) return
    void window.yiben.reader.pageDims(activeId).catch(() => {})
  }, [activeId, mode, pageCount])

  // ---------- 书签 ----------

  const [bookmarks, setBookmarks] = useState<BookmarkInfo[]>([])
  useEffect(() => {
    if (!seriesId) return
    void window.yiben.bookmarks
      .list(seriesId)
      .then(setBookmarks)
      .catch(() => {})
  }, [seriesId])

  const isBookmarked = bookmarks.some((b) => b.chapter_id === positionId && b.page === page)

  const toggleBookmark = useCallback(() => {
    const ch = chapter
    if (!ch) return
    const cur = useReaderStore.getState().page
    const targetId = embeddedRef.current?.id ?? ch.id
    const targetTitle = embeddedRef.current?.title || ch.title
    void window.yiben.bookmarks
      .toggle(targetId, cur)
      .then((on) => {
        setBookmarks((list) =>
          on
            ? [
                ...list,
                { chapter_id: targetId, chapter_title: targetTitle, page: cur, created_at: Date.now() }
              ]
            : list.filter((b) => !(b.chapter_id === targetId && b.page === cur))
        )
      })
      .catch(() => {})
  }, [chapter])

  /** 跳页：同话直接定位（条漫滚动），跨话经深链进对应章节 */
  const jumpTo = useCallback(
    (targetChapterId: number, page0: number) => {
      // 目标是路由话而当前归属在拼接话：同一路由仅 search 变化不会重挂组件，
      // ?p= 深链形同空操作——就地清掉软切换滚回路由话
      if (targetChapterId === activeId && embeddedRef.current) {
        flush()
        setEmbedded(null)
        useReaderStore.setState({ pageCount: chapter?.page_count ?? 0 })
        useReaderStore.getState().setPage(page0)
        if (useReaderStore.getState().mode === 'webtoon') scrollStripTo(page0, true)
        return
      }
      if (targetChapterId !== positionId) {
        flush()
        navigate(`/reader/${targetChapterId}?p=${page0 + 1}`)
        return
      }
      useReaderStore.getState().setPage(page0)
      if (useReaderStore.getState().mode === 'webtoon') {
        scrollStripTo(page0)
      } else {
        document
          .querySelector(`img[data-page="${page0}"], div[data-page="${page0}"]`)
          ?.scrollIntoView({ block: 'start' })
      }
    },
    [activeId, positionId, chapter, navigate, scrollStripTo, flush]
  )

  // ---------- 进度 ----------

  // 进度节流写入的 effect 与离开页面时的补写。
  // 归属话（positionId）随条漫跨话软切换：写到视口当前所在的那一话
  useEffect(() => {
    if (!chapter || readyFor.current !== chapter.id) return
    pending.current = { chapterId: positionId, page, pageCount: positionCount }
    const timer = setTimeout(flush, 400)
    return () => clearTimeout(timer)
  }, [chapter, positionId, positionCount, page, pageCount, flush])

  // 离开阅读器时补写最后一次进度
  useEffect(() => () => flush(), [flush])

  // 刷新/关闭窗口时渲染进程直接销毁，unmount 清理不保证执行，用 pagehide 补写
  useEffect(() => {
    const onHide = (): void => flush()
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [flush])

  // 提示浮层自动消失
  useEffect(() => {
    if (!hint) return
    const timer = setTimeout(() => setHint(null), 2400)
    return () => clearTimeout(timer)
  }, [hint])

  // ---------- 跨页配对（双页模式下 C 键切换，按系列记忆） ----------

  const toggleSpreadOffset = useCallback(() => {
    const s = useReaderStore.getState()
    if (s.mode !== 'double') {
      setHint({ kind: 'text', text: '跨页配对在双页模式下可用（M 切换）' })
      return
    }
    const next = s.spreadOffset === 1 ? 0 : 1
    s.patch({ spreadOffset: next })
    setHint({
      kind: 'text',
      text:
        next === 1
          ? '跨页配对：第 1 页单独，之后两两配对'
          : '跨页配对：从第 1 页起两两配对'
    })
    if (chapter) {
      void window.yiben.reader.setPrefs(chapter.series_id, { spreadOffset: next }).catch(() => {})
    }
  }, [chapter])

  // ---------- 邻话预取（跨话切换首屏零等待；PDF 走 pdfjs，不走图片协议） ----------

  useEffect(() => {
    if (!neighbors) return
    const warm = (ch: { id: number; page_count: number; kind: string } | null, pages: number[]): void => {
      if (!ch || ch.kind === 'pdf') return
      for (const p of pages) {
        if (p < 0) continue
        const img = new Image()
        img.src = pageUrl(ch.id, p)
      }
    }
    if (neighbors.next) warm(neighbors.next, [0, 1])
    if (neighbors.prev) warm(neighbors.prev, [neighbors.prev.page_count - 1])
  }, [neighbors])

  // 预加载 前5后2 页（PDF 走 pdfjs，不走图片协议）；跨话软切换后预载跟随归属话
  usePagePreload(positionId, page, positionCount, 5, 2, chapter?.kind !== 'pdf')

  // 沉浸模式：鼠标静止自动隐藏
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const reveal = (): void => {
      if (useReaderStore.getState().immersive) useReaderStore.setState({ immersive: false })
      if (idleTimer.current) clearTimeout(idleTimer.current)
      idleTimer.current = setTimeout(() => useReaderStore.setState({ immersive: true }), IDLE_MS)
    }
    reveal()
    window.addEventListener('mousemove', reveal)
    return () => {
      window.removeEventListener('mousemove', reveal)
      if (idleTimer.current) clearTimeout(idleTimer.current)
    }
  }, [])

  // 全屏状态跟踪
  const [isFullscreen, setIsFullscreen] = useState(false)
  useEffect(() => {
    const onFs = (): void => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  const toggleFullscreen = useCallback((): void => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen()
  }, [])

  const onModeChange = useCallback(
    (mode: ReaderMode): void => {
      if (chapter) patchReaderPrefs(chapter.series_id, { mode })
      else useReaderStore.getState().patch({ mode })
    },
    [chapter]
  )

  // 帮助/书签面板（ReaderChrome 展示，这里持有状态让快捷键和按钮共用）；ref 供快捷键读取最新值
  const [panel, setPanel] = useState<'none' | 'bookmarks' | 'help'>('none')
  const panelRef = useRef(panel)
  panelRef.current = panel

  // 快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      const s = useReaderStore.getState()
      // 帮助是全屏模态：打开期间按键不穿透到阅读操作
      if (panelRef.current === 'help' && e.key !== 'Escape' && e.key !== '?') return

      // 条漫是垂直阅读，翻页等价于滚到相邻页；其余模式走 spread 步进（越界进前后话）
      const step = (delta: number): void => {
        if (s.mode === 'webtoon') {
          const target = s.page + delta
          if (target < 0) {
            // 嵌入话的第 0 页再往上：滚回上一话（路由话）末页，观察者自动切回归属
            const emb = embeddedRef.current
            if (emb && emb.start > 0) {
              const routeLast = emb.start - 1
              s.setPage(routeLast)
              scrollStripTo(routeLast)
              return
            }
            goPrev()
            return
          }
          if (s.pageCount > 0 && target > s.pageCount - 1) {
            // 跨话拼接后条带末尾属于拼接话：到底就停住，顶栏可继续跳话
            if (embeddedRef.current) return
            goNext()
            return
          }
          s.setPage(target)
          scrollStripTo(target)
          return
        }
        if (delta > 0) goNext()
        else goPrev()
      }

      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
        case ' ':
        case 'PageDown':
          e.preventDefault()
          step(1)
          break
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'Backspace':
        case 'PageUp':
          e.preventDefault()
          step(-1)
          break
        case 'Home':
          e.preventDefault()
          if (s.mode === 'webtoon') {
            // 条漫：回到条带最顶（路由话第 1 页），滚回去的路上观察者会自动软切换归属
            s.setPage(0)
            scrollStripTo(0, true)
          } else s.setPage(0)
          break
        case 'End':
          e.preventDefault()
          if (s.mode === 'webtoon') {
            s.setPage(s.pageCount - 1)
            scrollStripTo(s.pageCount - 1)
          } else s.setPage(s.pageCount - 1)
          break
        case 'd':
        case 'D':
          // 顶栏按钮/帮助面板均标注 D 为方向切换（此前误绑成单双页切换）
          if (chapter) patchReaderPrefs(chapter.series_id, { rtl: !s.rtl })
          else s.patch({ rtl: !s.rtl })
          break
        case 'c':
        case 'C':
          toggleSpreadOffset()
          break
        case 'm':
        case 'M': {
          const order: ReaderMode[] = ['single', 'double', 'webtoon']
          onModeChange(order[(order.indexOf(s.mode) + 1) % order.length])
          break
        }
        case 's':
        case 'S': {
          const nextFit =
            s.fit === 'width' ? 'height' : s.fit === 'height' ? 'original' : 'width'
          if (chapter) patchReaderPrefs(chapter.series_id, { fit: nextFit })
          else s.patch({ fit: nextFit })
          break
        }
        case 'r':
        case 'R': {
          const nextRotate = ((s.rotate + 90) % 360) as number
          if (chapter) patchReaderPrefs(chapter.series_id, { rotate: nextRotate })
          else s.patch({ rotate: nextRotate })
          break
        }
        case 't':
        case 'T':
          s.toggleThumbs()
          break
        case 'b':
        case 'B':
          toggleBookmark()
          break
        case 'f':
        case 'F':
          toggleFullscreen()
          break
        case 'Enter':
          // 沉浸模式：隐藏/显示界面（鼠标移动会自动恢复）
          e.preventDefault()
          s.toggleImmersive()
          break
        case '?':
          e.preventDefault()
          setPanel((v) => (v === 'help' ? 'none' : 'help'))
          break
        case 'Escape':
          // 面板开着时先关面板，不退出阅读器
          if (panelRef.current !== 'none') {
            setPanel('none')
            break
          }
          if (!document.fullscreenElement) goBack()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    onModeChange,
    toggleFullscreen,
    toggleBookmark,
    toggleSpreadOffset,
    goNext,
    goPrev,
    jumpTo,
    activeId,
    chapter,
    goBack
  ])

  if (error) {
    return (
      <div className="grid h-screen place-items-center bg-black px-8 text-center text-sm text-white/60">
        章节加载失败：{error}
      </div>
    )
  }

  if (!info || !chapter) {
    return (
      <div className="grid h-screen place-items-center bg-black text-sm text-white/40">
        加载中…
      </div>
    )
  }

  return (
    <div className="relative h-screen overflow-hidden bg-black">
      {chapter.kind === 'pdf' ? (
        <PdfViewer
          info={info}
          initialPage={startPage}
          onCurrentPage={(p) => setPage(p)}
        />
      ) : mode === 'webtoon' ? (
        // key=activeId：切话强制重挂。否则路由参数变化时组件实例保留，
        // 条带按旧话冻结页数渲染新话 URL（破图闪烁），scrollTop 也只靠内容塌缩偶然钳位
        <WebtoonViewer
          key={activeId}
          chapterId={activeId}
          seriesId={seriesId}
          initialPage={startPage}
          onPosition={onPosition}
          onNext={goNext}
        />
      ) : (
        // 点击区与键盘同一条越界感知链路：末屏点击直接进下一话（首页回上一话末页）
        <ImageViewer
          key={`${activeId}-${mode}`}
          chapterId={activeId}
          seriesId={seriesId}
          onNext={goNext}
          onPrev={goPrev}
        />
      )}

      <ReaderChrome
        chapterId={activeId}
        seriesId={seriesId}
        seriesTitle={chapter.series_title}
        chapterTitle={chapter.title}
        canThumbnail={chapter.kind !== 'pdf'}
        isFullscreen={isFullscreen}
        toggleFullscreen={toggleFullscreen}
        onModeChange={onModeChange}
        onNextChapter={goNextChapter}
        onPrevChapter={goPrevChapter}
        neighbors={neighbors}
        bookmarks={bookmarks}
        isBookmarked={isBookmarked}
        onToggleBookmark={toggleBookmark}
        onJump={jumpTo}
        onBack={goBack}
        onToggleSpreadOffset={toggleSpreadOffset}
        hint={hint}
        onHintClose={() => setHint(null)}
        panel={panel}
        onPanelChange={setPanel}
      />
    </div>
  )
}
