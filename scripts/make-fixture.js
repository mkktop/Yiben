// 生成 selftest/UI 验证用的本地书库 fixture
// 用法: FIX_ROOT=<目录> node scripts/make-fixture.js
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const sharp = require('sharp')
const { path7za } = require('7zip-bin')

const FIX = process.env.FIX_ROOT
if (!FIX) {
  console.error('需要 FIX_ROOT 环境变量')
  process.exit(1)
}

const W = 800
const H = 1200

function svg(label, hue, w = W, h = H) {
  return Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue},65%,28%)"/>
      <stop offset="1" stop-color="hsl(${(hue + 40) % 360},60%,16%)"/>
    </linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/>
    <circle cx="${w - 150}" cy="220" r="140" fill="hsl(${hue},50%,45%)" opacity="0.5"/>
    <text x="60" y="140" font-size="52" fill="white" font-family="sans-serif" font-weight="bold">${label}</text>
  </svg>`)
}

async function writePng(dir, name, label, hue, w = W, h = H) {
  fs.mkdirSync(dir, { recursive: true })
  await sharp(svg(label, hue, w, h)).png().toFile(path.join(dir, name))
}

async function main() {
  // 系列A：散图章节 ×2（跨话导航 / 标记已读用）
  for (let i = 1; i <= 4; i++) {
    await writePng(path.join(FIX, '海贼王', '第01话 降落之岛'), `${i}.png`, `海贼王 1-${i}`, 12)
    await writePng(path.join(FIX, '海贼王', '第02话'), `${i}.png`, `海贼王 2-${i}`, 30)
  }

  // 系列B：含跨页大图（第2页 1600×900 横宽）
  await writePng(path.join(FIX, '扉页彩页', '第01话'), '1.png', '彩页 1-1', 120)
  await writePng(path.join(FIX, '扉页彩页', '第01话'), '2.png', '跨页 SPREAD', 150, 1600, 900)
  await writePng(path.join(FIX, '扉页彩页', '第01话'), '3.png', '彩页 1-3', 180)

  // 系列C：zip 章节 ×2（经 7za 打包）
  const tmp = fs.mkdtempSync(path.join(process.env.TEMP, 'yiben-zip-'))
  for (const vol of ['1', '2']) {
    const zdir = path.join(tmp, `v${vol}`)
    for (let i = 1; i <= 2; i++) {
      await writePng(zdir, `${i}.png`, `单行本 ${vol}-${i}`, 200 + Number(vol) * 30)
    }
    execFileSync(path7za, ['a', '-tzip', path.join(FIX, `单行本 第${vol}卷.zip`), path.join(zdir, '*')], {
      stdio: 'ignore'
    })
  }
  console.log('FIXTURE_DONE', FIX)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
