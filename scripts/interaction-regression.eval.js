// 由隔离临时书库的回归脚本运行，验证实际界面和数据库结果。
;(async () => {
  const checks = []
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const assert = (name, condition) => {
    if (!condition) throw new Error(name)
    checks.push(name)
  }
  const wait = async (predicate, name) => {
    const end = Date.now() + 12000
    while (Date.now() < end) {
      if (await predicate()) return
      await delay(50)
    }
    throw new Error(`等待失败：${name}`)
  }
  const button = (label, root = document) =>
    [...root.querySelectorAll('button')].find((node) => {
      const text = node.textContent.trim()
      return text === label || (label === '书架与标签' && text.startsWith(label))
    })
  const heading = (label) =>
    [...document.querySelectorAll('h2')].find((node) => node.textContent.trim() === label)
  try {
    const librarySeries = await window.yudu.series.list({ limit: 5000 })
    const series = librarySeries.find(
      (entry) => entry.title === '海贼王'
    )
    if (!series) throw new Error('未找到隔离自测书库的海贼王系列')
    const detail = await window.yudu.series.get(series.id)
    const chapter = detail.chapters.find((entry) => entry.page_count >= 3)
    if (!chapter) throw new Error('未找到可验证进度的章节')
    const suffix = Date.now()
    const names = [`回归书架 A ${suffix}`, `回归书架 B ${suffix}`]
    const shelves = await Promise.all(names.map((name) => window.yudu.shelves.create(name)))
    const tags = [`回归标签 A ${suffix}`, `回归标签 B ${suffix}`, `回归标签 C ${suffix}`]
    await window.yudu.shelves.setForSeries(series.id, [])
    await window.yudu.tags.setForSeries(series.id, tags)
    await window.yudu.progress.save(chapter.id, 1, false)

    location.hash = `/series/${series.id}`
    await wait(() => button('书架与标签'), '系列详情')
    const opener = button('书架与标签')
    opener.focus()
    opener.click()
    await wait(() => document.querySelector('[role="dialog"][aria-modal="true"]'), '可访问弹窗')
    const modal = document.querySelector('[role="dialog"][aria-modal="true"]')
    await wait(() => modal.contains(document.activeElement), '弹窗自动聚焦')
    assert('弹窗打开后焦点进入弹窗', modal.contains(document.activeElement))
    const controls = [...modal.querySelectorAll('button, input, select, textarea, [tabindex]')]
      .filter((node) => !node.disabled && node.tabIndex >= 0 && node.getClientRects().length > 0)
    const first = controls[0]
    const last = controls[controls.length - 1]
    last.focus()
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    assert('Tab 在弹窗内循环', document.activeElement === first)
    first.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Tab', shiftKey: true, bubbles: true, cancelable: true
    }))
    assert('Shift Tab 在弹窗内循环', document.activeElement === last)
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', bubbles: true, cancelable: true
    }))
    await wait(() => !document.querySelector('[role="dialog"][aria-modal="true"]'), 'Esc 关闭弹窗')
    assert('关闭弹窗恢复入口焦点', document.activeElement === opener)
    opener.click()
    await wait(
      () => names.every((name) => button(name) && !button(name).disabled),
      '初始书架归属加载'
    )
    // 在同一事件周期触发，故意不给第一次 IPC 保存/列表重取留时间。
    button(names[0]).click()
    button(names[1]).click()
    await wait(async () => {
      const ids = await window.yudu.shelves.forSeries(series.id)
      return shelves.every((shelf) => ids.includes(shelf.id))
    }, '连续选择的两个书架均保存')
    assert('连续选择两个书架不会丢失归属',
      (await window.yudu.shelves.forSeries(series.id)).length === 2)

    const removeTag = (name) =>
      [...document.querySelectorAll('button[title="删除标签"]')].find(
        (node) => node.parentElement.textContent.includes(name)
      )
    await wait(() => removeTag(tags[0]) && removeTag(tags[1]), '初始标签加载')
    removeTag(tags[0]).click()
    removeTag(tags[1]).click()
    await wait(async () => {
      const current = await window.yudu.tags.forSeries(series.id)
      return current.length === 1 && current[0] === tags[2]
    }, '连续删除的标签均保存')
    assert('连续删除两个标签不会重新加入已删除标签',
      JSON.stringify(await window.yudu.tags.forSeries(series.id)) === JSON.stringify([tags[2]]))
    await wait(() => button('完成') && !button('完成').disabled, '归属保存完成')
    button('完成').click()
    await wait(() => !heading('书架与标签'), '归属弹窗关闭')

    const before = (await window.yudu.reader.chapter(chapter.id)).progress
    button('重置进度').click()
    await wait(() => heading('重置阅读进度'), '重置确认弹窗')
    assert('打开重置确认不会修改数据库',
      (await window.yudu.reader.chapter(chapter.id)).progress?.page === before.page)
    const dialog = heading('重置阅读进度').parentElement.parentElement
    button('取消', dialog).click()
    await wait(() => !heading('重置阅读进度'), '取消重置')
    assert('取消重置保留阅读进度',
      (await window.yudu.reader.chapter(chapter.id)).progress?.page === before.page)

    button('重置进度').click()
    await wait(() => button('确认重置进度'), '再次打开重置确认')
    button('确认重置进度').click()
    await wait(async () => !(await window.yudu.reader.chapter(chapter.id)).progress,
      '确认重置后进度清空')
    await wait(() => !heading('重置阅读进度'), '确认完成关闭弹窗')
    assert('确认后清空整个系列的进度',
      (await window.yudu.series.get(series.id)).chapters.every((entry) => entry.read_page === null))
    const pdfSeries = librarySeries.find((entry) => entry.title === '验证PDF')
    if (pdfSeries) {
      location.hash = `/series/${pdfSeries.id}`
      await wait(() => document.querySelector('h1')?.textContent.trim() === pdfSeries.title, 'PDF 系列详情')
      assert('正常 PDF 不显示扫描失败', !document.body.textContent.includes('扫描失败'))
    }
    location.hash = '/series/2147483647'
    await wait(() => document.body.textContent.includes('系列不存在'), '已删除系列提示')
    assert('不存在的系列可以返回书架', !!button('返回书架'))
    return { success: true, checks }
  } catch (error) {
    return {
      success: false,
      checks,
      error: String(error),
      route: location.hash,
      text: document.body.textContent.slice(-1800)
    }
  }
})()
