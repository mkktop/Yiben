const D = require('better-sqlite3');
const db = new D(process.env.APPDATA + '/一本 Yiben/yiben.db', { readonly: true });
console.log('PDFCH:', JSON.stringify(db.prepare("SELECT id, series_id, title, page_count FROM chapters WHERE kind='pdf'").all()));
