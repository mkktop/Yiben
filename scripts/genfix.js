const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const FIX = process.env.FIX_ROOT;
const dirs = [
  { dir: '海贼王/第01话 降落之岛', hue: 12, label: '第01话' },
  { dir: '海贼王/第03话', hue: 200, label: '第03话' },
];
const archives = [
  { file: '海贼王/第02话', hue: 120, label: '第02话' },
  { file: '单人单行本 第1卷', hue: 260, label: '第1卷' },
];

function svg(text, hue) {
  return Buffer.from(`<svg width="800" height="1200" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" hsl="${hue},70%,30%"/>
      <stop offset="0" stop-color="hsl(${hue},65%,28%)"/>
      <stop offset="1" stop-color="hsl(${(hue+40)%360},60%,16%)"/>
    </linearGradient></defs>
    <rect width="800" height="1200" fill="url(#g)"/>
    <circle cx="650" cy="220" r="140" fill="hsl(${hue},50%,45%)" opacity="0.5"/>
    <circle cx="180" cy="980" r="200" fill="hsl(${(hue+80)%360},50%,40%)" opacity="0.35"/>
    <text x="60" y="140" font-size="52" fill="white" font-family="sans-serif" font-weight="bold">${text}</text>
    <text x="62" y="200" font-size="30" fill="white" opacity="0.7" font-family="sans-serif">雨读 Yudu</text>
  </svg>`);
}

async function main() {
  let n = 0;
  for (const d of dirs) {
    const full = path.join(FIX, d.dir);
    for (const f of fs.readdirSync(full)) {
      if (!f.endsWith('.png')) continue;
      n++;
      await sharp(svg(d.label, d.hue)).png().toFile(path.join(full, f));
    }
  }
  for (const a of archives) {
    const ext = path.extname(a.file);
    const base = a.file; // 已含序号
    const png1 = path.join(process.env.TEMP, 'genfix-1.png');
    const png2 = path.join(process.env.TEMP, 'genfix-2.png');
    await sharp(svg(a.label + ' · P1', a.hue)).png().toFile(png1);
    await sharp(svg(a.label + ' · P2', a.hue + 20)).png().toFile(png2);
    console.log('written', png1, png2);
  }
  console.log('GEN_DONE', n);
}
main().catch(e => { console.error(e); process.exit(1); });
