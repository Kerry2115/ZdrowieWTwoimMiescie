import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { ApiError, cachedJson } from '../src/external.js';
import { runMigrations } from '../src/migrations.js';

test('cache współdzieli równoległe żądanie i ogranicza ponowne pobrania', async () => {
  runMigrations(db);
  const url = 'https://api.example.test/cache-single-flight';
  const key = new URL(url).toString();
  db.prepare('DELETE FROM api_cache WHERE cache_key = ?').run(key);
  const originalFetch = globalThis.fetch;
  let requests = 0;

  globalThis.fetch = async () => {
    requests += 1;
    await new Promise(resolve => setTimeout(resolve, 15));
    return {
      ok: true,
      status: 200,
      json: async () => ({ results: [{ id: 'one' }] })
    };
  };

  try {
    const [first, second] = await Promise.all([
      cachedJson(url, {}),
      cachedJson(url, {})
    ]);
    const third = await cachedJson(url, {});
    assert.deepEqual(first, { results: [{ id: 'one' }] });
    assert.deepEqual(second, first);
    assert.deepEqual(third, first);
    assert.equal(requests, 1);
  } finally {
    globalThis.fetch = originalFetch;
    db.prepare('DELETE FROM api_cache WHERE cache_key = ?').run(key);
  }
});

test('zewnętrzne błędy HTTP i nieprawidłowy JSON nie są zapisywane w cache', async () => {
  runMigrations(db);
  const originalFetch = globalThis.fetch;
  const httpUrl = 'https://api.example.test/http-error';
  const jsonUrl = 'https://api.example.test/invalid-json';
  const keys = [httpUrl, jsonUrl].map(url => new URL(url).toString());
  let mode = 'http';

  globalThis.fetch = async () => {
    if (mode === 'http') return { ok: false, status: 503 };
    return {
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError('invalid json'); }
    };
  };

  try {
    await assert.rejects(cachedJson(httpUrl, {}), error =>
      error instanceof ApiError && error.status === 502
    );
    mode = 'json';
    await assert.rejects(cachedJson(jsonUrl, {}), error =>
      error instanceof ApiError && error.status === 502
    );
    assert.equal(
      db.prepare('SELECT COUNT(*) AS count FROM api_cache WHERE cache_key IN (?, ?)').get(...keys).count,
      0
    );
  } finally {
    globalThis.fetch = originalFetch;
    db.prepare('DELETE FROM api_cache WHERE cache_key IN (?, ?)').run(...keys);
  }
});

test('błąd połączenia i timeout zewnętrznego API są zgłaszane bez zapisu do cache', async () => {
  runMigrations(db);
  const originalFetch = globalThis.fetch;
  const connectionUrl = 'https://api.example.test/connection-error';
  const timeoutUrl = 'https://api.example.test/timeout';
  const keys = [connectionUrl, timeoutUrl].map(url => new URL(url).toString());

  globalThis.fetch = async (_url, {signal}) => {
    if (String(_url).includes('connection-error')) throw new TypeError('fetch failed');
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, {once: true});
    });
  };

  try {
    await assert.rejects(cachedJson(connectionUrl, {}), error =>
      error instanceof ApiError && error.status === 502 &&
      error.message === 'Nie udało się połączyć z zewnętrznym API'
    );
    await assert.rejects(cachedJson(timeoutUrl, {}), error =>
      error instanceof ApiError && error.status === 504 &&
      error.message === 'Przekroczono czas odpowiedzi API'
    );
    assert.equal(
      db.prepare('SELECT COUNT(*) AS count FROM api_cache WHERE cache_key IN (?, ?)').get(...keys).count,
      0
    );
  } finally {
    globalThis.fetch = originalFetch;
    db.prepare('DELETE FROM api_cache WHERE cache_key IN (?, ?)').run(...keys);
  }
});
