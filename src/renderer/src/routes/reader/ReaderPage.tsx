import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAsync } from '@/hooks/useAsync'
import { usePagePreload } from './usePagePreload'
import { ImageViewer, WebtoonViewer } from './ImageViewer'
import { PdfViewer } from './PdfViewer'
import { ReaderChrome } from './ReaderChrome'
import { useReaderStore, type ReaderMode } from '@/stores/reader'
import { useDataStore } from '@/stores/data'
import type { BookmarkInfo, ReaderChapterInfo } from '@shared/types'

const IDLE_MS = 2200

interface Neighbors {
  index: number
  total: number
  prev: { id: number; title: string; page_count: number } | null
  next: { id: number; title: string; page_count: number } | null
}

export function ReaderPage() {
  const { chapterId } = useParams()
  const navigate = useNavigate()
  const [search, setSearch] = useSearchParams()
  const { data: info, error } = useAsync<ReaderChapterInfo | null>(
    () => window.yiben.reader.chapter(Number(chapterId)),
    [chapterId]
  )
  const store = useReaderStore()
  /** 已发起初始化的章节（按章节各初始化一次） */
  const initFor = useRef<number | null>(null)
  /** 初始化完成的章节：在此之前不写进度，避免用默认页数误判「已读完」 */
  const readyFor = useRef<number | null>(null)

  const chapter = info?.chapter ?? null
  const activeId = chapter?.id ?? 0
  const seriesId = chapter?.series_id ?? 0

  // 书签深链（/reader/:id?p=N）；progress 仍会照常记录
  const deepParam = search.get('p')
  const deepPage =
    deepParam != null && Number.isFinite(Number(deepParam)) ? Math.max(0, Number(deepParam) - 1) : null
  const startPage = deepPage ?? info?.progress?.page ?? 0

  useEffect(() => {
    if (!chapter || initFor.current === chapter.id) return
    initFor.current = chapter.id
    void (async () => {
      // 全局默认 < 按系列记忆
      const [prefs, defaults] = await Promise.all([
        window.yiben.reader.getPrefs(chapter.series_id),
        window.yiben.reader.getDefaults().catch(() => ({}))
      ])
      useReaderStore.getState().init({ ...defaults, ...prefs }, chapter.page_count, startPage)
      readyFor.current = chapter.id
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
    return window.yiben.events.onChapterPageCount(({ chapterId: id, pageCount }) => {
      if (id !== activeId || pageCount <= 0) return
      const s = useReaderStore.getState()
      useReaderStore.setState({ pageCount })
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
    void window.yiben.progress.save(p.chapterId, p.page, completed)
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
    (id: number) => {
      // flush 由卸载兜底；先清 init 标记让新章节重新初始化
      flush()
      navigate(`/reader/${id}`)
    },
    [navigate]
  )

  /** 越界感知的下一页：末页进下一话 */
  const goNext = useCallback(() => {
    const s = useReaderStore.getState()
    const atEnd = s.pageCount > 0 && s.page >= s.pageCount - 1
    if (atEnd && neighborsRef.current?.next) {
      openChapter(neighborsRef.current.next.id)
      return
    }
    s.next()
  }, [openChapter])

  /** 越界感知的上一页：首页回上一话（落点由其保存的进度决定） */
  const goPrev = useCallback(() => {
    const s = useReaderStore.getState()
    if (s.page <= 0 && neighborsRef.current?.prev) {
      openChapter(neighborsRef.current.prev.id)
      return
    }
    s.prev()
  }, [openChapter])

  const neighborsRef = useRef<Neighbors | null>(null)
  neighborsRef.current = neighbors

  // ---------- 双页模式的跨页识别 ----------

  useEffect(() => {
    if (!activeId || store.mode !== 'double') return
    const apply = (id: number, dims: Array<{ idx: number; w: number; h: number }>): void => {
      if (id !== activeId) return
      useReaderStore.getState().setWidePages(dims.filter((d) => d.w > d.h).map((d) => d.idx))
    }
    void window.yiben.reader.pageDims(activeId).then((r) => apply(activeId, r.dims)).catch(() => {})
    return window.yiben.events.onChapterPageDims(({ chapterId: id, dims }) => apply(id, dims))
  }, [activeId, store.mode])

  // 页数回填（云端整包下载完成）后可能又多了待探测的页，双页模式下补一次
  useEffect(() => {
    if (!activeId || store.mode !== 'double' || store.pageCount <= 0) return
    void window.yiben.reader.pageDims(activeId).catch(() => {})
  }, [activeId, store.mode, store.pageCount])

  // ---------- 书签 ----------

  const [bookmarks, setBookmarks] = useState<BookmarkInfo[]>([])
  useEffect(() => {
    if (!seriesId) return
    void window.yiben.bookmarks
      .list(seriesId)
      .then(setBookmarks)
      .catch(() => {})
  }, [seriesId])

  const isBookmarked = bookmarks.some(
    (b) => b.chapter_id === activeId && b.page === store.page
  )

  const toggleBookmark = useCallback(() => {
    const ch = chapter
    if (!ch) return
    const page = useReaderStore.getState().page
    void window.yiben.bookmarks.toggle(ch.id, page).then((on) => {
      setBookmarks((list) =>
        on
          ? [
              ...list,
              { chapter_id: ch.id, chapter_title: ch.title, page, created_at: Date.now() }
            ]
          : list.filter((b) => !(b.chapter_id === ch.id && b.page === page))
      )
    })
  }, [chapter])

  /** 跳页：同话直接定位（条漫滚动），跨话经深链进对应章节 */
  const jumpTo = useCallback(
    (targetChapterId: number, page0: number) => {
      if (targetChapterId !== activeId) {
        flush()
        navigate(`/reader/${targetChapterId}?p=${page0 + 1}`)
        return
      }
      useReaderStore.getState().setPage(page0)
      if (useReaderStore.getState().mode === 'webtoon') {
        document
          .querySelector(`img[data-page="${page0}"], div[data-page="${page0}"]`)
          ?.scrollIntoView({ block: 'start' })
      }
    },
    [activeId, navigate]
  )

  // ---------- 进度 ----------

  // 进度节流写入的 effect 与离开页面时的补写
  useEffect(() => {
    if (!chapter || readyFor.current !== chapter.id) return
    pending.current = { chapterId: chapter.id, page: store.page, pageCount: store.pageCount }
    const timer = setTimeout(flush, 400)
    return () => clearTimeout(timer)
  }, [chapter, store.page, store.pageCount, flush])

  // 离开阅读器时补写最后一次进度
  useEffect(() => () => flush(), [flush])

  // 预加载 ±3 页（PDF 走 pdfjs，不走图片协议）
  usePagePreload(activeId, store.page, store.pageCount, 3, chapter?.kind !== 'pdf')

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
      useReaderStore.getState().patch({ mode })
      if (chapter) {
        void window.yiben.reader.setPrefs(chapter.series_id, { mode })
      }
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

      // 条漫是垂直阅读，翻页等价于滚到相邻页；其余模式走 spread 步进（越界进前后话）
      const step = (delta: number): void => {
        if (s.mode === 'webtoon') {
          const target = s.page + delta
          if (target < 0) {
            goPrev()
            return
          }
          if (s.pageCount > 0 && target > s.pageCount - 1) {
            goNext()
            return
          }
          s.setPage(target)
          document
            .querySelector(`img[data-page="${target}"], div[data-page="${target}"]`)
            ?.scrollIntoView({ block: 'start' })
          return
        }
        if (delta > 0) goNext()
        else goPrev()
      }

      switch (e.key) {
        case 'ArrowRight':
        case ' ':
        case 'PageDown':
          e.preventDefault()
          step(1)
          break
        case 'ArrowLeft':
        case 'PageUp':
          e.preventDefault()
          step(-1)
          break
        case 'Home':
          e.preventDefault()
          if (s.mode === 'webtoon') jumpTo(activeId, 0)
          else s.setPage(0)
          break
        case 'End':
          e.preventDefault()
          if (s.mode === 'webtoon') jumpTo(activeId, s.pageCount - 1)
          else s.setPage(s.pageCount - 1)
          break
        case 'd':
        case 'D':
          onModeChange(s.mode === 'double' ? 'single' : 'double')
          break
        case 'm':
        case 'M': {
          const order: ReaderMode[] = ['single', 'double', 'webtoon']
          onModeChange(order[(order.indexOf(s.mode) + 1) % order.length])
          break
        }
        case 's':
        case 'S':
          s.patch({
            fit: s.fit === 'width' ? 'height' : s.fit === 'height' ? 'original' : 'width'
          })
          break
        case 'r':
        case 'R':
          s.patch({ rotate: ((s.rotate + 90) % 360) as number })
          break
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
          if (!document.fullscreenElement) window.history.back()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onModeChange, toggleFullscreen, toggleBookmark, goNext, goPrev, jumpTo, activeId])

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
          onCurrentPage={(p) => store.setPage(p)}
        />
      ) : store.mode === 'webtoon' ? (
        <WebtoonViewer
          chapterId={activeId}
          onCurrentPage={(p) => store.setPage(p)}
          onNext={goNext}
        />
      ) : (
        <ImageViewer
          key={`${activeId}-${store.mode}`}
          chapterId={activeId}
          onNext={goNext}
          onPrev={goPrev}
        />
      )}

      <ReaderChrome
        chapterId={activeId}
        seriesTitle={chapter.series_title}
        chapterTitle={chapter.title}
        canThumbnail={chapter.kind !== 'pdf'}
        isFullscreen={isFullscreen}
        toggleFullscreen={toggleFullscreen}
        onModeChange={onModeChange}
        onNext={goNext}
        onPrev={goPrev}
        neighbors={neighbors}
        bookmarks={bookmarks}
        isBookmarked={isBookmarked}
        onToggleBookmark={toggleBookmark}
        onJump={jumpTo}
        panel={panel}
        onPanelChange={setPanel}
      />
    </div>
  )
}
