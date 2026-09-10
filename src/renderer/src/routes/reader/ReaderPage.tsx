import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAsync } from '@/hooks/useAsync'
import { usePagePreload } from './usePagePreload'
import { ImageViewer, WebtoonViewer } from './ImageViewer'
import { PdfViewer } from './PdfViewer'
import { ReaderChrome } from './ReaderChrome'
import { useReaderStore, type ReaderMode } from '@/stores/reader'
import { useDataStore } from '@/stores/data'
import type { ReaderChapterInfo } from '@shared/types'

const IDLE_MS = 2200

export function ReaderPage() {
  const { chapterId } = useParams()
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
  const startPage = info?.progress?.page ?? 0

  useEffect(() => {
    if (!chapter || initFor.current === chapter.id) return
    initFor.current = chapter.id
    void (async () => {
      const prefs = await window.yiben.reader.getPrefs(chapter.series_id)
      useReaderStore.getState().init(prefs, chapter.page_count, startPage)
      readyFor.current = chapter.id
    })()
  }, [chapter, startPage])

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

  // 快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      const s = useReaderStore.getState()

      const scrollTo = (target: number): void => {
        s.setPage(target)
        document
          .querySelector(`img[data-page="${useReaderStore.getState().page}"]`)
          ?.scrollIntoView({ block: 'start' })
      }
      // 条漫是垂直阅读，翻页等价于滚到相邻页；其余模式走 spread 步进
      const step = (delta: number): void => {
        if (s.mode !== 'webtoon') {
          if (delta > 0) s.next()
          else s.prev()
          return
        }
        scrollTo(s.page + delta)
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
          if (s.mode === 'webtoon') scrollTo(0)
          else s.setPage(0)
          break
        case 'End':
          e.preventDefault()
          if (s.mode === 'webtoon') scrollTo(s.pageCount - 1)
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
        case 'f':
        case 'F':
          toggleFullscreen()
          break
        case 'Escape':
          if (!document.fullscreenElement) window.history.back()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onModeChange, toggleFullscreen])

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
        <WebtoonViewer chapterId={activeId} onCurrentPage={(p) => store.setPage(p)} />
      ) : (
        <ImageViewer key={`${activeId}-${store.mode}`} chapterId={activeId} />
      )}

      <ReaderChrome
        chapterId={activeId}
        seriesTitle={chapter.series_title}
        chapterTitle={chapter.title}
        canThumbnail={chapter.kind !== 'pdf'}
        isFullscreen={isFullscreen}
        toggleFullscreen={toggleFullscreen}
        onModeChange={onModeChange}
      />
    </div>
  )
}
