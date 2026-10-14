import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/migrations.js';
import {
  normalizeGusUnits,
  normalizeNfzQueues,
  saveGusUnits,
  saveNfzQueues
} from '../src/data-processing.js';

test('normalizuje, waliduje i zapisuje kolejki NFZ bez duplikowania placówek i usług', () => {
  const source = {
    meta: { count: 2 },
    links: { next: null },
    data: [
      {
        id: 123,
        attributes: {
          'provider-code': 'provider-1',
          provider: '  Poradnia   Testowa ',
          benefit: ' Kardiologia ',
          address: 'ul. Testowa 1',
          locality: 'Poznań',
          latitude: '52.4',
          longitude: 16.9,
          phone: '123 456 789',
          ramp: 'Y',
          dates: { date: '2027-02-03' }
        }
      },
      { id: 'broken', attributes: null }
    ]
  };

  const normalized = normalizeNfzQueues(source);
  assert.equal(normalized.records.length, 1);
  assert.equal(normalized.rejected, 1);
  assert.equal(normalized.records[0].attributes.provider, 'Poradnia Testowa');
  assert.equal(normalized.records[0].attributes.latitude, 52.4);
  assert.equal(normalized.records[0].attributes.dates.date, '2027-02-03');

  const database = new Database(':memory:');
  try {
    database.pragma('foreign_keys = ON');
    runMigrations(database);
    const firstSave = saveNfzQueues(database, normalized.records);
    const secondSave = saveNfzQueues(database, normalized.records);

    assert.deepEqual(firstSave, { records: 1, facilities: 1, services: 1 });
    assert.deepEqual(secondSave, firstSave);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM facilities').get().count, 1);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM services').get().count, 1);
    assert.equal(
      database.prepare('SELECT first_available_date FROM services').get().first_available_date,
      '2027-02-03'
    );
    assert.throws(() => database.prepare(`
      INSERT INTO facilities (source, external_id, name, type, latitude)
      VALUES ('test', 'invalid-coordinates', 'Invalid coordinates', 'clinic', 91)
    `).run(), /Facility coordinates are outside valid ranges/);

    const facilityId = database.prepare(
      "SELECT id FROM facilities WHERE source = 'nfz' AND external_id = 'provider-1'"
    ).get().id;
    database.prepare('DELETE FROM facilities WHERE id = ?').run(facilityId);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM services').get().count, 0);
  } finally {
    database.close();
  }
});

test('odrzuca nieprawidłową odpowiedź NFZ i oczyszcza jednostki GUS', () => {
  assert.throws(() => normalizeNfzQueues({ data: {} }), /nieprawidłową strukturę/);

  const normalized = normalizeGusUnits({
    total_count: 2,
    results: [
      { id: 123, name: '  Poznań  ', level: 2 },
      { id: null, name: 'Niepoprawna jednostka' }
    ]
  });
  assert.equal(normalized.data.results.length, 1);
  assert.deepEqual(normalized.data.results[0], { id: '123', name: 'Poznań', level: 2 });
  assert.equal(normalized.rejected, 1);

  const database = new Database(':memory:');
  try {
    database.pragma('foreign_keys = ON');
    runMigrations(database);
    assert.deepEqual(saveGusUnits(database, normalized.data.results), { units: 1 });
    assert.deepEqual(saveGusUnits(database, normalized.data.results), { units: 1 });
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM gus_units').get().count, 1);
    assert.equal(
      database.prepare('SELECT name FROM gus_units WHERE id = ?').get('123').name,
      'Poznań'
    );
  } finally {
    database.close();
  }
});
