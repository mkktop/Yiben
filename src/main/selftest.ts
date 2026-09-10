import { app, net } from 'electron'
import { addLibrary, chaptersBySeries, listSeries, saveProgress, getProgress, continueReading } from './db'
import { scanLibrary } from './scanner'

/**
 * 开发自测钩子：YIBEN_SELFTEST=<fixture路径> 时执行
 * 加库 → 扫描 → 查询 → 协议读页 → 封面 → 进度，输出 SELFTEST_OK 后退出。
 */
export async function runSelfTest(fixture: string): Promise<void> {
  try {
    const lib = addLibrary('测试库', fixture)
    const summary = await scanLibrary(lib.id)
    console.log('[selftest] scan:', JSON.stringify(summary))

    const series = listSeries()
    console.log(
      '[selftest] series:',
      JSON.stringify(series.map((s) => ({ id: s.id, title: s.title, cover: !!s.cover_path })))
    )

    const first = series[0]
    const chapters = chaptersBySeries(first.id)
    console.log(
      '[selftest] chapters:',
      JSON.stringify(chapters.map((c) => ({ id: c.id, t: c.title, n: c.number, pages: c.page_count })))
    )

    // 协议读页
    const pageResp = await net.fetch(`yiben://page/${chapters[0].id}/0`)
    const pageBuf = await pageResp.arrayBuffer()
    console.log(
      '[selftest] page fetch:',
      pageResp.status,
      pageResp.headers.get('content-type'),
      pageBuf.byteLength,
      'bytes'
    )

    // 封面
    const thumbResp = await net.fetch(`yiben://thumb/${first.id}`)
    const thumbBuf = await thumbResp.arrayBuffer()
    console.log('[selftest] thumb fetch:', thumbResp.status, thumbBuf.byteLength, 'bytes')

    // 页缩略图（缩略图条用的小图协议：取页 → sharp 缩小 → 落盘缓存）
    const pageThumbResp = await net.fetch(`yiben://page-thumb/${chapters[0].id}/0`)
    const pageThumbBuf = await pageThumbResp.arrayBuffer()
    console.log(
      '[selftest] page-thumb fetch:',
      pageThumbResp.status,
      pageThumbResp.headers.get('content-type'),
      pageThumbBuf.byteLength,
      'bytes'
    )

    // 进度读写
    saveProgress(chapters[0].id, 1, false)
    const [p] = getProgress([chapters[0].id])
    console.log('[selftest] progress:', JSON.stringify(p))
    const cont = continueReading(5)
    console.log('[selftest] continueReading:', cont.length, 'rows')

    const totalChapters = series.reduce((acc, s) => acc + chaptersBySeries(s.id).length, 0)
    const allPagesOk = series.every((s) =>
      chaptersBySeries(s.id).every((c) => c.kind === 'pdf' || c.page_count > 0)
    )
    for (const s of series) {
      console.log(
        `[selftest] ${s.title}:`,
        chaptersBySeries(s.id).map((c) => `${c.title}[${c.kind}]=${c.page_count}p`).join(' ')
      )
    }
    const ok =
      pageResp.status === 200 &&
      pageBuf.byteLength > 0 &&
      thumbResp.status === 200 &&
      thumbBuf.byteLength > 0 &&
      pageThumbResp.status === 200 &&
      pageThumbBuf.byteLength > 0 &&
      series.length >= 2 &&
      totalChapters >= 4 &&
      allPagesOk &&
      p.page === 1
    console.log(
      `[selftest] assert: totalChapters=${totalChapters} allPagesOk=${allPagesOk}`
    )
    console.log(ok ? 'SELFTEST_OK' : 'SELFTEST_FAIL')
  } catch (err) {
    console.error('SELFTEST_ERROR', err)
  } finally {
    app.quit()
  }
}
