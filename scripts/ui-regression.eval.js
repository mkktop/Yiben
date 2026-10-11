// 只在隔离的 Electron 验证配置中执行，不操作真实用户书库。
(async () => {
  const checks = []
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  function assert(name, condition) {
    if (!condition) throw new Error(name)
    checks.push(name)
  }
  async function wait(predicate, name) {
    for (let attempt = 0; attempt < 80; attempt++) {
      if (await predicate()) return
      await delay(50)
    }
    throw new Error(`等待超时：${name}`)
  }
  function key(target, value) {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }))
  }
  try {
    location.hash = '/settings'
    await wait(() => document.querySelector('[role="radiogroup"][aria-labelledby="theme-label"]'), '主题卡片')
    const radios = [...document.querySelectorAll('[role="radio"]')]
    assert('三套主题有明确的单选语义', radios.length === 3 && radios.filter((item) => item.getAttribute('aria-checked') === 'true').length === 1)
    const previews = [...document.querySelectorAll('.theme-preview')]
    const previewColors = () => previews.map((item) => getComputedStyle(item).backgroundColor)
    const originalColors = previewColors()
    assert('三套预览各自显示主题颜色', new Set(originalColors).size === 3)
    for (const [index, name] of ['paper', 'comic', 'neon'].entries()) {
      radios[index].click()
      await delay(60)
      assert(`${name} 立即应用并记住`, document.documentElement.dataset.theme === name && JSON.parse(localStorage.getItem('yudu-theme')).state.theme === name)
      assert(`${name} 仅选中当前卡片`, radios[index].getAttribute('aria-checked') === 'true' && radios.filter((item) => item.getAttribute('aria-checked') === 'true').length === 1)
      assert(`${name} 不改变其他主题预览`, JSON.stringify(previewColors()) === JSON.stringify(originalColors))
    }
    radios[2].focus()
    key(radios[2], 'ArrowRight')
    await delay(60)
    assert('方向键循环主题并同步焦点', document.documentElement.dataset.theme === 'paper' && document.activeElement === radios[0])
    key(radios[0], 'End')
    await delay(60)
    assert('End 到最后主题', document.documentElement.dataset.theme === 'neon' && document.activeElement === radios[2])
    const trigger = document.querySelector('button[aria-haspopup="menu"][aria-label^="选择主题"]')
    trigger.click()
    await wait(() => document.querySelector('[role="menu"][aria-label="选择主题"]'), '顶栏主题菜单')
    let items = [...document.querySelectorAll('[role="menuitemradio"]')]
    assert('菜单打开聚焦当前主题', document.activeElement === items[2])
    key(items[2], 'ArrowDown')
    assert('菜单方向键只移动焦点', document.activeElement === items[0] && document.documentElement.dataset.theme === 'neon')
    items[0].click()
    await delay(60)
    assert('直接选择后关闭并返回焦点', !document.querySelector('[role="menu"]') && document.activeElement === trigger && document.documentElement.dataset.theme === 'paper')
    trigger.click()
    await delay(60)
    items = [...document.querySelectorAll('[role="menuitemradio"]')]
    key(items[0], 'Escape')
    await delay(60)
    assert('Esc 关闭菜单并返回焦点', !document.querySelector('[role="menu"]') && document.activeElement === trigger)
    trigger.click()
    await delay(60)
    document.querySelector('h1').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await delay(60)
    assert('点击外部关闭主题菜单', !document.querySelector('[role="menu"]'))
    const switches = [...document.querySelectorAll('[role="switch"]')]
    assert('设置开关有可访问名称', switches.every((item) => item.getAttribute('aria-label') || item.getAttribute('aria-labelledby')))
    await wait(() => !document.querySelector('#settings-reading fieldset').disabled, '阅读默认值加载')
    const originalDefaults = await window.yudu.reader.getDefaults()
    const modes = [...document.querySelector('[role="group"][aria-label="翻页模式"]').querySelectorAll('button')]
    const fits = [...document.querySelector('[role="group"][aria-label="页面适配"]').querySelectorAll('button')]
    modes[1].click()
    fits[0].click()
    await wait(async () => { const prefs = await window.yudu.reader.getDefaults(); return prefs.mode === 'double' && prefs.fit === 'width' }, '快速改变两项阅读默认值')
    assert('连续设置保留两项选择并反馈保存', modes[1].getAttribute('aria-pressed') === 'true' && fits[0].getAttribute('aria-pressed') === 'true' && !document.querySelector('#settings-reading [role="alert"]'))
    modes[['single', 'double', 'webtoon'].indexOf(originalDefaults.mode ?? 'single')].click()
    fits[['width', 'height', 'original'].indexOf(originalDefaults.fit ?? 'height')].click()
    await wait(async () => { const prefs = await window.yudu.reader.getDefaults(); return prefs.mode === (originalDefaults.mode ?? 'single') && prefs.fit === (originalDefaults.fit ?? 'height') }, '恢复隔离默认值')
    assert('控件色彩跟随主题', getComputedStyle(document.documentElement).colorScheme === 'light')
    assert('主题卡片位于可视区域且互不重叠', radios.every((item, index) => {
      const rect = item.getBoundingClientRect()
      return rect.width > 150 && rect.right <= innerWidth && (!index || rect.left >= radios[index - 1].getBoundingClientRect().right)
    }))
    const nav = document.querySelector('nav[aria-label="设置分区"]')
    const backupJump = [...nav.querySelectorAll('button')].find((item) => item.textContent === '备份')
    backupJump.click()
    await delay(900)
    assert('长设置页可直达备份且标题不被分区导航挡住', document.querySelector('#settings-backup').getBoundingClientRect().top >= nav.getBoundingClientRect().bottom && document.querySelector('#settings-backup').getBoundingClientRect().top < innerHeight / 2)
    nav.querySelector('button').click()
    await delay(900)
    assert('分区导航能返回主题选择', radios[0].getBoundingClientRect().top < innerHeight / 2)
    return { success: true, checks }
  } catch (error) {
    return { success: false, error: String(error), checks, route: location.hash, text: document.body.textContent.slice(0, 1200) }
  }
})()
