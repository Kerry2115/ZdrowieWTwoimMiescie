CREATE TABLE IF NOT EXISTS gus_units (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  level INTEGER,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO gus_units (id, name)
SELECT DISTINCT TRIM(gus_unit_id), TRIM(gus_unit_id)
FROM local_statistics
WHERE TRIM(gus_unit_id) <> '';

ALTER TABLE local_statistics RENAME TO local_statistics_legacy;

CREATE TABLE local_statistics (
  id INTEGER PRIMARY KEY,
  gus_unit_id TEXT NOT NULL REFERENCES gus_units(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  variable_id TEXT NOT NULL,
  year INTEGER NOT NULL,
  value REAL,
  UNIQUE(gus_unit_id, variable_id, year)
);

INSERT INTO local_statistics (id, gus_unit_id, variable_id, year, value)
SELECT id, gus_unit_id, variable_id, year, value
FROM local_statistics_legacy;

DROP TABLE local_statistics_legacy;

CREATE INDEX IF NOT EXISTS idx_gus_units_name ON gus_units(name);
