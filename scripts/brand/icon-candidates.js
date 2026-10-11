// 雨读品牌方标候选画板：同系列设计语言（暗夜底 #12172a + 粉→青环彩渐变 + 雨元素）的 6 个构图。
// 渲染 scripts/brand/icon-candidates.png（3×2 网格，行序即编号）供选稿；选中后把对应 SVG
// 同步进 scripts/make-icon.js 与 src/renderer/src/components/LogoMark.tsx。
const sharp = require('sharp')
const { mkdirSync } = require('fs')

// 公共渐变/滤镜 defs（各候选共用 id 前缀 cN 避免冲突）
function defs(p) {
  return `<defs>
    <linearGradient id="${p}-ring" x1="14" y1="14" x2="50" y2="50" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ff5c8a"/><stop offset="1" stop-color="#22d3ee"/>
    </linearGradient>
    <linearGradient id="${p}-tri" x1="22" y1="22" x2="43" y2="41" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ff5c8a"/><stop offset=".5" stop-color="#a78bfa"/><stop offset="1" stop-color="#22d3ee"/>
    </linearGradient>
    <linearGradient id="${p}-horiz" x1="14" y1="32" x2="50" y2="32" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ff5c8a"/><stop offset="1" stop-color="#22d3ee"/>
    </linearGradient>
    <filter id="${p}-blur" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="2.8"/>
    </filter>
  </defs>`
}

// 暗夜底 + 微描边 + 右上白色雨丝（贯穿全系列的签名元素；rain=false 时省略雨丝）
function base(p, rain = true) {
  return `<rect width="64" height="64" rx="15" fill="#12172a"/>
  <rect x=".5" y=".5" width="63" height="63" rx="14.5" fill="none" stroke="rgba(255,255,255,.1)"/>
  ${rain ? `<path d="M43 6.5L39.5 12.5" stroke="#fff" stroke-width="3.5" stroke-linecap="round" opacity=".85" fill="none"/>` : ''}`
}

// 系列同款缺口环（dasharray 缺口落在右上雨丝处）
function ring(p) {
  return `<circle cx="32" cy="32" r="17.5" fill="none" stroke="url(#${p}-ring)" stroke-width="4.5"
    stroke-linecap="round" stroke-dasharray="88 22" transform="rotate(-52 32 32)" filter="url(#${p}-blur)" opacity=".9"/>
  <circle cx="32" cy="32" r="17.5" fill="none" stroke="url(#${p}-ring)" stroke-width="4.5"
    stroke-linecap="round" stroke-dasharray="88 22" transform="rotate(-52 32 32)"/>`
}

// 翻开的书（C1/C4 共用形）
function book(p, y = 0) {
  return `<g transform="translate(0 ${y})">
    <path d="M32 24.8 C29 22.6 25.4 22 22.2 22.5 V38 C25.4 37.5 29 38.1 32 40.4 Z"
      fill="url(#${p}-tri)" stroke="url(#${p}-tri)" stroke-width="2" stroke-linejoin="round"/>
    <path d="M32 24.8 C35 22.6 38.6 22 41.8 22.5 V38 C38.6 37.5 35 38.1 32 40.4 Z"
      fill="url(#${p}-tri)" stroke="url(#${p}-tri)" stroke-width="2" stroke-linejoin="round"/>
    <path d="M32 24.8 V40.4" stroke="#12172a" stroke-width="1.6" stroke-linecap="round"/>
  </g>`
}

// 渐变雨滴（尖上圆下）
function drop(p, cx, cy, s) {
  return `<g transform="translate(${cx} ${cy}) scale(${s}) translate(-32 -32)">
    <path d="M32 21 C36 27 39 30.5 39 34.5 A7 7 0 1 1 25 34.5 C25 30.5 28 27 32 21 Z"
      fill="url(#${p}-tri)" stroke="url(#${p}-tri)" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="29" cy="34" r="1.8" fill="#fff" opacity=".75"/>
  </g>`
}

const candidates = [
  {
    name: '1-ring-book',
    svg: `<g>${defs('c1')}${base('c1')}${ring('c1')}${book('c1')}</g>`
  },
  {
    name: '2-ring-drop',
    svg: `<g>${defs('c2')}${base('c2')}${ring('c2')}${drop('c2', 32, 33, 1)}</g>`
  },
  {
    name: '3-glyph-rain',
    // 「雨」的几何印章：圆角外框 + 天横 + 三雨丝，全渐变霓虹描边
    svg: `<g>${defs('c3')}${base('c3', false)}
      <rect x="16" y="16" width="32" height="32" rx="8" fill="none"
        stroke="url(#c3-ring)" stroke-width="4" filter="url(#c3-blur)" opacity=".55"/>
      <rect x="16" y="16" width="32" height="32" rx="8" fill="none" stroke="url(#c3-ring)" stroke-width="4"/>
      <path d="M24 26 H40" stroke="url(#c3-tri)" stroke-width="4" stroke-linecap="round"/>
      <path d="M24 33 V42" stroke="#ff5c8a" stroke-width="3.6" stroke-linecap="round"/>
      <path d="M32 33 V43" stroke="#a78bfa" stroke-width="3.6" stroke-linecap="round"/>
      <path d="M40 33 V42" stroke="#22d3ee" stroke-width="3.6" stroke-linecap="round"/>
    </g>`
  },
  {
    name: '4-book-rain',
    // 书承雨：翻开的书放大居下，一颗雨滴落向书页
    svg: `<g>${defs('c4')}${base('c4')}${drop('c4', 32, 18, 0.62)}
      <g transform="translate(0 6) scale(1.08) translate(-2.6 -1.5)">${book('c4')}</g>
    </g>`
  },
  {
    name: '5-rain-ripple',
    // 雨帘涟漪：三条斜雨丝（粉/紫/青）落地两圈涟漪
    svg: `<g>${defs('c5')}${base('c5', false)}
      <path d="M20 13 L26 34" stroke="#ff5c8a" stroke-width="4.5" stroke-linecap="round" filter="url(#c5-blur)" opacity=".5"/>
      <path d="M20 13 L26 34" stroke="#ff5c8a" stroke-width="4.5" stroke-linecap="round"/>
      <path d="M32 10 L38 31" stroke="#a78bfa" stroke-width="4.5" stroke-linecap="round"/>
      <path d="M44 13 L50 34" stroke="#22d3ee" stroke-width="4.5" stroke-linecap="round"/>
      <path d="M17 46 Q32 53 47 46" fill="none" stroke="#22d3ee" stroke-width="3" stroke-linecap="round"/>
      <path d="M24 53 Q32 57 40 53" fill="none" stroke="#a78bfa" stroke-width="3" stroke-linecap="round"/>
    </g>`
  },
  {
    name: '6-umbrella',
    // 雨伞：渐变伞面 + 伞柄，右上签名雨丝
    svg: `<g>${defs('c6')}${base('c6')}
      <path d="M14 33 A18 18 0 0 1 50 33" fill="none" stroke="url(#c6-ring)" stroke-width="4.5"
        stroke-linecap="round" filter="url(#c6-blur)" opacity=".5"/>
      <path d="M14 33 A18 18 0 0 1 50 33" fill="none" stroke="url(#c6-ring)" stroke-width="4.5" stroke-linecap="round"/>
      <path d="M14 33 Q17 30.5 20 33 Q23 30.5 26 33 Q29 30.5 32 33 Q35 30.5 38 33 Q41 30.5 44 33 Q47 30.5 50 33"
        fill="none" stroke="url(#c6-ring)" stroke-width="3.2" stroke-linecap="round"/>
      <path d="M32 34 V46 Q32 52 37 51" fill="none" stroke="url(#c6-tri)" stroke-width="3.6" stroke-linecap="round"/>
    </g>`
  }
]

const CELL = 320 // 展示尺寸
const GAP = 44
const LABEL = 46

async function main() {
  mkdirSync('scripts/brand/candidates', { recursive: true })

  // 每个候选单独渲染 512 PNG（选稿放大看细节 + 选中后直接搬 SVG）
  for (const c of candidates) {
    const svg = `<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${c.svg}</svg>`
    await sharp(Buffer.from(svg), { density: 300 }).resize(512, 512).png()
      .toFile(`scripts/brand/candidates/${c.name}.png`)
  }

  // 画板：3×2 浅底网格（行序 = 编号），下方数字标签
  const cols = 3
  const rows = Math.ceil(candidates.length / cols)
  const W = cols * CELL + (cols + 1) * GAP
  const H = rows * (CELL + LABEL) + (rows + 1) * GAP
  const cellSvg = candidates
    .map((c, i) => {
      const x = GAP + (i % cols) * (CELL + GAP)
      const y = GAP + Math.floor(i / cols) * (CELL + LABEL + GAP)
      return `<g transform="translate(${x + CELL / 2} ${y + CELL + 26})">
        <text text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="28" font-weight="600" fill="#3a3f4a">${i + 1}</text>
      </g><g transform="translate(${x} ${y}) scale(${CELL / 64})">${c.svg}</g>`
    })
    .join('\n')
  const sheet = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${W}" height="${H}" fill="#eceef2"/>${cellSvg}</svg>`
  await sharp(Buffer.from(sheet)).png().toFile('scripts/brand/icon-candidates.png')
  console.log('CANDIDATES_OK', candidates.length, '->', 'scripts/brand/icon-candidates.png')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
