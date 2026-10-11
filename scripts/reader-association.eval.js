;(async () => {
  const files = __ASSOC_FILES__
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const waitFile = async (file) => {
    const end = Date.now() + 12000
    while (Date.now() < end) {
      const id = Number(location.hash.match(/reader\/(\d+)/)?.[1])
      if (id) {
        const info = await window.yudu.reader.chapter(id)
        const image = document.querySelector(`img[src^="yudu://page/${id}/"]`)
        if (info?.chapter.path === file && image?.complete && image.naturalWidth > 0) return id
      }
      await delay(80)
    }
    throw new Error(`文件关联未进入正确章节：${file} ${location.hash}`)
  }
  const cold = await waitFile(files[0])
  console.warn('YUDU_HOT_TEST_READY')
  const hot = await waitFile(files[1])
  if (hot === cold) throw new Error('热启动没有切换章节')
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
  const end = Date.now() + 5000
  while (Date.now() < end) {
    if ((await window.yudu.reader.chapter(hot)).progress?.page === 1)
      return { success: true, cold, hot, progress: 1 }
    await delay(80)
  }
  throw new Error('热启动阅读进度没有落库')
})()
