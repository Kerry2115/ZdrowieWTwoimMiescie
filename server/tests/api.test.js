import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { app } from '../src/app.js';
import { db } from '../src/db.js';
import { runMigrations } from '../src/migrations.js';

test('CRUD placówek waliduje dane i zwraca wspólny format odpowiedzi', async () => {
  runMigrations(db);
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const externalId = `api-test-${Date.now()}`;
  let facilityId;

  async function request(path, options) {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: { 'content-type': 'application/json', ...options?.headers }
    });
    return { response, body: await response.json() };
  }

  try {
    const created = await request('/api/facilities', {
      method: 'POST',
      body: JSON.stringify({
        source: 'test',
        external_id: externalId,
        name: 'Placówka testowa',
        type: 'przychodnia',
        city: 'Poznań'
      })
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.data.name, 'Placówka testowa');
    facilityId = created.body.data.id;

    const health = await request('/api/health');
    assert.deepEqual(health.body, { data: { ok: true, database: 'sqlite' } });

    const listed = await request('/api/facilities?city=Poznań');
    assert.equal(listed.response.status, 200);
    assert.ok(listed.body.data.some(facility => facility.id === facilityId));

    const duplicate = await request('/api/facilities', {
      method: 'POST',
      body: JSON.stringify({
        source: 'test',
        external_id: externalId,
        name: 'Duplikat',
        type: 'przychodnia'
      })
    });
    assert.equal(duplicate.response.status, 409);
    assert.equal(duplicate.body.error.code, 'RESOURCE_CONFLICT');

    const read = await request(`/api/facilities/${facilityId}`);
    assert.equal(read.response.status, 200);
    assert.equal(read.body.data.city, 'Poznań');

    const patched = await request(`/api/facilities/${facilityId}`, {
      method: 'PATCH',
      body: JSON.stringify({ city: 'Gdańsk' })
    });
    assert.equal(patched.response.status, 200);
    assert.equal(patched.body.data.city, 'Gdańsk');

    const replaced = await request(`/api/facilities/${facilityId}`, {
      method: 'PUT',
      body: JSON.stringify({
        source: 'test',
        external_id: externalId,
        name: 'Zmieniona placówka',
        type: 'szpital'
      })
    });
    assert.equal(replaced.response.status, 200);
    assert.equal(replaced.body.data.name, 'Zmieniona placówka');
    assert.equal(replaced.body.data.city, null);

    const invalid = await request('/api/facilities', {
      method: 'POST',
      body: JSON.stringify({ name: 'Brak wymaganych pól' })
    });
    assert.equal(invalid.response.status, 400);
    assert.equal(invalid.body.error.code, 'REQUIRED_FIELD');

    const invalidCoordinates = await request('/api/facilities', {
      method: 'POST',
      body: JSON.stringify({
        source: 'test',
        external_id: `${externalId}-bad-coordinates`,
        name: 'Błędne współrzędne',
        type: 'przychodnia',
        latitude: 91
      })
    });
    assert.equal(invalidCoordinates.response.status, 400);
    assert.equal(invalidCoordinates.body.error.code, 'INVALID_FIELD');

    const emptyPatch = await request(`/api/facilities/${facilityId}`, {
      method: 'PATCH',
      body: JSON.stringify({})
    });
    assert.equal(emptyPatch.response.status, 400);
    assert.equal(emptyPatch.body.error.code, 'EMPTY_UPDATE');

    const invalidJson = await request('/api/facilities', {
      method: 'POST',
      body: '{"source":'
    });
    assert.equal(invalidJson.response.status, 400);
    assert.equal(invalidJson.body.error.code, 'INVALID_JSON');

    const notFound = await request('/api/facilities/999999999');
    assert.equal(notFound.response.status, 404);
    assert.equal(notFound.body.error.code, 'FACILITY_NOT_FOUND');

    const invalidId = await request('/api/facilities/0');
    assert.equal(invalidId.response.status, 400);
    assert.equal(invalidId.body.error.code, 'INVALID_ID');

    const unknownRoute = await request('/api/not-a-route');
    assert.equal(unknownRoute.response.status, 404);
    assert.equal(unknownRoute.body.error.code, 'ROUTE_NOT_FOUND');

    const originalFetch = globalThis.fetch;
    const importedExternalId = `api-import-${externalId}`;
    const importedGusUnitId = `gus-${externalId}`;
    const gusSearchName = `GUSIntegration${externalId}`;
    globalThis.fetch = (url, options) => {
      const requestUrl = String(url);
      if (!requestUrl.startsWith('https://api.nfz.gov.pl/') &&
          !requestUrl.startsWith('https://bdl.stat.gov.pl/')) {
        return originalFetch(url, options);
      }
      if (requestUrl.startsWith('https://bdl.stat.gov.pl/')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            results: [
              { id: importedGusUnitId, name: '  Jednostka testowa  ', level: 3 },
              { id: null, name: 'Niepoprawna jednostka' }
            ],
            total_count: 2
          })
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          meta: { count: 1 },
          links: { next: null },
          data: [{
            id: 'nfz-test-record',
            attributes: {
              'provider-code': `api-import-${externalId}`,
              provider: 'Import testowy NFZ',
              benefit: 'Specjalność testowa',
              locality: 'Łódź',
              dates: { date: '2027-04-05' }
            }
          }]
        })
      });
    };
    try {
      const imported = await request('/api/nfz/import', {
        method: 'POST',
        body: JSON.stringify({
          province: '07',
          benefit: `integration-${externalId}`,
          limit: '1',
          page: '1',
          case: '1'
        })
      });
      assert.equal(imported.response.status, 200);
      assert.equal(imported.body.data.records, 1);
      assert.equal(imported.body.data.facilities, 1);
      assert.equal(imported.body.data.services, 1);
      assert.equal(imported.body.normalization.rejected, 0);
      assert.equal(
        db.prepare('SELECT city FROM facilities WHERE source = ? AND external_id = ?')
          .get('nfz', importedExternalId).city,
        'Łódź'
      );

      const importedGus = await request('/api/gus/import', {
        method: 'POST',
        body: JSON.stringify({ name: gusSearchName })
      });
      assert.equal(importedGus.response.status, 200);
      assert.equal(importedGus.body.data.units, 1);
      assert.equal(importedGus.body.normalization.accepted, 1);
      assert.equal(importedGus.body.normalization.rejected, 1);
      assert.equal(
        db.prepare('SELECT name FROM gus_units WHERE id = ?').get(importedGusUnitId).name,
        'Jednostka testowa'
      );
    } finally {
      globalThis.fetch = originalFetch;
      db.prepare('DELETE FROM facilities WHERE source = ? AND external_id = ?')
        .run('nfz', importedExternalId);
      db.prepare('DELETE FROM api_cache WHERE cache_key LIKE ?')
        .run(`%integration-${externalId}%`);
      db.prepare('DELETE FROM gus_units WHERE id = ?').run(importedGusUnitId);
      db.prepare('DELETE FROM api_cache WHERE cache_key LIKE ?').run(`%${gusSearchName}%`);
    }

    const deleted = await request(`/api/facilities/${facilityId}`, { method: 'DELETE' });
    assert.equal(deleted.response.status, 200);
    assert.deepEqual(deleted.body.data, { id: facilityId, deleted: true });
  } finally {
    if (facilityId) db.prepare('DELETE FROM facilities WHERE id = ?').run(facilityId);
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
