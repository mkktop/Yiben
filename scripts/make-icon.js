// 雨读品牌方标「雨帘涟漪」生成脚本（与雨番 Framix「霓虹环彩键」同一系列设计语言：
// 暗夜底 #12172a + 粉→紫→青渐变。雨读构图：三条斜雨丝落地两圈涟漪。
// 系列选稿共 6 候选，见 scripts/brand/icon-candidates.png，2026-09-25 定稿第 5 号）。
// 产出：resources/icon.png（512，dev 用）+ build/icon.ico（256/128/64/48/32/24/16，PNG 条目打包）。
// 改版需同步 src/renderer/src/components/LogoMark.tsx（应用内标），三者同源。
const sharp = require('sharp')
const { writeFileSync } = require('fs')

const svg = `<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="yudu-ring" x1="14" y1="14" x2="50" y2="50" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ff5c8a"/>
      <stop offset="1" stop-color="#22d3ee"/>
    </linearGradient>
    <filter id="yudu-blur" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="2.8"/>
    </filter>
  </defs>
  <rect width="64" height="64" rx="15" fill="#12172a"/>
  <rect x=".5" y=".5" width="63" height="63" rx="14.5" fill="none" stroke="rgba(255,255,255,.1)"/>
  <path d="M20 13 L26 34" stroke="#ff5c8a" stroke-width="4.5" stroke-linecap="round" filter="url(#yudu-blur)" opacity=".5"/>
  <path d="M20 13 L26 34" stroke="#ff5c8a" stroke-width="4.5" stroke-linecap="round"/>
  <path d="M32 10 L38 31" stroke="#a78bfa" stroke-width="4.5" stroke-linecap="round"/>
  <path d="M44 13 L50 34" stroke="#22d3ee" stroke-width="4.5" stroke-linecap="round"/>
  <path d="M17 46 Q32 53 47 46" fill="none" stroke="#22d3ee" stroke-width="3" stroke-linecap="round"/>
  <path d="M24 53 Q32 57 40 53" fill="none" stroke="#a78bfa" stroke-width="3" stroke-linecap="round"/>
</svg>`

// ICO 容器：Vista+ 支持 PNG 条目，直接嵌各尺寸 PNG，无需引入 ico 依赖
function packIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(images.length, 4)
  const entries = Buffer.alloc(16 * images.length)
  let offset = 6 + entries.length
  const blobs = []
  images.forEach(({ size, buf }, i) => {
    entries.writeUInt8(size >= 256 ? 0 : size, i * 16) // 0 表示 256
    entries.writeUInt8(size >= 256 ? 0 : size, i * 16 + 1)
    entries.writeUInt16LE(1, i * 16 + 4) // planes
    entries.writeUInt16LE(32, i * 16 + 6) // bit count
    entries.writeUInt32LE(buf.length, i * 16 + 8)
    entries.writeUInt32LE(offset, i * 16 + 12)
    offset += buf.length
    blobs.push(buf)
  })
  return Buffer.concat([header, entries, ...blobs])
}

async function main() {
  const base = sharp(Buffer.from(svg), { density: 300 })
  await base.clone().resize(512, 512).png().toFile('resources/icon.png')
  const sizes = [256, 128, 64, 48, 32, 24, 16]
  const pngs = await Promise.all(
    sizes.map((size) =>
      base
        .clone()
        .resize(size, size)
        .png()
        .toBuffer()
        .then((buf) => ({ size, buf }))
    )
  )
  writeFileSync('build/icon.ico', packIco(pngs))
  console.log('ICON_OK resources/icon.png + build/icon.ico (' + sizes.join('/') + ')')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
