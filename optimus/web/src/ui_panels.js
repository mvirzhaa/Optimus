/* ===== Optimus UI: tabs, editors (NetEdit), demand, TLS, detectors, simulation, output, files ===== */
const TABS = [['net', 'NetEdit'], ['demand', 'Demand'], ['tls', 'Lampu'], ['det', 'Detektor'], ['fac', 'Fasilitas'], ['sim', 'Simulasi'], ['traci', 'TraCI'], ['out', 'Output'], ['file', 'File']];
const MODES = [['inspect', '🔍', 'Inspeksi (I)'], ['create', '✏️', 'Buat ruas jalan (E)'], ['move', '✥', 'Pindah simpul / titik geometri (M)'], ['delete', '🗑', 'Hapus (D)']];

function setHint(t) {
  if (t === undefined) {
    if (S.pick) t = `Ketuk ruas jalan untuk "${S.pick.label}". Esc untuk batal.`;
    else if (S.tab === 'net') t = { inspect: 'Ketuk simpul/ruas/kendaraan untuk melihat & mengubah atribut.', create: (+S.opts.layer ? `[${SW.LEVEL_NAMES[S.opts.layer]}] ` : '') + (S.chain ? `Ketuk lokasi berikutnya (dari ${S.chain}). Ketuk simpul yang sama / Esc untuk selesai.` : 'Ketuk peta untuk simpul awal, lalu ketuk lagi untuk membuat ruas. Ketuk ruas di level yang sama untuk membelahnya.'), move: 'Seret simpul, atau seret ruas untuk menambah titik geometri (lengkung).', delete: 'Ketuk simpul / ruas / detektor untuk menghapus.' }[S.mode];
    else if (S.tab === 'demand' && S.mode === 'route') t = 'Mode rute: ketuk ruas secara berurutan (jalur otomatis dilengkapi).';
    else if (S.tab === 'tls') t = 'Ketuk persimpangan untuk mengedit program lampu lalu lintas.';
    else if (S.tab === 'fac') t = { halte: 'Ketuk lajur tepi untuk menaruh halte.', zebra: 'Ketuk ruas untuk menaruh zebra cross.', pelican: 'Ketuk ruas untuk menaruh pelican crossing.', tls: 'Ketuk ruas yang masuk ke simpang bersinyal.' }[S.facTool || 'halte'];
    else if (S.tab === 'det') t = `Ketuk lajur untuk menaruh ${S.detTool === 'e1' ? 'induction loop (E1)' : 'lane area detector (E2)'}.`;
    else t = '';
  }
  $('hintText').textContent = t || '';
}
function setTab(t) {
  S.tab = t; S.pick = null;
  if (t !== 'net' && t !== 'demand') S.mode = 'inspect';
  if (t === 'demand' && S.mode !== 'route') S.mode = 'inspect';
  if (t !== 'net') S.chain = null;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  renderTools(); renderPanel(); setHint(); S.need = true;
}
function setMode(m) { S.mode = m; S.chain = null; renderTools(); setHint(); S.need = true; }
function renderTools() {
  const el = $('tools'); el.innerHTML = '';
  if (S.tab === 'net') for (const [m, ic, title] of MODES) el.append(h('button', { class: S.mode === m ? 'on' : '', title, onclick: () => setMode(m) }, ic));
  el.append(h('button', { title: 'Undo (Ctrl+Z)', onclick: undo }, '↶'), h('button', { title: 'Redo (Ctrl+Y)', onclick: redo }, '↷'));
}

/* ---------- canvas clicks ---------- */
function snapXY(x, y) { if (S.opts.snap > 0) return [Math.round(x / S.opts.snap) * S.opts.snap, Math.round(y / S.opts.snap) * S.opts.snap]; return [x, y]; }
function onClick(wx, wy) {
  if (S.pick) {
    const hit = hitTest(wx, wy, ['edge']);
    if (hit) { const p = S.pick; S.pick = null; p.cb(hit.id); setHint(); renderPanel(); }
    return;
  }
  if (S.tab === 'net') {
    if (S.mode === 'create') return createAt(wx, wy);
    if (S.mode === 'delete') {
      const hit = hitTest(wx, wy, ['busStop', 'crossing', 'e1', 'e2', 'node', 'edge']); if (!hit) return;
      S.sel = hit; deleteSel(); return;
    }
    const hit = hitTest(wx, wy); S.sel = hit; S.selPhase = undefined; renderPanel(); S.need = true; return;
  }
  if (S.tab === 'tls') {
    const hit = hitTest(wx, wy, ['node']); S.sel = hit; S.selPhase = 0; renderPanel(); S.need = true; return;
  }
  if (S.tab === 'fac') return facClick(wx, wy);
  if (S.tab === 'det') {
    const hit = hitTest(wx, wy, ['e1', 'e2']);
    if (hit) { S.sel = hit; renderPanel(); S.need = true; return; }
    const hl = hitTest(wx, wy, ['lane']); if (!hl) return;
    pushUndo();
    const L = topo().lanes[hl.lane];
    if (S.detTool === 'e1') { const id = uniqueId('e1_' + L.id, S.add.e1); S.add.e1.push({ id, lane: L.id, pos: +Math.min(L.length - 0.5, hl.s).toFixed(2), period: S.cfg.period }); S.sel = { kind: 'e1', id }; }
    else { const len = Math.min(50, L.length - hl.s); const id = uniqueId('e2_' + L.id, S.add.e2); S.add.e2.push({ id, lane: L.id, pos: +Math.max(0, hl.s).toFixed(2), length: +Math.max(5, len).toFixed(2), period: S.cfg.period }); S.sel = { kind: 'e2', id }; }
    demandChanged(); renderPanel(); return;
  }
  if (S.tab === 'demand' && S.mode === 'route') {
    const hit = hitTest(wx, wy, ['edge']); if (!hit) return;
    const T = topo();
    if (!S.routeBuild.length) S.routeBuild = [hit.id];
    else {
      const last = S.routeBuild[S.routeBuild.length - 1];
      const r = SW.dijkstra(T, last, hit.id);
      if (!r) { toast('Tidak ada jalur dari ' + last + ' ke ' + hit.id); return; }
      S.routeBuild = S.routeBuild.concat(r.slice(1));
    }
    S.need = true; renderPanel(); return;
  }
  const hit = hitTest(wx, wy); S.sel = hit; renderPanel(); S.need = true;
}
function uniqueId(base, list) { let i = 0, id = base; const has = x => list.some(d => d.id === x); while (has(id)) id = base + '_' + (++i); return id; }
function createAt(wx, wy) {
  let node = null;
  const hn = hitTest(wx, wy, ['node']);
  pushUndo();
  if (hn) node = hn.id;
  else {
    const he = hitTest(wx, wy, ['edge']);
    if (he && (S.net.edges[he.id].layer || 0) === (+S.opts.layer || 0)) { const n = SW.splitEdge(S.net, he.id, { x: wx, y: wy }); node = n.id; }
    else { const [x, y] = snapXY(wx, wy); node = SW.addNode(S.net, x, y, S.opts.nodeType).id; }
  }
  if (S.chain && S.chain !== node) {
    const o = { numLanes: +S.opts.lanes, speed: mps(+S.opts.speedKmh), priority: +S.opts.priority, layer: +S.opts.layer || 0 };
    const ex = Object.values(S.net.edges).find(e => e.from === S.chain && e.to === node);
    if (!ex) {
      const e = SW.addEdge(S.net, S.chain, node, o);
      if (S.opts.twoWay && !Object.values(S.net.edges).some(r => r.from === node && r.to === S.chain)) SW.addEdge(S.net, node, S.chain, { ...o, id: '-' + e.id });
    }
    S.net.connections = null;
    S.chain = node;
  } else if (S.chain === node) { S.chain = null; }
  else S.chain = node;
  netChanged(); setHint();
}
function deleteSel() {
  const s = S.sel; if (!s) return;
  pushUndo();
  if (s.kind === 'node') SW.removeNode(S.net, s.id);
  else if (s.kind === 'edge') SW.removeEdge(S.net, s.id);
  else if (s.kind === 'e1') S.add.e1 = S.add.e1.filter(d => d.id !== s.id);
  else if (s.kind === 'e2') S.add.e2 = S.add.e2.filter(d => d.id !== s.id);
  else if (s.kind === 'busStop') { S.add.busStops = S.add.busStops.filter(d => d.id !== s.id); for (const f of S.demand.flows) if (f.stops) f.stops = f.stops.filter(x => x.busStop !== s.id); }
  else if (s.kind === 'crossing') S.add.crossings = S.add.crossings.filter(d => d.id !== s.id);
  else if (s.kind === 'veh' && S.sim && S.sim.vehs.has(s.id)) { S.sim.arrive(S.sim.vehs.get(s.id), 'vaporized'); S.sel = null; renderPanel(); return; }
  S.sel = null;
  if (['e1', 'e2', 'busStop', 'crossing'].includes(s.kind)) { demandChanged(); renderPanel(); }
  else netChanged();
}

/* ---------- small form helpers ---------- */
function field(label, input) { return [h('label', null, label), input]; }
function num(value, onchange, o = {}) { return h('input', { type: 'number', value: value === undefined ? '' : value, step: o.step || 'any', min: o.min, max: o.max, onchange: e => onchange(e.target.value === '' ? undefined : +e.target.value) }); }
function txt(value, onchange, o = {}) { return h('input', { type: 'text', value: value || '', placeholder: o.ph || '', onchange: e => onchange(e.target.value) }); }
function sel(value, options, onchange) { const s = h('select', { onchange: e => onchange(e.target.value) }, options.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return h('option', { value: v, selected: String(v) === String(value) }, l); })); return s; }
function chk(value, label, onchange) { return h('label', { class: 'row', style: { gap: '6px', margin: 0 } }, h('input', { type: 'checkbox', checked: !!value, onchange: e => onchange(e.target.checked) }), label); }
function btn(label, onclick, cls) { return h('button', { class: 'btn ' + (cls || ''), onclick }, label); }
function edgeSelect(value, onchange, label) {
  const ids = Object.keys(topo().edges).sort();
  return h('div', { class: 'row', style: { flexWrap: 'nowrap', margin: 0 } }, sel(value, [['', '—'], ...ids], onchange), h('button', { class: 'btn sm', title: 'Pilih di peta', onclick: () => { S.pick = { label, cb: id => onchange(id) }; setHint(); } }, '🎯'));
}

/* ---------- panel dispatcher ---------- */
function renderPanel() {
  const p = $('panel'); const st = p.scrollTop; p.innerHTML = '';
  p.append(h('div', { id: 'sheetHandle', onclick: toggleSheet }, h('i')));
  const fn = { fac: panelFac, proj: typeof panelProj !== 'undefined' ? panelProj : panelFile, net: panelNet, demand: panelDemand, tls: panelTLS, det: panelDet, sim: panelSim, traci: panelTraci, out: panelOut, file: panelFile }[S.tab];
  try { fn(p); } catch (e) { console.error(e); p.append(h('pre', { class: 'console' }, String(e.stack || e))); }
  p.scrollTop = st;
}
function toggleSheet() { const m = $('main'); const cur = getComputedStyle(m).getPropertyValue('--sheet').trim(); m.style.setProperty('--sheet', cur === '18vh' ? '44vh' : cur === '44vh' ? '72vh' : '18vh'); setTimeout(() => { resize(); }, 50); }

/* ---------- NetEdit panel ---------- */
function panelNet(p) {
  const s = S.sel;
  if (s) p.append(inspector(s));
  p.append(h('div', { class: 'card' }, chk(S.net.lefthand, 'Lalu lintas lajur kiri (Indonesia)', v => {
    pushUndo(); S.net.lefthand = v; S.net.connections = null;
    for (const id of Object.keys(S.net.tls)) delete S.net.tls[id];   // urutan link berubah -> program lampu dibuat ulang
    netChanged(); toast(v ? 'Lajur kiri: lajur dalam dibalik, program lampu dibuat ulang' : 'Lajur kanan');
  }), h('div', { class: 'small mut' }, 'Mengubah posisi lajur, aturan belok, bundaran (searah jarum jam) dan ekspor SUMO (lefthand).')));
  p.append(h('h3', null, 'Ruas baru (mode ✏️)'),
    h('div', { class: 'grid2' },
      ...field('Jumlah lajur', num(S.opts.lanes, v => S.opts.lanes = Math.max(1, Math.min(8, v || 1)), { min: 1, max: 8, step: 1 })),
      ...field('Kecepatan (km/j)', num(S.opts.speedKmh, v => S.opts.speedKmh = v || 50)),
      ...field('Prioritas', num(S.opts.priority, v => S.opts.priority = v === undefined ? -1 : v, { step: 1 })),
      ...field('Level jalan', sel(S.opts.layer, [[2, '▲ Flyover 2 (susun)'], [1, '▲ Flyover'], [0, 'Permukaan'], [-1, '▼ Underpass'], [-2, '▼ Underpass 2']], v => { S.opts.layer = +v; setHint(); })),
      ...field('Tipe simpul', sel(S.opts.nodeType, [['priority', 'priority'], ['traffic_light', 'traffic_light'], ['right_before_left', 'right_before_left']], v => S.opts.nodeType = v)),
      ...field('Snap grid (m)', num(S.opts.snap, v => { S.opts.snap = v || 0; S.need = true; }, { min: 0 }))),
    chk(S.opts.twoWay, 'Dua arah (buat ruas balik otomatis)', v => S.opts.twoWay = v),
    h('div', { class: 'small mut' }, 'Flyover/underpass: pilih level lalu gambar dari simpul jalan permukaan ke simpul lain. Ruas berbeda level saling melintas tanpa persimpangan; tanjakan (±6%) dibuat otomatis di ujung yang terhubung ke jalan permukaan.'));
  p.append(h('h3', null, 'Generator jaringan (netgenerate)'), genPanel());
  p.append(h('h3', null, 'Peta latar GIS'), bgPanel());
  const T = topo();
  p.append(h('h3', null, 'Ringkasan jaringan'), h('div', { class: 'small mut' },
    `${Object.keys(T.nodes).length} simpul · ${Object.keys(T.edges).length} ruas · ${Object.keys(T.lanes).length} lajur · ${T.conns.length} koneksi · ${T.tlsNodes.length} lampu lalu lintas`),
    h('div', { class: 'small mut', style: { marginTop: '6px' } }, 'Pintasan: I/E/M/D ganti mode, Esc selesai, Del hapus, Spasi main/jeda, Ctrl+Z undo.'));
}
function genPanel() {
  const g = S._gen = S._gen || { type: 'grid', nx: 3, ny: 3, length: 150, lanes: 1, speedKmh: 50, tls: true, attach: 100, arms: 6, circles: 3 };
  const box = h('div', { class: 'card' });
  const draw = () => {
    box.innerHTML = '';
    box.append(h('div', { class: 'grid2' },
      ...field('Tipe', sel(g.type, [['grid', 'Grid'], ['spider', 'Spider (jaring laba-laba)']], v => { g.type = v; draw(); })),
      ...(g.type === 'grid' ? [...field('Kolom × baris', h('div', { class: 'row', style: { margin: 0, flexWrap: 'nowrap' } }, num(g.nx, v => g.nx = v, { min: 2, step: 1 }), num(g.ny, v => g.ny = v, { min: 1, step: 1 }))), ...field('Panjang tepi (m)', num(g.attach, v => g.attach = v))]
        : [...field('Lengan × lingkar', h('div', { class: 'row', style: { margin: 0, flexWrap: 'nowrap' } }, num(g.arms, v => g.arms = v, { min: 3, step: 1 }), num(g.circles, v => g.circles = v, { min: 1, step: 1 })))]),
      ...field('Panjang ruas (m)', num(g.length, v => g.length = v)),
      ...field('Lajur', num(g.lanes, v => g.lanes = v, { min: 1, step: 1 })),
      ...field('Kecepatan (km/j)', num(g.speedKmh, v => g.speedKmh = v))),
      chk(g.tls, 'Semua persimpangan bersinyal', v => g.tls = v),
      h('div', { class: 'row' }, btn('Buat jaringan', () => {
        if (Object.keys(S.net.nodes).length && !confirmBox('Ganti jaringan saat ini?')) return;
        pushUndo();
        const o = { nx: g.nx, ny: g.ny, length: g.length, lanes: g.lanes, speed: mps(g.speedKmh), tls: g.tls, attach: g.attach, arms: g.arms, circles: g.circles };
        S.net = g.type === 'grid' ? SW.genGrid(o) : SW.genSpider(o);
        S.demand = SW.newDemand(); S.add = SW.newAdditional(); S.sel = null;
        netChanged(); fitView(); toast('Jaringan dibuat. Tambahkan demand di tab Demand.');
      }, 'pri')));
  };
  draw(); return box;
}
function confirmBox() { return true; }
function bgPanel() {
  const box = h('div', { class: 'card' });
  const b = S.bg;
  box.append(h('div', { class: 'small mut' }, 'Muat citra peta/satelit (PNG/JPG) lalu atur posisi & skala untuk menggambar jaringan di atasnya (georeferensi sederhana).'),
    h('input', { type: 'file', accept: 'image/*', onchange: e => { const f = e.target.files[0]; if (!f) return; const img = new Image(); img.onload = () => { const w = 500; S.bg = { img, x: S.view.cx - w / 2, y: S.view.cy - w * img.height / img.width / 2, w, h: w * img.height / img.width, alpha: 0.6, ratio: img.height / img.width }; renderPanel(); S.need = true; }; img.src = URL.createObjectURL(f); } }));
  if (b) box.append(h('div', { class: 'grid2', style: { marginTop: '6px' } },
    ...field('Kiri-bawah X', num(+b.x.toFixed(1), v => { b.x = v; S.need = true; })),
    ...field('Kiri-bawah Y', num(+b.y.toFixed(1), v => { b.y = v; S.need = true; })),
    ...field('Lebar (m)', num(+b.w.toFixed(1), v => { b.w = v; b.h = v * b.ratio; S.need = true; })),
    ...field('Transparansi', h('input', { type: 'range', min: 0.1, max: 1, step: 0.05, value: b.alpha, oninput: e => { b.alpha = +e.target.value; S.need = true; } }))),
    btn('Hapus latar', () => { S.bg = null; renderPanel(); S.need = true; }, 'sm bad'));
  return box;
}
function inspector(s) {
  const box = h('div', { class: 'card' });
  if (s.kind === 'node') {
    const n = S.net.nodes[s.id]; if (!n) return box;
    const tn = topo().nodes[s.id];
    box.append(h('h3', null, 'Simpul (junction) ', h('span', { class: 'tag' }, n.id)),
      h('div', { class: 'grid2' },
        ...field('x', num(+n.x.toFixed(2), v => { pushUndo(); n.x = v; netChanged(); })),
        ...field('y', num(+n.y.toFixed(2), v => { pushUndo(); n.y = v; netChanged(); })),
        ...field('Tipe', sel(n.type, ['priority', 'traffic_light', 'right_before_left'], v => { pushUndo(); n.type = v; if (v !== 'traffic_light') delete S.net.tls[n.id]; netChanged(); })),
        ...field('Radius (m)', num(n.radius || '', v => { pushUndo(); n.radius = v || 0; netChanged(); }, { min: 0 }))),
      h('div', { class: 'small mut' }, tn ? `Masuk: ${tn.inc.map(e => e.id).join(', ') || '–'} · Keluar: ${tn.out.map(e => e.id).join(', ') || '–'} · ${tn.conns.length} koneksi` : ''),
      h('div', { class: 'row' }, btn('Hapus', deleteSel, 'sm bad'), n.type === 'traffic_light' ? btn('Edit lampu →', () => { setTab('tls'); S.sel = s; S.selPhase = 0; renderPanel(); }, 'sm') : null));
    if (tn && tn.neighbors.size >= 3) {
      const ro = S._rbt = S._rbt || { radius: 20, lanes: 1 };
      box.append(h('details', null, h('summary', null, '⟳ Jadikan bundaran'), h('div', { class: 'grid2' }, ...field('Radius (m)', num(ro.radius, v => ro.radius = Math.max(8, v || 20))), ...field('Lajur lingkar', num(ro.lanes, v => ro.lanes = Math.max(1, Math.min(3, v || 1)), { step: 1 }))),
        btn('Buat bundaran', () => {
          pushUndo();
          try { const r = SW.makeRoundabout(S.net, n.id, ro); const rr = SW.repairRoutes(S.net, S.demand); S.add.crossings = (S.add.crossings || []).filter(c => S.net.edges[c.edge]); S.sel = null; netChanged(); toast(`Bundaran dibuat (${r.nodes.length} lengan${rr.fixed ? ', ' + rr.fixed + ' rute disesuaikan' : ''})`); }
          catch (e) { S.undo.pop(); toast(e.message, 4000); }
        }, 'sm pri')));
    }
    if (tn && tn.conns.length) {
      box.append(h('details', null, h('summary', null, 'Koneksi (link index)'), h('table', null, h('tr', null, h('th', null, '#'), h('th', null, 'dari'), h('th', null, 'ke'), h('th', null, 'arah'), h('th', null, 'mengalah ke')),
        tn.links.map(c => h('tr', null, h('td', null, c.linkIndex), h('td', null, c.from + '_' + c.fromLane), h('td', null, c.to + '_' + c.toLane), h('td', null, { s: 'lurus', l: 'kiri', r: 'kanan', t: 'putar' }[c.dir]), h('td', { class: 'small mut' }, c.yieldTo.map(f => f.linkIndex).join(',')))))));
    }
  } else if (s.kind === 'edge') {
    const e = S.net.edges[s.id]; if (!e) return box;
    const te = topo().edges[s.id];
    const rev = Object.values(S.net.edges).find(r => r.from === e.to && r.to === e.from);
    box.append(h('h3', null, 'Ruas (edge) ', h('span', { class: 'tag' }, e.id)),
      h('div', { class: 'grid2' },
        ...field('Dari → ke', h('span', null, `${e.from} → ${e.to}`)),
        ...field('Lajur', num(e.numLanes, v => { pushUndo(); e.numLanes = Math.max(1, Math.min(8, Math.round(v || 1))); S.net.connections = null; netChanged(); }, { min: 1, max: 8, step: 1 })),
        ...field('Kecepatan (km/j)', num(+kmh(e.speed).toFixed(1), v => { pushUndo(); e.speed = mps(v || 50); netChanged(); })),
        ...field('Prioritas', num(e.priority, v => { pushUndo(); e.priority = v === undefined ? -1 : v; netChanged(); }, { step: 1 })),
        ...field('Nama', txt(e.name, v => { e.name = v; autosave(); })),
        ...field('Level', sel(e.layer || 0, [[2, '▲ Flyover 2'], [1, '▲ Flyover'], [0, 'Permukaan'], [-1, '▼ Underpass'], [-2, '▼ Underpass 2']], v => { pushUndo(); e.layer = +v; delete e.height; if (rev && rev.shape.length === e.shape.length) { rev.layer = +v; delete rev.height; } netChanged(); })),
        ...(e.layer ? [
          ...field('Tinggi (m)', num(SW.edgeHeight(e), v => { pushUndo(); e.height = v; if (rev && rev.layer === e.layer) rev.height = v; netChanged(); })),
          ...field('Tanjakan awal', sel(typeof e.rampIn === 'boolean' ? String(e.rampIn) : 'auto', [['auto', 'otomatis' + (te ? (te.rin ? ' (ya)' : ' (tidak)') : '')], ['true', 'ya'], ['false', 'tidak']], v => { pushUndo(); if (v === 'auto') delete e.rampIn; else e.rampIn = v === 'true'; netChanged(); })),
          ...field('Tanjakan akhir', sel(typeof e.rampOut === 'boolean' ? String(e.rampOut) : 'auto', [['auto', 'otomatis' + (te ? (te.rout ? ' (ya)' : ' (tidak)') : '')], ['true', 'ya'], ['false', 'tidak']], v => { pushUndo(); if (v === 'auto') delete e.rampOut; else e.rampOut = v === 'true'; netChanged(); })),
          ...field('Kelandaian', h('span', null, te && te.elev && te.elev.R ? `${fmt(100 * Math.abs(te.elev.h) / te.elev.R, 1)}% sepanjang ${fmt(te.elev.R, 0)} m` : 'datar (tanpa tanjakan)'))] : []),
        ...field('Panjang', h('span', null, te ? fmt(te.length, 1) + ' m' : '')),
        ...field('Titik geometri', h('span', null, e.shape.length))),
      h('div', { class: 'row' },
        btn('Hapus', deleteSel, 'sm bad'),
        e.shape.length ? btn('Luruskan', () => { pushUndo(); e.shape = []; if (rev) rev.shape = []; netChanged(); }, 'sm') : null,
        !rev ? btn('Tambah arah balik', () => { pushUndo(); SW.addEdge(S.net, e.to, e.from, { id: '-' + e.id, numLanes: e.numLanes, speed: e.speed, priority: e.priority, shape: e.shape.slice().reverse() }); S.net.connections = null; netChanged(); }, 'sm') : btn('Pilih arah balik', () => { S.sel = { kind: 'edge', id: rev.id }; renderPanel(); S.need = true; }, 'sm'),
        btn('Belah di tengah', () => { pushUndo(); const A = S.net.nodes[e.from], B = S.net.nodes[e.to]; const full = [A, ...e.shape, B]; const c = SW.geom.cum(full); const m = SW.geom.posAt(full, c, c[c.length - 1] / 2); const n = SW.splitEdge(S.net, e.id, m); S.sel = { kind: 'node', id: n.id }; netChanged(); }, 'sm')));
  } else if (s.kind === 'veh') box.append(vehInspector(s.id));
  else if (s.kind === 'e1' || s.kind === 'e2') box.append(detInspector(s));
  return box;
}
function vehInspector(id) {
  const box = h('div', { id: 'vehInsp' });
  const sim = S.sim; const v = sim && sim.vehs.get(id);
  if (!v) { box.append(h('div', { class: 'mut' }, `Kendaraan ${id} sudah tiba / tidak ada.`)); return box; }
  const rows = [['Tipe', `${v.typeId} (${v.vt.vClass}, ${v.vt.carFollowModel})`], ['Kecepatan', fmt(kmh(v.v), 1) + ' km/j'], ['Percepatan', fmt(v.a, 2) + ' m/s²'], ['Ruas / lajur', v.kind === 'lane' ? v.seg.id : v.seg.id + ' (internal)'], ['Posisi', fmt(v.pos, 1) + ' m'],
  ['Rute', `${v.ri + 1}/${v.route.length}: ${v.route.join(' ')}`], ['Waktu tunggu', fmt(v.wait, 1) + ' s (total ' + fmt(v.waitTotal, 0) + ')'], ['Time loss', fmt(v.timeLoss, 1) + ' s'], ['Jarak', fmt(v.dist, 0) + ' m'], ['Ketinggian / landai', `${fmt(sim.vehZ(v), 1)} m · ${fmt(100 * sim.gradeOf(v), 1)}%` + (sim.vehLayer(v) ? ` (${SW.LEVEL_NAMES[sim.vehLayer(v)]})` : '')],
  ['CO₂', fmt(v.em.CO2, 1) + ' g'], ['NOx', fmt(v.em.NOx, 2) + ' g'], ['BBM', fmt(v.em.fuel, 0) + ' ml'], v.vt.emissionClass === 'Energy' ? ['Baterai', fmt(v.battery / 1000, 2) + ' kWh (' + fmt(100 * v.battery / (v.vt.batteryCapacity || 35000), 0) + '%)'] : ['Emisi', v.vt.emissionClass]];
  box.append(h('h3', null, 'Kendaraan ', h('span', { class: 'tag' }, v.id)), h('div', { class: 'grid2 small' }, ...rows.flatMap(([a, b]) => [h('label', null, a), h('span', null, b)])),
    h('div', { class: 'row' },
      btn(S.track === v.id ? 'Berhenti ikuti' : 'Ikuti (track)', () => { S.track = S.track === v.id ? null : v.id; renderPanel(); }, 'sm pri'),
      btn('Hapus', () => { sim.arrive(v, 'vaporized'); S.sel = null; renderPanel(); }, 'sm bad'),
      h('span', { class: 'small mut' }, 'setSpeed'), h('input', { type: 'number', style: { width: '70px' }, placeholder: 'km/j', onchange: e => { v.forcedSpeed = e.target.value === '' ? null : mps(+e.target.value); } })));
  return box;
}

/* ---------- Demand panel ---------- */
function panelDemand(p) {
  const d = S.demand;
  p.append(h('h3', null, 'Tipe kendaraan (vType)'));
  const tl = h('div', { class: 'list card' });
  for (const t of Object.values(d.vTypes)) tl.append(h('div', { class: 'it' + (S.selType === t.id ? ' on' : ''), onclick: () => { S.selType = S.selType === t.id ? null : t.id; renderPanel(); } },
    h('span', null, h('i', { style: { display: 'inline-block', width: '10px', height: '10px', background: t.color, borderRadius: '2px', marginRight: '6px' } }), t.id), h('span', { class: 'mut small' }, `${t.vClass} · ${t.carFollowModel} · ${t.emissionClass}`)));
  p.append(tl);
  const newT = S._newT = S._newT || { id: 'type1', vClass: 'passenger' };
  p.append(h('div', { class: 'row' }, txt(newT.id, v => newT.id = v), sel(newT.vClass, Object.keys(SW.VCLASS), v => newT.vClass = v),
    btn('+ Tipe', () => { if (!newT.id || d.vTypes[newT.id]) return toast('ID kosong / sudah ada'); d.vTypes[newT.id] = SW.makeVType(newT.id, newT.vClass); S.selType = newT.id; newT.id = 'type' + (Object.keys(d.vTypes).length); demandChanged(); renderPanel(); }, 'sm')));
  if (S.selType && d.vTypes[S.selType]) p.append(vTypeEditor(d.vTypes[S.selType]));

  p.append(h('h3', null, 'Flow (arus lalu lintas)'));
  const ft = h('table', null, h('tr', null, h('th', null, 'id'), h('th', null, 'tipe'), h('th', null, 'dari → ke'), h('th', null, 'kend/jam'), h('th', null, 'mulai–akhir'), h('th')));
  for (const f of d.flows) {
    ft.append(h('tr', null, h('td', null, f.id), h('td', null, sel(f.type, Object.keys(d.vTypes), v => { f.type = v; demandChanged(); })),
      h('td', { class: 'small' }, f.route ? 'rute ' + f.route : f.edges ? `${f.edges[0]} … ${f.edges[f.edges.length - 1]}` : `${f.from} → ${f.to}`),
      h('td', null, h('input', { type: 'number', style: { width: '64px' }, value: f.vehsPerHour !== undefined ? f.vehsPerHour : f.period ? +(3600 / f.period).toFixed(1) : '', onchange: e => { f.vehsPerHour = +e.target.value; delete f.period; delete f.probability; demandChanged(); } })),
      h('td', { class: 'small' }, h('input', { type: 'number', style: { width: '52px' }, value: f.begin || 0, onchange: e => { f.begin = +e.target.value; demandChanged(); } }), h('input', { type: 'number', style: { width: '58px' }, value: f.end !== undefined ? f.end : '', placeholder: 'end', onchange: e => { f.end = e.target.value === '' ? undefined : +e.target.value; demandChanged(); } })),
      h('td', null, h('button', { class: 'btn sm bad', onclick: () => { d.flows.splice(d.flows.indexOf(f), 1); demandChanged(); renderPanel(); } }, '✕'))));
  }
  p.append(h('div', { style: { overflowX: 'auto' } }, ft));
  const nf = S._nf = S._nf || { from: '', to: '', vph: 300, type: 'DEFAULT_VEHTYPE', begin: 0, end: '' };
  p.append(h('div', { class: 'card' }, h('div', { class: 'grid2' },
    ...field('Dari ruas', edgeSelect(nf.from, v => { nf.from = v; renderPanel(); }, 'dari')),
    ...field('Ke ruas', edgeSelect(nf.to, v => { nf.to = v; renderPanel(); }, 'ke')),
    ...field('Tipe', sel(nf.type, Object.keys(d.vTypes), v => nf.type = v)),
    ...field('Kendaraan/jam', num(nf.vph, v => nf.vph = v)),
    ...field('Mulai / akhir (s)', h('div', { class: 'row', style: { margin: 0, flexWrap: 'nowrap' } }, num(nf.begin, v => nf.begin = v || 0), num(nf.end, v => nf.end = v)))),
    h('div', { class: 'row' }, btn('+ Flow', () => {
      if (!nf.from || !nf.to) return toast('Pilih ruas asal & tujuan');
      if (!SW.route(topo(), nf.from, nf.to)) return toast('Tidak ada rute dari ' + nf.from + ' ke ' + nf.to);
      d.flows.push({ id: uniqueId('f_' + nf.from + '_' + nf.to, d.flows), type: nf.type, from: nf.from, to: nf.to, begin: nf.begin || 0, end: nf.end === '' || nf.end === undefined ? undefined : nf.end, vehsPerHour: nf.vph, departLane: 'best', departSpeed: 'max' });
      demandChanged(); renderPanel();
    }, 'pri'), btn('+ 1 kendaraan', () => {
      if (!nf.from || !nf.to) return toast('Pilih ruas asal & tujuan');
      d.vehicles.push({ id: uniqueId('veh' + d.vehicles.length, d.vehicles), type: nf.type, from: nf.from, to: nf.to, depart: nf.begin || 0 });
      demandChanged(); renderPanel();
    }))));

  p.append(h('h3', null, 'Rute (mode rute NetEdit)'));
  const rb = h('div', { class: 'card' });
  rb.append(h('div', { class: 'row' }, btn(S.mode === 'route' ? '■ Selesai memilih' : '▶ Mulai pilih ruas di peta', () => { S.mode = S.mode === 'route' ? 'inspect' : 'route'; if (S.mode === 'route') S.routeBuild = []; setHint(); renderPanel(); S.need = true; }, S.mode === 'route' ? 'ok' : ''),
    S.routeBuild.length ? btn('Reset', () => { S.routeBuild = []; renderPanel(); S.need = true; }, 'sm') : null),
    h('div', { class: 'small mut', style: { wordBreak: 'break-all' } }, S.routeBuild.length ? S.routeBuild.join(' ') : 'Belum ada ruas dipilih.'));
  if (S.routeBuild.length > 1) {
    const ro = S._ro = S._ro || { id: 'route0', vph: 200, type: 'DEFAULT_VEHTYPE' };
    rb.append(h('div', { class: 'row' }, txt(ro.id, v => ro.id = v), btn('Simpan rute', () => { d.routes[ro.id] = { id: ro.id, edges: S.routeBuild.slice() }; ro.id = 'route' + Object.keys(d.routes).length; demandChanged(); renderPanel(); }, 'sm')),
      h('div', { class: 'row' }, sel(ro.type, Object.keys(d.vTypes), v => ro.type = v), h('input', { type: 'number', style: { width: '80px' }, value: ro.vph, onchange: e => ro.vph = +e.target.value }), h('span', { class: 'small mut' }, 'kend/jam'),
        btn('+ Flow dgn rute ini', () => { d.flows.push({ id: uniqueId('fr', d.flows), type: ro.type, edges: S.routeBuild.slice(), begin: 0, vehsPerHour: ro.vph }); demandChanged(); renderPanel(); }, 'sm pri')));
  }
  const rl = Object.values(d.routes);
  if (rl.length) rb.append(h('div', { class: 'small' }, ...rl.map(r => h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('span', null, h('b', null, r.id), ' ', h('span', { class: 'mut' }, r.edges.length + ' ruas')),
    h('span', null, btn('Tampilkan', () => { S.routeBuild = r.edges.slice(); S.need = true; renderPanel(); }, 'sm'), btn('+Flow', () => { d.flows.push({ id: uniqueId('f_' + r.id, d.flows), type: 'DEFAULT_VEHTYPE', route: r.id, begin: 0, vehsPerHour: 200 }); demandChanged(); renderPanel(); }, 'sm'), btn('✕', () => { delete d.routes[r.id]; demandChanged(); renderPanel(); }, 'sm bad'))))));
  p.append(rb);

  p.append(h('h3', null, 'Perjalanan acak (randomTrips.py)'));
  const rt = S._rt = S._rt || { begin: 0, end: 1800, period: 2, fringe: true, seed: 7 };
  p.append(h('div', { class: 'card' }, h('div', { class: 'grid2' },
    ...field('Mulai / akhir (s)', h('div', { class: 'row', style: { margin: 0, flexWrap: 'nowrap' } }, num(rt.begin, v => rt.begin = v || 0), num(rt.end, v => rt.end = v || 1800))),
    ...field('Periode (-p, s)', num(rt.period, v => rt.period = Math.max(0.1, v || 2))),
    ...field('Seed', num(rt.seed, v => rt.seed = v || 1, { step: 1 }))),
    chk(rt.fringe, 'Hanya dari/ke tepi jaringan (--fringe-factor)', v => rt.fringe = v),
    h('div', { class: 'row' }, btn('Buat perjalanan', () => { const n = SW.randomTrips(topo(), d, { ...rt, prefix: 'rt' + d.vehicles.length + '_' }); demandChanged(); toast(n + ' perjalanan dibuat'); renderPanel(); }, 'pri'),
      h('span', { class: 'small mut' }, `${d.vehicles.length} kendaraan/trip terdaftar`),
      d.vehicles.length ? btn('Hapus semua trip', () => { d.vehicles = []; demandChanged(); renderPanel(); }, 'sm bad') : null)));
}
function vTypeEditor(t) {
  const set = (k, v) => { t[k] = v; demandChanged(); };
  return h('div', { class: 'card' }, h('div', { class: 'grid2' },
    ...field('vClass', sel(t.vClass, Object.keys(SW.VCLASS), v => { const nt = SW.makeVType(t.id, v); Object.assign(t, nt); demandChanged(); renderPanel(); })),
    ...field('Model car-following', sel(t.carFollowModel, ['Krauss', 'IDM'], v => set('carFollowModel', v))),
    ...field('Panjang (m)', num(t.length, v => set('length', v))),
    ...field('minGap (m)', num(t.minGap, v => set('minGap', v))),
    ...field('accel (m/s²)', num(t.accel, v => set('accel', v))),
    ...field('decel (m/s²)', num(t.decel, v => set('decel', v))),
    ...field('sigma (0–1)', num(t.sigma, v => set('sigma', v), { min: 0, max: 1 })),
    ...field('tau (s)', num(t.tau, v => set('tau', v))),
    ...field('maxSpeed (km/j)', num(+kmh(t.maxSpeed).toFixed(1), v => set('maxSpeed', mps(v)))),
    ...field('speedFactor / dev', h('div', { class: 'row', style: { margin: 0, flexWrap: 'nowrap' } }, num(t.speedFactor, v => set('speedFactor', v)), num(t.speedDev, v => set('speedDev', v)))),
    ...field('lcSpeedGain', num(t.lcSpeedGain, v => set('lcSpeedGain', v), { min: 0 })),
    ...field('lcKeepRight', num(t.lcKeepRight, v => set('lcKeepRight', v), { min: 0 })),
    ...field('Kelas emisi', sel(t.emissionClass, SW.EMISSION_CLASSES, v => set('emissionClass', v))),
    ...field('Massa (kg)', num(t.mass, v => set('mass', v))),
    ...(t.emissionClass === 'Energy' ? field('Baterai (Wh)', num(t.batteryCapacity || 35000, v => set('batteryCapacity', v))) : []),
    ...field('Warna', h('input', { type: 'color', value: t.color, onchange: e => set('color', e.target.value) }))),
    t.id !== 'DEFAULT_VEHTYPE' ? btn('Hapus tipe', () => { delete S.demand.vTypes[t.id]; S.selType = null; demandChanged(); renderPanel(); }, 'sm bad') : null);
}

/* ---------- Traffic light panel ---------- */
const STATE_CYCLE = ['G', 'g', 'y', 'r', 'u', 'o', 's'];
function selectedProgram() {
  if (!S.sel || S.sel.kind !== 'node' || !S.net.nodes[S.sel.id]) return null;
  const n = S.net.nodes[S.sel.id];
  return n.type === 'traffic_light' ? (n.tl || n.id) : null;
}
function panelTLS(p) {
  const T = topo();
  p.append(h('h3', null, 'Program lampu lalu lintas'));
  const list = h('div', { class: 'list card' });
  for (const id of T.tlsNodes) {
    const pr = T.tlsPrograms[id], prog = S.net.tls[id];
    list.append(h('div', { class: 'it' + (S.selPid === id ? ' on' : ''), onclick: () => { S.sel = { kind: 'node', id: pr.nodes[0] }; S.selPid = id; S.selPhase = 0; renderPanel(); S.need = true; } },
      h('span', null, id, pr.nodes.length > 1 ? h('span', { class: 'tag' }, 'gabungan ' + pr.nodes.length + ' simpang') : null),
      h('span', { class: 'small mut' }, `${prog.type} · ${prog.phases.length} fase`)));
  }
  if (!T.tlsNodes.length) list.append(h('div', { class: 'mut small' }, 'Belum ada. Ketuk persimpangan di peta lalu jadikan traffic_light.'));
  p.append(list);
  const s = S.sel;
  if (!s || s.kind !== 'node' || !S.net.nodes[s.id]) return;
  const n = S.net.nodes[s.id];
  if (n.type !== 'traffic_light') {
    p.append(h('div', { class: 'card' }, `Simpul ${n.id} bertipe ${n.type}. `, btn('Jadikan lampu lalu lintas', () => { pushUndo(); n.type = 'traffic_light'; netChanged(true); renderPanel(); }, 'pri sm')));
    return;
  }
  const pid = n.tl || n.id; S.selPid = pid;
  const prog = S.net.tls[pid], pr = T.tlsPrograms[pid];
  if (!prog || !pr) return;
  const live = S.sim && S.sim.tls[pid];
  const box = h('div', { class: 'card' });
  box.append(h('div', { class: 'grid2' },
    ...field('Program', h('span', null, pid + (pr.nodes.length > 1 ? ` (simpang ${pr.nodes.join(', ')})` : ''))),
    ...field('Tipe', sel(prog.type, [['static', 'static (waktu tetap)'], ['actuated', 'actuated (aktuasi)'], ['rl', 'RL (Q-learning)']], v => { pushUndo(); prog.type = v; if (v === 'actuated') prog.phases.forEach(ph => { if (/[Gg]/.test(ph.state)) { ph.minDur = ph.minDur || 5; ph.maxDur = ph.maxDur || 50; } }); demandChanged(); renderPanel(); })),
    ...field('Offset (s)', num(prog.offset || 0, v => { prog.offset = v || 0; demandChanged(); })),
    ...field('Siklus', h('span', null, prog.phases.reduce((a, q) => a + q.duration, 0) + ' s'))),
    live ? h('div', { class: 'small', id: 'tlsLive' }, `Live: fase ${live.phase}`) : null);
  const tbl = h('table', null, h('tr', null, h('th', null, '#'), h('th', null, 'durasi'), h('th', null, 'state (ketuk huruf untuk ganti)'), prog.type === 'actuated' ? h('th', null, 'min/max') : null, h('th')));
  prog.phases.forEach((ph, i) => {
    const stateEl = h('span', { class: 'state' }, ...[...ph.state].map((c, k) => h('span', { class: 'ch ' + c, title: 'link ' + k, onclick: ev => { ev.stopPropagation(); const nc = STATE_CYCLE[(STATE_CYCLE.indexOf(c) + 1) % STATE_CYCLE.length]; ph.state = ph.state.slice(0, k) + nc + ph.state.slice(k + 1); demandChanged(); renderPanel(); } }, c)));
    tbl.append(h('tr', { style: { background: (S.selPhase === i ? '#2a3342' : (live && live.phase === i ? '#1f3326' : '')) }, onclick: () => { S.selPhase = i; S.need = true; renderPanel(); } },
      h('td', null, i), h('td', null, h('input', { type: 'number', style: { width: '54px' }, value: ph.duration, onchange: e => { ph.duration = Math.max(0.5, +e.target.value); demandChanged(); } })),
      h('td', null, stateEl),
      prog.type === 'actuated' ? h('td', null, h('input', { type: 'number', style: { width: '42px' }, value: ph.minDur !== undefined ? ph.minDur : '', onchange: e => { ph.minDur = +e.target.value; demandChanged(); } }), h('input', { type: 'number', style: { width: '42px' }, value: ph.maxDur !== undefined ? ph.maxDur : '', onchange: e => { ph.maxDur = +e.target.value; demandChanged(); } })) : null,
      h('td', null, h('button', { class: 'btn sm', title: 'Duplikat', onclick: ev => { ev.stopPropagation(); prog.phases.splice(i + 1, 0, { ...ph }); demandChanged(); renderPanel(); } }, '⎘'), h('button', { class: 'btn sm bad', onclick: ev => { ev.stopPropagation(); if (prog.phases.length < 2) return; prog.phases.splice(i, 1); S.selPhase = 0; demandChanged(); renderPanel(); } }, '✕'))));
  });
  box.append(h('div', { style: { overflowX: 'auto' } }, tbl),
    h('div', { class: 'row' }, btn('Atur ulang default', () => { pushUndo(); S.net.tls[pid] = SW.defaultTLS(pr, T, prog.type === 'rl' ? 'static' : prog.type); demandChanged(); renderPanel(); S.need = true; }, 'sm'),
      btn('+ fase belok terlindung', () => { pushUndo(); addProtectedLeft(prog); demandChanged(); renderPanel(); }, 'sm'),
      btn('Semua merah', () => { prog.phases.push({ duration: 2, state: 'r'.repeat(pr.links.length) }); demandChanged(); renderPanel(); }, 'sm')),
    chk(S.labels.links, 'Tampilkan nomor link di peta', v => { S.labels.links = v; S.need = true; }),
    h('div', { class: 'legend' }, ...[['G', 'hijau prioritas'], ['g', 'hijau mengalah'], ['y', 'kuning'], ['r', 'merah'], ['u', 'merah-kuning'], ['o', 'mati (kedip)'], ['s', 'stop']].map(([c, l]) => h('span', null, h('span', { class: 'ch ' + c }, c), ' ' + l))));
  box.append(h('details', null, h('summary', null, 'Daftar link'), h('table', null, pr.links.map(c => h('tr', null, h('td', null, c.tlIndex), h('td', null, c.node), h('td', null, `${c.from}_${c.fromLane} → ${c.to}_${c.toLane}`), h('td', null, c.dir))))));
  p.append(box);
  // joined programs
  p.append(h('h3', null, 'Gabungkan beberapa simpang (satu program)'));
  const jb = h('div', { class: 'card' });
  if (pr.nodes.length > 1) jb.append(h('div', { class: 'small' }, `Program ${pid} mengendalikan simpang: ${pr.nodes.join(', ')}.`), btn('Pisahkan menjadi program terpisah', () => { pushUndo(); SW.splitTLS(S.net, pid); netChanged(); toast('Program dipisahkan'); }, 'sm'));
  const others = Object.values(S.net.nodes).filter(x => x.type === 'traffic_light' && (x.tl || x.id) !== pid);
  const near = others.map(x => ({ x, d: Math.hypot(x.x - n.x, x.y - n.y) })).sort((a, b) => a.d - b.d).slice(0, 8);
  S._join = S._join || new Set();
  if (near.length) {
    jb.append(h('div', { class: 'small mut' }, 'Pilih simpang bersinyal lain yang harus berjalan dengan satu siklus (mis. simpang ganda di bawah flyover):'),
      ...near.map(({ x, d }) => chk(S._join.has(x.id), `${x.id} (${Math.round(d)} m)`, v => { if (v) S._join.add(x.id); else S._join.delete(x.id); })),
      h('div', { class: 'row' }, btn('Gabungkan', () => {
        const extra = [...S._join]; if (!extra.length) return toast('Centang minimal satu simpang');
        pushUndo(); const nodes = [...pr.nodes, ...extra.flatMap(id => { const q = S.net.nodes[id]; const qp = q.tl || q.id; return Object.values(S.net.nodes).filter(z => (z.tl || z.id) === qp).map(z => z.id); })];
        const id = SW.joinTLS(S.net, [...new Set(nodes)], 'TL_' + [...new Set(nodes)].sort().join('_').slice(0, 40));
        S._join.clear(); netChanged(); toast('Program gabungan ' + id + ' dibuat (fase default per sumbu jalan)');
      }, 'sm pri')));
  } else jb.append(h('div', { class: 'small mut' }, 'Tidak ada simpang bersinyal lain.'));
  p.append(jb);
  // reinforcement learning
  p.append(h('h3', null, 'Pelatihan RL (Part 8)'));
  const rb = h('div', { class: 'card' });
  const ro = S._rl = S._rl || { episodes: 25, horizon: 1800, minGreen: 10, maxGreen: 60 };
  rb.append(h('div', { class: 'small mut' }, 'Q-learning tabel: agen memutuskan tiap 5 detik apakah hijau diteruskan atau diakhiri, dengan imbalan = −jumlah kendaraan berhenti. Pelatihan menjalankan skenario berulang kali tanpa tampilan.'),
    h('div', { class: 'grid2' }, ...field('Episode', num(ro.episodes, v => ro.episodes = Math.max(2, v || 25), { step: 1 })), ...field('Durasi episode (s)', num(ro.horizon, v => ro.horizon = Math.max(300, v || 1800))),
      ...field('Hijau min/max (s)', h('div', { class: 'row', style: { margin: 0, flexWrap: 'nowrap' } }, num(ro.minGreen, v => ro.minGreen = v || 10), num(ro.maxGreen, v => ro.maxGreen = v || 60)))),
    h('div', { class: 'row' }, h('button', { class: 'btn pri', id: 'rlBtn', onclick: () => trainRLUI(pid) }, '▶ Latih RL untuk program ini'), btn('Bandingkan tetap / aktuasi / RL', () => evalTLSUI(pid), 'sm')),
    h('canvas', { class: 'chart', id: 'rlChart', style: { height: '120px', display: S._rlCurve ? 'block' : 'none' } }), h('div', { class: 'small', id: 'rlOut' }, S._rlMsg || ''));
  p.append(rb);
  if (S._rlCurve) requestAnimationFrame(() => { const c = $('rlChart'); if (c) lineChart(c, [{ data: S._rlCurve.map(x => [x.episode, x.meanTimeLoss]), color: '#2ecc71' }]); });
}
async function trainRLUI(pid) {
  const ro = S._rl, b = $('rlBtn'); if (b) b.disabled = true;
  stopSim(); pushUndo();
  const curve = [];
  try {
    await SW.trainRL(S.net, S.demand, S.add, S.cfg, {
      programs: [pid], episodes: ro.episodes, horizon: ro.horizon, minGreen: ro.minGreen, maxGreen: ro.maxGreen, reset: true,
      onProgress: async c => { curve.push(c); S._rlCurve = curve; const o = $('rlOut'); if (o) o.textContent = `Episode ${c.episode}/${ro.episodes} · ε=${c.eps.toFixed(2)} · tundaan rata-rata ${c.meanTimeLoss.toFixed(1)} s · ${c.states} keadaan`; const ch = $('rlChart'); if (ch) { ch.style.display = 'block'; lineChart(ch, [{ data: curve.map(x => [x.episode, x.meanTimeLoss]), color: '#2ecc71' }]); } await new Promise(r => setTimeout(r, 0)); }
    });
    S._rlMsg = `Selesai: program ${pid} kini bertipe RL. Grafik = tundaan rata-rata per episode (s).`;
    demandChanged(); toast('Pelatihan RL selesai');
  } catch (e) { toast('Gagal: ' + e.message); }
  if (b) b.disabled = false; renderPanel();
}
function evalTLSUI(pid) {
  const o = $('rlOut'); if (o) o.textContent = 'Mengevaluasi…';
  setTimeout(() => {
    const H = S._rl.horizon, res = [];
    for (const type of ['static', 'actuated', 'rl']) {
      const net = JSON.parse(JSON.stringify(S.net)); const pr = net.tls[pid];
      if (type === 'rl' && !(pr.rl && Object.keys(pr.rl.q || {}).length)) { res.push([type, null]); continue; }
      pr.type = type; if (type === 'actuated') pr.phases.forEach(ph => { if (/[Gg]/.test(ph.state)) { ph.minDur = ph.minDur || 5; ph.maxDur = ph.maxDur || 50; } });
      res.push([type, SW.evalTLS(net, S.demand, S.add, Object.assign({}, S.cfg, { seed: (S.cfg.seed || 1) + 1000 }), H)]);
    }
    S._rlMsg = 'Evaluasi (' + H + ' s, seed berbeda dari pelatihan): ' + res.map(([t, r]) => `${t}: ${r ? `tundaan ${r.meanTimeLoss.toFixed(1)} s, tunggu ${r.meanWait.toFixed(1)} s, tiba ${r.arrived}` : 'belum dilatih'}`).join(' · ');
    renderPanel();
  }, 30);
}
function addProtectedLeft(prog) {
  // insert a protected phase for permissive (yielding) turns before every green phase that has them
  const out = [];
  for (const ph of prog.phases) {
    if (ph.state.includes('g')) {
      const lst = [...ph.state].map(c => c === 'g' ? 'G' : 'r').join('');
      out.push({ duration: 8, state: lst, minDur: 4, maxDur: 15 }, { duration: 3, state: lst.replace(/G/g, 'y') });
    }
    out.push(ph);
  }
  prog.phases = out;
}

/* ---------- Facilities: bus stops, public transport lines, pedestrian crossings ---------- */
function facClick(wx, wy) {
  const hit = hitTest(wx, wy, ['busStop', 'crossing']);
  if (hit) { S.sel = hit; renderPanel(); S.need = true; return; }
  const tool = S.facTool || 'halte';
  const T = topo();
  if (tool === 'halte') {
    const hl = hitTest(wx, wy, ['lane']); if (!hl) return;
    const L = T.lanes[hl.lane]; const s0 = Math.max(0, Math.min(L.length - 20, hl.s - 10));
    pushUndo(); S.add.busStops = S.add.busStops || [];
    const id = uniqueId('halte_' + L.edge.id, S.add.busStops);
    S.add.busStops.push({ id, lane: L.id, startPos: +s0.toFixed(1), endPos: +Math.min(L.length - 0.5, s0 + 20).toFixed(1), name: 'Halte ' + (L.edge.e.name || L.edge.id), lines: '' });
    S.sel = { kind: 'busStop', id };
  } else {
    const he = hitTest(wx, wy, ['edge']); if (!he) return;
    const te = T.edges[he.id];
    let pos = SW.geom.distToPoly({ x: wx, y: wy }, te.center).s;
    if (tool === 'tls') { if (S.net.nodes[te.to].type !== 'traffic_light') return toast('Penyeberangan "ikut lampu" harus di ruas yang masuk ke simpang bersinyal'); pos = te.length - 3; }
    pushUndo(); S.add.crossings = S.add.crossings || [];
    const id = uniqueId(tool + '_' + te.id, S.add.crossings);
    S.add.crossings.push({ id, edge: te.id, pos: +pos.toFixed(1), type: tool, pedPerHour: 200, compliance: 0.5, minVehGreen: 30, walk: 10, width: 4 });
    S.sel = { kind: 'crossing', id };
  }
  demandChanged(); renderPanel();
}
function panelFac(p) {
  const tool = S.facTool || 'halte';
  p.append(h('h3', null, 'Alat (ketuk peta)'), h('div', { class: 'row' },
    ...[['halte', '🚏 Halte'], ['zebra', 'Zebra cross'], ['pelican', 'Pelican (tombol)'], ['tls', 'Ikut lampu simpang']].map(([k, l]) => btn(l, () => { S.facTool = k; renderPanel(); setHint(); }, tool === k ? 'pri sm' : 'sm'))),
  h('div', { class: 'small mut' }, { halte: 'Ketuk lajur paling tepi untuk menaruh halte (panjang 20 m).', zebra: 'Zebra: pejalan menunggu celah; pengemudi berhenti sesuai tingkat kepatuhan.', pelican: 'Pelican: pejalan menekan tombol, kendaraan mendapat merah setelah hijau minimum.', tls: 'Ikut lampu: pejalan menyeberang saat arus dari ruas itu merah; kendaraan berbelok wajib mengalah.' }[tool]));
  const s = S.sel;
  if (s && s.kind === 'busStop') {
    const b = S.add.busStops.find(x => x.id === s.id);
    if (b) p.append(h('div', { class: 'card' }, h('h3', null, 'Halte ', h('span', { class: 'tag' }, b.id)), h('div', { class: 'grid2' },
      ...field('Nama', txt(b.name, v => { b.name = v; demandChanged(); })), ...field('Lajur', h('span', null, b.lane)),
      ...field('Awal / akhir (m)', h('div', { class: 'row', style: { margin: 0, flexWrap: 'nowrap' } }, num(b.startPos, v => { b.startPos = v || 0; demandChanged(); S.need = true; }), num(b.endPos, v => { b.endPos = v || 20; demandChanged(); S.need = true; }))),
      ...field('Trayek', txt(b.lines, v => { b.lines = v; demandChanged(); }))), btn('Hapus', deleteSel, 'sm bad')));
  }
  if (s && s.kind === 'crossing') {
    const c = S.add.crossings.find(x => x.id === s.id);
    if (c) p.append(h('div', { class: 'card' }, h('h3', null, 'Penyeberangan ', h('span', { class: 'tag' }, c.id)), h('div', { class: 'grid2' },
      ...field('Jenis', sel(c.type, [['zebra', 'zebra cross'], ['pelican', 'pelican (tombol)'], ['tls', 'ikut lampu simpang']], v => { c.type = v; demandChanged(); renderPanel(); S.need = true; })),
      ...field('Posisi (m)', num(c.pos, v => { c.pos = v || 0; demandChanged(); S.need = true; })),
      ...field('Lebar (m)', num(c.width || 4, v => { c.width = Math.max(2, v || 4); demandChanged(); S.need = true; })),
      ...field('Pejalan / jam', num(c.pedPerHour, v => { c.pedPerHour = Math.max(0, v || 0); demandChanged(); })),
      ...(c.type === 'zebra' ? field('Kepatuhan pengemudi (0–1)', num(c.compliance, v => { c.compliance = Math.max(0, Math.min(1, v === undefined ? 0.5 : v)); demandChanged(); }, { step: 0.1, min: 0, max: 1 })) : []),
      ...(c.type === 'pelican' ? [...field('Hijau kendaraan min (s)', num(c.minVehGreen, v => { c.minVehGreen = v || 30; demandChanged(); })), ...field('Waktu jalan pejalan (s)', num(c.walk, v => { c.walk = v || 10; demandChanged(); }))] : [])),
      btn('Hapus', deleteSel, 'sm bad')));
  }
  // lists
  p.append(h('h3', null, `Halte (${(S.add.busStops || []).length}) & penyeberangan (${(S.add.crossings || []).length})`));
  const L = h('div', { class: 'list card' });
  for (const b of S.add.busStops || []) L.append(h('div', { class: 'it', onclick: () => { S.sel = { kind: 'busStop', id: b.id }; renderPanel(); S.need = true; } }, h('span', null, '🚏 ' + (b.name || b.id)), h('span', { class: 'small mut' }, b.lane)));
  for (const c of S.add.crossings || []) L.append(h('div', { class: 'it', onclick: () => { S.sel = { kind: 'crossing', id: c.id }; renderPanel(); S.need = true; } }, h('span', null, '🚶 ' + c.id), h('span', { class: 'small mut' }, `${c.type} · ${c.pedPerHour}/jam`)));
  if (!L.children.length) L.append(h('div', { class: 'small mut' }, 'Belum ada.'));
  p.append(L);
  // public transport line builder
  p.append(h('h3', null, 'Trayek angkutan umum'));
  const lb = h('div', { class: 'card' });
  const lo = S._line = S._line || { id: 'trayek1', type: 'bus', headway: 10, dwell: 20, stops: {} };
  const route = S.routeBuild.length > 1 ? S.routeBuild : null;
  lb.append(h('div', { class: 'small mut' }, route ? `Rute dipilih: ${route.length} ruas (${route[0]} … ${route[route.length - 1]}).` : 'Pilih rute dulu di tab Demand › Rute (ketuk ruas berurutan), lalu kembali ke sini.'),
    h('div', { class: 'row' }, btn('Pilih rute di peta', () => { setTab('demand'); S.mode = 'route'; S.routeBuild = []; setHint(); renderPanel(); }, 'sm')));
  if (route) {
    const onRoute = (S.add.busStops || []).filter(b => route.includes(topo().lanes[b.lane] ? topo().lanes[b.lane].edge.id : '')).sort((a, b) => route.indexOf(topo().lanes[a.lane].edge.id) - route.indexOf(topo().lanes[b.lane].edge.id) || a.endPos - b.endPos);
    if (!S.demand.vTypes.angkot) S.demand.vTypes.angkot = SW.makeVType('angkot', 'angkot');
    if (!S.demand.vTypes.bus) S.demand.vTypes.bus = SW.makeVType('bus', 'bus');
    lb.append(h('div', { class: 'grid2' }, ...field('ID trayek', txt(lo.id, v => lo.id = v)), ...field('Kendaraan', sel(lo.type, Object.keys(S.demand.vTypes), v => lo.type = v)),
      ...field('Selang waktu (menit)', num(lo.headway, v => lo.headway = Math.max(0.5, v || 10))), ...field('Henti di halte (s)', num(lo.dwell, v => lo.dwell = Math.max(1, v || 20)))),
    onRoute.length ? h('div', null, h('div', { class: 'small mut' }, 'Halte yang dilalui:'), ...onRoute.map(b => chk(lo.stops[b.id] !== false, b.name || b.id, v => { lo.stops[b.id] = v; }))) : h('div', { class: 'small mut' }, 'Tidak ada halte pada rute ini.'),
    btn('+ Buat trayek', () => {
      const stops = onRoute.filter(b => lo.stops[b.id] !== false).map(b => ({ busStop: b.id, duration: lo.dwell }));
      S.demand.flows.push({ id: uniqueId(lo.id, S.demand.flows), type: lo.type, edges: route.slice(), begin: 0, period: lo.headway * 60, stops });
      demandChanged(); toast(`Trayek dibuat: tiap ${lo.headway} menit, ${stops.length} halte`); renderPanel();
    }, 'pri sm'));
  }
  const lines = S.demand.flows.filter(f => f.stops && f.stops.length);
  if (lines.length) lb.append(h('div', { class: 'small' }, ...lines.map(f => h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('span', null, h('b', null, f.id), ` · ${f.type} · tiap ${fmt((f.period || 3600 / (f.vehsPerHour || 1)) / 60, 1)} mnt · ${f.stops.length} halte`), btn('✕', () => { S.demand.flows.splice(S.demand.flows.indexOf(f), 1); demandChanged(); renderPanel(); }, 'sm bad')))));
  p.append(lb);
}

/* ---------- Detector panel ---------- */
function panelDet(p) {
  p.append(h('h3', null, 'Alat'), h('div', { class: 'row' },
    btn('E1 – Induction loop', () => { S.detTool = 'e1'; renderPanel(); setHint(); }, S.detTool === 'e1' ? 'pri' : ''),
    btn('E2 – Lane area', () => { S.detTool = 'e2'; renderPanel(); setHint(); }, S.detTool === 'e2' ? 'pri' : '')),
    chk(S.labels.det, 'Tampilkan detektor', v => { S.labels.det = v; S.need = true; }));
  if (S.sel && (S.sel.kind === 'e1' || S.sel.kind === 'e2')) p.append(h('div', { class: 'card' }, detInspector(S.sel)));
  p.append(h('h3', null, 'Daftar detektor'));
  const tbl = h('table', { id: 'detTable' });
  tbl.append(h('tr', null, h('th', null, 'id'), h('th', null, 'lajur'), h('th', null, 'pos'), h('th', null, 'live')));
  const live = id => { if (!S.sim) return '–'; const a = S.sim.e1.find(x => x.d.id === id); if (a) return `${a.acc.n} kend · ${fmt(a.last.occ, 0)}%`; const b = S.sim.e2.find(x => x.d.id === id); if (b) return `${b.last.n} kend · macet ${fmt(b.last.jamM, 0)} m`; return '–'; };
  for (const d of [...S.add.e1.map(x => ['e1', x]), ...S.add.e2.map(x => ['e2', x])]) tbl.append(h('tr', { onclick: () => { S.sel = { kind: d[0], id: d[1].id }; renderPanel(); S.need = true; }, style: { cursor: 'pointer' } }, h('td', null, d[1].id, h('span', { class: 'tag' }, d[0].toUpperCase())), h('td', null, d[1].lane), h('td', null, fmt(d[1].pos, 1)), h('td', { class: 'small', 'data-live': d[1].id }, live(d[1].id))));
  p.append(tbl);
  if (!S.add.e1.length && !S.add.e2.length) p.append(h('div', { class: 'mut small' }, 'Belum ada detektor. Ketuk lajur di peta.'));
}
function detInspector(s) {
  const list = s.kind === 'e1' ? S.add.e1 : S.add.e2, d = list.find(x => x.id === s.id);
  const box = h('div'); if (!d) return box;
  const L = topo().lanes[d.lane];
  box.append(h('h3', null, s.kind === 'e1' ? 'Induction loop (E1) ' : 'Lane area detector (E2) ', h('span', { class: 'tag' }, d.id)), h('div', { class: 'grid2' },
    ...field('Lajur', h('span', null, d.lane + (L ? ` (${fmt(L.length, 1)} m)` : ''))),
    ...field('Posisi (m)', num(d.pos, v => { d.pos = Math.max(0, Math.min(L ? L.length : 1e9, v || 0)); demandChanged(); })),
    ...(s.kind === 'e2' ? field('Panjang (m)', num(d.length, v => { d.length = Math.max(1, v || 10); demandChanged(); })) : []),
    ...field('Periode (s)', num(d.period, v => { d.period = v || 60; demandChanged(); }))),
    btn('Hapus', () => { S.sel = s; deleteSel(); }, 'sm bad'));
  return box;
}

/* ---------- Simulation panel ---------- */
function panelSim(p) {
  const c = S.cfg;
  p.append(h('h3', null, 'Statistik live'), h('div', { class: 'stat', id: 'liveStats' }));
  p.append(h('h3', null, 'Konfigurasi (.sumocfg)'), h('div', { class: 'grid2' },
    ...field('begin (s)', num(c.begin, v => { c.begin = v || 0; demandChanged(); })),
    ...field('end (s)', num(c.end, v => { c.end = v || 3600; demandChanged(); })),
    ...field('step-length (s)', sel(c.stepLength, [0.1, 0.2, 0.25, 0.5, 1], v => { c.stepLength = +v; $('stepLen').value = v; demandChanged(); })),
    ...field('seed', num(c.seed, v => { c.seed = v || 1; demandChanged(); }, { step: 1 })),
    ...field('time-to-teleport (s)', num(c.timeToTeleport, v => { c.timeToTeleport = v || 0; demandChanged(); })),
    ...field('Periode agregasi (s)', num(c.period, v => { c.period = Math.max(1, v || 60); demandChanged(); })),
    ...field('Pemanasan / warm-up (s)', num(c.warmup || 0, v => { c.warmup = Math.max(0, v || 0); demandChanged(); }))),
    chk(c.sublane !== false, 'Model sublane: sepeda motor menyelip & berjajar dalam lajur', v => { c.sublane = v; demandChanged(); }));
  p.append(h('h3', null, 'Bandingkan skenario berdampingan'), compareBox());
  p.append(h('h3', null, 'Tampilan (sumo-gui)'), h('div', { class: 'grid2' },
    ...field('Warna kendaraan', sel(S.colorVeh, [['type', 'per tipe / warna'], ['speed', 'kecepatan'], ['waiting', 'waktu tunggu'], ['accel', 'akselerasi'], ['co2', 'emisi CO₂'], ['route', 'asal-tujuan'], ['battery', 'baterai (EV)']], v => { S.colorVeh = v; S.need = true; })),
    ...field('Warna ruas', sel(S.colorEdge, [['none', 'tidak ada'], ['speed', 'kecepatan rata-rata'], ['density', 'kepadatan'], ['halting', 'kendaraan berhenti'], ['co2', 'emisi CO₂']], v => { S.colorEdge = v; S.need = true; })),
    ...field('Ikuti kendaraan', sel(S.track || '', [['', '—'], ...(S.sim ? [...S.sim.vehs.keys()].slice(0, 300) : [])], v => { S.track = v || null; }))),
    h('div', { class: 'row' }, chk(S.labels.edges, 'ID ruas', v => { S.labels.edges = v; S.need = true; }), chk(S.labels.nodes, 'ID simpul', v => { S.labels.nodes = v; S.need = true; }), chk(S.labels.veh, 'ID kendaraan', v => { S.labels.veh = v; S.need = true; }), chk(S.labels.links, 'Link index', v => { S.labels.links = v; S.need = true; })));
  if (S.sel && S.sel.kind === 'veh') p.append(h('div', { class: 'card' }, vehInspector(S.sel.id)));
  p.append(h('h3', null, 'Pesan'), h('pre', { class: 'console', id: 'simMsgs' }, S.sim ? S.sim.messages.slice(-30).map(m => `[${fmt(m.t, 1)}] ${m.m}`).join('\n') || 'Tidak ada peringatan.' : 'Simulasi belum dimulai.'));
  updateLive();
}
function updateLive() {
  const el = $('liveStats'); if (!el) return;
  const sim = S.sim; const s = sim && sim.lastSummary;
  const items = [['Waktu', sim ? fmt(sim.t, 1) + ' s' : '0'], ['Berjalan', s ? s.running : 0], ['Berangkat', sim ? sim.departed : 0], ['Tiba', sim ? sim.arrived.length : 0], ['Antre masuk', sim ? sim.waitingInsert.length : 0], ['Berhenti', s ? s.halting : 0],
  ['Kec. rata-rata', s ? fmt(kmh(s.meanSpeed), 1) + ' km/j' : '–'], ['Teleport', sim ? sim.teleports : 0], ['CO₂ total', sim ? fmt(sim.totals.CO2 / 1000, 2) + ' kg' : '–'], ['BBM total', sim ? fmt(sim.totals.fuel / 1000, 2) + ' L' : '–'], ['Listrik', sim ? fmt(sim.totals.elec / 1000, 2) + ' kWh' : '–'], ['NOx total', sim ? fmt(sim.totals.NOx, 1) + ' g' : '–']];
  el.innerHTML = ''; for (const [a, b] of items) el.append(h('div', null, h('b', null, b), h('span', null, a)));
}

/* ---------- Output panel ---------- */
function panelOut(p) {
  const sim = S.sim;
  if (!sim) { p.append(h('div', { class: 'mut' }, 'Jalankan simulasi untuk melihat output.')); return; }
  if (typeof SV !== 'undefined' && SV.on && SV.user) p.append(h('div', { class: 'row' }, btn('⬆ Simpan hasil ini ke server', () => { setTab('proj'); svSaveRun(); }, 'sm pri'), SV.project ? h('span', { class: 'small mut' }, `${SV.project.name} v${SV.version}`) : h('span', { class: 'small mut' }, 'simpan proyek dulu di tab Proyek')));
  p.append(h('h3', null, 'Ringkasan (summary-output)'));
  const c1 = h('canvas', { class: 'chart' }), c2 = h('canvas', { class: 'chart' }), c3 = h('canvas', { class: 'chart' });
  p.append(c1, h('div', { class: 'legend' }, h('span', null, h('i', { style: { background: '#4f9dff' } }), 'berjalan'), h('span', null, h('i', { style: { background: '#eb5757' } }), 'berhenti')),
    c2, h('div', { class: 'legend' }, h('span', null, h('i', { style: { background: '#2ecc71' } }), 'kecepatan rata-rata (km/j)')),
    c3, h('div', { class: 'legend' }, h('span', null, h('i', { style: { background: '#f2994a' } }), 'CO₂ kumulatif (kg)')));
  const sm = sim.summary;
  requestAnimationFrame(() => {
    lineChart(c1, [{ data: sm.map(s => [s.t, s.running]), color: '#4f9dff' }, { data: sm.map(s => [s.t, s.halting]), color: '#eb5757' }]);
    lineChart(c2, [{ data: sm.map(s => [s.t, kmh(s.meanSpeed)]), color: '#2ecc71' }]);
    lineChart(c3, [{ data: sm.map(s => [s.t, s.co2 / 1000]), color: '#f2994a' }]);
  });
  // tripinfo
  const ti = sim.tripinfo;
  p.append(h('h3', null, `Tripinfo (${ti.length} perjalanan selesai)`));
  if (ti.length) {
    const by = {};
    for (const r of ti) { const b = by[r.type] = by[r.type] || { n: 0, dur: 0, wait: 0, loss: 0, len: 0, co2: 0, fuel: 0, elec: 0 }; b.n++; b.dur += r.duration; b.wait += r.waitingTime; b.loss += r.timeLoss; b.len += r.routeLength; b.co2 += r.CO2; b.fuel += r.fuel; b.elec += r.elec; }
    const tbl = h('table', null, h('tr', null, h('th', null, 'tipe'), h('th', null, 'n'), h('th', null, 'durasi'), h('th', null, 'tunggu'), h('th', null, 'timeLoss'), h('th', null, 'CO₂/km'), h('th', null, 'energi/km')));
    for (const [k, b] of Object.entries(by)) tbl.append(h('tr', null, h('td', null, k), h('td', null, b.n), h('td', null, fmt(b.dur / b.n, 1)), h('td', null, fmt(b.wait / b.n, 1)), h('td', null, fmt(b.loss / b.n, 1)), h('td', null, fmt(b.co2 / Math.max(1, b.len / 1000), 0) + ' g'), h('td', null, b.elec > 0 ? fmt(b.elec / Math.max(1, b.len / 1000), 0) + ' Wh' : fmt(b.fuel / Math.max(1, b.len / 1000), 0) + ' ml')));
    p.append(h('div', { style: { overflowX: 'auto' } }, tbl), h('div', { class: 'small mut' }, 'Satuan rata-rata per kendaraan dalam detik.'));
  }
  // detectors
  if (sim.e1.length || sim.e2.length) {
    p.append(h('h3', null, 'Detektor (interval ' + S.cfg.period + ' s)'));
    for (const d of sim.e1) {
      const cv2 = h('canvas', { class: 'chart', style: { height: '110px' } });
      const last = d.intervals[d.intervals.length - 1];
      p.append(h('div', { class: 'small' }, h('b', null, d.d.id), ` · arus ${last ? fmt(last.flow, 0) : '–'} kend/jam · okupansi ${last ? fmt(last.occupancy, 1) : '–'}% · kec ${last && last.speed >= 0 ? fmt(kmh(last.speed), 1) : '–'} km/j`), cv2);
      requestAnimationFrame(() => lineChart(cv2, [{ data: d.intervals.map(i => [i.end, i.flow]), color: '#ffd400', bar: true }]));
    }
    for (const d of sim.e2) {
      const cv2 = h('canvas', { class: 'chart', style: { height: '110px' } });
      const last = d.intervals[d.intervals.length - 1];
      p.append(h('div', { class: 'small' }, h('b', null, d.d.id), ` · antrean maks ${last ? fmt(last.maxJamLengthInMeters, 0) : '–'} m · okupansi ${last ? fmt(last.meanOccupancy, 1) : '–'}%`), cv2);
      requestAnimationFrame(() => lineChart(cv2, [{ data: d.intervals.map(i => [i.end, i.maxJamLengthInMeters]), color: '#56ccf2', bar: true }]));
    }
  }
  p.append(h('h3', null, 'Analisis PKJI 2023'), pkjiBox(sim));
  if ((sim.crossings || []).length || Object.keys(sim.busStops || {}).length) {
    p.append(h('h3', null, 'Pejalan kaki & angkutan umum'));
    if (sim.crossings.length) p.append(h('table', null, h('tr', null, h('th', null, 'penyeberangan'), h('th', null, 'jenis'), h('th', null, 'menyeberang'), h('th', null, 'tunggu rata-rata')),
      ...sim.crossings.map(c => h('tr', null, h('td', null, c.d.id), h('td', null, c.type), h('td', null, c.crossed), h('td', null, fmt(c.crossed ? c.waitSum / c.crossed : 0, 1) + ' s')))));
    const bs = Object.values(sim.busStops || {});
    if (bs.length) p.append(h('table', null, h('tr', null, h('th', null, 'halte'), h('th', null, 'kedatangan'), h('th', null, 'henti rata-rata')),
      ...bs.map(b => h('tr', null, h('td', null, b.d.name || b.d.id), h('td', null, b.arrivals), h('td', null, fmt(b.arrivals ? b.dwellSum / b.arrivals : 0, 0) + ' s')))));
  }
  p.append(h('h3', null, 'Emisi total'), h('div', { class: 'stat' }, ...[['CO₂', fmt(sim.totals.CO2 / 1000, 2) + ' kg'], ['CO', fmt(sim.totals.CO, 1) + ' g'], ['HC', fmt(sim.totals.HC, 1) + ' g'], ['NOx', fmt(sim.totals.NOx, 1) + ' g'], ['PMx', fmt(sim.totals.PMx, 2) + ' g'], ['BBM', fmt(sim.totals.fuel / 1000, 2) + ' L'], ['Listrik', fmt(sim.totals.elec / 1000, 2) + ' kWh'], ['Jarak', fmt(sim.totals.dist / 1000, 1) + ' km']].map(([a, b]) => h('div', null, h('b', null, b), h('span', null, a)))));
  p.append(h('h3', null, 'Ekspor output XML'), h('div', { class: 'row' },
    btn('tripinfo.xml', () => showText('tripinfo.xml', SW.toTripinfoXML(sim)), 'sm'), btn('summary.xml', () => showText('summary.xml', SW.toSummaryXML(sim)), 'sm'),
    btn('detektor.xml', () => showText('detector.xml', SW.toDetectorXML(sim)), 'sm'), btn('edgedata.xml', () => showText('edgedata.xml', SW.toEdgeDataXML(sim)), 'sm'),
    btn('tripinfo.csv', () => showText('tripinfo.csv', 'id,type,depart,arrival,duration,routeLength,waitingTime,timeLoss,CO2_g,fuel_ml,electricity_Wh\n' + sim.tripinfo.map(r => [r.id, r.type, fmt(r.depart, 2), fmt(r.arrival, 2), fmt(r.duration, 2), fmt(r.routeLength, 1), fmt(r.waitingTime, 1), fmt(r.timeLoss, 1), fmt(r.CO2, 2), fmt(r.fuel, 1), fmt(r.elec, 1)].join(',')).join('\n')), 'sm')));
}
function lineChart(canvas, series) {
  const r = canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.max(10, r.width * dpr); canvas.height = Math.max(10, r.height * dpr);
  const c = canvas.getContext('2d'); c.scale(dpr, dpr);
  const W = r.width, H = r.height, pl = 38, pb = 18, pt = 8, pr = 8;
  let x0 = Infinity, x1 = -Infinity, y1 = 0;
  for (const s of series) for (const [x, y] of s.data) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  c.fillStyle = '#9aa4b2'; c.font = '10px sans-serif';
  if (!isFinite(x0)) { c.fillText('Belum ada data', W / 2 - 30, H / 2); return; }
  if (x1 === x0) x1 = x0 + 1; if (y1 === 0) y1 = 1;
  const pow = Math.pow(10, Math.floor(Math.log10(y1))); y1 = Math.ceil(y1 / pow * 1.05) * pow;
  const X = x => pl + (x - x0) / (x1 - x0) * (W - pl - pr), Y = y => H - pb - y / y1 * (H - pb - pt);
  c.strokeStyle = '#2f3846'; c.lineWidth = 1; c.beginPath();
  for (let k = 0; k <= 4; k++) { const yy = Y(y1 * k / 4); c.moveTo(pl, yy); c.lineTo(W - pr, yy); c.fillText(+(y1 * k / 4).toPrecision(3), 2, yy + 3); }
  c.stroke();
  c.fillText(fmt(x0, 0) + ' s', pl, H - 4); c.textAlign = 'right'; c.fillText(fmt(x1, 0) + ' s', W - pr, H - 4); c.textAlign = 'left';
  for (const s of series) {
    c.strokeStyle = s.color; c.fillStyle = s.color; c.lineWidth = 1.6;
    if (s.bar) { const bw = Math.max(2, (W - pl - pr) / Math.max(1, s.data.length) * 0.7); for (const [x, y] of s.data) c.fillRect(X(x) - bw, Y(y), bw, H - pb - Y(y)); continue; }
    c.beginPath(); const step = Math.max(1, Math.floor(s.data.length / 600));
    s.data.forEach(([x, y], i) => { if (i % step) return; if (i) c.lineTo(X(x), Y(y)); else c.moveTo(X(x), Y(y)); }); c.stroke();
  }
}

/* ---------- File panel ---------- */
function panelFile(p) {
  p.append(h('h3', null, 'Contoh skenario (sesuai playlist)'));
  const ex = h('div', { class: 'list card' });
  for (const name of Object.keys(SW.examples)) ex.append(h('div', { class: 'it', onclick: () => { loadScenario(SW.examples[name](), name.replace(/[^\w]+/g, '_').toLowerCase()); toast('Dimuat: ' + name); setTab('sim'); } }, h('span', null, name), h('span', { class: 'mut' }, '›')));
  p.append(ex);
  if (typeof SV !== 'undefined' && SV.on && SV.user) p.append(h('h3', null, 'Peta OpenStreetMap'), h('div', { class: 'row' }, btn('🗺 Ambil jaringan dari peta OSM…', osmDialog, 'pri'), h('span', { class: 'small mut' }, 'cari lokasi, pilih area, unduh jalan')));
  p.append(h('h3', null, 'Impor file SUMO / OSM'), h('div', { class: 'card' },
    h('div', { class: 'small mut' }, 'Terima .net.xml, .rou.xml, .trips.xml, .add.xml, .sumocfg, .nod.xml, .edg.xml, dan .osm (OpenStreetMap → netconvert). Bisa pilih beberapa file sekaligus.'),
    h('input', { type: 'file', multiple: true, accept: '.xml,.osm,.sumocfg,.txt', onchange: e => importFiles([...e.target.files]) }),
    h('details', null, h('summary', null, 'Tempel teks XML'), h('textarea', { id: 'pasteXml', rows: 6, placeholder: '<net ...> / <routes> / <osm> ...' }), btn('Impor teks', () => importTexts([['tempel.xml', $('pasteXml').value]]), 'sm pri'))));
  p.append(h('h3', null, 'Ekspor (format SUMO)'), h('div', { class: 'card' }, h('div', { class: 'grid2' }, ...field('Nama skenario', txt(S.scenarioName, v => S.scenarioName = v.replace(/[^\w.-]/g, '_') || 'scenario'))),
    h('div', { class: 'row' },
      btn('.net.xml', () => showText(S.scenarioName + '.net.xml', SW.toNetXML(S.net, topo())), 'sm'),
      btn('.rou.xml', () => showText(S.scenarioName + '.rou.xml', SW.toRouXML(S.demand)), 'sm'),
      btn('.add.xml', () => showText(S.scenarioName + '.add.xml', SW.toAddXML(S.add)), 'sm'),
      btn('.sumocfg', () => showText(S.scenarioName + '.sumocfg', SW.toSumocfg(S.cfg, S.scenarioName)), 'sm'),
      btn('.nod.xml', () => showText(S.scenarioName + '.nod.xml', SW.toNodXML(S.net)), 'sm'),
      btn('.edg.xml', () => showText(S.scenarioName + '.edg.xml', SW.toEdgXML(S.net)), 'sm'),
      btn('.con.xml', () => showText(S.scenarioName + '.con.xml', SW.toConXML(S.net, topo())), 'sm'),
      btn('.tll.xml', () => showText(S.scenarioName + '.tll.xml', SW.toTllXML(S.net, topo())), 'sm'),
      btn('build.sh', () => showText('build.sh', SW.toBuildScript(S.net, S.scenarioName)), 'sm'),
      btn('build.bat', () => showText('build.bat', SW.toBuildScript(S.net, S.scenarioName, true)), 'sm')),
    h('div', { class: 'small mut' }, 'Untuk SUMO desktop: simpan .nod/.edg/.con/.tll/.rou/.add/.sumocfg + build.bat (Windows) atau build.sh (Linux/macOS) dalam satu folder, lalu jalankan skrip build. Skrip memanggil netconvert untuk membuat .net.xml (lajur & lampu tetap sama) lalu membuka sumo-gui. File .net.xml dari tombol di atas untuk dibaca ulang oleh Optimus.')));
  p.append(h('h3', null, 'Proyek'), h('div', { class: 'row' },
    btn('Simpan proyek (JSON)', () => showText(S.scenarioName + '.optimus.json', JSON.stringify({ net: S.net, demand: S.demand, add: S.add, cfg: S.cfg, name: S.scenarioName }, null, 1)), 'sm'),
    h('label', { class: 'btn sm' }, 'Buka proyek JSON', h('input', { type: 'file', accept: '.json', style: { display: 'none' }, onchange: async e => { const f = e.target.files[0]; if (!f) return; try { const o = JSON.parse(await f.text()); pushUndo(); S.cfg = Object.assign(SW.defaultConfig(), o.cfg || {}); loadScenario({ net: o.net, demand: o.demand, add: o.add }, o.name); toast('Proyek dibuka'); } catch (er) { toast('Gagal: ' + er.message); } } })),
    btn('Proyek baru', () => { pushUndo(); loadScenario(SW.examples['Kosong (mulai dari nol)'](), 'scenario'); setTab('net'); setMode('create'); }, 'sm bad')),
    h('div', { class: 'small mut' }, 'Proyek otomatis tersimpan di peramban ini.'));
  p.append(h('h3', null, 'Tentang'), h('div', { class: 'small mut' }, `Optimus ${SW.VERSION} meniru alur kerja Eclipse SUMO: NetEdit, netgenerate, netconvert (OSM), duarouter/randomTrips, sumo-gui, TraCI, detektor E1/E2, emisi & energi. Model: Krauss & IDM, pindah lajur strategis/speed-gain/keep-right, persimpangan prioritas & lampu statis/aktuasi.`));
}
async function importFiles(files) { const arr = []; for (const f of files) arr.push([f.name, await f.text()]); importTexts(arr); }
function importTexts(arr) {
  pushUndo();
  // order: net / osm first, then routes, additional, cfg
  const rank = ([n, t]) => /<net[\s>]|<osm[\s>]|<nodes[\s>]/.test(t.slice(0, 3000)) ? 0 : /<edges[\s>]/.test(t.slice(0, 3000)) ? 1 : 2;
  arr.sort((a, b) => rank(a) - rank(b));
  const st = { net: S.net, demand: S.demand, add: S.add, cfg: S.cfg };
  const isNet = arr.some(a => rank(a) === 0);
  if (isNet) { st.net = SW.newNet(); st.demand = SW.newDemand(); st.add = SW.newAdditional(); }
  const done = [];
  for (const [name, t] of arr) {
    try { const k = SW.importAny(t, st); done.push(`${name} (${k})`); }
    catch (e) { toast(`Gagal impor ${name}: ${e.message}`, 4000); console.error(e); }
  }
  S.net = st.net; S.demand = st.demand; S.add = st.add; S.cfg = st.cfg;
  netChanged(true); if (isNet) fitView(); renderPanel();
  if (done.length) toast('Diimpor: ' + done.join(', '), 3500);
}
function showText(name, text) {
  $('mTitle').textContent = name;
  const ta = h('textarea', { readonly: true }); ta.value = text;
  const body = $('mBody'); body.innerHTML = '';
  body.append(h('div', { class: 'row' },
    btn('Salin', async () => { try { await navigator.clipboard.writeText(text); toast('Disalin'); } catch (e) { ta.select(); toast('Pilih teks lalu salin manual'); } }, 'pri sm'),
    btn('Unduh', () => { try { const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/xml' })), download: name }); document.body.append(a); a.click(); a.remove(); } catch (e) { toast('Unduhan diblokir; gunakan Salin'); } }, 'sm'),
    h('span', { class: 'small mut' }, `${(text.length / 1024).toFixed(1)} KB · ${text.split('\n').length} baris`)), ta);
  $('modal').classList.add('on');
}
$('mClose').onclick = () => $('modal').classList.remove('on');
$('modal').addEventListener('click', e => { if (e.target.id === 'modal') $('modal').classList.remove('on'); });

/* ---------- PKJI 2023 box (Output tab) ---------- */
function pkjiBox(sim) {
  const o = S.pkjiOpt = S.pkjiOpt || SW.PKJI.defaults();
  const box = h('div', { class: 'card' });
  box.append(h('div', { class: 'grid2' },
    ...field('Penduduk kota', num(o.population, v => { o.population = v || 1e6; renderPanel(); })),
    ...field('Lingkungan', sel(o.environment, [['KOM', 'komersial'], ['KIM', 'permukiman'], ['AT', 'akses terbatas']], v => { o.environment = v; renderPanel(); })),
    ...field('Hambatan samping', sel(o.friction, [['T', 'tinggi'], ['S', 'sedang'], ['R', 'rendah']], v => { o.friction = v; renderPanel(); }))),
  h('div', { class: 'small mut' }, `Data dihitung setelah pemanasan ${S.cfg.warmup || 0} s. EMP APILL: KR 1,0 · KB 1,3 · SM 0,15 (terlindung) / 0,40 (terlawan). LOS menurut PM 96/2015.`));
  let r;
  try { r = SW.pkji(S.net, SW.pkjiInput(sim), o); } catch (e) { box.append(h('div', { class: 'small' }, 'Gagal menghitung: ' + e.message)); return box; }
  if (r.approaches.length) {
    box.append(h('div', { style: { overflowX: 'auto' } }, h('table', null, h('tr', null, ...['pendekat', 'tipe', 'KR/KB/SM', 'q smp/j', 'S', 'H/c', 'C', 'DJ', 'T PKJI', 'T sim', 'LOS', 'antrean sim'].map(x => h('th', null, x))),
      ...r.approaches.map(a => h('tr', null, h('td', null, a.approach), h('td', null, a.type[0]), h('td', null, `${a.counts.KR}/${a.counts.KB}/${a.counts.SM}`), h('td', null, fmt(a.q_smp, 0)), h('td', null, fmt(a.S, 0)), h('td', null, `${fmt(a.g, 0)}/${fmt(a.cycle, 0)}`), h('td', null, fmt(a.C, 0)),
        h('td', { style: { color: a.DJ >= 0.85 ? '#eb5757' : a.DJ >= 0.75 ? '#f2994a' : '' } }, fmt(a.DJ, 2)), h('td', null, fmt(a.T_pkji, 1)), h('td', null, fmt(a.T_sim, 1)), h('td', null, `${a.los_pkji}/${a.los_sim || '–'}`), h('td', null, fmt(a.Q_sim_m, 0) + ' m'))))));
    for (const j of r.junctions) box.append(h('div', { class: 'small', style: { marginTop: '4px' } }, h('b', null, 'Simpang ' + j.tl + ': '), `tundaan PKJI ${fmt(j.T_pkji, 1)} s/smp (LOS ${j.los_pkji}) · simulasi ${fmt(j.T_sim, 1)} s/smp (LOS ${j.los_sim || '–'}) · DJ maks ${fmt(j.maxDJ, 2)}`));
  } else box.append(h('div', { class: 'small mut' }, 'Tidak ada simpang bersinyal.'));
  if (r.segments.length) box.append(h('details', null, h('summary', null, `Ruas jalan (${r.segments.length})`), h('table', null, h('tr', null, ...['ruas', 'tipe', 'q smp/j', 'C', 'DJ'].map(x => h('th', null, x))),
    ...r.segments.map(x => h('tr', null, h('td', null, x.edge), h('td', null, x.type), h('td', null, fmt(x.q_smp, 0)), h('td', null, fmt(x.C, 0)), h('td', null, fmt(x.DJ, 2)))))));
  return box;
}
