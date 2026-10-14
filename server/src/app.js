import express from 'express';
import cors from 'cors';
import { db } from './db.js';
import { nfzQueues, gusUnits } from './external.js';
import {
  normalizeGusUnits,
  normalizeNfzQueues,
  saveGusUnits,
  saveNfzQueues
} from './data-processing.js';

export const app = express();

const facilityFields = [
  'source',
  'external_id',
  'name',
  'type',
  'city',
  'street',
  'postal_code',
  'phone',
  'latitude',
  'longitude'
];
const requiredFacilityFields = ['source', 'external_id', 'name', 'type'];

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function validateFacility(body, { partial = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'INVALID_BODY', 'Treść żądania musi być obiektem JSON');
  }

  const keys = Object.keys(body);
  const unknownField = keys.find(field => !facilityFields.includes(field));
  if (unknownField) {
    throw new HttpError(400, 'INVALID_FIELD', `Nieznane pole: ${unknownField}`);
  }

  if (!partial) {
    const missingField = requiredFacilityFields.find(
      field => typeof body[field] !== 'string' || !body[field].trim()
    );
    if (missingField) {
      throw new HttpError(400, 'REQUIRED_FIELD', `Pole ${missingField} jest wymagane`);
    }
  }

  const facility = {};
  for (const field of keys) {
    const value = body[field];
    if (field === 'latitude' || field === 'longitude') {
      const maximum = field === 'latitude' ? 90 : 180;
      if (value !== null && (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < -maximum ||
        value > maximum
      )) {
        throw new HttpError(400, 'INVALID_FIELD', `Pole ${field} musi być liczbą z zakresu ${-maximum}–${maximum} lub null`);
      }
      facility[field] = value;
      continue;
    }

    if (typeof value !== 'string' && value !== null) {
      throw new HttpError(400, 'INVALID_FIELD', `Pole ${field} musi być tekstem lub null`);
    }
    if (requiredFacilityFields.includes(field) && (value === null || !value.trim())) {
      throw new HttpError(400, 'INVALID_FIELD', `Pole ${field} nie może być puste`);
    }
    facility[field] = typeof value === 'string' ? value.trim() || null : value;
  }

  return facility;
}

function parseFacilityId(value) {
  const id = Number(value);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(id)) {
    throw new HttpError(400, 'INVALID_ID', 'Identyfikator placówki musi być dodatnią liczbą całkowitą');
  }
  return id;
}

function getFacility(id) {
  const facility = db.prepare('SELECT * FROM facilities WHERE id = ?').get(id);
  if (!facility) {
    throw new HttpError(404, 'FACILITY_NOT_FOUND', 'Nie znaleziono placówki');
  }
  return facility;
}

function facilityValues(facility) {
  return Object.fromEntries(facilityFields.map(field => [field, facility[field] ?? null]));
}

function nfzParameters(query) {
  if (!query || typeof query !== 'object' || Array.isArray(query)) {
    throw new HttpError(400, 'INVALID_BODY', 'Parametry NFZ muszą być obiektem JSON');
  }
  const allowed = ['province', 'benefit', 'case', 'limit', 'page'];
  if (Object.keys(query).some(key => !allowed.includes(key))) {
    throw new HttpError(400, 'INVALID_QUERY', 'Zapytanie zawiera nieznany parametr');
  }

  const provinceValue = String(query.province ?? '07').trim();
  const benefitValue = String(query.benefit ?? '').trim();
  const limitValue = String(query.limit ?? '50').trim();
  const pageValue = String(query.page ?? '1').trim();
  const caseValue = String(query.case ?? '1').trim();

  const valid =
    /^(0[1-9]|1[0-6])$/.test(provinceValue) &&
    /^\d+$/.test(limitValue) &&
    Number(limitValue) >= 1 &&
    Number(limitValue) <= 100 &&
    /^[1-9]\d*$/.test(pageValue) &&
    Number.isSafeInteger(Number(pageValue)) &&
    ['1', '2'].includes(caseValue) &&
    benefitValue.length <= 150;

  if (!valid) {
    throw new HttpError(400, 'INVALID_QUERY', 'Nieprawidłowe parametry zapytania');
  }

  return {
    province: provinceValue,
    case: caseValue,
    limit: limitValue,
    page: pageValue,
    ...(benefitValue ? { benefit: benefitValue } : {})
  };
}

async function getNormalizedNfz(params) {
  const payload = await nfzQueues(params);
  try {
    return normalizeNfzQueues(payload);
  } catch {
    throw new HttpError(502, 'UPSTREAM_INVALID_RESPONSE', 'API NFZ zwróciło nieprawidłową strukturę danych');
  }
}

async function getNormalizedGus(name) {
  const payload = await gusUnits({ name, 'page-size': 20, page: 0 });
  try {
    return normalizeGusUnits(payload);
  } catch {
    throw new HttpError(502, 'UPSTREAM_INVALID_RESPONSE', 'API GUS zwróciło nieprawidłową strukturę danych');
  }
}

function gusName(value) {
  if (value !== undefined && typeof value !== 'string') {
    throw new HttpError(400, 'INVALID_QUERY', 'Parametr name musi być pojedynczym tekstem');
  }
  const name = value?.trim() || 'Poznań';
  if (!name || name.length > 100) {
    throw new HttpError(400, 'INVALID_QUERY', 'Nieprawidłowa nazwa jednostki');
  }
  return name;
}

app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '100kb', strict: true }));

app.get('/api/health', (_req, res) => {
  res.json({ data: { ok: true, database: 'sqlite' } });
});

app.get('/api/facilities', (req, res) => {
  if (req.query.city !== undefined && typeof req.query.city !== 'string') {
    throw new HttpError(400, 'INVALID_QUERY', 'Parametr city musi być pojedynczym tekstem');
  }
  const city = req.query.city?.trim() || '';
  const facilities = city
    ? db.prepare('SELECT * FROM facilities WHERE city LIKE ? ORDER BY name LIMIT 100').all(`%${city}%`)
    : db.prepare('SELECT * FROM facilities ORDER BY name LIMIT 100').all();
  res.json({ data: facilities });
});

app.get('/api/facilities/:id', (req, res) => {
  res.json({ data: getFacility(parseFacilityId(req.params.id)) });
});

app.post('/api/facilities', (req, res) => {
  const facility = validateFacility(req.body);
  const values = facilityValues(facility);
  const result = db.prepare(`
    INSERT INTO facilities (
      source, external_id, name, type, city, street, postal_code, phone, latitude, longitude
    ) VALUES (
      @source, @external_id, @name, @type, @city, @street, @postal_code, @phone, @latitude, @longitude
    )
  `).run(values);
  res.status(201).json({ data: getFacility(result.lastInsertRowid) });
});

app.put('/api/facilities/:id', (req, res) => {
  const id = parseFacilityId(req.params.id);
  getFacility(id);
  const facility = facilityValues(validateFacility(req.body));
  db.prepare(`
    UPDATE facilities SET
      source = @source, external_id = @external_id, name = @name, type = @type,
      city = @city, street = @street, postal_code = @postal_code, phone = @phone,
      latitude = @latitude, longitude = @longitude
    WHERE id = @id
  `).run({ ...facility, id });
  res.json({ data: getFacility(id) });
});

app.patch('/api/facilities/:id', (req, res) => {
  const id = parseFacilityId(req.params.id);
  const existing = getFacility(id);
  const changes = validateFacility(req.body, { partial: true });
  if (Object.keys(changes).length === 0) {
    throw new HttpError(400, 'EMPTY_UPDATE', 'Podaj co najmniej jedno pole do zmiany');
  }

  const updated = facilityValues({ ...existing, ...changes });
  db.prepare(`
    UPDATE facilities SET
      source = @source, external_id = @external_id, name = @name, type = @type,
      city = @city, street = @street, postal_code = @postal_code, phone = @phone,
      latitude = @latitude, longitude = @longitude
    WHERE id = @id
  `).run({ ...updated, id });
  res.json({ data: getFacility(id) });
});

app.delete('/api/facilities/:id', (req, res) => {
  const id = parseFacilityId(req.params.id);
  getFacility(id);
  db.prepare('DELETE FROM facilities WHERE id = ?').run(id);
  res.json({ data: { id, deleted: true } });
});

app.get('/api/nfz/queues', async (req, res, next) => {
  try {
    const result = await getNormalizedNfz(nfzParameters(req.query));
    res.json({
      data: result.records.map(({ id, attributes }) => ({ id, attributes })),
      ...(result.meta === undefined ? {} : { meta: result.meta }),
      ...(result.links === undefined ? {} : { links: result.links }),
      normalization: {
        accepted: result.records.length,
        rejected: result.rejected
      }
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/nfz/import', async (req, res, next) => {
  try {
    const params = nfzParameters(req.body);
    const normalized = await getNormalizedNfz(params);
    const imported = saveNfzQueues(db, normalized.records);
    res.json({
      data: imported,
      normalization: {
        accepted: normalized.records.length,
        rejected: normalized.rejected
      }
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/gus/units', async (req, res, next) => {
  try {
    const normalized = await getNormalizedGus(gusName(req.query.name));
    res.json({
      data: normalized.data,
      normalization: {
        accepted: normalized.data.results.length,
        rejected: normalized.rejected
      }
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/gus/import', async (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      throw new HttpError(400, 'INVALID_BODY', 'Parametry importu GUS muszą być obiektem JSON');
    }
    const unknownField = Object.keys(req.body).find(field => field !== 'name');
    if (unknownField) {
      throw new HttpError(400, 'INVALID_FIELD', `Nieznane pole: ${unknownField}`);
    }
    const normalized = await getNormalizedGus(gusName(req.body.name));
    const imported = saveGusUnits(db, normalized.data.results);
    res.json({
      data: imported,
      normalization: {
        accepted: normalized.data.results.length,
        rejected: normalized.rejected
      }
    });
  } catch (error) {
    next(error);
  }
});

app.use((_req, res) => {
  res.status(404).json({
    error: { code: 'ROUTE_NOT_FOUND', message: 'Nie znaleziono endpointu' }
  });
});

app.use((error, _req, res, _next) => {
  let status = error.status || 500;
  let code = error.code || 'INTERNAL_ERROR';
  let message = error.message || 'Wystąpił błąd serwera';

  if (error.type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
    message = 'Treść żądania zawiera nieprawidłowy JSON';
  } else if (error.type === 'entity.too.large') {
    status = 413;
    code = 'REQUEST_TOO_LARGE';
    message = 'Treść żądania przekracza dozwolony rozmiar';
  } else if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
    status = 409;
    code = 'RESOURCE_CONFLICT';
    message = 'Placówka o podanym źródle i identyfikatorze już istnieje';
  } else if (status === 502 || status === 504) {
    if (code === 'INTERNAL_ERROR') code = 'UPSTREAM_ERROR';
  } else if (status >= 500) {
    console.error(error);
    status = 500;
    code = 'INTERNAL_ERROR';
    message = 'Wystąpił błąd serwera';
  } else if (!error.code) {
    code = 'REQUEST_ERROR';
  }

  res.status(status).json({ error: { code, message } });
});
