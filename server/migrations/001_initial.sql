CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS facilities (
 id INTEGER PRIMARY KEY, source TEXT NOT NULL, external_id TEXT NOT NULL,
 name TEXT NOT NULL, type TEXT NOT NULL, city TEXT, street TEXT,
 postal_code TEXT, phone TEXT, latitude REAL, longitude REAL,
 UNIQUE(source, external_id)
);
CREATE TABLE IF NOT EXISTS services (
 id INTEGER PRIMARY KEY, facility_id INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
 specialty TEXT NOT NULL, first_available_date TEXT, waiting_days INTEGER,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(facility_id, specialty)
);
CREATE TABLE IF NOT EXISTS favorites (
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 facility_id INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
 PRIMARY KEY(user_id, facility_id)
);
CREATE TABLE IF NOT EXISTS saved_searches (
 id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 city TEXT NOT NULL, specialty TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS alerts (
 id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 saved_search_id INTEGER NOT NULL REFERENCES saved_searches(id) ON DELETE CASCADE,
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
 last_notified_date TEXT
);
CREATE TABLE IF NOT EXISTS local_statistics (
 id INTEGER PRIMARY KEY, gus_unit_id TEXT NOT NULL, variable_id TEXT NOT NULL,
 year INTEGER NOT NULL, value REAL, UNIQUE(gus_unit_id, variable_id, year)
);
CREATE TABLE IF NOT EXISTS api_cache (
 cache_key TEXT PRIMARY KEY, payload TEXT NOT NULL,
 expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_facilities_city ON facilities(city);
CREATE INDEX IF NOT EXISTS idx_services_date ON services(first_available_date);
CREATE INDEX IF NOT EXISTS idx_search_user ON saved_searches(user_id);
