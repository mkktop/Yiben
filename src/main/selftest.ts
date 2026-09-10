import { app, net } from 'electron'
import {
  addLibrary,
  bookmarksForSeries,
  chaptersBySeries,
  getProgress,
  getPageDims,
  getSeries,
  listSeries,
  neighborChapters,
  resetSeriesProgress,
  saveProgress,
  setSeriesProgress,
  toggleBookmark,
  updateSeriesMeta
} from './db'
import { scanLibrary, scanOneLocalSeries } from './scanner'
import { ensurePageDims } from './pageDims'

/**
 * 开发自测钩子：YIBEN_SELFTEST=<fixture路径> 时执行
 * 加库 → 扫描 → 查询 → 协议读页 → 封面 → 进度 → 书签/跨话/已读/元数据/页尺寸，
 * 输出 SELFTEST_OK 后退出。
 */
export async function runSelfTest(fixture: string): Promise<void> {
  const failures: string[] = []
  const check = (name: string, cond: boolean): void => {
    console.log(`[selftest] ${cond ? 'PASS' : 'FAIL'} ${name}`)
    if (!cond) failures.push(name)
  }

  try {
    const lib = addLibrary('测试库', fixture)
    const summary = await scanLibrary(lib.id)
    console.log('[selftest] scan:', JSON.stringify(summary))

    const series = listSeries()
    const first = series[0]
    const chapters = chaptersBySeries(first.id)

    // 协议读页
    const pageResp = await net.fetch(`yiben://page/${chapters[0].id}/0`)
    const pageBuf = await pageResp.arrayBuffer()
    // 封面
    const thumbResp = await net.fetch(`yiben://thumb/${first.id}`)
    const thumbBuf = await thumbResp.arrayBuffer()
    // 页缩略图（取页 → sharp 缩小 → 落盘缓存）
    const pageThumbResp = await net.fetch(`yiben://page-thumb/${chapters[0].id}/0`)
    const pageThumbBuf = await pageThumbResp.arrayBuffer()

    // 进度读写
    saveProgress(chapters[0].id, 1, false)
    const [p] = getProgress([chapters[0].id])

    // ---------- 基础断言 ----------
    const totalChapters = series.reduce((acc, s) => acc + chaptersBySeries(s.id).length, 0)
    const allPagesOk = series.every((s) =>
      chaptersBySeries(s.id).every((c) => c.kind === 'pdf' || c.page_count > 0)
    )
    check('协议读页', pageResp.status === 200 && pageBuf.byteLength > 0)
    check('封面', thumbResp.status === 200 && thumbBuf.byteLength > 0)
    check('页缩略图', pageThumbResp.status === 200 && pageThumbBuf.byteLength > 0)
    check('系列数 >= 2', series.length >= 2)
    check('章节数 >= 4', totalChapters >= 4)
    check('页数齐全', allPagesOk)
    check('进度写入', p?.page === 1)

    // ---------- 书签 ----------
    const added = toggleBookmark(chapters[0].id, 2)
    const marks = bookmarksForSeries(first.id)
    const removed = !toggleBookmark(chapters[0].id, 2)
    toggleBookmark(chapters[0].id, 2) // 留下一个供 UI 截图
    check('书签添加', added && marks.length === 1 && marks[0].page === 2)
    check('书签移除', removed)

    // ---------- 跨话导航 ----------
    const multi = series.find((s) => chaptersBySeries(s.id).length >= 2)
    const multiChapters = multi ? chaptersBySeries(multi.id) : []
    const nb = multiChapters.length >= 2 ? neighborChapters(multiChapters[0].id) : null
    const lastNb = multiChapters.length >= 2
      ? neighborChapters(multiChapters[multiChapters.length - 1].id)
      : null
    check(
      '前后话',
      nb !== null && nb.index === 0 && nb.next !== null && nb.prev === null &&
        lastNb !== null && lastNb.prev !== null && lastNb.next === null
    )

    // ---------- 标记已读 / 重置 ----------
    setSeriesProgress(first.id, true)
    const allDone = chaptersBySeries(first.id).every((c) => c.completed === 1)
    resetSeriesProgress(first.id)
    const allCleared = chaptersBySeries(first.id).every((c) => c.read_page === null)
    check('整系列标记已读', allDone)
    check('整系列重置进度', allCleared)
    saveProgress(chapters[0].id, 1, false)

    // ---------- 元数据编辑：重扫不覆盖 ----------
    updateSeriesMeta(first.id, { author: '手动作者' })
    await scanOneLocalSeries(lib.id, {
      folder: first.folder_path,
      isSingleFile: first.is_single_file === 1
    })
    const afterRescan = getSeries(first.id)
    check('手动元数据不被重扫覆盖', afterRescan?.author === '手动作者')

    // ---------- 页尺寸探测（双页跨页识别） ----------
    // 找一个包含多页的章节等探测完成
    const dimChapter = chaptersBySeries(series[series.length - 1].id).find((c) => c.page_count >= 2)
      ?? chapters[0]
    const dims0 = ensurePageDims(dimChapter.id)
    let dims = dims0.dims
    const deadline = Date.now() + 20_000
    while (dims.length < (dimChapter.page_count ?? 0) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 300))
      dims = getPageDims(dimChapter.id)
    }
    check(
      '页尺寸探测补齐',
      dims.length === dimChapter.page_count && dims.every((d) => d.w > 0 && d.h > 0)
    )
    console.log('[selftest] dims:', JSON.stringify(dims))

    console.log(
      `[selftest] 汇总: series=${series.length} chapters=${totalChapters} ` +
        `page=${pageResp.status}/${pageBuf.byteLength}B thumb=${thumbResp.status} page-thumb=${pageThumbResp.status}`
    )
  } catch (err) {
    console.error('SELFTEST_ERROR', err)
    failures.push('exception')
  } finally {
    app.quit()
    if (failures.length > 0) {
      console.error('SELFTEST_FAIL:', failures.join(', '))
    } else {
      console.log('SELFTEST_OK')
    }
  }
}
