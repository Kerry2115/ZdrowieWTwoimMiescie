import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const filename = resolve(process.env.DB_PATH || 'data/zwtm.db');
mkdirSync(dirname(filename), { recursive: true });
export const db = new Database(filename);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');
