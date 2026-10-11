import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PDFDataRangeTransport, PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist'
import { createPdfLoad } from './pdfLoader'
afterEach(() => vi.unstubAllGlobals())
function factory() {
  const doc = { numPages: 100 } as PDFDocumentProxy
  const destroy = vi.fn().mockResolvedValue(undefined)
  const document = vi.fn(
    (_options: unknown) =>
      ({ promise: Promise.resolve(doc), destroy }) as unknown as PDFDocumentLoadingTask
  )
  let request!: (begin: number, end: number) => void
  const onDataRange = vi.fn()
  const range = vi.fn((_length: number, _initial: Uint8Array, fn: typeof request) => {
    request = fn
    return { onDataRange } as unknown as PDFDataRangeTransport
  })
  return {
    doc,
    document,
    destroy,
    range,
    onDataRange,
    request: (begin: number, end: number) => request(begin, end)
  }
}
describe('PDF 加载生命周期', () => {
  it('HEAD 尚未返回时取消，不创建旧文档', async () => {
    let head!: (response: Response) => void
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            head = resolve
          })
      )
    )
    const api = factory()
    const load = createPdfLoad('yudu://file/1', api)
    load.cancel()
    head(new Response(null, { headers: { 'content-length': '10' } }))
    await expect(load.promise).rejects.toThrow()
    expect(api.document).not.toHaveBeenCalled()
  })
  it('小文件走整包，取消销毁对应任务', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { headers: { 'content-length': '10' } }))
        .mockResolvedValueOnce(new Response(new Uint8Array(10)))
    )
    const api = factory()
    const load = createPdfLoad('yudu://file/2', api)
    expect(await load.promise).toBe(api.doc)
    expect(api.document).toHaveBeenCalledWith({ data: new Uint8Array(10) })
    load.cancel()
    expect(api.destroy).toHaveBeenCalledOnce()
  })
  it('大文件只先取首块，再按 pdfjs 请求读取段', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { headers: { 'content-length': '500000', 'accept-ranges': 'bytes' } })
      )
      .mockResolvedValueOnce(new Response(new Uint8Array(65536), { status: 206 }))
      .mockResolvedValueOnce(new Response(new Uint8Array(100), { status: 206 }))
    vi.stubGlobal('fetch', fetcher)
    const api = factory()
    const load = createPdfLoad('yudu://file/3', api)
    await load.promise
    expect(api.document.mock.calls[0][0]).toMatchObject({
      disableStream: true,
      disableAutoFetch: true
    })
    api.request(100000, 100100)
    await vi.waitFor(() =>
      expect(api.onDataRange).toHaveBeenCalledWith(100000, new Uint8Array(100))
    )
    expect(fetcher.mock.calls[1][1].headers).toEqual({ Range: 'bytes=0-65535' })
    load.cancel()
  })
  it('服务端无视 Range 时拒绝，避免错误字节破坏文档', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(null, { headers: { 'content-length': '500000', 'accept-ranges': 'bytes' } })
        )
        .mockResolvedValueOnce(new Response(new Uint8Array(500000)))
    )
    const api = factory()
    await expect(createPdfLoad('yudu://file/4', api).promise).rejects.toThrow('分段读取失败')
    expect(api.document).not.toHaveBeenCalled()
  })
})
