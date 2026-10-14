const textFields = {
  provider: ['provider', 'provider-name', 'provider_name'],
  place: ['place', 'place-name', 'place_name'],
  benefit: ['benefit', 'benefit-name', 'benefit_name'],
  address: ['address', 'address-street', 'address_street'],
  locality: ['locality', 'city', 'town'],
  phone: ['phone', 'telephone'],
  providerId: [
    'provider-code',
    'provider-id',
    'provider_id',
    'regon-provider',
    'nip-provider',
    'rpw-dl',
    'rpw_dl',
    'regon',
    'nip'
  ]
};

function cleanText(value) {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned || null;
}

function readText(attributes, aliases) {
  for (const key of aliases) {
    const value = cleanText(attributes[key]);
    if (value) return value;
  }
  return null;
}

function readCoordinate(value, maximum) {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number >= -maximum && number <= maximum ? number : null;
}

function readDate(attributes) {
  const values = [
    attributes.dates?.date,
    attributes.dates?.['first-date'],
    attributes.dates?.firstDate,
    attributes.dates?.['first-available-date'],
    attributes.dates?.['date-of-first-availability'],
    ...(Array.isArray(attributes.dates) ? attributes.dates : [])
  ];

  for (const value of values) {
    if (typeof value !== 'string') continue;
    const date = value.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const parsed = new Date(`${date}T00:00:00.000Z`);
    if (!Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date) return date;
  }
  return null;
}

function stableFacilityId(attributes, name, locality, address) {
  const sourceId = readText(attributes, textFields.providerId) ||
    (typeof attributes['teryt-place'] === 'string' ? cleanText(attributes['teryt-place']) : null);
  if (sourceId) return sourceId;

  const fallback = [name, locality, address]
    .filter(Boolean)
    .join('|')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pl')
    .replace(/[^a-z0-9|]+/g, '-')
    .replace(/^-|-$/g, '');
  return `name-${fallback}`;
}

function normalizeQueueRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  if ((typeof record.id !== 'string' && typeof record.id !== 'number') || !record.attributes || typeof record.attributes !== 'object' || Array.isArray(record.attributes)) {
    return null;
  }

  const attributes = record.attributes;
  const provider = readText(attributes, textFields.provider);
  const place = readText(attributes, textFields.place);
  const name = provider || place;
  if (!name) return null;

  const benefit = readText(attributes, textFields.benefit);
  const address = readText(attributes, textFields.address);
  const locality = readText(attributes, textFields.locality);
  const date = readDate(attributes);
  const yesNo = key => ['Y', 'N'].includes(attributes[key]) ? attributes[key] : null;

  return {
    id: String(record.id),
    attributes: {
      provider,
      place,
      benefit,
      address,
      locality,
      phone: readText(attributes, textFields.phone),
      latitude: readCoordinate(attributes.latitude, 90),
      longitude: readCoordinate(attributes.longitude, 180),
      ramp: yesNo('ramp'),
      elevator: yesNo('elevator'),
      'car-park': yesNo('car-park'),
      toilet: yesNo('toilet'),
      dates: { date }
    },
    facility: {
      source: 'nfz',
      external_id: stableFacilityId(attributes, name, locality, address),
      name,
      type: 'placówka medyczna',
      city: locality,
      street: address,
      postal_code: null,
      phone: readText(attributes, textFields.phone),
      latitude: readCoordinate(attributes.latitude, 90),
      longitude: readCoordinate(attributes.longitude, 180)
    },
    service: benefit ? { specialty: benefit, first_available_date: date } : null
  };
}

export function normalizeNfzQueues(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.data)) {
    throw new TypeError('API NFZ zwróciło nieprawidłową strukturę danych');
  }

  const normalized = [];
  for (const record of payload.data) {
    const item = normalizeQueueRecord(record);
    if (item) normalized.push(item);
  }

  return {
    records: normalized,
    rejected: payload.data.length - normalized.length,
    meta: payload.meta,
    links: payload.links
  };
}

export function normalizeGusUnits(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.results)) {
    throw new TypeError('API GUS zwróciło nieprawidłową strukturę danych');
  }

  const results = [];
  for (const unit of payload.results) {
    if (!unit || typeof unit !== 'object' || Array.isArray(unit)) continue;
    const id = typeof unit.id === 'string' || typeof unit.id === 'number' ? String(unit.id) : null;
    const name = cleanText(unit.name);
    if (!id || !name) continue;
    results.push({ ...unit, id, name });
  }

  return {
    data: { ...payload, results },
    rejected: payload.results.length - results.length
  };
}

export function saveGusUnits(database, units) {
  const save = database.transaction(items => {
    const upsert = database.prepare(`
      INSERT INTO gus_units (id, name, level)
      VALUES (@id, @name, @level)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        level = COALESCE(excluded.level, gus_units.level),
        updated_at = CURRENT_TIMESTAMP
    `);
    for (const unit of items) {
      upsert.run({
        id: unit.id,
        name: unit.name,
        level: Number.isInteger(unit.level) && unit.level >= 0 ? unit.level : null
      });
    }
    return { units: items.length };
  });
  return save(units);
}

export function saveNfzQueues(database, records) {
  const save = database.transaction(items => {
    const facilityIds = new Set();
    const serviceKeys = new Set();

    for (const item of items) {
      const facility = item.facility;
      database.prepare(`
        INSERT INTO facilities (
          source, external_id, name, type, city, street, postal_code, phone, latitude, longitude
        ) VALUES (
          @source, @external_id, @name, @type, @city, @street, @postal_code, @phone, @latitude, @longitude
        )
        ON CONFLICT(source, external_id) DO UPDATE SET
          name = excluded.name,
          type = excluded.type,
          city = COALESCE(excluded.city, facilities.city),
          street = COALESCE(excluded.street, facilities.street),
          postal_code = COALESCE(excluded.postal_code, facilities.postal_code),
          phone = COALESCE(excluded.phone, facilities.phone),
          latitude = COALESCE(excluded.latitude, facilities.latitude),
          longitude = COALESCE(excluded.longitude, facilities.longitude)
      `).run(facility);

      const facilityId = database.prepare(
        'SELECT id FROM facilities WHERE source = ? AND external_id = ?'
      ).get(facility.source, facility.external_id).id;
      facilityIds.add(facility.external_id);

      if (item.service) {
        database.prepare(`
          INSERT INTO services (facility_id, specialty, first_available_date, waiting_days)
          VALUES (?, ?, ?, NULL)
          ON CONFLICT(facility_id, specialty) DO UPDATE SET
            first_available_date = excluded.first_available_date,
            waiting_days = NULL,
            updated_at = CURRENT_TIMESTAMP
        `).run(facilityId, item.service.specialty, item.service.first_available_date);
        serviceKeys.add(`${facility.external_id}\u0000${item.service.specialty}`);
      }
    }

    return {
      records: items.length,
      facilities: facilityIds.size,
      services: serviceKeys.size
    };
  });

  return save(records);
}
