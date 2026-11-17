const SW = require('../src/optimus-core.js');
const fs = require('fs');
const B = (process.env.BASE_URL || 'http://localhost:3000') + '/api'; let tok;
const call = async (m, p, b, raw) => { const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }); if (raw) return [r.status, Buffer.from(await r.arrayBuffer()), r.headers.get('content-type')]; return [r.status, await r.json().catch(() => ({}))]; };
(async () => {
  const u = 'ind' + Date.now() % 100000;
  const tA = tok = (await call('POST', '/auth/register', { username: u, password: 'rahasia123', name: 'Fitrah' }))[1].token;
  const ex = SW.examples['Simpang Indonesia: lajur kiri, motor, angkot, halte & penyeberangan']();
  const data = { net: ex.net, demand: ex.demand, add: ex.add, cfg: { ...SW.defaultConfig(), end: 1800, warmup: 300 } };
  const pid = (await call('POST', '/projects', { name: 'Simpang Pajajaran–Otista', description: 'Kajian simpang APILL Bogor', data }))[1].project.id;
  const sim = new SW.Sim(data.net, data.demand, data.add, data.cfg); while (sim.t < 1800) sim.step();
  const run = (await call('POST', `/projects/${pid}/runs`, { version: 1, ...SW.runPayload(sim, 'eksisting') }))[1].run;
  console.log('run saved', run.id, run.totals.arrived);
  // RL variant as second run for comparison
  const rlNet = JSON.parse(JSON.stringify(data.net)); SW.buildTopo(rlNet); await SW.trainRL(rlNet, data.demand, data.add, data.cfg, { episodes: 10, horizon: 1200 });
  const sim2 = new SW.Sim(rlNet, data.demand, data.add, data.cfg); while (sim2.t < 1800) sim2.step();
  const run2 = (await call('POST', `/projects/${pid}/runs`, { version: 1, ...SW.runPayload(sim2, 'lampu RL') }))[1].run;
  // verify left-hand with real SUMO
  const [vs, vr] = await call('POST', `/projects/${pid}/verify`, {});
  console.log('verify', vs, vr.error || ('arrived ' + vr.run.totals.arrived + ' CO2kg ' + (vr.run.totals.CO2 / 1000).toFixed(1) + ' tele ' + vr.run.totals.teleports), 'web CO2kg', (sim.totals.CO2 / 1000).toFixed(1), 'web arr', sim.arrived.length);
  if (vr.warnings) console.log('  warn', vr.warnings.slice(0, 4).join(' | '));
  for (const f of ['docx', 'pdf']) {
    const t0 = Date.now(); const [st, buf, ct] = await call('GET', `/runs/${run.id}/report?format=${f}&compare=${run2.id}`, null, true);
    fs.writeFileSync(require('os').tmpdir() + '/laporan.' + f, buf); console.log('report', f, st, ct, buf.length, 'bytes', Date.now() - t0, 'ms');
  }
  // sharing
  const u2 = u + 'b'; const tB = (await call('POST', '/auth/register', { username: u2, password: 'rahasia123' }))[1].token;
  tok = tA; console.log('share view', (await call('POST', `/projects/${pid}/shares`, { username: u2, role: 'view' }))[0]);
  tok = tB; console.log('B list', (await call('GET', '/projects'))[1].projects.map(p => p.name + ':' + p.my_role + ' owner ' + p.owner));
  console.log('B get', (await call('GET', `/projects/${pid}`))[0], 'B save (view) ->', (await call('PUT', `/projects/${pid}`, { data, baseVersion: 1 }))[0], 'B delete ->', (await call('DELETE', `/projects/${pid}`))[0], 'B analysis', (await call('GET', `/runs/${run.id}/analysis`))[0]);
  tok = tA; await call('POST', `/projects/${pid}/shares`, { username: u2, role: 'edit' });
  tok = tB; console.log('B save (edit) ->', (await call('PUT', `/projects/${pid}`, { data, baseVersion: 1, note: 'edit oleh B' }))[0], 'B share others ->', (await call('POST', `/projects/${pid}/shares`, { username: u, role: 'view' }))[0]);
  tok = tA; const pub = (await call('POST', `/projects/${pid}/public`, { enable: true }))[1].public_token; console.log('public token', !!pub);
  tok = null; const [ps, pj] = await call('GET', `/public/${pub}`); console.log('public get', ps, pj.project && pj.project.name, pj.readonly, 'v', pj.version);
  tok = tA; await call('POST', `/projects/${pid}/public`, { enable: false }); tok = null; console.log('public after disable', (await call('GET', `/public/${pub}`))[0]);
  tok = tA; console.log('shares', JSON.stringify((await call('GET', `/projects/${pid}/shares`))[1].shares.map(s => s.username + ':' + s.role)));
  // OSM proxy + geocode (mocked upstream)
  const [os_, osm] = await call('GET', '/osm?s=-6.60&w=106.79&n=-6.59&e=106.81', null, true); console.log('osm', os_, osm.length, 'bytes');
  console.log('osm too big', (await call('GET', '/osm?s=-6.7&w=106.7&n=-6.5&e=106.9'))[1].error);
  console.log('geocode', JSON.stringify((await call('GET', '/geocode?q=tugu%20kujang'))[1].results[0]));
})().catch(e => { console.error('FAIL', e); process.exit(1); });
