import { Router } from 'express';
import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { db } from './db.js';
import { nfzQueue } from './external.js';
const scrypt = promisify(scryptCallback);
export const accounts = Router();
const lifetime = 7 * 24 * 60 * 60 * 1000;
const digest = value => createHash('sha256').update(value).digest('hex');
const publicUser = u => ({ id: u.id, email: u.email, firstName: u.first_name, lastName: u.last_name, city: u.city, phone: u.phone });
const cookieOptions = `Path=/; HttpOnly; SameSite=Strict${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
const attempts = new Map();
const tokenFrom = req => /(?:^|;\s*)zwtm_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
accounts.use((req, res, next) => {
 res.setHeader('Cache-Control', 'no-store');
 if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
  const origin = req.get('origin');
  if (origin && origin !== (process.env.CLIENT_ORIGIN || 'http://localhost:5173') && origin !== `${req.protocol}://${req.get('host')}`) return res.status(403).json({ error: 'Niedozwolone źródło żądania' });
 }
 const token = tokenFrom(req);
 if (token) req.user = db.prepare('SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>?').get(digest(token), Date.now());
 next();
});
function requireUser(req, res, next) {
 if (!req.user) return res.status(401).json({ error: 'Zaloguj się, aby skorzystać z tej funkcji' });
 next();
}
function session(req, res, user) {
 const token = randomBytes(32).toString('hex');
 const old = tokenFrom(req);
 if (old) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(old));
 db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
 db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token), user.id, Date.now() + lifetime);
 res.setHeader('Set-Cookie', `zwtm_session=${token}; Max-Age=${lifetime / 1000}; ${cookieOptions}`);
 res.json({ data: publicUser(user) });
}
function authLimit(req, res, next) {
 const now = Date.now();
 for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
 const entry = attempts.get(req.ip) || { count: 0, until: now + 15 * 60 * 1000 };
 attempts.set(req.ip, entry);
 if (++entry.count > 30) return res.status(429).json({ error: 'Zbyt wiele prób. Spróbuj ponownie za 15 minut.' });
 next();
}
accounts.post('/auth/:action', authLimit, async (req, res, next) => {
 try {
  if (!['login', 'register'].includes(req.params.action)) return res.status(404).json({ error: 'Nie znaleziono endpointu' });
  const { password } = req.body;
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || typeof password !== 'string' || password.length < 8 || password.length > 128) return res.status(400).json({ error: 'Podaj poprawny e-mail i hasło od 8 do 128 znaków.' });
  let user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (req.params.action === 'register') {
   if (user) return res.status(409).json({ error: 'Konto z tym adresem już istnieje. Spróbuj się zalogować.' });
   const salt = randomBytes(16).toString('hex');
   const hash = (await scrypt(password, salt, 64)).toString('hex');
   try { db.prepare('INSERT INTO users(email,password_hash) VALUES(?,?)').run(email, `${salt}:${hash}`); }
   catch (error) { if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'Konto z tym adresem już istnieje.' }); throw error; }
   user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  } else {
   const [salt, expected] = (user?.password_hash || `${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
   const actual = await scrypt(password, salt, 64);
   const stored = Buffer.from(expected || '', 'hex');
   if (!user || stored.length !== actual.length || !timingSafeEqual(stored, actual)) return res.status(401).json({ error: 'Nieprawidłowy e-mail lub hasło.' });
  }
  session(req, res, user);
 } catch (error) { next(error); }
});
accounts.get('/auth/me', (req, res) => res.json({ data: req.user ? publicUser(req.user) : null }));
accounts.post('/logout', (req, res) => {
 const token = tokenFrom(req);
 if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token));
 res.setHeader('Set-Cookie', `zwtm_session=; Max-Age=0; ${cookieOptions}`);
 res.json({ ok: true });
});
accounts.put('/profile', requireUser, (req, res) => {
 const fields = ['firstName', 'lastName', 'city', 'phone'];
 if (fields.some(key => typeof req.body[key] !== 'string' || req.body[key].trim().length > (key === 'phone' ? 30 : 100))) return res.status(400).json({ error: 'Sprawdź długość i poprawność danych profilu.' });
 db.prepare('UPDATE users SET first_name=?,last_name=?,city=?,phone=? WHERE id=?').run(...fields.map(key => req.body[key].trim()), req.user.id);
 res.json({ data: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)) });
});
accounts.get('/favorites', requireUser, (req, res) => res.json({ data: db.prepare('SELECT snapshot,created_at FROM favorite_queues WHERE user_id=? ORDER BY created_at DESC,queue_id').all(req.user.id).map(row => ({ ...JSON.parse(row.snapshot), savedAt: row.created_at })) }));
accounts.put('/favorites/:id', requireUser, async (req, res, next) => {
 try {
  if (!/^[a-f0-9-]{36}$/i.test(req.params.id)) return res.status(400).json({ error: 'Nieprawidłowy identyfikator placówki' });
  const result = await nfzQueue(req.params.id);
  const item = Array.isArray(result.data) ? result.data[0] : result.data;
  if (!item?.attributes || String(item.id) !== req.params.id) return res.status(502).json({ error: 'Nie udało się potwierdzić danych placówki w NFZ.' });
  db.prepare('INSERT INTO favorite_queues(user_id,queue_id,snapshot) VALUES(?,?,?) ON CONFLICT(user_id,queue_id) DO UPDATE SET snapshot=excluded.snapshot').run(req.user.id, item.id, JSON.stringify(item));
  res.json({ data: item });
 } catch (error) { next(error); }
});
accounts.delete('/favorites/:id', requireUser, (req, res) => {
 db.prepare('DELETE FROM favorite_queues WHERE user_id=? AND queue_id=?').run(req.user.id, req.params.id);
 res.json({ ok: true });
});
