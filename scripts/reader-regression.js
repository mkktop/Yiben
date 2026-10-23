// 真正启动 Electron 的 DOM 回归；所有书库、数据库、截图均使用新建临时目录。
// 用法：先 pnpm build，再 node scripts/reader-regression.js。
const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawn } = require('child_process')
const electron = require('electron')
const Database = require('better-sqlite3')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yudu-reader-regression-'))
const fixture = path.join(root, 'fixture')
const profile = path.join(root, 'profile')
const baseEnv = { ...process.env }
for (const key of [
  'ELECTRON_RUN_AS_NODE',
  'YUDU_SELFTEST',
  'YUDU_SCREENSHOT',
  'YUDU_ROUTE',
  'YUDU_KEY',
  'YUDU_EVAL',
  'YUDU_THEME',
  'ELECTRON_RENDERER_URL'
])
  delete baseEnv[key]

function run(executable, args, env = {}, limit = 45000, onOutput) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: path.resolve(__dirname, '..'),
      env: { ...baseEnv, ...env },
      windowsHide: true
    })
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk
      onOutput?.(output)
    })
    child.stderr.on('data', (chunk) => {
      output += chunk
      onOutput?.(output)
    })
    // 只终止本脚本创建的进程，不影响用户已开的 Electron。
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`验证超时：${output}`))
    }, limit)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      code === 0 ? resolve(output) : reject(new Error(`退出码 ${code}：${output}`))
    })
  })
}
function pdf(count, padded) {
  const objects = ['', '<< /Type /Catalog /Pages 2 0 R >>', '']
  const kids = []
  for (let page = 0; page < count; page++) {
    const id = objects.length
    kids.push(`${id} 0 R`)
    const stream = `${page % 2 ? '0.2 0.4 0.8' : '0.8 0.3 0.2'} rg 0 0 612 792 re f\n${padded ? '% ' + '分段'.replace(/./g, 'r').repeat(15000) + '\n' : ''}`
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${id + 1} 0 R >>`)
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`)
  }
  objects[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${count} >>`
  let output = '%PDF-1.4\n'
  const offsets = [0]
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = output.length
    output += `${id} 0 obj\n${objects[id]}\nendobj\n`
  }
  const xref = output.length
  output += `xref\n0 ${objects.length}\n0000000000 65535 f \n`
  for (const offset of offsets.slice(1)) output += `${String(offset).padStart(10, '0')} 00000 n \n`
  output += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(output)
}

function seedConfirmationFixture() {
  const cacheRoot = path.join(profile, 'cache', 'cloud189')
  fs.mkdirSync(cacheRoot, { recursive: true })
  const now = Date.now()
  const entries = [
    { key: 'a', title: 'LongUnbrokenComicTitle'.repeat(9), bytes: 4096 },
    { key: 'b', title: '确认测试系列 B', bytes: 6144 }
  ]
  const index = {}
  for (const entry of entries) {
    entry.file = path.join(cacheRoot, `confirmation-fixture-${entry.key}.cbz`)
    fs.writeFileSync(entry.file, Buffer.alloc(entry.bytes, 1))
    index[entry.file] = { size: entry.bytes, at: now }
  }
  fs.writeFileSync(path.join(cacheRoot, 'index.json'), JSON.stringify(index))
  const db = new Database(path.join(profile, 'yudu.db'))
  let series
  try {
    series = db.transaction(() => {
      const libraryId = Number(db.prepare(
        'INSERT INTO libraries (name,path,kind,created_at) VALUES (?,?,?,?)'
      ).run('确认测试云端书库', path.join(profile, 'confirmation-library'), 'cloud189', now).lastInsertRowid)
      return entries.map((entry) => {
        const id = Number(db.prepare(
          'INSERT INTO series (library_id,title,folder_path,added_at) VALUES (?,?,?,?)'
        ).run(libraryId, entry.title, path.join(cacheRoot, `series-${entry.key}`), now).lastInsertRowid)
        const chapterId = Number(db.prepare(
          'INSERT INTO chapters (series_id,title,sort_index,path,kind,page_count,size,mtime,cloud_file_id) VALUES (?,?,?,?,?,?,?,?,?)'
        ).run(id, '第 1 话', 0, entry.file, 'zip', 3, entry.bytes, now, `confirmation-fixture-${entry.key}`).lastInsertRowid)
        db.prepare('INSERT INTO progress (chapter_id,page,completed,updated_at) VALUES (?,?,?,?)')
          .run(chapterId, 1, 0, now)
        return { id, title: entry.title, chapterId, bytes: entry.bytes }
      })
    })()
  } finally {
    db.close()
  }
  return { profileRoot: profile, series, totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0) }
}

function setTestWindow(width = 960, height = 640) {
  const db = new Database(path.join(profile, 'yudu.db'))
  try {
    db.prepare(
      'INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run('windowBounds', JSON.stringify({ x: 0, y: 0, width, height, maximized: false }))
  } finally {
    db.close()
  }
}

function seedLibraryFixture() {
  const db = new Database(path.join(profile, 'yudu.db'))
  const now = Date.now()
  const coverSource = fs.readdirSync(path.join(profile, 'thumbs')).find((name) => /^series-\d+\.webp$/.test(name))
  const result = { longTitle: '交互回归：长篇作品' }
  try {
    db.transaction(() => {
      const libraryId = Number(db.prepare('INSERT INTO libraries (name,path,kind,created_at) VALUES (?,?,?,?)')
        .run('交互回归库', path.join(root, 'library-fixture'), 'local', now).lastInsertRowid)
      const addSeries = (title) => {
        const id = Number(db.prepare('INSERT INTO series (library_id,title,folder_path,added_at) VALUES (?,?,?,?)')
          .run(libraryId, title, path.join(root, title), now).lastInsertRowid)
        if (coverSource) fs.copyFileSync(path.join(profile, 'thumbs', coverSource), path.join(profile, 'thumbs', `series-${id}.webp`))
        return id
      }
      const addChapter = (id, title, order, count = 10, volume = null) => Number(db.prepare(
        'INSERT INTO chapters (series_id,title,sort_index,path,kind,page_count,volume) VALUES (?,?,?,?,?,?,?)'
      ).run(id, title, order, path.join(root, `fixture-${id}-${order}.zip`), 'zip', count, volume).lastInsertRowid)
      const save = db.prepare('INSERT INTO progress (chapter_id,page,completed,updated_at) VALUES (?,?,?,?)')
      for (let index = 0; index < 80; index++) addChapter(addSeries(`UX ${String(index).padStart(3, '0')}`), '展示章节', 0)
      result.nextSeries = addSeries('交互回归：读完首话')
      const first = addChapter(result.nextSeries, '第一话', 0)
      addChapter(result.nextSeries, '第二话', 1)
      save.run(first, 9, 1, now + 2)
      result.unknownSeries = addSeries('交互回归：未知页数')
      save.run(addChapter(result.unknownSeries, '未知页数章节', 0, 0), 2, 0, now + 1)
      result.longSeries = addSeries(result.longTitle)
      for (let index = 0; index < 120; index++) {
        const id = addChapter(result.longSeries, `章节检索 ${String(index + 1).padStart(3, '0')}`, index, 10, String(Math.floor(index / 20) + 1))
        if (index === 85) {
          result.currentChapter = id
          save.run(id, 4, 0, now + 3)
        }
      }
      const shelf = Number(db.prepare('INSERT INTO shelves (name,sort) VALUES (?,?)').run('交互回归书架', 0).lastInsertRowid)
      db.prepare('INSERT INTO series_shelves (series_id,shelf_id,added_at) VALUES (?,?,?)').run(result.longSeries, shelf, now)
    })()
  } finally {
    db.close()
  }
  return result
}

async function main() {
  await run(process.execPath, ['scripts/make-fixture.js'], { FIX_ROOT: fixture })
  const association = [path.join(fixture, '关联验证.cbz'), path.join(fixture, '热启动验证.cbz')]
  for (const file of association) fs.copyFileSync(path.join(fixture, '单行本 第1卷.zip'), file)
  const folder = path.join(fixture, '验证PDF')
  fs.mkdirSync(folder)
  fs.writeFileSync(path.join(folder, '第01话.pdf'), pdf(18, true))
  fs.writeFileSync(path.join(folder, '第02话.pdf'), pdf(2, false))
  const selftest = await run(electron, ['.', `--user-data-dir=${profile}`], {
    YUDU_SELFTEST: fixture
  })
  if (!/^SELFTEST_OK$/m.test(selftest) || /SELFTEST_FAIL|SELFTEST_ERROR/.test(selftest))
    throw new Error(selftest)
  console.log('SELFTEST_OK')
  const db = new Database(path.join(profile, 'yudu.db'))
  for (const [key, value] of [
    ['autoRescan', false],
    ['resumeOnLaunch', false],
    ['autoCheckUpdate', false],
    ['backupEnabled', false]
  ])
    db.prepare(
      'INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run(key, JSON.stringify(value))
  const chapters = db
    .prepare(
      'SELECT c.*, s.title AS series_title FROM chapters c JOIN series s ON s.id = c.series_id ORDER BY c.sort_index, c.id'
    )
    .all()
  const ids = {
    pdf: chapters.filter((row) => row.kind === 'pdf').map((row) => row.id),
    sea: chapters.filter((row) => row.series_title === '海贼王').map((row) => row.id),
    spread: chapters.find((row) => row.series_title === '扉页彩页').id
  }
  const seaSeries = chapters.find((row) => row.id === ids.sea[0]).series_id
  db.prepare(
    'INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(
    'readerPrefs',
    JSON.stringify({ [seaSeries]: { mode: 'webtoon', rtl: false, brightness: 0.8, warmth: 0.2 } })
  )
  db.close()
  const script = fs
    .readFileSync(path.join(__dirname, 'reader-regression.eval.js'), 'utf8')
    .replace('__FIXTURE_IDS__', JSON.stringify(ids))
  const screenshot = path.join(root, 'reader.png').replaceAll('\\', '/')
  const output = await run(
    electron,
    ['.', `--user-data-dir=${profile}`],
    { YUDU_SCREENSHOT: screenshot, YUDU_EVAL: script },
    60000
  )
  const result = output.split(/\r?\n/).find((line) => line.startsWith('[eval] '))
  if (!result || result.includes('EVAL_ERROR')) throw new Error(output)
  const checks = JSON.parse(result.slice(7))
  if (!checks.success) throw new Error(JSON.stringify(checks))
  console.log('READER_DOM_OK', JSON.stringify(checks))
  const uiScript = fs.readFileSync(path.join(__dirname, 'ui-regression.eval.js'), 'utf8')
  const uiOutput = await run(electron, ['.', `--user-data-dir=${profile}`], {
    YUDU_SCREENSHOT: path.join(root, 'settings.png').replaceAll('\\', '/'),
    YUDU_EVAL: uiScript
  })
  const uiResult = uiOutput.split(/\r?\n/).find((line) => line.startsWith('[eval] '))
  if (!uiResult || uiResult.includes('EVAL_ERROR')) throw new Error(uiOutput)
  const uiChecks = JSON.parse(uiResult.slice(7))
  if (!uiChecks.success) throw new Error(JSON.stringify(uiChecks))
  console.log('UI_DOM_OK', JSON.stringify(uiChecks))
  const interactionScript = fs.readFileSync(path.join(__dirname, 'interaction-regression.eval.js'), 'utf8')
  const interactionOutput = await run(electron, ['.', `--user-data-dir=${profile}`], {
    YUDU_SCREENSHOT: path.join(root, 'interactions.png').replaceAll('\\', '/'),
    YUDU_EVAL: interactionScript
  })
  const interactionResult = interactionOutput.split(/\r?\n/).find((line) => line.startsWith('[eval] '))
  if (!interactionResult || interactionResult.includes('EVAL_ERROR')) throw new Error(interactionOutput)
  const interactionChecks = JSON.parse(interactionResult.slice(7))
  if (!interactionChecks.success) throw new Error(JSON.stringify(interactionChecks))
  console.log('INTERACTION_DOM_OK', JSON.stringify(interactionChecks))
  const confirmationFixture = seedConfirmationFixture()
  const confirmationScript = fs
    .readFileSync(path.join(__dirname, 'confirmation-regression.eval.js'), 'utf8')
    .replace('__CONFIRM_FIXTURE__', JSON.stringify(confirmationFixture))
  setTestWindow()
  const cachePreviewOutput = await run(electron, ['.', `--user-data-dir=${profile}`], {
    YUDU_SCREENSHOT: path.join(root, 'cache-confirmation-960.png').replaceAll('\\', '/'),
    YUDU_EVAL: confirmationScript.replace('__CONFIRM_PREVIEW_ONLY__', 'true')
  })
  const cachePreviewResult = cachePreviewOutput.split(/\r?\n/).find((line) => line.startsWith('[eval] '))
  if (!cachePreviewResult || cachePreviewResult.includes('EVAL_ERROR') || !JSON.parse(cachePreviewResult.slice(7)).success)
    throw new Error(cachePreviewOutput)
  setTestWindow()
  const confirmationOutput = await run(electron, ['.', `--user-data-dir=${profile}`], {
    YUDU_SCREENSHOT: path.join(root, 'confirmations.png').replaceAll('\\', '/'),
    YUDU_EVAL: confirmationScript.replace('__CONFIRM_PREVIEW_ONLY__', 'false')
  }, 60000)
  const confirmationResult = confirmationOutput.split(/\r?\n/).find((line) => line.startsWith('[eval] '))
  if (!confirmationResult || confirmationResult.includes('EVAL_ERROR')) throw new Error(confirmationOutput)
  const confirmationChecks = JSON.parse(confirmationResult.slice(7))
  if (!confirmationChecks.success) throw new Error(JSON.stringify(confirmationChecks))
  if (fs.existsSync(path.join(profile, 'pending-restore.sqlite')))
    throw new Error('取消备份恢复后不应创建待恢复数据库')
  for (const key of ['a', 'b']) {
    if (fs.existsSync(path.join(profile, 'cache', 'cloud189', `confirmation-fixture-${key}.cbz`)))
      throw new Error('确认清理后缓存文件仍存在')
  }
  console.log('CONFIRMATION_DOM_OK', JSON.stringify(confirmationChecks))
  const previewScript = fs.readFileSync(path.join(__dirname, 'theme-preview.eval.js'), 'utf8')
  // 设置页在应用允许的最小窗口中也必须能完整选择三套主题。
  const resumeDb = new Database(path.join(profile, 'yudu.db'))
  resumeDb.prepare(
    'INSERT INTO progress (chapter_id,page,completed,updated_at) VALUES (?,?,?,?) ON CONFLICT(chapter_id) DO UPDATE SET page=excluded.page, completed=excluded.completed, updated_at=excluded.updated_at'
  ).run(ids.sea[1], 1, 0, Date.now())
  resumeDb.close()
  const seriesScript = fs.readFileSync(path.join(__dirname, 'series-layout.eval.js'), 'utf8')
  for (const theme of ['paper', 'comic', 'neon']) {
    setTestWindow()
    const seriesOutput = await run(electron, ['.', `--user-data-dir=${profile}`], {
      YUDU_SCREENSHOT: path.join(root, `series-${theme}-960.png`).replaceAll('\\', '/'),
      YUDU_EVAL: seriesScript.replace('__SERIES_THEME__', JSON.stringify(theme)).replace('__SERIES_MINIMUM__', 'true')
    })
    const seriesResult = seriesOutput.split(/\r?\n/).find((line) => line.startsWith('[eval] '))
    if (!seriesResult || seriesResult.includes('EVAL_ERROR')) throw new Error(seriesOutput)
    const seriesChecks = JSON.parse(seriesResult.slice(7))
    if (!seriesChecks.success) throw new Error(JSON.stringify(seriesChecks))
    console.log('SERIES_LAYOUT_OK', JSON.stringify(seriesChecks))
  }
  setTestWindow(1400, 900)
  const wideSeriesOutput = await run(electron, ['.', `--user-data-dir=${profile}`], {
    YUDU_SCREENSHOT: path.join(root, 'series-comic-1400.png').replaceAll('\\', '/'),
    YUDU_EVAL: seriesScript.replace('__SERIES_THEME__', JSON.stringify('comic')).replace('__SERIES_MINIMUM__', 'false')
  })
  const wideSeriesResult = wideSeriesOutput.split(/\r?\n/).find((line) => line.startsWith('[eval] '))
  if (!wideSeriesResult || wideSeriesResult.includes('EVAL_ERROR') || !JSON.parse(wideSeriesResult.slice(7)).success)
    throw new Error(wideSeriesOutput)
  // 宽窗口检查在屏幕放不下 1280 宽窗口的环境（CI 虚拟屏）里被 eval 显式跳过
  if (JSON.parse(wideSeriesResult.slice(7)).skipped)
    console.log('SERIES_LAYOUT_SKIPPED', JSON.stringify({ skipped: JSON.parse(wideSeriesResult.slice(7)).skipped }))
  else console.log('SERIES_LAYOUT_OK', wideSeriesResult.slice(7))
  for (const theme of ['comic', 'neon']) {
    setTestWindow()
    const previewOutput = await run(electron, ['.', `--user-data-dir=${profile}`], {
      YUDU_SCREENSHOT: path.join(root, `settings-${theme}-960.png`).replaceAll('\\', '/'),
      YUDU_EVAL: previewScript.replace('__THEME__', theme)
    })
    const previewResult = previewOutput.split(/\r?\n/).find((line) => line.startsWith('[eval] '))
    if (!previewResult || previewResult.includes('EVAL_ERROR')) throw new Error(previewOutput)
    const layout = JSON.parse(previewResult.slice(7))
    if (!layout.success) throw new Error(JSON.stringify(layout))
    console.log('THEME_LAYOUT_OK', JSON.stringify(layout))
  }
  const associationScript = fs
    .readFileSync(path.join(__dirname, 'reader-association.eval.js'), 'utf8')
    .replace('__ASSOC_FILES__', JSON.stringify(association))
  let hotRun
  const associationOutput = await run(
    electron,
    ['.', association[0], `--user-data-dir=${profile}`],
    {
      YUDU_SCREENSHOT: path.join(root, 'association.png').replaceAll('\\', '/'),
      YUDU_EVAL: associationScript
    },
    45000,
    (log) => {
      if (!hotRun && log.includes('YUDU_HOT_TEST_READY'))
        hotRun = run(electron, ['.', association[1], `--user-data-dir=${profile}`], {}, 12000)
    }
  )
  if (!hotRun) throw new Error('热启动验证未触发')
  await hotRun
  const associationResult = associationOutput
    .split(/\r?\n/)
    .find((line) => line.startsWith('[eval] '))
  if (
    !associationResult ||
    associationResult.includes('EVAL_ERROR') ||
    !JSON.parse(associationResult.slice(7)).success
  )
    throw new Error(associationOutput)
  console.log('FILE_ASSOCIATION_DOM_OK', associationResult.slice(7))
  // 连续关闭 / 重开真实应用，检查窗口尺寸保存没有每轮累计增长。
  setTestWindow()
  const restoredWindows = []
  for (let launch = 0; launch < 3; launch++) {
    const restoredOutput = await run(electron, ['.', `--user-data-dir=${profile}`], {
      YUDU_SCREENSHOT: path.join(root, `window-restore-${launch}.png`).replaceAll('\\', '/'),
      YUDU_EVAL: '(async () => { await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); return {width: innerWidth, height: innerHeight} })()'
    })
    const restoredResult = restoredOutput.split(/\r?\n/).find((line) => line.startsWith('[eval] '))
    if (!restoredResult || restoredResult.includes('EVAL_ERROR')) throw new Error(restoredOutput)
    const boundsDb = new Database(path.join(profile, 'yudu.db'))
    const saved = JSON.parse(boundsDb.prepare('SELECT value FROM settings WHERE key = ?').get('windowBounds').value)
    boundsDb.close()
    restoredWindows.push({ ...JSON.parse(restoredResult.slice(7)), saved })
  }
  const stable = restoredWindows.slice(1).every((entry) =>
    JSON.stringify(entry) === JSON.stringify(restoredWindows[0]))
  if (!stable) throw new Error(`窗口重开后尺寸累计变化：${JSON.stringify(restoredWindows)}`)
  console.log('WINDOW_RESTORE_OK', JSON.stringify(restoredWindows))
  const libraryFixture = seedLibraryFixture()
  setTestWindow()
  const libraryScript = fs.readFileSync(path.join(__dirname, 'library-regression.eval.js'), 'utf8')
    .replace('__LIBRARY_FIXTURE__', JSON.stringify(libraryFixture))
  const libraryOutput = await run(electron, ['.', `--user-data-dir=${profile}`], {
    YUDU_SCREENSHOT: path.join(root, 'chapter-list-960.png').replaceAll('\\', '/'),
    YUDU_EVAL: libraryScript
  })
  const libraryResult = libraryOutput.split(/\r?\n/).find((line) => line.startsWith('[eval] '))
  if (!libraryResult || libraryResult.includes('EVAL_ERROR') || !JSON.parse(libraryResult.slice(7)).success)
    throw new Error(libraryOutput)
  console.log('LIBRARY_DOM_OK', libraryResult.slice(7))

  // 故障注入只存在于临时入口；应用本身不增加测试接口。
  const faultEntry = path.join(root, 'home-fault.cjs')
  fs.writeFileSync(faultEntry, `
const { ipcMain } = require('electron')
const handle = ipcMain.handle.bind(ipcMain)
const failed = new Set()
ipcMain.handle = (channel, listener) => handle(channel, (...args) => {
  if ((channel === 'home:recent' || channel === 'home:continue') && !failed.has(channel)) {
    failed.add(channel)
    throw new Error('模拟首页加载失败')
  }
  return listener(...args)
})
require(${JSON.stringify(path.resolve(__dirname, '../out/main/index.js'))})
`)
  const homeErrorOutput = await run(electron, [faultEntry, `--user-data-dir=${profile}`], {
    YUDU_SCREENSHOT: path.join(root, 'home-recovered.png').replaceAll('\\', '/'),
    YUDU_EVAL: fs.readFileSync(path.join(__dirname, 'home-error-regression.eval.js'), 'utf8')
  })
  const homeErrorResult = homeErrorOutput.split(/\r?\n/).find((line) => line.startsWith('[eval] '))
  if (!homeErrorResult || homeErrorResult.includes('EVAL_ERROR') || !JSON.parse(homeErrorResult.slice(7)).success)
    throw new Error(homeErrorOutput)
  console.log('HOME_ERROR_DOM_OK', homeErrorResult.slice(7))
  console.log('REGRESSION_ARTIFACTS', root)
}
main().catch((error) => {
  console.error(error)
  console.error('REGRESSION_ARTIFACTS', root)
  process.exitCode = 1
})
