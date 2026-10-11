// 三套主题与最小窗口的渲染检查，运行环境由回归脚本隔离。
(async () => {
  const desired = '__THEME__'
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  location.hash = '/settings'
  for (let attempt = 0; attempt < 80 && !document.querySelector('[role="radio"]'); attempt++) await delay(50)
  const radios = [...document.querySelectorAll('[role="radio"]')]
  const index = ['paper', 'comic', 'neon'].indexOf(desired)
  if (!radios[index]) return { success: false, error: '主题入口未加载' }
  radios[index].click()
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  await delay(500)
  const nav = document.querySelector('nav[aria-label="设置分区"]')
  const result = {
    success: radios.every((item) => {
      const rect = item.getBoundingClientRect()
      return rect.width > 150 && rect.left >= 0 && rect.right <= innerWidth && rect.bottom < innerHeight
    }) && nav.getBoundingClientRect().right <= innerWidth && document.documentElement.dataset.theme === desired,
    theme: desired,
    width: innerWidth,
    height: innerHeight,
    cards: radios.map((item) => ({ width: item.getBoundingClientRect().width, height: item.getBoundingClientRect().height })),
    colorScheme: getComputedStyle(document.documentElement).colorScheme
  }
  return result
})()
