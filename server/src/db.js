import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const filename = process.env.DB_PATH
  ? resolve(process.env.DB_PATH)
  : resolve(serverDirectory, 'data/zwtm.db');
mkdirSync(dirname(filename), { recursive: true });
export const db = new Database(filename);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');
