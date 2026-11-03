import { db } from './db.js';

const TTL = 15 * 60 * 1000;
const TIMEOUT = 8000;
const inFlightRequests = new Map();

export class ApiError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' }
    });
    if (!response.ok) {
      throw new ApiError(`Zewnętrzne API zwróciło HTTP ${response.status}`, 502);
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new ApiError('Zewnętrzne API zwróciło nieprawidłowy JSON', 502);
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new ApiError('Zewnętrzne API zwróciło nieprawidłowy format danych', 502);
    }
    return payload;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error.name === 'AbortError') {
      throw new ApiError('Przekroczono czas odpowiedzi API', 504);
    }
    throw new ApiError('Nie udało się połączyć z zewnętrznym API', 502);
  } finally {
    clearTimeout(timer);
  }
}

export async function cachedJson(base, params) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  url.searchParams.sort();

  const key = url.toString();
  const now = new Date().toISOString();
  const cached = db.prepare(
    'SELECT payload FROM api_cache WHERE cache_key = ? AND expires_at > ?'
  ).get(key, now);

  if (cached) {
    try {
      const payload = JSON.parse(cached.payload);
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) return payload;
    } catch {
      // Discard invalid cache content and refresh it from the upstream API.
    }
    db.prepare('DELETE FROM api_cache WHERE cache_key = ?').run(key);
  }

  const pending = inFlightRequests.get(key);
  if (pending) return pending;

  const request = (async () => {
    const payload = await fetchJson(url);
    db.prepare(`
      INSERT INTO api_cache (cache_key, payload, expires_at)
      VALUES (?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        payload = excluded.payload,
        expires_at = excluded.expires_at
    `).run(key, JSON.stringify(payload), new Date(Date.now() + TTL).toISOString());
    return payload;
  })();
  inFlightRequests.set(key, request);

  try {
    return await request;
  } finally {
    if (inFlightRequests.get(key) === request) inFlightRequests.delete(key);
  }
}

export const nfzQueues = params => cachedJson(
  'https://api.nfz.gov.pl/app-itl-api/queues',
  {
    format: 'json',
    case: '1',
    ...params,
    province: String(params.province ?? '07').padStart(2, '0')
  }
);

export const nfzQueue = id => cachedJson(
  `https://api.nfz.gov.pl/app-itl-api/queues/${encodeURIComponent(id)}`,
  { format: 'json' }
);

export const nfzBenefits = params => cachedJson(
  'https://api.nfz.gov.pl/app-itl-api/benefits',
  { format: 'json', limit: 25, ...params }
);

export const gusUnits = params => cachedJson(
  'https://bdl.stat.gov.pl/api/v1/units',
  params
);
