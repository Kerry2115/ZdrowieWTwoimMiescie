import { db } from '../src/db.js';
import { readFileSync } from 'node:fs';
db.exec(readFileSync('migrations/001_initial.sql','utf8'));
db.prepare(`INSERT OR IGNORE INTO facilities(source,external_id,name,type,city,street) VALUES (?,?,?,?,?,?)`).run('demo','demo-1','Przykładowa poradnia (fikcyjne dane)','przychodnia','Poznań','ul. Testowa 1');
const id=db.prepare('SELECT id FROM facilities WHERE source=? AND external_id=?').get('demo','demo-1').id;
db.prepare(`INSERT OR IGNORE INTO services(facility_id,specialty,first_available_date,waiting_days) VALUES (?,?,?,?)`).run(id,'Kardiologia','2027-01-15',30);
console.log('Dodano fikcyjne dane demonstracyjne');
