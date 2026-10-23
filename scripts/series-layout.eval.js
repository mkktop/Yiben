// 由隔离 profile 的截图钩子执行；调用方将 windowBounds 设为 960×640。
// 只查看已有 fixture，切主题并打开 / 取消弹窗，不写阅读进度或元数据。
;(async () => {
  const checks = []
  // runner 可将占位符替换为 JSON 字符串；直接运行时保持三主题检查。
  const requestedTheme = (() => {
    try { return __SERIES_THEME__ } catch { return null }
  })()
  const minimumWindow = (() => {
    try { return __SERIES_MINIMUM__ } catch { return true }
  })()
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const assert = (name, condition) => {
    if (!condition) throw new Error(name)
    checks.push(name)
  }
  const wait = async (predicate, name) => {
    const end = Date.now() + 12000
    while (Date.now() < end) {
      if (await predicate()) return
      await delay(60)
    }
    throw new Error(`等待失败：${name}`)
  }
  const button = (label, root = document) =>
    [...root.querySelectorAll('button')].find((node) => node.textContent.trim() === label ||
      (label === '书架与标签' && node.textContent.trim().startsWith(label)))
  const modal = () => document.querySelector('[role="dialog"][aria-modal="true"]')
  const close = async () => {
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', bubbles: true, cancelable: true
    }))
    await wait(() => !modal(), '关闭查看弹窗')
  }
  try {
    // CI 虚拟屏（1024×768）放不下 1280 宽的窗口，系统会把窗口钳制到工作区大小；
    // 此时宽窗口布局无法验证，显式跳过并记录原因（本地大屏照常执行）
    if (!minimumWindow && screen.availWidth < 1296) {
      return { success: true, skipped: `宽窗口检查跳过：屏幕工作区 ${screen.availWidth}×${screen.availHeight} 不足以容纳 1280 宽窗口`,
        checks, width: innerWidth, height: innerHeight, minimumWindow }
    }
    const list = await window.yudu.series.list({ limit: 5000 })
    const series = list.find((item) => item.title === '海贼王')
    if (!series) throw new Error('未找到隔离自测书库')
    const initial = await window.yudu.series.get(series.id)
    const initialProgress = initial.chapters.map((item) => [item.id, item.read_page, item.completed])
    const resumeChapter = initial.chapters.find((item) => item.read_page === 1 && item.completed !== 1)
    location.hash = `/series/${series.id}`
    await wait(() => document.querySelector('[data-series-page] h1')?.textContent === series.title, '作品卡')
    // Windows 缩放会在客户区尺寸换算时舍入数个像素，仍限制在最小窗口附近。
    assert(minimumWindow ? '在最小支持窗口验证系列布局' : '在宽窗口验证系列布局',
      minimumWindow ? Math.abs(innerWidth - 960) <= 8 && Math.abs(innerHeight - 640) <= 8 : innerWidth >= 1280)
    const themes = [['paper', '纸墨书斋'], ['comic', '现代漫画'], ['neon', '霓虹夜读']]
      .filter(([theme]) => !requestedTheme || theme === requestedTheme)
    assert('截图主题有效', themes.length > 0)
    for (const [theme, label] of themes) {
      document.querySelector('button[aria-label^="选择主题，当前为"]').click()
      await wait(() => document.querySelector('[role="menuitemradio"]'), '主题菜单')
      const choice = [...document.querySelectorAll('[role="menuitemradio"]')].find((node) => node.textContent.includes(label))
      choice.click()
      await wait(() => document.documentElement.dataset.theme === theme, '应用主题')
      await delay(100)
      const page = document.querySelector('[data-series-page]')
      const main = document.querySelector('main')
      const hero = document.querySelector('[data-series-hero]')
      const content = document.querySelector('[data-series-content]')
      const title = hero.querySelector('h1')
      const primary = hero.querySelector('[data-series-read]')
      assert(`${label}最小窗口无横向溢出`, page.scrollWidth <= page.clientWidth + 1 &&
        main.scrollWidth <= main.clientWidth + 1 && hero.scrollWidth <= hero.clientWidth + 1)
      assert(`${label}首屏突出书名与主阅读动作`, primary && primary.getBoundingClientRect().bottom < innerHeight &&
        hero.querySelectorAll('button').length === 1 && getComputedStyle(title).color === getComputedStyle(main).color)
      if (resumeChapter) {
        assert(`${label}跳话进度显示继续阅读与对应章节`, primary.textContent.trim() === '继续阅读' &&
          primary.parentElement.querySelector('span[title]')?.getAttribute('title') === resumeChapter.title)
      }
      assert(`${label}章节为主内容且信息维护独立`, content.children[0].querySelector('h2').textContent === '章节列表' &&
        content.querySelector('aside h2').textContent === '作品信息' &&
        !hero.textContent.includes('重置进度') && !hero.textContent.includes('合并系列'))
      const chapterBounds = content.children[0].getBoundingClientRect()
      const infoBounds = content.querySelector('aside').getBoundingClientRect()
      assert(minimumWindow ? '窄窗口信息排列在章节之后' : '宽窗口章节与信息并排', minimumWindow
        ? infoBounds.top >= chapterBounds.bottom
        : infoBounds.left >= chapterBounds.right && Math.abs(infoBounds.top - chapterBounds.top) < 2)
      assert(`${label}系列进度与章节统计一致`, Number(hero.querySelector('[role="progressbar"]').getAttribute('aria-valuemax')) === initial.chapters.length &&
        Math.abs(Number(hero.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')) - initial.chapters.reduce((sum, item) =>
          sum + (item.completed === 1 ? 1 : item.read_page !== null && item.page_count > 0 ? Math.min(0.99, Math.max(0, (item.read_page + 1) / item.page_count)) : 0), 0)) < 0.0001)
    }
    const actions = [
      ['编辑信息', '编辑信息'],
      ['元数据', '在线元数据与回写'],
      ['书架与标签', '书架与标签'],
      ['合并系列', '合并系列'],
      ['重置进度', '重置阅读进度']
    ]
    for (const [label, title] of actions) {
      const opener = button(label)
      assert(`${label}入口保留`, !!opener && !opener.disabled)
      opener.scrollIntoView({ block: 'center' })
      opener.focus()
      opener.click()
      await wait(() => modal()?.textContent.includes(title), title)
      await close()
    }
    assert('重扫与全部已读入口保留', !!button('重扫') && !!button('全部已读'))
    const chapterToggle = document.querySelector('[data-series-content] button[title="标记为已读"]') ||
      document.querySelector('[data-series-content] button[title="标记为未读"]')
    chapterToggle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await delay(100)
    assert('章节已读勾选的回车不冒泡打开章节', location.hash.includes(`/series/${series.id}`))
    button('移出书架').click()
    await wait(() => button('确认移出'), '移出确认')
    assert('移出仍有明确确认并说明进度保留', document.body.textContent.includes('移出后重扫不会恢复，进度保留'))
    button('取消').click()
    const final = await window.yudu.series.get(series.id)
    assert('查看维护弹窗与取消确认保留全部进度', JSON.stringify(initialProgress) ===
      JSON.stringify(final.chapters.map((item) => [item.id, item.read_page, item.completed])))
    const main = document.querySelector('main')
    main.scrollTop = 0
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    await delay(500)
    return { success: true, checks, seriesId: series.id, theme: document.documentElement.dataset.theme,
      width: innerWidth, height: innerHeight, minimumWindow }
  } catch (error) {
    return { success: false, checks, error: String(error), width: innerWidth, height: innerHeight,
      route: location.hash, text: document.body.textContent.slice(-1500) }
  }
})()
