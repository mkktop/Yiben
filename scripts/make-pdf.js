// 生成一个最简两页 PDF（彩色矩形页）
const fs = require('fs');
function pageStream(rgb) {
  const content = `${rgb[0]} ${rgb[1]} ${rgb[2]} rg 0 0 612 792 re f\n`;
  return content;
}
function buildPdf() {
  const streams = [pageStream([0.85, 0.35, 0.2]), pageStream([0.2, 0.45, 0.85])];
  const objs = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>';
  objs[3] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R >>';
  objs[4] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R >>';
  objs[5] = `<< /Length ${streams[0].length} >>\nstream\n${streams[0]}endstream`;
  objs[6] = `<< /Length ${streams[1].length} >>\nstream\n${streams[1]}endstream`;
  let out = '%PDF-1.4\n';
  const offsets = [];
  for (let i = 1; i <= 6; i++) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 7\n0000000000 65535 f \n`;
  for (let i = 1; i <= 6; i++) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'binary');
}
fs.writeFileSync(process.argv[2], buildPdf());
console.log('PDF_WRITTEN', process.argv[2]);
