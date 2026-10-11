// 由 reader-regression.js 注入，只对新建临时 profile 中的明确缓存 fixture 做真实清理。
;(async () => {
  const checks = []
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const nativeConfirm = window.confirm
  let nativeConfirmCalls = 0
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
    [...root.querySelectorAll('button')].find((node) => node.textContent.trim() === label)
  const section = (title) =>
    [...document.querySelectorAll('section')].find((node) =>
      [...node.querySelectorAll('h2')].some((heading) => heading.textContent.trim() === title)
    )
  const modal = () => document.querySelector('[role="dialog"][aria-modal="true"]')
  const detailValue = (label, root) =>
    [...root.querySelectorAll('dt')].find((node) => node.textContent.trim() === label)
      ?.nextElementSibling?.textContent.trim()
  const open = async (opener, title) => {
    if (!opener || opener.disabled) throw new Error(`入口不可用：${title}`)
    opener.scrollIntoView({ block: 'center' })
    opener.focus()
    opener.click()
    await wait(() => modal()?.textContent.includes(title), title)
    const dialog = modal()
    assert(`${title}优先聚焦取消`, document.activeElement === button('取消', dialog))
    return dialog
  }
  const cancel = async (dialog, opener) => {
    button('取消', dialog).click()
    await wait(() => !modal(), '取消后关闭确认弹窗')
    assert('取消后恢复入口焦点', document.activeElement === opener)
  }
  const formatBytes = (bytes) => {
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
    if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
    return `${Math.max(0, Math.round(bytes / 1024))} KB`
  }
  let selectedBackupId = null
  let snapshotCountBefore = null
  let snapshotCountAfter = null
  try {
    const fixture = __CONFIRM_FIXTURE__
    // runner 可注入 true 仅截图全量清理确认；未注入时按完整回归执行。
    const previewOnly = (() => {
      try {
        return Boolean(__CONFIRM_PREVIEW_ONLY__)
      } catch {
        return false
      }
    })()
    if (!fixture.profileRoot || fixture.series?.length !== 2)
      throw new Error('缺少两个系列与隔离 profile 的缓存 fixture')
    assert('确认回归覆盖长无空格系列标题',
      fixture.series[0].title.length >= 120 && !/\s/.test(fixture.series[0].title))
    const cacheRoot = `${fixture.profileRoot.replaceAll('\\', '/').replace(/\/$/, '')}/cache/cloud189/`.toLowerCase()
    assert('确认回归禁用自动重扫', (await window.yudu.config.get('autoRescan')) === false)
    for (const entry of fixture.series) {
      const data = await window.yudu.reader.chapter(entry.chapterId)
      assert('清理对象仅限隔离缓存 fixture',
        data?.chapter.series_id === entry.id &&
          data.chapter.cloud_file_id &&
          data.chapter.path.replaceAll('\\', '/').toLowerCase().startsWith(cacheRoot))
    }
    const progress = async () => Promise.all(fixture.series.map(async (entry) =>
      [entry.chapterId, (await window.yudu.reader.chapter(entry.chapterId)).progress]))
    const originalProgress = JSON.stringify(await progress())
    const sameProgress = async () => JSON.stringify(await progress()) === originalProgress
    assert('隔离 fixture 已写入阅读进度',
      (await window.yudu.reader.chapter(fixture.series[0].chapterId)).progress?.page === 1)
    const originalCache = await window.yudu.cloud.cacheStats()
    assert('隔离缓存包含两个完整文件',
      originalCache.files === 2 && originalCache.totalBytes === fixture.totalBytes)
    const originalSeriesCache = await window.yudu.cloud.cacheBySeries()
    assert('按系列统计覆盖两个隔离系列', fixture.series.every((entry) =>
      originalSeriesCache.some((cached) => cached.seriesId === entry.id && cached.bytes === entry.bytes)))

    // 创建真实隔离备份，再让设置页从实际 IPC 列表载入；恢复动作本身不执行。
    const backup = await window.yudu.backup.create()
    selectedBackupId = backup.id
    snapshotCountBefore = (await window.yudu.backup.list()).length
    window.confirm = () => {
      nativeConfirmCalls++
      throw new Error('确认回归不应调用原生 window.confirm')
    }
    location.hash = '/settings'
    await wait(() => section('云端缓存') && section('数据库备份与恢复'), '设置页缓存与备份')
    await wait(() => button('清除全部', section('云端缓存')) &&
      !button('清除全部', section('云端缓存')).disabled, '缓存统计载入')
    await wait(() => fixture.series.every((entry) =>
      [...section('云端缓存').querySelectorAll('[data-cache-series-id]')].some((node) =>
        node.getAttribute('data-cache-series-id') === String(entry.id))), '系列缓存列表载入')
    const allOpener = button('清除全部', section('云端缓存'))
    const allDialog = await open(allOpener, '清除全部云端缓存')
    assert('全部清理显示实际占用与保护提示',
      detailValue('当前占用', allDialog) === formatBytes(fixture.totalBytes) &&
        detailValue('缓存文件', allDialog) === `${originalCache.files} 个` &&
        /阅读进度/.test(allDialog.textContent) && /保护/.test(allDialog.textContent))
    assert('打开全部清理不会删除缓存',
      JSON.stringify(await window.yudu.cloud.cacheStats()) === JSON.stringify(originalCache))
    if (previewOnly) {
      // 只展示真实缓存详情；不确认、不执行删除，后续完整回归仍可使用同一 fixture。
      assert('清理预览不调用原生阻塞弹窗', nativeConfirmCalls === 0)
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      await delay(500)
      return { success: true, checks, previewDialog: '清除全部云端缓存' }
    }
    await cancel(allDialog, allOpener)
    assert('取消全部清理保留缓存与进度',
      JSON.stringify(await window.yudu.cloud.cacheStats()) === JSON.stringify(originalCache) &&
        await sameProgress())

    const oneRow = [...section('云端缓存').querySelectorAll('[data-cache-series-id]')].find((node) =>
      node.getAttribute('data-cache-series-id') === String(fixture.series[0].id))
    const oneOpener = [...oneRow.querySelectorAll('button')].find((node) =>
      node.getAttribute('aria-label') === `清除「${fixture.series[0].title}」的缓存`)
    const oneDialog = await open(oneOpener, '清除系列缓存')
    assert('单系列清理显示准确标题与大小',
      detailValue('清理范围', oneDialog) === fixture.series[0].title &&
        detailValue('当前占用', oneDialog) === formatBytes(fixture.series[0].bytes))
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const description = document.getElementById(oneDialog.getAttribute('aria-describedby'))
    const details = oneDialog.querySelector('dl')
    assert('长无空格标题在确认说明和详情中换行且无横向溢出',
      description.scrollWidth <= description.clientWidth + 1 &&
        details.scrollWidth <= details.clientWidth + 1 &&
        oneDialog.scrollWidth <= oneDialog.clientWidth + 1 &&
        getComputedStyle(description).overflowWrap === 'anywhere')
    assert('打开单系列清理不会执行删除',
      JSON.stringify(await window.yudu.cloud.cacheStats()) === JSON.stringify(originalCache))
    await cancel(oneDialog, oneOpener)
    assert('取消单系列清理保留缓存与进度',
      JSON.stringify(await window.yudu.cloud.cacheStats()) === JSON.stringify(originalCache) &&
        await sameProgress())

    const confirmedOne = await open(oneOpener, '清除系列缓存')
    button('确认清除此系列缓存', confirmedOne).click()
    await wait(async () => {
      const cache = await window.yudu.cloud.cacheBySeries()
      return !cache.some((entry) => entry.seriesId === fixture.series[0].id) &&
        cache.some((entry) => entry.seriesId === fixture.series[1].id && entry.bytes === fixture.series[1].bytes)
    }, '确认后仅清掉选中系列')
    await wait(() => !modal(), '单系列清理成功后关闭确认')
    await wait(() => document.activeElement ===
      section('云端缓存').querySelector('[data-cache-focus-target]'), '移除缓存行后恢复到缓存标题')
    assert('单系列清理入口移除后焦点回到缓存标题',
      !oneOpener.isConnected && document.activeElement !== document.body)
    assert('确认单系列清理保留另一系列缓存与全部进度',
      (await window.yudu.cloud.cacheStats()).totalBytes === fixture.series[1].bytes &&
        await sameProgress())

    const finalAllOpener = button('清除全部', section('云端缓存'))
    const confirmedAll = await open(finalAllOpener, '清除全部云端缓存')
    button('确认清除全部缓存', confirmedAll).click()
    await wait(async () => (await window.yudu.cloud.cacheStats()).totalBytes === 0, '确认后缓存清空')
    await wait(() => !modal(), '全部清理成功后关闭确认')
    await wait(() => document.activeElement ===
      section('云端缓存').querySelector('[data-cache-focus-target]'), '清空缓存后恢复到缓存标题')
    assert('全部清理入口禁用后焦点回到缓存标题',
      finalAllOpener.disabled && document.activeElement !== document.body)
    const finalCache = await window.yudu.cloud.cacheStats()
    assert('确认全部清理删除实际文件并保留阅读进度',
      finalCache.files === 0 && finalCache.totalBytes === 0 && await sameProgress())

    const backupSection = section('数据库备份与恢复')
    const backupRow = () => [...backupSection.querySelectorAll('[data-backup-id]')].find((node) =>
      node.getAttribute('data-backup-id') === backup.id)
    const backupTime = new Date(backup.createdAt).toLocaleString('zh-CN', { hour12: false })
    await wait(() => backupRow() && button('恢复', backupRow()), '已创建备份显示在界面')
    const restoreOpener = button('恢复', backupRow())
    const restoreDialog = await open(restoreOpener, '恢复数据库备份')
    assert('恢复确认显示选中备份时间大小与普通备份类型',
      detailValue('备份时间', restoreDialog) === backupTime &&
        detailValue('备份大小', restoreDialog) === formatBytes(backup.bytes) &&
        detailValue('备份类型', restoreDialog) === '普通数据库备份')
    assert('恢复确认明确安全备份与重启',
      /安全备份|安全快照/.test(restoreDialog.textContent) && /重启/.test(restoreDialog.textContent))
    assert('打开恢复确认未创建额外快照',
      (await window.yudu.backup.list()).length === snapshotCountBefore)
    await cancel(restoreDialog, restoreOpener)
    snapshotCountAfter = (await window.yudu.backup.list()).length
    assert('取消恢复不会增加快照且当前进度保留',
      snapshotCountAfter === snapshotCountBefore && await sameProgress())
    assert('确认界面不调用原生阻塞弹窗', nativeConfirmCalls === 0)
    // 所有取消与数据库断言完成后，只展示选中备份的确认框供截图；不点确认，
    // 截图钩子结束 Electron 时不会安排数据库恢复。
    await open(restoreOpener, '恢复数据库备份')
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    await delay(500)
    return {
      success: true,
      checks,
      selectedBackupId,
      snapshotCountBefore,
      snapshotCountAfter,
      cacheStatsBefore: originalCache,
      cacheStatsAfter: finalCache,
      progressUnchanged: await sameProgress(),
      nativeConfirmCalls,
      previewDialog: '恢复数据库备份'
    }
  } catch (error) {
    return {
      success: false,
      checks,
      error: String(error),
      selectedBackupId,
      snapshotCountBefore,
      snapshotCountAfter,
      nativeConfirmCalls,
      route: location.hash,
      text: document.body.textContent.slice(-2600)
    }
  } finally {
    window.confirm = nativeConfirm
  }
})()
