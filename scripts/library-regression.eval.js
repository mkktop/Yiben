// 仅在隔离的自测书库中验证返回定位、筛选、续读及长章节列表。
;(async () => {
  const fixture = __LIBRARY_FIXTURE__
  const checks = []
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const assert = (name, condition) => {
    if (!condition) throw new Error(name)
    checks.push(name)
  }
  const wait = async (predicate, name) => {
    for (let attempt = 0; attempt < 160; attempt++) {
      if (await predicate()) return
      await delay(50)
    }
    throw new Error(`等待失败：${name}`)
  }
  const button = (label, root = document) => [...root.querySelectorAll('button')].find((node) => node.textContent.trim() === label)
  const input = (node, text) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, text)
    node.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const grid = () => document.querySelector('[data-cover-grid]')
  const library = async () => {
    location.hash = '/library'
    await wait(() => grid()?.querySelector('[data-series-card]'), '书架封面')
    await delay(300)
  }
  try {
    location.hash = '/'
    await wait(() => document.querySelector(`[data-continue-series="${fixture.nextSeries}"]`), '读完一话后续读')
    const next = document.querySelector(`[data-continue-series="${fixture.nextSeries}"]`)
    assert('读完一话后首页接到下一话且不伪造已读进度', next.textContent.includes('第二话') && next.textContent.includes('尚未开始'))
    assert('未知页数显示实际位置且无零分母', document.querySelector(`[data-continue-series="${fixture.unknownSeries}"]`).textContent.includes('读到第 3 页') && !document.body.textContent.includes('/ 0 页'))
    const unread = await window.yudu.series.list({ filter: 'unread' })
    const reading = await window.yudu.series.list({ filter: 'reading' })
    assert('未读和在读不重叠，读完一话待续仍在读', !unread.some((item) => reading.some((other) => other.id === item.id)) && reading.some((item) => item.id === fixture.nextSeries))

    await library()
    const checkRows = () => {
      const rows = [...grid().querySelectorAll('[data-index]')]
      return rows.length > 1 && Math.abs(rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().bottom) < 1
    }
    const originalWidth = grid().clientWidth
    grid().style.width = `${originalWidth - 20}px`
    await delay(250)
    assert('同列数缩放后行高更新且无间隙重叠', checkRows())
    grid().style.width = ''
    await delay(250)
    grid().scrollTop = 1300
    await delay(250)
    const before = grid().scrollTop
    const card = grid().querySelector('[data-series-card]')
    const cardId = card.dataset.seriesCard
    card.click()
    await wait(() => document.querySelector('[data-series-page]'), '打开详情')
    history.back()
    await wait(() => grid()?.querySelector('[data-series-card]'), '返回书架')
    await delay(400)
    assert(`返回书架保留滚动位置（${before} → ${grid().scrollTop}）`, Math.abs(grid().scrollTop - before) < 2 && !!grid().querySelector(`[data-series-card="${cardId}"]`))

    button('在读').click()
    await wait(() => grid()?.querySelector(`[data-series-card="${fixture.longSeries}"]`), '在读筛选')
    button('交互回归书架').click()
    await delay(300)
    const longCard = grid().querySelector(`[data-series-card="${fixture.longSeries}"]`)
    assert('首话未完成的作品也显示在读与进度，封面书名不重复', longCard.textContent.includes('在读') && longCard.textContent.includes('%') && longCard.textContent.split(fixture.longTitle).length === 2)
    longCard.click()
    await wait(() => document.querySelector('[data-chapter-list]'), '长章节详情')
    history.back()
    await wait(() => grid()?.querySelector(`[data-series-card="${fixture.longSeries}"]`), '返回筛选书架')
    assert('返回后保留阅读筛选和虚拟书架', button('在读').getAttribute('aria-pressed') === 'true' && button('交互回归书架').getAttribute('aria-pressed') === 'true')

    grid().querySelector(`[data-series-card="${fixture.longSeries}"]`).click()
    await wait(() => document.querySelector('[data-chapter-list]'), '章节列表')
    const search = document.querySelector('input[aria-label="搜索章节"]')
    button('折叠全部').click()
    await delay(100)
    assert('卷折叠后移除章节行', !document.querySelector('[data-chapter-id]'))
    input(search, '章节检索 086')
    await wait(() => document.querySelector(`[data-chapter-id="${fixture.currentChapter}"]`), '跨折叠卷搜索')
    assert('搜索自动展示折叠卷中的匹配项且保留原序号', document.querySelectorAll('[data-chapter-id]').length === 1 && document.querySelector('[data-chapter-id]').textContent.includes('86'))
    input(search, '不存在的章节')
    await wait(() => document.body.textContent.includes('没有匹配的章节'), '搜索空态')
    button('定位当前话').click()
    await wait(() => document.activeElement?.closest('[data-chapter-id]')?.dataset.chapterId === String(fixture.currentChapter), '定位焦点')
    const current = document.querySelector(`[data-chapter-id="${fixture.currentChapter}"]`)
    assert('定位清除搜索、展开目标卷并将当前话带到视口', search.value === '' && current.getBoundingClientRect().top > 56 && current.getBoundingClientRect().bottom < innerHeight)
    assert('定位当前话不修改阅读进度', (await window.yudu.series.get(fixture.longSeries)).chapters.find((item) => item.id === fixture.currentChapter).read_page === 4)
    button('展开全部').click()
    await wait(() => document.querySelectorAll('[data-chapter-id]').length === 120, '展开全部章节')
    const main = document.querySelector('main')
    document.activeElement?.blur()
    await delay(150)
    main.scrollTop = 0
    await delay(150)
    assert('最小窗口章节工具栏与书架无横向溢出', main.scrollWidth <= main.clientWidth + 1)
    return { success: true, checks, width: innerWidth, height: innerHeight }
  } catch (error) {
    return { success: false, checks, error: String(error), route: location.hash, text: document.body.textContent.slice(-800) }
  }
})()
