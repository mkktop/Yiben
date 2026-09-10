const D = require('better-sqlite3');
const db = new D(process.env.APPDATA + '/一本 Yiben/yiben.db', { readonly: true });
console.log('PROGRESS:', JSON.stringify(db.prepare('SELECT id, title, kind FROM chapters WHERE kind='pdf'').all()));
