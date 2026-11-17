const SW = require('../src/optimus-core.js');
const B = (process.env.BASE_URL || 'http://localhost:3000') + '/api';
let tok = null;
async function call(method, path, body, expect) {
  const r = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (expect && r.status !== expect) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(j).slice(0,300)}`);
  return [r.status, j];
}
(async () => {
  const u = 'uji' + Date.now() % 100000;
  console.log('no token', (await call('GET', '/projects'))[0]);
  console.log('short pw', (await call('POST', '/auth/register', { username: u, password: '123' }))[1].error);
  let [, reg] = await call('POST', '/auth/register', { username: u, password: 'rahasia123', name: 'Peneliti' }, 201); tok = reg.token;
  console.log('dup', (await call('POST', '/auth/register', { username: u, password: 'rahasia123' }))[0]);
  tok = null; console.log('bad login', (await call('POST', '/auth/login', { username: u, password: 'salah12345' }))[0]);
  let [, li] = await call('POST', '/auth/login', { username: u, password: 'rahasia123' }, 200); tok = li.token;
  const ex = SW.examples['Flyover di atas persimpangan bersinyal']();
  const data = { net: ex.net, demand: ex.demand, add: ex.add, cfg: { ...SW.defaultConfig(), end: 900 } };
  let [, cr] = await call('POST', '/projects', { name: 'Flyover Pajajaran', description: 'uji', data }, 201);
  const pid = cr.project.id; console.log('created', pid, cr.project.stats);
  data.demand.flows[0].vehsPerHour = 1200;
  let [, up] = await call('PUT', `/projects/${pid}`, { data, note: 'naikkan arus lurus', baseVersion: 1 }, 200); console.log('v', up.project.current_version);
  console.log('conflict', (await call('PUT', `/projects/${pid}`, { data, baseVersion: 1 }))[0]);
  let [, ver] = await call('GET', `/projects/${pid}/versions`, null, 200); console.log('versions', ver.versions.map(v => v.version + ':' + v.note).join(' | '));
  let [, g1] = await call('GET', `/projects/${pid}?version=1`, null, 200); console.log('v1 vph', g1.data.demand.flows[0].vehsPerHour);
  // run in Optimus (node) and store
  const g2 = (await call('GET', `/projects/${pid}`, null, 200))[1];
  const sim = new SW.Sim(g2.data.net, g2.data.demand, g2.data.add, g2.data.cfg); while (sim.t < g2.data.cfg.end) sim.step();
  let [, run] = await call('POST', `/projects/${pid}/runs`, { version: g2.version, ...SW.runPayload(sim, 'uji node') }, 201); console.log('run', run.run.id, run.run.totals.arrived);
  let [, an] = await call('GET', `/runs/${run.run.id}/analysis`, null, 200); console.log('analysis LOS', an.los, 'dur', an.duration.mean.toFixed(1), 'p85', an.duration.p85.toFixed(1), 'types', an.by_type.map(t => t.type + ':' + t.n).join(','), 'profile', an.profile_15min.length, 'dets', JSON.stringify(an.detectors[0]));
  // verify in real SUMO
  const t0 = Date.now();
  let [st, vr] = await call('POST', `/projects/${pid}/verify`, {});
  console.log('verify', st, vr.error || '', vr.run && vr.run.totals && ('arrived ' + vr.run.totals.arrived + ' tele ' + vr.run.totals.teleports + ' CO2kg ' + (vr.run.totals.CO2/1000).toFixed(1)), (Date.now()-t0)+'ms', (vr.warnings||[]).slice(0,3));
  if (vr.run) {
    let [, cmp] = await call('POST', '/runs/compare', { run_ids: [run.run.id, vr.run.id] }, 200);
    for (const r of cmp.rows) console.log('  ', r.metric.padEnd(32), r.values.map(v => v === null ? '-' : typeof v === 'number' ? v.toFixed(1) : v).join('  vs  '), r.diff_pct[1] != null ? `(${r.diff_pct[1].toFixed(0)}%)` : '');
  }
  let [, ls] = await call('GET', '/projects', null, 200); console.log('list', ls.projects.map(p => `${p.name} v${p.current_version} runs${p.runs}`));
  let [, exf] = await call('GET', `/projects/${pid}/export`, null, 200); console.log('export files', Object.keys(exf.files));
  let [, dup] = await call('POST', `/projects/${pid}/duplicate`, {}, 201); console.log('dup', dup.project.name);
  console.log('restore', (await call('POST', `/projects/${pid}/versions/1/restore`, {}, 200))[1].project.current_version);
  // other user cannot see
  const tokA = tok; let [, r2] = await call('POST', '/auth/register', { username: u + 'b', password: 'rahasia123' }, 201); tok = r2.token;
  console.log('other user get', (await call('GET', `/projects/${pid}`))[0], 'run', (await call('GET', `/runs/${run.run.id}`))[0]);
  tok = tokA; console.log('delete', (await call('DELETE', `/projects/${pid}`, null, 200))[0], 'after', (await call('GET', `/projects/${pid}`))[0]);
  console.log('logout', (await call('POST', '/auth/logout', {}, 200))[0], 'me', (await call('GET', '/auth/me'))[0]);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
