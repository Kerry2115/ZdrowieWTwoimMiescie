import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/migrations.js';

test('migracje i dane demonstracyjne działają na pustej bazie', () => {
  const temporaryDirectory = mkdtempSync(resolve(tmpdir(), 'zwtm-migration-test-'));
  const databasePath = resolve(temporaryDirectory, 'fresh.db');
  const projectDirectory = resolve(import.meta.dirname, '../..');
  const environment = { ...process.env, DB_PATH: databasePath };

  function runScript(script) {
    const result = spawnSync(process.execPath, [script], {
      cwd: projectDirectory,
      env: environment,
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }

  try {
    runScript('server/scripts/migrate.js');
    runScript('server/scripts/seed.js');
    runScript('server/scripts/seed.js');

    const database = new Database(databasePath, { readonly: true });
    try {
      const migrationCount = database.prepare(
        'SELECT COUNT(*) AS count FROM schema_migrations'
      ).get().count;
      const facilityCount = database.prepare(
        "SELECT COUNT(*) AS count FROM facilities WHERE source = 'demo' AND external_id = 'demo-1'"
      ).get().count;
      const serviceCount = database.prepare(
        'SELECT COUNT(*) AS count FROM services'
      ).get().count;
      const triggers = database.prepare(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'facilities_validate_coordinates_%'"
      ).get().count;
      const gusUnitTable = database.prepare(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'gus_units'"
      ).get().count;
      const statisticsForeignKey = database.prepare(
        'PRAGMA foreign_key_list(local_statistics)'
      ).all().some(key => key.table === 'gus_units' && key.from === 'gus_unit_id');

      assert.equal(migrationCount, 4);
      assert.equal(facilityCount, 1);
      assert.equal(serviceCount, 1);
      assert.equal(triggers, 2);
      assert.equal(gusUnitTable, 1);
      assert.equal(statisticsForeignKey, true);
    } finally {
      database.close();
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('migracja GUS zachowuje istniejące statystyki i dodaje ich relację', () => {
  const database = new Database(':memory:');
  const projectDirectory = resolve(import.meta.dirname, '../..');
  database.pragma('foreign_keys = ON');

  try {
    database.exec(readFileSync(resolve(projectDirectory, 'server/migrations/001_initial.sql'), 'utf8'));
    database.exec(readFileSync(resolve(projectDirectory, 'server/migrations/002_facility_coordinate_checks.sql'), 'utf8'));
    database.exec(`
      CREATE TABLE schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO schema_migrations (name) VALUES
        ('001_initial.sql'),
        ('002_facility_coordinate_checks.sql');
      INSERT INTO local_statistics (gus_unit_id, variable_id, year, value)
      VALUES ('legacy-unit-id', 'population', 2025, 1234);
    `);

    runMigrations(database);

    assert.deepEqual(
      database.prepare('SELECT gus_unit_id, variable_id, year, value FROM local_statistics').get(),
      { gus_unit_id: 'legacy-unit-id', variable_id: 'population', year: 2025, value: 1234 }
    );
    assert.equal(
      database.prepare('SELECT name FROM gus_units WHERE id = ?').get('legacy-unit-id').name,
      'legacy-unit-id'
    );
    assert.deepEqual(database.pragma('foreign_key_check'), []);
  } finally {
    database.close();
  }
});
