import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
test('SQLite odpowiada',()=>assert.equal(db.prepare('SELECT 1 AS value').get().value,1));
test('Klucze obce aktywne',()=>assert.equal(db.pragma('foreign_keys',{simple:true}),1));
