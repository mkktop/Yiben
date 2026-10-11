import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { useReaderStore } from '@/stores/reader'
import { useDataStore } from '@/stores/data'
import { errorMessage } from '@/lib/utils'
import { useCurrentPageObserver } from './useCurrentPageObserver'
import type { ReaderChapterInfo } from '@shared/types'
import { createPdfLoad } from './pdfLoader'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

interface PdfViewerProps {
  info: ReaderChapterInfo
  /** 上次读到的页（PDF 页数此前恒为 0，起始页要等 numPages 拿到后才生效） */
  initialPage: number
  onCurrentPage: (page: number) => void
}

/** PDF：垂直连续、按可视区域懒渲染（pdf.js 在渲染进程渲染到 canvas） */
export function PdfViewer({ info, initialPage, onCurrentPage }: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null)
  const [error, setError] = useState('')
  const [colWidth, setColWidth] = useState(760)

  const chapterId = info.chapter.id

  useEffect(() => {
    // 切话竞态防护：加载在途时切走（卸载/换章节），闭包里的异步照跑，
    // setPdf 会把旧话文档写进新话、setState 把旧话页数写进新话的 store
    // （atLastScreen 可能因此误判「已读完」落库）。loadingTask.destroy 同时中断在途加载。
    let cancelled = false
    setError('')
    setPdf(null)
    const load = createPdfLoad(`yudu://file/${chapterId}`, {
      document: (options) => pdfjsLib.getDocument(options),
      range: (length, initial, request, abort) => {
        class Transport extends pdfjsLib.PDFDataRangeTransport {
          requestDataRange(begin: number, end: number): void {
            request(begin, end)
          }
          abort(): void {
            abort()
          }
        }
        return new Transport(length, initial)
      }
    })
    void (async () => {
      try {
        const doc = await load.promise
        if (cancelled) return
        setPdf(doc)
        useReaderStore.setState({ pageCount: doc.numPages })
        // 主进程驱动层不解析 PDF，页数由这里回填进数据库
        void window.yudu.reader
          .setPageCount(chapterId, doc.numPages)
          .then((changed) => {
            if (changed && !cancelled) useDataStore.getState().bump()
          })
          .catch(() => {})
      } catch (err) {
        if (!cancelled) setError(errorMessage(err))
      }
    })()
    return () => {
      cancelled = true
      load.cancel()
    }
  }, [chapterId])

  useCurrentPageObserver(containerRef, onCurrentPage)

  // 首次拿到 numPages 后跳到上次阅读位置
  const restoredFor = useRef(0)
  useEffect(() => {
    if (!pdf || restoredFor.current === chapterId) return
    restoredFor.current = chapterId
    const target = Math.min(Math.max(initialPage, 0), pdf.numPages - 1)
    if (target <= 0) return
    useReaderStore.getState().setPage(target)
    requestAnimationFrame(() => {
      containerRef.current
        ?.querySelector(`[data-page="${target}"]`)
        ?.scrollIntoView({ block: 'start' })
    })
  }, [pdf, chapterId, initialPage])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = (): void => setColWidth(Math.min(920, el.clientWidth - 48))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div ref={containerRef} className="h-full overflow-y-auto bg-neutral-900">
      <div className="mx-auto flex flex-col items-center gap-3 py-4">
        {error ? (
          <div className="pt-24 text-sm text-white/60">PDF 加载失败：{error}</div>
        ) : pdf ? (
          Array.from({ length: pdf.numPages }, (_, i) => (
            <PdfPage key={i} pdf={pdf} num={i + 1} width={colWidth} />
          ))
        ) : (
          <div className="pt-24 text-sm text-white/40">正在加载 PDF…</div>
        )}
      </div>
    </div>
  )
}

function PdfPage({
  pdf,
  num,
  width
}: {
  pdf: pdfjsLib.PDFDocumentProxy
  num: number
  width: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [ratio, setRatio] = useState(3 / 4)
  const [error, setError] = useState('')

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        setVisible(entries.some((e) => e.isIntersecting))
      },
      { root: el.parentElement?.parentElement, rootMargin: '800px 0px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) {
      const canvas = ref.current?.querySelector('canvas')
      if (canvas) {
        canvas.width = 0
        canvas.height = 0
      }
      ref.current?.replaceChildren()
      return
    }
    let cancelled = false
    let task: { cancel: () => void } | null = null
    let pageProxy: pdfjsLib.PDFPageProxy | null = null
    setError('')
    void (async () => {
      try {
        const page = await pdf.getPage(num)
        if (cancelled) return
        pageProxy = page
        const base = page.getViewport({ scale: 1 })
        setRatio(base.width / base.height)
        const viewport = page.getViewport({ scale: width / base.width })
        const canvas = document.createElement('canvas')
        canvas.width = viewport.width
        canvas.height = viewport.height
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        const render = page.render({ canvasContext: ctx, viewport, canvas })
        task = render
        await render.promise
        if (cancelled) return
        const host = ref.current
        if (!host) return
        canvas.style.width = '100%'
        canvas.style.display = 'block'
        canvas.dataset.page = String(num - 1)
        host.replaceChildren(canvas)
      } catch (err) {
        if (!cancelled) setError(errorMessage(err))
        // 渲染任务被取消（切话/卸载/宽度变化重渲染）属正常流程，不向全局抛未捕获异常
      }
    })()
    return () => {
      cancelled = true
      // 未完成的渲染任务立即取消：否则切话/卸载后 pdfjs 仍在后台渲染浪费 CPU，
      // 文档销毁后还可能抛出无人接住的异常
      task?.cancel()
      const canvas = ref.current?.querySelector('canvas')
      if (canvas) {
        canvas.width = 0
        canvas.height = 0
      }
      ref.current?.replaceChildren()
      pageProxy?.cleanup()
    }
  }, [visible, pdf, num, width])

  return (
    <div
      ref={ref}
      data-page={num - 1}
      className="w-full overflow-hidden bg-white shadow-lg"
      style={{ width, maxWidth: '100%', aspectRatio: String(ratio) }}
    >
      {error && <p className="p-4 text-sm text-red-600">页面渲染失败：{error}</p>}
    </div>
  )
}
