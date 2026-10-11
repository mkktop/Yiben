// 由 reader-regression.js 注入开发截图钩子，仅在隔离数据目录执行。
;(async () => {
  const ids = __FIXTURE_IDS__
  const results = []
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const assert = (name, condition) => {
    if (!condition) throw new Error(name)
    results.push(name)
  }
  const wait = async (predicate, name) => {
    const end = Date.now() + 12000
    while (Date.now() < end) {
      if (await predicate()) return
      await delay(80)
    }
    throw new Error(`等待失败：${name}`)
  }
  const route = async (id) => {
    location.hash = `/reader/${id}`
    await delay(150)
  }
  const key = (value) => window.dispatchEvent(new KeyboardEvent('keydown', { key: value }))
  const focusedKey = (value, target = document.activeElement) => {
    const event = new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })
    target.dispatchEvent(event)
    return event
  }
  const pdfCanvas = () =>
    [...document.querySelectorAll('canvas')].filter((canvas) => canvas.width > 0)
  const readPage = async (id) => (await window.yudu.reader.chapter(id)).progress?.page
  try {
    const head = await fetch(`yudu://file/${ids.pdf[0]}`, { method: 'HEAD' })
    const range = await fetch(`yudu://file/${ids.pdf[0]}`, { headers: { Range: 'bytes=0-9' } })
    const suffix = await fetch(`yudu://file/${ids.pdf[0]}`, { headers: { Range: 'bytes=-6' } })
    assert(
      'PDF 协议 HEAD / 前段 / 后缀 Range',
      head.ok &&
        Number(head.headers.get('content-length')) > 131072 &&
        range.status === 206 &&
        (await range.arrayBuffer()).byteLength === 10 &&
        suffix.status === 206 &&
        (await suffix.arrayBuffer()).byteLength === 6
    )
    await route(ids.pdf[0])
    await wait(
      () => document.querySelector('div[data-page="17"]') && pdfCanvas().length > 0,
      '长 PDF 首屏'
    )
    assert('PDF 首屏仅保留附近画布', pdfCanvas().length <= 5)
    document.querySelector('div[data-page="14"]').scrollIntoView({ block: 'start' })
    await wait(() => document.querySelector('div[data-page="14"] canvas'), 'PDF 远页渲染')
    await delay(250)
    assert(
      'PDF 滚动后旧画布回收',
      !document.querySelector('div[data-page="0"] canvas') && pdfCanvas().length <= 5
    )
    key('Home')
    await wait(async () => (await readPage(ids.pdf[0])) === 0, 'PDF Home 回到首页')
    assert('PDF Home 同步定位画面', document.querySelector('div[data-page="0"]').getBoundingClientRect().top >= -20)
    key('ArrowRight')
    await wait(async () => (await readPage(ids.pdf[0])) === 1, 'PDF 下一页键')
    assert('PDF 下一页键同步定位画面', Math.abs(document.querySelector('div[data-page="1"]').getBoundingClientRect().top) < 30)
    key('End')
    await wait(async () => (await readPage(ids.pdf[0])) === 17, 'PDF End 到末页')
    assert('PDF 隐藏无效图像控制', !document.querySelector('button[title="双页模式（M 循环切换）"]') && !document.querySelector('button[title="旋转（R）"]') && document.body.textContent.includes('PDF · 连续阅读'))
    await route(ids.pdf[1])
    await wait(
      () =>
        document.querySelector('div[data-page="1"] canvas') &&
        !document.querySelector('div[data-page="2"]'),
      '第二份 PDF'
    )
    assert(
      'PDF 切话隔离页数与画布',
      (await window.yudu.reader.chapter(ids.pdf[1])).chapter.page_count === 2 &&
        pdfCanvas().length <= 2
    )
    await route(ids.pdf[0])
    await delay(10)
    await route(ids.sea[0])
    await wait(() => document.querySelector('div[data-page="3"]'), '条漫首话')
    document.querySelector('div[data-page="3"]').scrollIntoView({ block: 'start' })
    await wait(() => document.querySelector('div[data-page="4"]'), '条漫跨话拼接')
    await delay(300)
    assert('离开 PDF 后无残留画布', pdfCanvas().length === 0)
    assert(
      '护眼偏好应用到画面',
      getComputedStyle(document.querySelector('[data-reading-surface]')).filter ===
        'brightness(0.8)' &&
        getComputedStyle(document.querySelector('[data-eye-overlay]')).opacity === '0.2'
    )
    document.querySelector('div[data-page="5"]').scrollIntoView({ block: 'start' })
    await wait(async () => (await readPage(ids.sea[1])) >= 1, '嵌入话进度落库')
    assert('条漫跨话进度写入第二话', (await readPage(ids.sea[1])) >= 1)
    document.querySelector('div[data-page="4"]').scrollIntoView({ block: 'start' })
    await wait(async () => (await readPage(ids.sea[1])) === 0, '嵌入话首页')
    key('PageUp')
    await wait(async () => (await readPage(ids.sea[0])) === 3, '嵌入话回退到上一话末页')
    assert('条漫跨话回退不重复叠加偏移', Math.abs(document.querySelector('div[data-page="3"]').getBoundingClientRect().top) < 30)
    document.querySelector('div[data-page="5"]').scrollIntoView({ block: 'start' })
    await wait(async () => (await readPage(ids.sea[1])) >= 1, '回到拼接话')
    key('t')
    await wait(() => document.querySelector(`button img[src^="yudu://page-thumb/${ids.sea[1]}/"]`), '缩略图跟随嵌入话')
    assert('条漫缩略图跟随当前话', !document.querySelector(`button img[src^="yudu://page-thumb/${ids.sea[0]}/"]`))
    key('t')
    key('g')
    await wait(
      () =>
        [...document.querySelectorAll('h2')].some((node) => node.textContent.includes('页面全览')),
      '全览打开'
    )
    await wait(() => document.querySelector('button img[alt="第 3 页"]'), '全览缩略图')
    const thumb = document.querySelector('button img[alt="第 3 页"]')
    thumb.closest('button').click()
    await wait(async () => (await readPage(ids.sea[1])) === 2, '全览跳到当前话第3页')
    assert('全览跳页保持嵌入话归属', (await readPage(ids.sea[1])) === 2)
    key('e')
    await delay(200)
    assert(
      '增强快捷键持久化',
      (
        await window.yudu.reader.getPrefs(
          (await window.yudu.reader.chapter(ids.sea[0])).chapter.series_id
        )
      ).enhance === true
    )
    key('m')
    await wait(() => location.hash.includes(`/reader/${ids.sea[1]}`) && document.querySelector(`img[src^="yudu://page/${ids.sea[1]}/2"]`), '拼接话切换单页')
    assert('条漫切模式保留当前话和局部页码', (await readPage(ids.sea[1])) === 2 && !document.querySelector(`img[src^="yudu://page/${ids.sea[0]}/"]`))
    await route(ids.spread)
    await wait(() => document.querySelector('img[src^="yudu://page/"]')?.complete, '跨页章节')
    document.querySelector('button[title="双页模式（M 循环切换）"]').click()
    await delay(250)
    await wait(
      async () =>
        (await window.yudu.reader.pageDims(ids.spread)).dims.some(
          (entry) => entry.idx === 1 && entry.w > entry.h
        ),
      '跨页尺寸探测'
    )
    key('ArrowRight')
    await delay(600)
    const displayed = [...document.querySelectorAll('img[src^="yudu://page/"]')].filter(
      (img) => img.getBoundingClientRect().width > 0
    )
    assert(
      '跨页大图单独成屏',
      displayed.length === 1 &&
        displayed[0].src.split('?')[0].endsWith(`/${ids.spread}/1`) &&
        (await readPage(ids.spread)) === 1
    )
    const prevChapter = document.querySelector('button[title^="上一话"]') || document.querySelector('button[title="没有上一话"]')
    const nextChapter = document.querySelector('button[title^="下一话"]') || document.querySelector('button[title="没有下一话"]')
    assert('前后话按钮排除窗口拖拽区域', [prevChapter, nextChapter].every((button) => getComputedStyle(button).getPropertyValue('-webkit-app-region') === 'no-drag'))
    const bookmarkButton = document.querySelector('button[title^="书签："]')
    bookmarkButton.focus()
    const space = focusedKey(' ')
    const enter = focusedKey('Enter')
    await delay(500)
    assert('聚焦按钮的空格与回车不触发阅读快捷键', !space.defaultPrevented && !enter.defaultPrevented && (await readPage(ids.spread)) === 1)
    const appearanceButton = [...document.querySelectorAll('button')].find((button) => button.textContent.includes('护眼与增强'))
    appearanceButton.click()
    await wait(() => document.querySelector('[role="dialog"] input[aria-label="阅读亮度"]'), '护眼面板')
    const brightness = document.querySelector('[role="dialog"] input[aria-label="阅读亮度"]')
    const colorReference = document.createElement('input')
    colorReference.type = 'range'
    colorReference.style.accentColor = 'var(--primary)'
    document.body.append(colorReference)
    const themeAccent = getComputedStyle(colorReference).accentColor
    colorReference.remove()
    assert('护眼滑块显示百分比并使用主题色', brightness.getAttribute('aria-valuetext') === '100%' && getComputedStyle(brightness).accentColor === themeAccent)
    brightness.focus()
    focusedKey('Escape')
    await wait(() => !document.querySelector('[role="dialog"]'), '滑块聚焦 Esc 关闭')
    assert('护眼控件聚焦时 Esc 关闭并保持阅读器', location.hash.includes(`/reader/${ids.spread}`))
    await route(999999)
    await wait(() => document.body.textContent.includes('未找到该章节'), '不存在章节空态')
    const returnLibrary = [...document.querySelectorAll('button')].find((button) => button.textContent === '返回书架')
    returnLibrary.click()
    await wait(() => location.hash.includes('/library'), '错误空态返回书架')
    assert('错误空态可通过鼠标返回书架', location.hash.includes('/library'))
    location.hash = '/settings'
    await wait(() => document.body.textContent.includes('数据库备份与恢复'), '设置页')
    assert(
      '设置页包含备份、护眼与增强',
      document.body.textContent.includes('自动备份') &&
        document.body.textContent.includes('阅读亮度') &&
        document.body.textContent.includes('自动裁白边')
    )
    location.hash = '/cloud'
    await wait(() => document.body.textContent.includes('WebDAV'), 'WebDAV 页面')
    assert('WebDAV 连接入口可用', !!document.querySelector('input[placeholder*="https://"]'))
    const connect = [...document.querySelectorAll('button')].find((button) =>
      button.textContent.includes('WebDAV / NAS')
    )
    connect.click()
    await wait(
      () => document.activeElement?.getAttribute('aria-label') === 'WebDAV 地址',
      'WebDAV 卡片跳到连接表单'
    )
    await delay(400)
    assert(
      'WebDAV 卡片可以进入配置',
      document.querySelector('input[aria-label="WebDAV 地址"]').getBoundingClientRect().top <
        innerHeight
    )
    return { success: true, checks: results }
  } catch (error) {
    return {
      success: false,
      checks: results,
      error: String(error),
      route: location.hash,
      text: document.body.textContent.slice(-1500),
      pages: [...document.querySelectorAll('div[data-page]')].map((node) => ({
        page: node.dataset.page,
        top: node.getBoundingClientRect().top,
        height: node.getBoundingClientRect().height,
        canvas: !!node.querySelector('canvas')
      }))
    }
  }
})()
