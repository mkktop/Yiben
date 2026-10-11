// 给截图用 profile 的 yudu.db 种进度与阅读日志（只碰 --user-data-dir 隔离库）
// 用法: node scripts/seed-shot-db.js <profile目录>
const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')

const profile = process.argv[2]
if (!profile) {
  console.error('用法: node scripts/seed-shot-db.js <profile目录>')
  process.exit(1)
}
const dbPath = path.join(profile, 'yudu.db')
if (!fs.existsSync(dbPath)) {
  console.error('找不到 ' + dbPath)
  process.exit(1)
}

const db = new Database(dbPath)
const chapters = db
  .prepare(
    `SELECT c.id, c.series_id, c.title, s.title AS series_title, c.page_count
     FROM chapters c JOIN series s ON s.id = c.series_id ORDER BY c.id`
  )
  .all()
console.log('chapters:', chapters.map((c) => `${c.id}:${c.series_title}/${c.title}(${c.page_count}p)`).join(' | '))
if (chapters.length === 0) process.exit(1)

const now = Date.now()
const day = (offsetDays) => {
  const d = new Date(now - offsetDays * 86400000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const at = (offsetDays) => now - offsetDays * 86400000

db.transaction(() => {
  // 在读：系列 1 第一话停在中间页（「继续阅读」卡片 + 封面进度条）
  const first = chapters[0]
  db.prepare(
    `INSERT INTO progress (chapter_id, page, completed, updated_at) VALUES (?, ?, 0, ?)
     ON CONFLICT(chapter_id) DO UPDATE SET page = excluded.page, completed = 0, updated_at = excluded.updated_at`
  ).run(first.id, Math.min(2, first.page_count - 1), at(0))

  // 已读完：系列 2 的全部话（封面对勾徽章）
  for (const c of chapters.filter((c) => c.series_id === chapters[1].series_id)) {
    db.prepare(
      `INSERT INTO progress (chapter_id, page, completed, updated_at) VALUES (?, ?, 1, ?)
       ON CONFLICT(chapter_id) DO UPDATE SET page = excluded.page, completed = 1, updated_at = excluded.updated_at`
    ).run(c.id, Math.max(0, c.page_count - 1), at(2))
  }

  // 阅读日志：过去一年里约 70 天有阅读，近期更密（热力图成形）
  const log = db.prepare(
    'INSERT INTO reading_log (chapter_id, series_id, day, pages, ms, at) VALUES (?, ?, ?, ?, ?, ?)'
  )
  const offsets = []
  for (let i = 0; i < 340; i++) {
    // 近 60 天 60% 概率，更早 20%，形成渐浓趋势
    const p = i < 60 ? 0.6 : 0.2
    if (Math.random() < p) offsets.push(i)
  }
  for (const off of offsets) {
    const c = chapters[Math.floor(Math.random() * chapters.length)]
    log.run(c.id, c.series_id, day(off), 8 + Math.floor(Math.random() * 40), 60000 + Math.floor(Math.random() * 900000), at(off))
  }
  console.log('reading_log rows:', offsets.length)
})()

db.close()
console.log('SEED_OK')
