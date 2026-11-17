'use strict';
/* Optimus server: aplikasi web + REST API proyek/versi/hasil simulasi (PostgreSQL)
   + jembatan ke layanan Python (analisis & verifikasi dengan SUMO asli) */
const path = require('path');
const express = require('express');
const { query, tx, migrate, pool } = require('./db');
const auth = require('./auth');
const SW = require('./optimus-core');

const PORT = Number(process.env.PORT || 3000);
const PY_URL = (process.env.PY_URL || 'http://127.0.0.1:8001').replace(/\/$/, '');
const MAX_BODY = process.env.MAX_BODY || '60mb';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === '1');
app.use(express.json({ limit: MAX_BODY }));
app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const isUuid = s => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s));

/* ---------- validasi data proyek ---------- */
function checkProjectData(d) {
  if (!d || typeof d !== 'object') return 'Data proyek kosong';
  if (!d.net || typeof d.net.nodes !== 'object' || typeof d.net.edges !== 'object') return 'Data jaringan (net) tidak valid';
  if (!d.demand || typeof d.demand.vTypes !== 'object') return 'Data demand tidak valid';
  if (!d.add) d.add = { e1: [], e2: [] };
  if (!d.cfg) d.cfg = SW.defaultConfig();
  return null;
}
function statsOf(d) {
  const n = d.net, dm = d.demand;
  const edges = Object.values(n.edges || {});
  return {
    nodes: Object.keys(n.nodes || {}).length, edges: edges.length,
    tls: Object.values(n.nodes || {}).filter(x => x.type === 'traffic_light').length,
    elevated: edges.filter(e => e.layer > 0).length, underground: edges.filter(e => e.layer < 0).length,
    flows: (dm.flows || []).length, vehicles: (dm.vehicles || []).length,
    detectors: ((d.add && d.add.e1) || []).length + ((d.add && d.add.e2) || []).length,
    osm: !!(n.location && n.location.lat0)
  };
}
/* akses proyek: owner > edit > view. need = 'view' | 'edit' | 'owner' */
const RANK = { view: 1, edit: 2, owner: 3 };
async function accessProject(req, id, need = 'view') {
  if (!isUuid(id)) return null;
  const r = await query(`SELECT p.*, CASE WHEN p.owner_id = $2 THEN 'owner' ELSE s.role END AS my_role
                         FROM projects p LEFT JOIN project_shares s ON s.project_id = p.id AND s.user_id = $2
                         WHERE p.id = $1 AND p.deleted_at IS NULL AND (p.owner_id = $2 OR s.user_id IS NOT NULL)`, [id, req.user.id]);
  const p = r.rows[0];
  if (!p) return null;
  if (RANK[p.my_role] < RANK[need]) { const e = new Error(need === 'owner' ? 'Hanya pemilik proyek yang boleh melakukan ini' : 'Anda hanya punya akses lihat untuk proyek ini'); e.status = 403; throw e; }
  return p;
}
const ownProject = (req, id) => accessProject(req, id, 'owner');
async function versionData(projectId, v) {
  const r = await query('SELECT version, data, note, created_at FROM project_versions WHERE project_id = $1 AND version = $2', [projectId, v]);
  return r.rows[0] || null;
}

/* ---------- kesehatan ---------- */
app.get('/api/health', wrap(async (req, res) => {
  let db = false, py = null;
  try { await query('SELECT 1'); db = true; } catch (e) { /* db mati */ }
  try { const r = await fetch(PY_URL + '/health', { signal: AbortSignal.timeout(2000) }); py = r.ok ? await r.json() : null; } catch (e) { py = null; }
  res.json({ ok: db, app: 'optimus', version: SW.VERSION, db, python: !!py, sumo: py ? py.sumo : null });
}));

/* ---------- akun ---------- */
app.post('/api/auth/register', wrap(async (req, res) => {
  if (process.env.ALLOW_REGISTER === '0') return bad(res, 'Pendaftaran ditutup oleh admin', 403);
  const { username, password, name } = req.body || {};
  if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(username || '')) return bad(res, 'Username 3–40 karakter: huruf, angka, _ . -');
  if (!password || String(password).length < 8) return bad(res, 'Kata sandi minimal 8 karakter');
  const exists = await query('SELECT 1 FROM users WHERE lower(username) = lower($1)', [username]);
  if (exists.rows.length) return bad(res, 'Username sudah dipakai', 409);
  const r = await query('INSERT INTO users(username, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id, username, display_name',
    [username, String(name || username).slice(0, 100), auth.hashPassword(String(password))]);
  const token = await auth.createSession(r.rows[0].id);
  res.status(201).json({ token, user: r.rows[0] });
}));
app.post('/api/auth/login', auth.loginLimiter, wrap(async (req, res) => {
  const { username, password } = req.body || {};
  const r = await query('SELECT id, username, display_name, password_hash FROM users WHERE lower(username) = lower($1)', [username || '']);
  const u = r.rows[0];
  if (!u || !auth.verifyPassword(String(password || ''), u.password_hash)) { req._loginAttempt.n++; return bad(res, 'Username atau kata sandi salah', 401); }
  req._loginAttempt.n = 0;
  await query('DELETE FROM sessions WHERE expires_at < now()');
  const token = await auth.createSession(u.id);
  res.json({ token, user: { id: u.id, username: u.username, display_name: u.display_name } });
}));
app.post('/api/auth/logout', auth.requireUser, wrap(async (req, res) => { await auth.destroySession(req.token); res.json({ ok: true }); }));
app.get('/api/auth/me', auth.requireUser, (req, res) => res.json({ user: req.user }));
app.post('/api/auth/password', auth.requireUser, wrap(async (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  const r = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!auth.verifyPassword(String(oldPassword || ''), r.rows[0].password_hash)) return bad(res, 'Kata sandi lama salah', 401);
  if (!newPassword || String(newPassword).length < 8) return bad(res, 'Kata sandi baru minimal 8 karakter');
  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [auth.hashPassword(String(newPassword)), req.user.id]);
  await query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [req.user.id, auth.sha256(req.token)]);
  res.json({ ok: true });
}));

/* ---------- proyek ---------- */
const api = express.Router();
api.use(auth.requireUser);

api.get('/projects', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const r = await query(`SELECT p.id, p.name, p.description, p.current_version, p.stats, p.created_at, p.updated_at, p.public_token IS NOT NULL AS is_public,
      CASE WHEN p.owner_id = $1 THEN 'owner' ELSE s.role END AS my_role, u.username AS owner,
      (SELECT count(*)::int FROM runs WHERE project_id = p.id) AS runs,
      (SELECT count(*)::int FROM project_shares WHERE project_id = p.id) AS shares
    FROM projects p JOIN users u ON u.id = p.owner_id LEFT JOIN project_shares s ON s.project_id = p.id AND s.user_id = $1
    WHERE p.deleted_at IS NULL AND (p.owner_id = $1 OR s.user_id IS NOT NULL)
      AND ($2 = '' OR p.name ILIKE '%' || $2 || '%' OR p.description ILIKE '%' || $2 || '%')
    ORDER BY p.updated_at DESC LIMIT 500`, [req.user.id, q]);
  res.json({ projects: r.rows });
}));
api.post('/projects', wrap(async (req, res) => {
  const { name, description, data, note } = req.body || {};
  if (!name || !String(name).trim()) return bad(res, 'Nama proyek wajib diisi');
  const err = checkProjectData(data); if (err) return bad(res, err);
  const body = JSON.stringify(data);
  const out = await tx(async c => {
    const p = (await c.query('INSERT INTO projects(owner_id, name, description, stats) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.user.id, String(name).trim().slice(0, 200), String(description || ''), statsOf(data)])).rows[0];
    await c.query('INSERT INTO project_versions(project_id, version, data, note, size_bytes, created_by) VALUES ($1, 1, $2, $3, $4, $5)',
      [p.id, body, String(note || 'Versi awal'), Buffer.byteLength(body), req.user.id]);
    return p;
  });
  res.status(201).json({ project: out });
}));
api.get('/projects/:id', wrap(async (req, res) => {
  const p = await accessProject(req, req.params.id, 'view'); if (!p) return bad(res, 'Proyek tidak ditemukan', 404);
  const v = req.query.version ? parseInt(req.query.version, 10) : p.current_version;
  const ver = await versionData(p.id, v); if (!ver) return bad(res, 'Versi tidak ditemukan', 404);
  res.json({ project: p, version: ver.version, note: ver.note, saved_at: ver.created_at, data: ver.data });
}));
api.put('/projects/:id', wrap(async (req, res) => {
  const { data, note, baseVersion } = req.body || {};
  let { name, description } = req.body || {};
  const err = checkProjectData(data); if (err) return bad(res, err);
  if (isUuid(req.params.id)) { const acc = await accessProject(req, req.params.id, 'view'); if (acc && acc.my_role === 'view') return bad(res, 'Anda hanya punya akses lihat. Gunakan "Simpan sebagai baru" untuk membuat salinan sendiri.', 403); }
  const body = JSON.stringify(data);
  const out = await tx(async c => {
    const p = (await c.query(`SELECT p.* FROM projects p LEFT JOIN project_shares s ON s.project_id = p.id AND s.user_id = $2
        WHERE p.id = $1 AND p.deleted_at IS NULL AND (p.owner_id = $2 OR s.role = 'edit') FOR UPDATE OF p`, [req.params.id, req.user.id])).rows[0];
    if (!p) return { code: 404 };
    if (p.owner_id !== req.user.id && (name || description !== undefined)) { name = undefined; description = undefined; }
    if (baseVersion !== undefined && baseVersion !== null && +baseVersion !== p.current_version) return { code: 409, current: p.current_version };
    const v = p.current_version + 1;
    await c.query('INSERT INTO project_versions(project_id, version, data, note, size_bytes, created_by) VALUES ($1, $2, $3, $4, $5, $6)',
      [p.id, v, body, String(note || ''), Buffer.byteLength(body), req.user.id]);
    const up = await c.query(`UPDATE projects SET current_version = $2, stats = $3, updated_at = now(),
        name = COALESCE($4, name), description = COALESCE($5, description) WHERE id = $1 RETURNING *`,
      [p.id, v, statsOf(data), name ? String(name).slice(0, 200) : null, description !== undefined ? String(description) : null]);
    return { project: up.rows[0] };
  });
  if (out.code === 404) return bad(res, 'Proyek tidak ditemukan', 404);
  if (out.code === 409) return res.status(409).json({ error: `Proyek sudah disimpan dari tempat lain (versi server ${out.current}). Muat ulang atau simpan sebagai proyek baru.`, current: out.current });
  res.json(out);
}));
api.patch('/projects/:id', wrap(async (req, res) => {
  const p = await ownProject(req, req.params.id); if (!p) return bad(res, 'Proyek tidak ditemukan', 404);
  const { name, description } = req.body || {};
  const r = await query('UPDATE projects SET name = COALESCE($2, name), description = COALESCE($3, description), updated_at = now() WHERE id = $1 RETURNING *',
    [p.id, name ? String(name).slice(0, 200) : null, description !== undefined ? String(description) : null]);
  res.json({ project: r.rows[0] });
}));
api.delete('/projects/:id', wrap(async (req, res) => {
  const p = await ownProject(req, req.params.id); if (!p) return bad(res, 'Proyek tidak ditemukan', 404);
  await query('UPDATE projects SET deleted_at = now() WHERE id = $1', [p.id]);
  res.json({ ok: true });
}));
api.post('/projects/:id/duplicate', wrap(async (req, res) => {
  const p = await accessProject(req, req.params.id, 'view'); if (!p) return bad(res, 'Proyek tidak ditemukan', 404);
  const ver = await versionData(p.id, req.body && req.body.version ? +req.body.version : p.current_version);
  const name = (req.body && req.body.name) || p.name + ' (salinan)';
  const out = await tx(async c => {
    const np = (await c.query('INSERT INTO projects(owner_id, name, description, stats) VALUES ($1, $2, $3, $4) RETURNING *', [req.user.id, name, p.description, p.stats])).rows[0];
    await c.query('INSERT INTO project_versions(project_id, version, data, note, size_bytes, created_by) VALUES ($1, 1, $2, $3, $4, $5)',
      [np.id, JSON.stringify(ver.data), `Disalin dari "${p.name}" v${ver.version}`, Buffer.byteLength(JSON.stringify(ver.data)), req.user.id]);
    return np;
  });
  res.status(201).json({ project: out });
}));
api.get('/projects/:id/versions', wrap(async (req, res) => {
  const p = await accessProject(req, req.params.id, 'view'); if (!p) return bad(res, 'Proyek tidak ditemukan', 404);
  const r = await query('SELECT version, note, size_bytes, created_at FROM project_versions WHERE project_id = $1 ORDER BY version DESC', [p.id]);
  res.json({ versions: r.rows });
}));
/* kembalikan versi lama sebagai versi terbaru */
api.post('/projects/:id/versions/:v/restore', wrap(async (req, res) => {
  const p = await accessProject(req, req.params.id, 'edit'); if (!p) return bad(res, 'Proyek tidak ditemukan', 404);
  const ver = await versionData(p.id, +req.params.v); if (!ver) return bad(res, 'Versi tidak ditemukan', 404);
  const out = await tx(async c => {
    const cur = (await c.query('SELECT current_version FROM projects WHERE id = $1 FOR UPDATE', [p.id])).rows[0].current_version;
    const body = JSON.stringify(ver.data);
    await c.query('INSERT INTO project_versions(project_id, version, data, note, size_bytes, created_by) VALUES ($1, $2, $3, $4, $5, $6)',
      [p.id, cur + 1, body, `Dipulihkan dari v${ver.version}`, Buffer.byteLength(body), req.user.id]);
    return (await c.query('UPDATE projects SET current_version = $2, stats = $3, updated_at = now() WHERE id = $1 RETURNING *', [p.id, cur + 1, statsOf(ver.data)])).rows[0];
  });
  res.json({ project: out });
}));

/* ---------- ekspor ke format SUMO (memakai inti yang sama dengan peramban) ---------- */
function sumoFiles(data, name) {
  const T = SW.buildTopo(data.net);
  const cfg = Object.assign(SW.defaultConfig(), data.cfg || {});
  return {
    [`${name}.net.xml`]: SW.toNetXML(data.net, T),
    [`${name}.nod.xml`]: SW.toNodXML(data.net),
    [`${name}.edg.xml`]: SW.toEdgXML(data.net),
    [`${name}.con.xml`]: SW.toConXML(data.net, T),
    [`${name}.tll.xml`]: SW.toTllXML(data.net, T),
    [`${name}.rou.xml`]: SW.toRouXML(data.demand),
    [`${name}.add.xml`]: SW.toAddXML(data.add || { e1: [], e2: [] }),
    [`${name}.sumocfg`]: SW.toSumocfg(cfg, name),
    'build.sh': SW.toBuildScript(data.net, name),
    'build.bat': SW.toBuildScript(data.net, name, true)
  };
}
const safeName = s => String(s || 'scenario').normalize('NFKD').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'scenario';
api.get('/projects/:id/export', wrap(async (req, res) => {
  const p = await accessProject(req, req.params.id, 'view'); if (!p) return bad(res, 'Proyek tidak ditemukan', 404);
  const ver = await versionData(p.id, req.query.version ? +req.query.version : p.current_version);
  if (!ver) return bad(res, 'Versi tidak ditemukan', 404);
  const files = sumoFiles(ver.data, safeName(p.name));
  if (req.query.file) {
    const f = files[req.query.file]; if (!f) return bad(res, 'Berkas tidak dikenal', 404);
    res.set('Content-Type', /\.(sh|bat)$/.test(req.query.file) ? 'text/plain; charset=utf-8' : 'application/xml; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${req.query.file}"`);
    return res.send(f);
  }
  res.json({ version: ver.version, files });
}));

/* ---------- hasil simulasi ---------- */
const MAX_TRIPS = 100000, MAX_SUMMARY = 5000;
function downsample(arr, n) { if (arr.length <= n) return arr; const k = arr.length / n, out = []; for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * k)]); out.push(arr[arr.length - 1]); return out; }
async function insertRun(c, p, b, userId) {
  const r = await c.query(`INSERT INTO runs(project_id, version, engine, note, config, totals, summary, tripinfo, detectors, sim_time, created_by, extra)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id, project_id, version, engine, note, totals, sim_time, created_at`,
  [p.id, b.version || p.current_version, b.engine, String(b.note || ''), JSON.stringify(b.config || {}), JSON.stringify(b.totals || {}),
    JSON.stringify(downsample(b.summary || [], MAX_SUMMARY)), JSON.stringify((b.tripinfo || []).slice(0, MAX_TRIPS)), JSON.stringify(b.detectors || []), +b.sim_time || 0, userId, JSON.stringify(b.extra || {})]);
  return r.rows[0];
}
api.get('/projects/:id/runs', wrap(async (req, res) => {
  const p = await accessProject(req, req.params.id, 'view'); if (!p) return bad(res, 'Proyek tidak ditemukan', 404);
  const r = await query(`SELECT id, version, engine, note, totals, sim_time, created_at, jsonb_array_length(tripinfo) AS trips
                         FROM runs WHERE project_id = $1 ORDER BY created_at DESC LIMIT 200`, [p.id]);
  res.json({ runs: r.rows });
}));
api.post('/projects/:id/runs', wrap(async (req, res) => {
  const p = await accessProject(req, req.params.id, 'edit'); if (!p) return bad(res, 'Proyek tidak ditemukan', 404);
  const b = req.body || {};
  if (!Array.isArray(b.summary) || !Array.isArray(b.tripinfo)) return bad(res, 'Format hasil simulasi tidak valid');
  const run = await insertRun(pool, p, { ...b, engine: 'sumoweb' }, req.user.id);
  res.status(201).json({ run });
}));
async function ownRun(req, id, need = 'view') {
  if (!isUuid(id)) return null;
  const r = await query(`SELECT r.* FROM runs r WHERE r.id = $1`, [id]);
  if (!r.rows[0]) return null;
  const p = await accessProject(req, r.rows[0].project_id, need);
  return p ? r.rows[0] : null;
}
api.get('/runs/:id', wrap(async (req, res) => { const r = await ownRun(req, req.params.id); if (!r) return bad(res, 'Hasil tidak ditemukan', 404); res.json({ run: r }); }));
api.delete('/runs/:id', wrap(async (req, res) => {
  const r = await ownRun(req, req.params.id, 'edit'); if (!r) return bad(res, 'Hasil tidak ditemukan', 404);
  await query('DELETE FROM runs WHERE id = $1', [r.id]); res.json({ ok: true });
}));

/* ---------- jembatan ke layanan Python ---------- */
async function py(pathname, body, timeoutMs = 60000) {
  let r;
  try {
    r = await fetch(PY_URL + pathname, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) { const er = new Error('Layanan Python tidak dapat dihubungi (' + (e.name === 'TimeoutError' ? 'waktu habis' : e.message) + ')'); er.status = 503; throw er; }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const er = new Error(j.detail || j.error || ('Layanan Python galat ' + r.status)); er.status = r.status >= 500 ? 502 : r.status; throw er; }
  return j;
}
api.get('/runs/:id/analysis', wrap(async (req, res) => {
  const r = await ownRun(req, req.params.id); if (!r) return bad(res, 'Hasil tidak ditemukan', 404);
  res.json(await py('/analyze', { run_id: r.id }));
}));
api.post('/runs/compare', wrap(async (req, res) => {
  const ids = (req.body && req.body.run_ids) || [];
  if (!Array.isArray(ids) || ids.length < 2 || ids.length > 8) return bad(res, 'Pilih 2–8 hasil simulasi');
  for (const id of ids) if (!(await ownRun(req, id))) return bad(res, 'Hasil tidak ditemukan: ' + id, 404);
  res.json(await py('/compare', { run_ids: ids }));
}));
/* jalankan skenario di SUMO asli (eclipse-sumo) lewat layanan Python, simpan sebagai run engine=sumo */
api.post('/projects/:id/verify', wrap(async (req, res) => {
  const p = await accessProject(req, req.params.id, 'edit'); if (!p) return bad(res, 'Proyek tidak ditemukan', 404);
  const v = req.body && req.body.version ? +req.body.version : p.current_version;
  const ver = await versionData(p.id, v); if (!ver) return bad(res, 'Versi tidak ditemukan', 404);
  const cfg = Object.assign(SW.defaultConfig(), ver.data.cfg || {});
  const end = Math.min(+(req.body && req.body.end) || cfg.end, Number(process.env.VERIFY_MAX_END || 7200));
  const name = 'scenario';
  const files = sumoFiles(ver.data, name);
  const out = await py('/sumo/run', { name, files, keep_tls: !(req.body && req.body.sumoDefaultTls), lefthand: !!ver.data.net.lefthand, begin: cfg.begin, end, step_length: cfg.stepLength, seed: cfg.seed, time_to_teleport: cfg.timeToTeleport, period: cfg.period }, 15 * 60 * 1000);
  const run = await insertRun(pool, p, { version: v, engine: 'sumo', note: req.body && req.body.note ? req.body.note : `SUMO ${out.sumo_version || ''}`.trim(), config: { ...cfg, end }, totals: out.totals, summary: out.summary, tripinfo: out.tripinfo, detectors: out.detectors, sim_time: out.sim_time }, req.user.id);
  res.status(201).json({ run, warnings: out.warnings || [], log: out.log || '' });
}));

/* ---------- berbagi proyek ---------- */
api.get('/projects/:id/shares', wrap(async (req, res) => {
  const p = await accessProject(req, req.params.id, 'view'); if (!p) return bad(res, 'Proyek tidak ditemukan', 404);
  const r = await query(`SELECT u.username, u.display_name, s.role, s.created_at FROM project_shares s JOIN users u ON u.id = s.user_id WHERE s.project_id = $1 ORDER BY u.username`, [p.id]);
  res.json({ shares: r.rows, public_token: p.my_role === 'owner' ? p.public_token : null, my_role: p.my_role });
}));
api.post('/projects/:id/shares', wrap(async (req, res) => {
  const p = await ownProject(req, req.params.id); if (!p) return bad(res, 'Proyek tidak ditemukan', 404);
  const { username, role } = req.body || {};
  if (!['view', 'edit'].includes(role)) return bad(res, 'Peran harus view atau edit');
  const u = (await query('SELECT id FROM users WHERE lower(username) = lower($1)', [username || ''])).rows[0];
  if (!u) return bad(res, 'Pengguna tidak ditemukan', 404);
  if (u.id === req.user.id) return bad(res, 'Tidak perlu berbagi ke diri sendiri');
  await query(`INSERT INTO project_shares(project_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role`, [p.id, u.id, role]);
  res.status(201).json({ ok: true });
}));
api.delete('/projects/:id/shares/:username', wrap(async (req, res) => {
  const p = await accessProject(req, req.params.id, 'view'); if (!p) return bad(res, 'Proyek tidak ditemukan', 404);
  const self = req.params.username.toLowerCase() === req.user.username.toLowerCase();
  if (p.my_role !== 'owner' && !self) return bad(res, 'Hanya pemilik proyek yang boleh mencabut akses', 403);
  await query(`DELETE FROM project_shares WHERE project_id = $1 AND user_id = (SELECT id FROM users WHERE lower(username) = lower($2))`, [p.id, req.params.username]);
  res.json({ ok: true });
}));
api.post('/projects/:id/public', wrap(async (req, res) => {
  const p = await ownProject(req, req.params.id); if (!p) return bad(res, 'Proyek tidak ditemukan', 404);
  const token = req.body && req.body.enable ? require('crypto').randomBytes(18).toString('base64url') : null;
  await query('UPDATE projects SET public_token = $2 WHERE id = $1', [p.id, token]);
  res.json({ public_token: token });
}));

/* ---------- OpenStreetMap: ambil jaringan dari area peta (Overpass) & cari lokasi (Nominatim) ---------- */
const OVERPASS_URL = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const NOMINATIM_URL = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org/search';
const UA = { 'User-Agent': 'Optimus/1.1 (traffic simulation; self-hosted)' };
api.get('/osm', wrap(async (req, res) => {
  const [s_, w, n, e] = ['s', 'w', 'n', 'e'].map(k => parseFloat(req.query[k]));
  if ([s_, w, n, e].some(v => !isFinite(v)) || n <= s_ || e <= w) return bad(res, 'Batas area tidak valid');
  const km2 = (n - s_) * 110.5 * (e - w) * 111.3 * Math.cos((n + s_) / 2 * Math.PI / 180);
  const maxKm2 = Number(process.env.OSM_MAX_KM2 || 6);
  if (km2 > maxKm2) return bad(res, `Area terlalu luas (${km2.toFixed(1)} km², maks ${maxKm2} km²). Perbesar peta.`);
  const types = 'motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street' + (req.query.service === '1' ? '|service' : '');
  const ql = `[out:xml][timeout:60];(way["highway"~"^(${types})$"](${s_},${w},${n},${e}););(._;>;);out body;`;
  let r;
  try { r = await fetch(OVERPASS_URL, { method: 'POST', headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(ql), signal: AbortSignal.timeout(90000) }); }
  catch (er) { return bad(res, 'Server Overpass tidak dapat dihubungi: ' + er.message, 502); }
  if (!r.ok) return bad(res, 'Overpass menolak permintaan (' + r.status + ')', 502);
  res.set('Content-Type', 'application/xml; charset=utf-8');
  res.send(await r.text());
}));
api.get('/geocode', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim(); if (!q) return bad(res, 'Kata kunci kosong');
  try {
    const r = await fetch(`${NOMINATIM_URL}?format=jsonv2&limit=6&countrycodes=${encodeURIComponent(process.env.GEOCODE_COUNTRY || 'id')}&q=${encodeURIComponent(q)}`, { headers: UA, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return bad(res, 'Layanan pencarian lokasi galat ' + r.status, 502);
    const j = await r.json();
    res.json({ results: j.map(x => ({ name: x.display_name, lat: +x.lat, lon: +x.lon, bbox: x.boundingbox ? x.boundingbox.map(Number) : null })) });
  } catch (er) { bad(res, 'Layanan pencarian lokasi tidak dapat dihubungi: ' + er.message, 502); }
}));

/* ---------- laporan Word / PDF (dibuat oleh layanan Python) ---------- */
function reportGeometry(net) {
  const T = SW.buildTopo(net);
  const r1 = v => Math.round(v * 10) / 10;
  return {
    edges: Object.values(T.edges).map(te => ({ id: te.id, name: te.e.name || '', lanes: te.lanes.length, layer: te.layer || 0, shape: te.mid.map(p => [r1(p.x), r1(p.y)]) })),
    nodes: Object.values(T.nodes).map(tn => ({ id: tn.id, x: r1(tn.n.x), y: r1(tn.n.y), type: tn.n.type, r: r1(tn.r) })),
    tls: T.tlsNodes.map(id => ({ id, nodes: T.tlsPrograms[id].nodes, links: T.tlsPrograms[id].links.length, type: net.tls[id].type, phases: net.tls[id].phases })),
    lefthand: !!net.lefthand
  };
}
api.get('/runs/:id/report', wrap(async (req, res) => {
  const run = await ownRun(req, req.params.id); if (!run) return bad(res, 'Hasil tidak ditemukan', 404);
  const p = await accessProject(req, run.project_id, 'view');
  const ver = await versionData(p.id, run.version) || await versionData(p.id, p.current_version);
  const fmt = req.query.format === 'pdf' ? 'pdf' : 'docx';
  const opt = { population: +req.query.population || 1100000, environment: req.query.environment || 'KOM', friction: req.query.friction || 'S' };
  let pkji = null;
  if (run.extra && run.extra.pkji) { try { pkji = SW.pkji(ver.data.net, run.extra.pkji, opt); } catch (e) { pkji = null; } }
  const d = ver.data;
  const demand = {
    vTypes: Object.values(d.demand.vTypes).map(t => ({ id: t.id, vClass: t.vClass, model: t.carFollowModel, emission: t.emissionClass, maxSpeed: t.maxSpeed })),
    flows: d.demand.flows.map(f => ({ id: f.id, type: f.type, from: f.from || (f.edges ? f.edges[0] : f.route), to: f.to || (f.edges ? f.edges[f.edges.length - 1] : ''), vph: f.vehsPerHour || (f.period ? 3600 / f.period : null), stops: (f.stops || []).length })),
    vehicles: d.demand.vehicles.length
  };
  let compare = null;
  if (req.query.compare && isUuid(req.query.compare)) { const o = await ownRun(req, req.query.compare); if (o) compare = o.id; }
  const body = {
    format: fmt, run_id: run.id, compare_run_id: compare, author: req.user.display_name || req.user.username,
    project: { name: p.name, description: p.description, version: run.version, stats: p.stats },
    config: d.cfg || {}, geometry: reportGeometry(d.net), demand, add: { e1: (d.add.e1 || []).length, e2: (d.add.e2 || []).length, busStops: d.add.busStops || [], crossings: d.add.crossings || [] },
    pkji, extra: run.extra || {}
  };
  let r;
  try { r = await fetch(PY_URL + '/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(180000) }); }
  catch (e) { return bad(res, 'Layanan Python tidak dapat dihubungi', 503); }
  if (!r.ok) { const j = await r.json().catch(() => ({})); return bad(res, j.detail || 'Gagal membuat laporan', 502); }
  const buf = Buffer.from(await r.arrayBuffer());
  const fname = `Laporan_${safeName(p.name)}_v${run.version}.${fmt}`;
  res.set('Content-Type', fmt === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.set('Content-Disposition', `attachment; filename="${fname}"`);
  res.send(buf);
}));

/* ---------- tautan publik (tanpa login, hanya-baca) ---------- */
app.get('/api/public/:token', wrap(async (req, res) => {
  const tok = String(req.params.token || '');
  if (!/^[\w-]{16,40}$/.test(tok)) return bad(res, 'Tautan tidak valid', 404);
  const r = await query(`SELECT p.id, p.name, p.description, p.current_version, u.username AS owner FROM projects p JOIN users u ON u.id = p.owner_id WHERE p.public_token = $1 AND p.deleted_at IS NULL`, [tok]);
  const p = r.rows[0]; if (!p) return bad(res, 'Tautan tidak berlaku', 404);
  const ver = await versionData(p.id, p.current_version);
  res.json({ project: { name: p.name, description: p.description, owner: p.owner, current_version: p.current_version }, version: ver.version, data: ver.data, readonly: true });
}));

app.use('/api', api);



/* ---------- aplikasi web ---------- */
app.get('/favicon.ico', (req, res) => res.status(204).end());
/* pustaka pihak ketiga disajikan lokal (tanpa CDN): Three.js untuk tampilan 3D, Leaflet untuk peta OSM */
const NM = path.join(__dirname, '..', 'node_modules');
app.get('/vendor/three.min.js', (req, res) => res.sendFile(path.join(NM, 'three', 'build', 'three.min.js'), { maxAge: '7d' }));
app.use('/vendor/leaflet', express.static(path.join(NM, 'leaflet', 'dist'), { maxAge: '7d' }));
app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html', maxAge: '1h' }));

app.use('/api', (req, res) => bad(res, 'Endpoint tidak ada', 404));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err.type === 'entity.too.large') return bad(res, 'Data terlalu besar (batas ' + MAX_BODY + ')', 413);
  if (err.status && err.status < 600) return bad(res, err.message, err.status);
  console.error(err);
  bad(res, 'Galat server', 500);
});

async function start() {
  await migrate();
  return new Promise(resolve => {
    const srv = app.listen(PORT, () => { console.log(`Optimus server berjalan di http://localhost:${PORT}`); resolve(srv); });
    srv.keepAliveTimeout = 65000; srv.headersTimeout = 66000;   // koneksi keep-alive tidak diputus di tengah pemakaian
    srv.requestTimeout = 20 * 60 * 1000;                         // verifikasi SUMO asli bisa lama
  });
}
if (require.main === module) start().catch(e => { console.error('Gagal start:', e.message); process.exit(1); });
module.exports = { app, start };
