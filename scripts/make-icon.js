const sharp = require('sharp')
const svg = `<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" rx="108" fill="#c2410c"/>
  <rect x="28" y="28" width="456" height="456" rx="88" fill="none" stroke="#ffe8d6" stroke-width="14" opacity="0.85"/>
  <text x="256" y="352" font-size="300" text-anchor="middle" fill="#fff7ed" font-family="serif" font-weight="bold">一</text>
</svg>`
sharp(Buffer.from(svg)).resize(512, 512).png().toFile('resources/icon.png').then(() => console.log('ICON_OK'))
