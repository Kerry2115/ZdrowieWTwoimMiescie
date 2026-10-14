import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const migrationsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations');

export function runMigrations(database, directory = migrationsDirectory) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const migrations = readdirSync(directory)
    .filter(name => /^\d+_[a-z0-9_-]+\.sql$/i.test(name))
    .sort();

  for (const name of migrations) {
    const applied = database.prepare(
      'SELECT 1 FROM schema_migrations WHERE name = ?'
    ).get(name);
    if (applied) continue;

    const sql = readFileSync(resolve(directory, name), 'utf8');
    database.transaction(() => {
      database.exec(sql);
      database.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(name);
    })();
    console.log('Migracja:', name);
  }
}
