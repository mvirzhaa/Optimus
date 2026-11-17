'use strict';
const crypto = require('crypto');
const { query } = require('./db');

const SESSION_DAYS = Number(process.env.SESSION_DAYS || 30);
const N = 16384, R = 8, P = 1, KEYLEN = 64;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${h.toString('base64')}`;
}
function verifyPassword(pw, stored) {
  const [alg, n, r, p, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const got = crypto.scryptSync(pw, Buffer.from(salt, 'base64'), expected.length, { N: +n, r: +r, p: +p });
  return crypto.timingSafeEqual(expected, got);
}
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await query(`INSERT INTO sessions(token_hash, user_id, expires_at) VALUES ($1, $2, now() + ($3 || ' days')::interval)`, [sha256(token), userId, String(SESSION_DAYS)]);
  return token;
}
async function destroySession(token) { await query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]); }

function tokenFrom(req) {
  const h = req.get('authorization') || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  return null;
}
/* middleware: wajib login */
async function requireUser(req, res, next) {
  try {
    const token = tokenFrom(req);
    if (!token) return res.status(401).json({ error: 'Perlu login' });
    const r = await query(`SELECT u.id, u.username, u.display_name FROM sessions s JOIN users u ON u.id = s.user_id
                           WHERE s.token_hash = $1 AND s.expires_at > now()`, [sha256(token)]);
    if (!r.rows.length) return res.status(401).json({ error: 'Sesi tidak berlaku, silakan login lagi' });
    req.user = r.rows[0]; req.token = token;
    next();
  } catch (e) { next(e); }
}

/* pembatas percobaan login sederhana (per IP + username) */
const attempts = new Map();
function loginLimiter(req, res, next) {
  const key = (req.ip || '') + '|' + String((req.body && req.body.username) || '').toLowerCase();
  const now = Date.now(), a = attempts.get(key) || { n: 0, t: now };
  if (now - a.t > 15 * 60 * 1000) { a.n = 0; a.t = now; }
  if (a.n >= 10) return res.status(429).json({ error: 'Terlalu banyak percobaan. Coba lagi 15 menit lagi.' });
  req._loginKey = key; req._loginAttempt = a; attempts.set(key, a);
  next();
}

module.exports = { hashPassword, verifyPassword, createSession, destroySession, requireUser, loginLimiter, tokenFrom, sha256 };
