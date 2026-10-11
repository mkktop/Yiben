import type { PDFDataRangeTransport, PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist'

const CHUNK_SIZE = 64 * 1024
interface PdfFactory {
  range: (
    length: number,
    initial: Uint8Array,
    request: (begin: number, end: number) => void,
    abort: () => void
  ) => PDFDataRangeTransport
  document: (options: {
    data?: Uint8Array
    range?: PDFDataRangeTransport
    disableAutoFetch?: boolean
    disableStream?: boolean
    rangeChunkSize?: number
  }) => PDFDocumentLoadingTask
}

/** 每次加载独立持有网络与 pdfjs 任务；销毁后不会继续创建旧章节文档。 */
export function createPdfLoad(
  url: string,
  factory: PdfFactory
): { promise: Promise<PDFDocumentProxy>; cancel: () => void } {
  const controller = new AbortController()
  let task: PDFDocumentLoadingTask | undefined
  let failRange!: (error: unknown) => void
  const rangeFailure = new Promise<never>((_resolve, reject) => {
    failRange = reject
  })
  // HEAD/首块失败前尚未进入 race，提前安装拒绝处理，避免未捕获异常。
  void rangeFailure.catch(() => {})
  const signal = controller.signal
  const check = (): void => {
    signal.throwIfAborted()
  }
  const fetchBytes = async (begin: number, end: number): Promise<Uint8Array> => {
    const response = await fetch(url, { headers: { Range: `bytes=${begin}-${end - 1}` }, signal })
    if (response.status !== 206) throw new Error('PDF 分段读取失败，请重新打开')
    const bytes = new Uint8Array(await response.arrayBuffer())
    check()
    if (bytes.length !== end - begin) throw new Error('PDF 分段数据不完整')
    return bytes
  }
  const promise = (async () => {
    const head = await fetch(url, { method: 'HEAD', signal })
    check()
    if (!head.ok) throw new Error(`PDF 文件读取失败：HTTP ${head.status}`)
    const length = Number(head.headers.get('content-length'))
    if (
      Number.isSafeInteger(length) &&
      length > CHUNK_SIZE * 2 &&
      head.headers.get('accept-ranges') === 'bytes'
    ) {
      const initial = await fetchBytes(0, CHUNK_SIZE)
      check()
      const transport = factory.range(
        length,
        initial,
        (begin, end) => {
          void fetchBytes(begin, end)
            .then((data) => transport.onDataRange(begin, data))
            .catch((error) => {
              failRange(error)
              controller.abort(error)
              void task?.destroy().catch(() => {})
            })
        },
        () => controller.abort()
      )
      task = factory.document({
        range: transport,
        disableAutoFetch: true,
        disableStream: true,
        rangeChunkSize: CHUNK_SIZE
      })
    } else {
      const response = await fetch(url, { signal })
      if (!response.ok) throw new Error(`PDF 文件读取失败：HTTP ${response.status}`)
      const data = new Uint8Array(await response.arrayBuffer())
      check()
      task = factory.document({ data })
    }
    const document = await Promise.race([task.promise, rangeFailure])
    check()
    return document
  })()
  return {
    promise,
    cancel: () => {
      controller.abort()
      void task?.destroy().catch(() => {})
    }
  }
}
