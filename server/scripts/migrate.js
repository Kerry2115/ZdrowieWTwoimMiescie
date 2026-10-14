import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { db } from '../src/db.js';
db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)');
for (const name of readdirSync(resolve('migrations')).filter(x=>x.endsWith('.sql')).sort()) {
 if (!db.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get(name)) {
  const sql=readFileSync(resolve('migrations',name),'utf8');
  db.transaction(()=>{db.exec(sql);db.prepare('INSERT INTO schema_migrations(name) VALUES (?)').run(name)})();
  console.log('Migracja:',name);
 }
}
console.log('Baza gotowa');
