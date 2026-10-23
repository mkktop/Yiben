// 由临时 Electron 入口注入一次性 IPC 故障，确认首页两分区可独立恢复。
;(async () => {
  const checks = []
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const wait = async (predicate) => {
    for (let attempt = 0; attempt < 120; attempt++) {
      if (predicate()) return
      await delay(50)
    }
    throw new Error('等待首页状态超时')
  }
  const assert = (name, condition) => {
    if (!condition) throw new Error(name)
    checks.push(name)
  }
  try {
    const recent = document.querySelector('section[aria-label="最近添加"]')
    const continuing = document.querySelector('section[aria-label="继续阅读"]')
    await wait(() => recent.querySelector('[role="alert"]') && continuing.querySelector('[role="alert"]'))
    assert('首页加载失败有明确提示，不伪装成空书架或没有在读', recent.textContent.includes('最近添加加载失败') && continuing.textContent.includes('续读列表加载失败') && !document.body.textContent.includes('书架还是空的') && !continuing.textContent.includes('还没有在读书目'))
    continuing.querySelector('button').click()
    await wait(() => continuing.querySelector('[data-continue-series]'))
    assert('续读重试成功，最近添加仍可独立重试', !!recent.querySelector('[role="alert"]') && !continuing.querySelector('[role="alert"]'))
    recent.querySelector('button').click()
    await wait(() => recent.querySelector('[data-series-card]'))
    assert('最近添加重试恢复封面列表', !document.querySelector('[role="alert"]'))
    // 等页面入场动画结束再截图，避免捕获透明的中间帧。
    await delay(600)
    return { success: true, checks }
  } catch (error) {
    return { success: false, checks, error: String(error), text: document.body.textContent.slice(-800) }
  }
})()
