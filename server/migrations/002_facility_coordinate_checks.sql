CREATE TRIGGER IF NOT EXISTS facilities_validate_coordinates_insert
BEFORE INSERT ON facilities
WHEN
  (NEW.latitude IS NOT NULL AND (NEW.latitude < -90 OR NEW.latitude > 90)) OR
  (NEW.longitude IS NOT NULL AND (NEW.longitude < -180 OR NEW.longitude > 180))
BEGIN
  SELECT RAISE(ABORT, 'Facility coordinates are outside valid ranges');
END;

CREATE TRIGGER IF NOT EXISTS facilities_validate_coordinates_update
BEFORE UPDATE OF latitude, longitude ON facilities
WHEN
  (NEW.latitude IS NOT NULL AND (NEW.latitude < -90 OR NEW.latitude > 90)) OR
  (NEW.longitude IS NOT NULL AND (NEW.longitude < -180 OR NEW.longitude > 180))
BEGIN
  SELECT RAISE(ABORT, 'Facility coordinates are outside valid ranges');
END;
