/* ===== Optimus UI: side-by-side scenario comparison (A | B) ===== */
function cmpScenario(label, data) {
  const d = JSON.parse(JSON.stringify(data));
  return { label, net: d.net, demand: d.demand, add: Object.assign(SW.newAdditional(), d.add || {}), cfg: Object.assign({}, S.cfg, d.cfg || {}, { delay: S.cfg.delay, stepLength: S.cfg.stepLength }), sim: null, T: SW.buildTopo(d.net) };
}
function cmpOpen(sc) {
  stopSim();
  S.cmp = sc; S.sim = null; S.finished = false;
  $('stage').classList.add('split');
  let c2 = $('cv2');
  if (!c2) { c2 = h('canvas', { id: 'cv2' }); $('stage').insertBefore(c2, $('tools')); c2.addEventListener('wheel', e => { cv.dispatchEvent(new WheelEvent('wheel', e)); e.preventDefault(); }, { passive: false }); }
  let lb = $('cmpLabels');
  if (!lb) { lb = h('div', { id: 'cmpLabels' }); $('stage').append(lb); }
  lb.innerHTML = ''; lb.append(h('span', { class: 'a' }, 'A: ' + (S.scenarioName || 'skenario')), h('span', { class: 'b' }, 'B: ' + sc.label));
  setTimeout(() => { resize(); fitView(); S.need = true; }, 30);
  renderPanel();
}
function cmpClose() {
  S.cmp = null; $('stage').classList.remove('split');
  const c2 = $('cv2'); if (c2) c2.remove(); const lb = $('cmpLabels'); if (lb) lb.remove();
  setTimeout(() => { resize(); S.need = true; }, 30); renderPanel();
}
function cmpSwap() {
  stopSim();
  const A = { label: S.scenarioName, net: S.net, demand: S.demand, add: S.add, cfg: S.cfg, sim: null, T: S.T };
  const B = S.cmp;
  S.net = B.net; S.demand = B.demand; S.add = B.add; S.cfg = Object.assign(B.cfg, { delay: S.cfg.delay }); S.scenarioName = B.label || 'B';
  S.cmp = A; S.sim = null; S.sel = null;
  netChanged(true); cmpOpen(A);
  toast('A dan B ditukar — sekarang Anda mengedit ' + S.scenarioName);
}
function cmpStep(t) {
  const c = S.cmp; if (!c) return;
  if (!c.sim) { c.sim = new SW.Sim(c.net, c.demand, c.add, Object.assign({}, c.cfg, { stepLength: S.cfg.stepLength, end: S.cfg.end, seed: S.cfg.seed })); c.T = c.sim.T; }
  let guard = 0;
  while (c.sim.t < t - 1e-9 && guard++ < 1000) c.sim.step();
}
function drawCompare() {
  const c = S.cmp, c2 = $('cv2'); if (!c || !c2) return;
  const r = c2.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width * DPR)), hh = Math.max(1, Math.round(r.height * DPR));
  if (c2.width !== w || c2.height !== hh) { c2.width = w; c2.height = hh; }
  const save = { ctx, CW, CH, net: S.net, add: S.add, sim: S.sim, T: S.T, sel: S.sel, hover: S.hover, rb: S.routeBuild, tab: S.tab, chain: S.chain };
  try {
    ctx = c2.getContext('2d'); CW = r.width; CH = r.height;
    S.net = c.net; S.add = c.add; S.sim = c.sim; S.T = c.T; S.sel = null; S.hover = null; S.routeBuild = []; S.chain = null;
    if (S.tab === 'net' || S.tab === 'tls') S.tab = 'sim';
    draw();
  } finally {
    ctx = save.ctx; CW = save.CW; CH = save.CH; S.net = save.net; S.add = save.add; S.sim = save.sim; S.T = save.T; S.sel = save.sel; S.hover = save.hover; S.routeBuild = save.rb; S.tab = save.tab; S.chain = save.chain;
  }
}
function kpi(sim) {
  if (!sim) return null;
  const ti = sim.tripinfo, s = sim.lastSummary || {};
  return {
    t: sim.t, running: s.running || 0, halting: s.halting || 0, speed: (s.meanSpeed || 0) * 3.6, arrived: sim.arrived.length,
    loss: ti.length ? ti.reduce((a, r) => a + r.timeLoss, 0) / ti.length : null, dur: ti.length ? ti.reduce((a, r) => a + r.duration, 0) / ti.length : null,
    co2: sim.totals.CO2 / 1000, peds: sim.pedStats ? sim.pedStats.crossed : 0
  };
}
function updateCmpTable() {
  const el = $('cmpTable'); if (!el || !S.cmp) return;
  const a = kpi(S.sim), b = kpi(S.cmp.sim);
  const rows = [['Kendaraan berjalan', 'running', 0], ['Kendaraan berhenti', 'halting', 0], ['Kecepatan rata-rata (km/j)', 'speed', 1], ['Perjalanan selesai', 'arrived', 0], ['Waktu tempuh rata-rata (s)', 'dur', 1], ['Tundaan rata-rata (s)', 'loss', 1], ['CO₂ total (kg)', 'co2', 1], ['Pejalan menyeberang', 'peds', 0]];
  el.innerHTML = '';
  el.append(h('tr', null, h('th', null, 't = ' + fmt(a ? a.t : 0, 0) + ' s'), h('th', null, 'A'), h('th', null, 'B'), h('th', null, 'B vs A')));
  for (const [l, k, d] of rows) {
    const va = a ? a[k] : null, vb = b ? b[k] : null;
    const diff = va && vb !== null && va !== null ? (vb - va) / Math.abs(va) * 100 : null;
    el.append(h('tr', null, h('td', null, l), h('td', null, fmt(va, d)), h('td', null, fmt(vb, d)), h('td', { style: { color: diff === null || Math.abs(diff) < 3 ? 'var(--mut)' : (['speed', 'arrived', 'peds'].includes(k) ? diff > 0 : diff < 0) ? '#2ecc71' : '#eb5757' } }, diff === null ? '–' : (diff > 0 ? '+' : '') + fmt(diff, 0) + '%')));
  }
}
function compareBox() {
  const box = h('div', { class: 'card' });
  if (S.cmp) {
    box.append(h('div', { class: 'small' }, h('b', null, 'A'), ': ' + (S.scenarioName || 'skenario saat ini') + ' (dapat diedit) · ', h('b', null, 'B'), ': ' + S.cmp.label),
      h('table', { id: 'cmpTable' }),
      h('div', { class: 'row' }, btn('Tukar A ⇄ B', cmpSwap, 'sm'), btn('Tutup perbandingan', cmpClose, 'sm bad')),
      h('div', { class: 'small mut' }, 'Keduanya berjalan serempak dengan seed yang sama; tampilan peta tersinkron. Ubah skenario A (atau tukar dulu untuk mengubah B), lalu tekan ⟲.'));
    setTimeout(updateCmpTable, 0);
    return box;
  }
  const exs = Object.keys(SW.examples).filter(k => !k.startsWith('Kosong'));
  box.append(h('div', { class: 'small mut' }, 'Jalankan dua skenario bersamaan di layar terbagi, mis. "eksisting" vs "dengan flyover" atau lampu tetap vs RL.'),
    h('div', { class: 'row' }, btn('Salin skenario ini sebagai B', () => cmpOpen(cmpScenario('salinan ' + (S.scenarioName || 'A'), { net: S.net, demand: S.demand, add: S.add, cfg: S.cfg })), 'sm pri')),
    h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, sel('', [['', 'atau contoh sebagai B…'], ...exs], v => { if (v) cmpOpen(cmpScenario(v, SW.examples[v]())); })));
  if (typeof SV !== 'undefined' && SV.on && SV.user && SV.project) {
    box.append(h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, h('input', { type: 'number', id: 'cmpVer', placeholder: 'versi', style: { width: '80px' }, value: Math.max(1, (SV.version || 1) - 1) }),
      btn('Versi proyek ini sebagai B', async () => { try { const v = +$('cmpVer').value; const j = await svApi('GET', `/projects/${SV.project.id}?version=${v}`); cmpOpen(cmpScenario(`${SV.project.name} v${v}`, j.data)); } catch (e) { toast(e.message); } }, 'sm')));
  }
  return box;
}
