import { db } from '../src/db.js';
import { runMigrations } from '../src/migrations.js';

runMigrations(db);
console.log('Baza gotowa');
