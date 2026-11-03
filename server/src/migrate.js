import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { db } from './db.js';
export function migrate() {
 const directory = fileURLToPath(new URL('../migrations/', import.meta.url));
 db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)');
 for (const name of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) {
  if (!db.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get(name)) {
   db.transaction(() => {
    db.exec(readFileSync(join(directory, name), 'utf8'));
    db.prepare('INSERT INTO schema_migrations(name) VALUES (?)').run(name);
   })();
  }
 }
}
