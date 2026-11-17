/* ===== Optimus UI: penyimpanan server (Node + PostgreSQL) & analisis (Python) ===== */
const svBase = () => (typeof location !== 'undefined' ? location.pathname.replace(/\/index\.html$/i, '').replace(/\/$/, '') : '');
const SV = { on: false, health: null, token: null, user: null, project: null, version: null, base: null, dirty: false, runs: [], sel: new Set(), list: [], q: '', versions: null, busy: false, confirmDel: null };

async function svApi(method, path, body) {
  const r = await fetch(svBase() + '/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(SV.token ? { Authorization: 'Bearer ' + SV.token } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = {}; try { j = await r.json(); } catch (e) { /* kosong */ }
  if (r.status === 401 && SV.token && !path.startsWith('/auth/login')) { SV.token = null; SV.user = null; store.set('optimus.token', ''); renderPanel(); }
  if (!r.ok) { const e = new Error(j.error || ('Galat ' + r.status)); e.status = r.status; e.body = j; throw e; }
  return j;
}
async function svInit() {
  if (!/^https?:$/.test(location.protocol)) return;
  try {
    const r = await fetch(svBase() + '/api/health', { cache: 'no-store' }); if (!r.ok) return;
    const h = await r.json(); if (h.app !== 'optimus') return;
    SV.health = h; SV.on = true;
  } catch (e) { return; }
  TABS.unshift(['proj', 'Proyek']);
  const tabs = $('tabs'); tabs.prepend(h('button', { 'data-t': 'proj', onclick: () => setTab('proj') }, 'Proyek'));
  $('app').querySelector('header').append(h('button', { id: 'svChip', class: 'btn sm', style: { whiteSpace: 'nowrap', maxWidth: '45vw', overflow: 'hidden', textOverflow: 'ellipsis' }, onclick: () => setTab('proj') }, '☁ Masuk'));
  SV.token = store.get('optimus.token') || null;
  const pub = new URLSearchParams(location.search).get('p');
  if (pub) {
    try {
      const r = await fetch(svBase() + '/api/public/' + encodeURIComponent(pub)); const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Tautan tidak berlaku');
      SV._loading = true; S.cfg = Object.assign(SW.defaultConfig(), j.data.cfg || {}); loadScenario({ net: j.data.net, demand: j.data.demand, add: j.data.add }, j.project.name.replace(/[^\w.-]+/g, '_'));
      setTimeout(() => { SV._loading = false; }, 700);
      SV.readonly = { name: j.project.name, owner: j.project.owner, version: j.version };
      $('svChip').textContent = `👁 ${j.project.name} (milik ${j.project.owner}, hanya-baca)`;
      toast('Tautan publik dibuka (hanya-baca). Masuk untuk menyimpan salinan.', 4000);
      setTab('sim'); return;
    } catch (e) { toast(e.message, 4000); }
  }
  if (SV.token) { try { SV.user = (await svApi('GET', '/auth/me')).user; } catch (e) { SV.token = null; } }
  const last = store.get('optimus.lastProject');
  if (SV.user && last) { try { await svOpen(last, undefined, true); } catch (e) { /* proyek terakhir tidak ada */ } }
  svChip();
  if (S.tab === 'proj') renderPanel();
  if (!SV.user) setTab('proj');
}
function svChip() {
  const c = $('svChip'); if (!c) return;
  if (SV.readonly && !SV.project) { c.textContent = `👁 ${SV.readonly.name} (hanya-baca)`; return; }
  if (!SV.user) { c.textContent = '☁ Masuk'; return; }
  c.textContent = SV.project ? `☁ ${SV.project.name} · v${SV.version}${SV.dirty ? ' •' : ''}` : '☁ Belum disimpan';
  c.title = SV.dirty ? 'Ada perubahan yang belum disimpan ke server (Ctrl+S)' : 'Tersimpan di server';
  c.style.borderColor = SV.dirty ? 'var(--warn)' : '';
}
function svMarkDirty() { if (!SV.on || SV._loading) return; if (!SV.dirty) { SV.dirty = true; svChip(); } }
function svData() { return { net: S.net, demand: S.demand, add: S.add, cfg: S.cfg }; }

async function svOpen(id, version, silent) {
  const q = version ? `?version=${version}` : '';
  const j = await svApi('GET', `/projects/${id}${q}`);
  SV._loading = true;
  try {
    S.cfg = Object.assign(SW.defaultConfig(), j.data.cfg || {});
    loadScenario({ net: j.data.net, demand: j.data.demand, add: j.data.add }, j.project.name.replace(/[^\w.-]+/g, '_'));
    $('delay').value = S.cfg.delay; $('delayV').textContent = S.cfg.delay; $('stepLen').value = String(S.cfg.stepLength);
  } finally { setTimeout(() => { SV._loading = false; }, 700); }
  SV.project = j.project; SV.version = j.version; SV.base = j.project.current_version; SV.dirty = false; SV.versions = null; SV.sel.clear();
  SV.role = j.project.my_role || 'owner'; SV.shares = null;
  store.set('optimus.lastProject', id);
  await svLoadRuns();
  svChip();
  if (!silent) toast(`Dibuka: ${j.project.name} (v${j.version}${j.version !== j.project.current_version ? ', versi lama' : ''})`);
  renderPanel();
}
async function svSave(note) {
  if (!SV.user) return toast('Masuk dulu untuk menyimpan ke server');
  if (!SV.project) return svSaveAs();
  if (SV.role === 'view' || SV.readonly) return toast('Anda hanya punya akses lihat. Gunakan "Simpan sebagai baru".', 4000);
  try {
    SV.busy = true;
    const j = await svApi('PUT', `/projects/${SV.project.id}`, { data: svData(), note: note || '', baseVersion: SV.base });
    SV.project = j.project; SV.version = SV.base = j.project.current_version; SV.dirty = false; SV.versions = null;
    toast(`Tersimpan sebagai versi ${SV.version}`);
  } catch (e) {
    if (e.status === 409) toast(e.message + ' Pakai "Simpan sebagai baru" agar tidak menimpa.', 6000);
    else toast('Gagal menyimpan: ' + e.message, 5000);
  } finally { SV.busy = false; svChip(); renderPanel(); }
}
async function svSaveAs(name) {
  if (!SV.user) return toast('Masuk dulu untuk menyimpan ke server');
  name = (name || ($('svNewName') && $('svNewName').value) || S.scenarioName || 'Skenario baru').trim();
  try {
    const j = await svApi('POST', '/projects', { name, description: ($('svNewDesc') && $('svNewDesc').value) || '', data: svData() });
    SV.project = j.project; SV.version = SV.base = 1; SV.dirty = false; SV.runs = []; SV.versions = null;
    store.set('optimus.lastProject', j.project.id);
    toast('Proyek baru disimpan: ' + j.project.name);
    await svRefreshList();
  } catch (e) { toast('Gagal: ' + e.message, 5000); }
  svChip(); renderPanel();
}
async function svRefreshList() { try { SV.list = (await svApi('GET', '/projects?q=' + encodeURIComponent(SV.q))).projects; } catch (e) { SV.list = []; } }
async function svLoadRuns() { if (!SV.project) { SV.runs = []; return; } try { SV.runs = (await svApi('GET', `/projects/${SV.project.id}/runs`)).runs; } catch (e) { SV.runs = []; } }

async function svSaveRun() {
  if (!SV.project) return toast('Simpan proyek ke server dulu');
  if (!S.sim || S.sim.t <= S.cfg.begin) return toast('Jalankan simulasi dulu');
  if (SV.dirty) return toast('Simpan perubahan proyek dulu supaya hasil terkait dengan versi yang benar', 4500);
  try {
    const note = ($('svRunNote') && $('svRunNote').value) || '';
    await svApi('POST', `/projects/${SV.project.id}/runs`, { version: SV.version, ...SW.runPayload(S.sim, note) });
    toast(`Hasil simulasi (t=${fmt(S.sim.t, 0)} s, ${S.sim.tripinfo.length} perjalanan) tersimpan`);
    await svLoadRuns(); renderPanel();
  } catch (e) { toast('Gagal: ' + e.message, 5000); }
}
async function svVerify() {
  if (!SV.project) return toast('Simpan proyek ke server dulu');
  if (SV.dirty) return toast('Simpan perubahan proyek dulu', 4000);
  const box = $('svVerifyOut'); if (box) box.textContent = 'Menjalankan netconvert + sumo di server…';
  SV.busy = true; renderRunsButtons();
  try {
    const j = await svApi('POST', `/projects/${SV.project.id}/verify`, { version: SV.version });
    toast(`SUMO asli selesai: ${j.run.totals.arrived} perjalanan`);
    await svLoadRuns(); SV.busy = false; renderPanel();
    const b2 = $('svVerifyOut'); if (b2) b2.textContent = (j.warnings || []).slice(0, 8).join('\n') || 'Tanpa peringatan.';
  } catch (e) { SV.busy = false; renderRunsButtons(); const b = $('svVerifyOut'); if (b) b.textContent = '✗ ' + e.message; }
}
function renderRunsButtons() { document.querySelectorAll('.svBusy').forEach(b => { b.disabled = SV.busy; }); }

/* ---------- tampilan analisis ---------- */
function kv(rows) { return h('div', { class: 'stat' }, ...rows.map(([a, b]) => h('div', null, h('b', null, b), h('span', null, a)))); }
async function svShowAnalysis(runId) {
  try {
    const a = await svApi('GET', `/runs/${runId}/analysis`);
    const body = $('mBody'); body.innerHTML = ''; $('mTitle').textContent = `Analisis hasil (${a.engine === 'sumo' ? 'SUMO asli' : 'Optimus'}, v${a.version})`;
    const D = a.duration, L = a.timeLoss;
    body.append(kv([['Perjalanan selesai', a.trips], ['Tingkat pelayanan', a.los || '–'], ['Waktu tempuh rata-rata', fmt(D.mean, 1) + ' s'], ['p85 waktu tempuh', fmt(D.p85, 1) + ' s'],
      ['Tundaan rata-rata', fmt(L.mean, 1) + ' s'], ['Tunggu rata-rata', fmt(a.waiting.mean, 1) + ' s'], ['Kecepatan rata-rata', fmt(a.speed_kmh.mean, 1) + ' km/j'], ['Puncak kendaraan', a.peak ? `${a.peak.running} @ ${fmt(a.peak.t, 0)} s` : '–']]),
    h('div', { class: 'small mut' }, 'LOS: ' + a.los_basis + ' (A ≤10, B ≤20, C ≤35, D ≤55, E ≤80, F >80 detik).'));
    const cv2 = h('canvas', { class: 'chart' });
    body.append(h('h3', null, 'Sebaran waktu tempuh'), cv2);
    requestAnimationFrame(() => lineChart(cv2, [{ data: a.hist_duration.counts.map((c, i) => [a.hist_duration.edges[i + 1], c]), color: '#4f9dff', bar: true }]));
    body.append(h('h3', null, 'Per jenis kendaraan'), h('div', { style: { overflowX: 'auto' } }, h('table', null,
      h('tr', null, ...['jenis', 'n', 'tempuh', 'tundaan', 'LOS', 'km/j', 'CO₂ g/km', 'BBM ml/km', 'Wh/km'].map(x => h('th', null, x))),
      ...a.by_type.map(t => h('tr', null, h('td', null, t.type), h('td', null, t.n), h('td', null, fmt(t.duration, 1)), h('td', null, fmt(t.timeLoss, 1)), h('td', null, t.los), h('td', null, fmt(t.speed_kmh, 1)), h('td', null, fmt(t.co2_g_per_km, 0)), h('td', null, fmt(t.fuel_ml_per_km, 0)), h('td', null, fmt(t.elec_wh_per_km, 0)))))));
    if (a.profile_15min.length) body.append(h('h3', null, 'Profil per 15 menit'), h('table', null, h('tr', null, ...['mulai', 'perjalanan', 'arus kend/jam', 'tundaan', 'LOS'].map(x => h('th', null, x))),
      ...a.profile_15min.map(p => h('tr', null, h('td', null, fmt(p.begin / 60, 0) + ' mnt'), h('td', null, p.trips), h('td', null, fmt(p.flow_vph, 0)), h('td', null, fmt(p.mean_timeLoss, 1)), h('td', null, p.los)))));
    if (a.detectors.length) body.append(h('h3', null, 'Detektor'), h('table', null, ...a.detectors.map(d => h('tr', null, h('td', null, d.id), h('td', null, d.kind.toUpperCase()),
      h('td', null, d.kind === 'e1' ? `arus rata-rata ${fmt(d.mean_flow_vph, 0)} · puncak ${fmt(d.peak_flow_vph, 0)} kend/jam · okupansi ${fmt(d.mean_occupancy, 1)}%` : `okupansi ${fmt(d.mean_occupancy, 1)}% · antrean maks ${fmt(d.max_jam_m, 0)} m`)))));
    $('modal').classList.add('on');
  } catch (e) { toast('Analisis gagal: ' + e.message, 5000); }
}
async function svCompare() {
  const ids = [...SV.sel];
  if (ids.length < 2) return toast('Centang minimal 2 hasil');
  try {
    const c = await svApi('POST', '/runs/compare', { run_ids: ids });
    const body = $('mBody'); body.innerHTML = ''; $('mTitle').textContent = 'Perbandingan hasil simulasi';
    const lbl = r => { const x = SV.runs.find(y => y.id === r.id); return `${r.engine === 'sumo' ? 'SUMO' : 'Optimus'} v${r.version}${x && x.note ? ' · ' + x.note : ''}`; };
    const tbl = h('table', null, h('tr', null, h('th', null, 'metrik'), ...c.runs.map((r, i) => h('th', null, (i ? '' : 'acuan: ') + lbl(r)))));
    for (const row of c.rows) {
      const tr = h('tr', null, h('td', null, row.metric + (row.unit ? ` (${row.unit})` : '')));
      row.values.forEach((v, i) => {
        const val = v === null || v === undefined ? '–' : typeof v === 'number' ? fmt(v, v > 100 ? 0 : 1) : v;
        const d = row.diff_pct[i];
        const diff = i && d !== null && d !== undefined ? h('span', { class: 'small', style: { color: Math.abs(d) < 5 ? 'var(--mut)' : d > 0 ? '#f2994a' : '#2ecc71', marginLeft: '4px' } }, (d > 0 ? '+' : '') + fmt(d, 0) + '%') : null;
        tr.append(h('td', null, val, diff));
      });
      tbl.append(tr);
    }
    body.append(h('div', { style: { overflowX: 'auto' } }, tbl),
      h('div', { class: 'small mut', style: { marginTop: '6px' } }, 'Persentase = selisih terhadap kolom acuan (pertama). Perbandingan Optimus vs SUMO asli berguna untuk menilai seberapa dekat model peramban dengan SUMO.'));
    $('modal').classList.add('on');
  } catch (e) { toast('Gagal: ' + e.message, 5000); }
}

/* ---------- panel Proyek ---------- */
function panelProj(p) {
  if (!SV.user) return panelLogin(p);
  p.append(h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('span', null, '👤 ', h('b', null, SV.user.display_name || SV.user.username), h('span', { class: 'mut small' }, ' @' + SV.user.username)),
    btn('Keluar', async () => { try { await svApi('POST', '/auth/logout', {}); } catch (e) { /* abaikan */ } SV.token = null; SV.user = null; SV.project = null; store.set('optimus.token', ''); svChip(); renderPanel(); }, 'sm')),
  h('div', { class: 'small mut' }, `Server: basis data ${SV.health.db ? '✓' : '✗'} · Python ${SV.health.python ? '✓' : '✗'} · SUMO asli ${SV.health.sumo ? SV.health.sumo : 'tidak terpasang'}`));
  // proyek aktif
  p.append(h('h3', null, 'Proyek aktif'));
  const card = h('div', { class: 'card' });
  if (SV.project) {
    card.append(h('div', null, h('b', null, SV.project.name), h('span', { class: 'tag' }, 'v' + SV.version), SV.version !== SV.base ? h('span', { class: 'tag', style: { color: 'var(--warn)' } }, 'versi lama') : null, SV.dirty ? h('span', { class: 'tag', style: { color: 'var(--warn)' } }, 'belum disimpan') : h('span', { class: 'tag' }, 'tersimpan')),
      SV.project.description ? h('div', { class: 'small mut' }, SV.project.description) : null,
      h('div', { class: 'row' }, h('input', { type: 'text', id: 'svNote', placeholder: 'Catatan versi (opsional), mis. "tambah flyover"' })),
      h('div', { class: 'row' }, h('button', { class: 'btn pri', onclick: () => svSave($('svNote').value) }, '💾 Simpan (Ctrl+S)'), btn('Simpan sebagai baru…', () => { SV.showNew = !SV.showNew; renderPanel(); }, 'sm'),
        btn('Versi', async () => { SV.versions = SV.versions ? null : (await svApi('GET', `/projects/${SV.project.id}/versions`)).versions; renderPanel(); }, 'sm'),
        btn('Ganti nama', () => { SV.rename = !SV.rename; renderPanel(); }, 'sm')));
    if (SV.rename) card.append(h('div', { class: 'grid2' }, ...field('Nama', h('input', { type: 'text', id: 'svRenName', value: SV.project.name })), ...field('Deskripsi', h('input', { type: 'text', id: 'svRenDesc', value: SV.project.description || '' }))),
      btn('Simpan nama', async () => { const j = await svApi('PATCH', `/projects/${SV.project.id}`, { name: $('svRenName').value, description: $('svRenDesc').value }); SV.project = j.project; SV.rename = false; svChip(); renderPanel(); }, 'sm ok'));
    if (SV.versions) card.append(h('div', { class: 'list' }, ...SV.versions.map(v => h('div', { class: 'it' + (v.version === SV.version ? ' on' : '') },
      h('span', null, h('b', null, 'v' + v.version), ' ', h('span', { class: 'small mut' }, `${new Date(v.created_at).toLocaleString('id-ID')} · ${(v.size_bytes / 1024).toFixed(0)} KB${v.note ? ' · ' + v.note : ''}`)),
      h('span', null, btn('Buka', () => svOpen(SV.project.id, v.version), 'sm'), v.version !== SV.base ? btn('Pulihkan', async () => { await svApi('POST', `/projects/${SV.project.id}/versions/${v.version}/restore`, {}); await svOpen(SV.project.id); toast(`v${v.version} dipulihkan sebagai versi terbaru`); }, 'sm') : null)))));
  } else card.append(h('div', { class: 'mut small' }, 'Skenario di layar belum tersimpan di server.'), h('div', { class: 'row' }, btn('💾 Simpan ke server…', () => { SV.showNew = true; renderPanel(); }, 'pri')));
  if (SV.showNew || !SV.project) card.append(h('div', { class: 'grid2', style: { marginTop: '6px' } }, ...field('Nama', h('input', { type: 'text', id: 'svNewName', value: SV.project ? SV.project.name + ' (salinan)' : (S.scenarioName || '').replace(/_/g, ' ') })), ...field('Deskripsi', h('input', { type: 'text', id: 'svNewDesc', placeholder: 'opsional' }))),
    h('div', { class: 'row' }, btn('Simpan sebagai proyek baru', () => { SV.showNew = false; svSaveAs(); }, 'ok sm')));
  p.append(card);
  // hasil simulasi
  if (SV.project) {
    p.append(h('h3', null, 'Hasil simulasi tersimpan'));
    const rc = h('div', { class: 'card' });
    rc.append(h('div', { class: 'row' }, h('input', { type: 'text', id: 'svRunNote', placeholder: 'Catatan hasil, mis. "skenario eksisting"' })),
      h('div', { class: 'row' }, h('button', { class: 'btn pri svBusy', onclick: svSaveRun }, `⬆ Simpan hasil simulasi saat ini${S.sim ? ` (t=${fmt(S.sim.t, 0)} s)` : ''}`),
        SV.health.sumo ? h('button', { class: 'btn svBusy', onclick: svVerify, title: 'Bangun jaringan dengan netconvert lalu jalankan sumo di server' }, '▶ Jalankan di SUMO asli') : null),
      h('pre', { class: 'console', id: 'svVerifyOut', style: { display: SV.health.sumo ? 'block' : 'none', maxHeight: '90px' } }, 'Verifikasi: skenario versi tersimpan dijalankan di Eclipse SUMO ' + (SV.health.sumo || '') + ' lalu hasilnya disimpan untuk dibandingkan.'));
    if (SV.runs.length) {
      rc.append(h('div', { style: { overflowX: 'auto' } }, h('table', null, h('tr', null, h('th'), h('th', null, 'mesin'), h('th', null, 'v'), h('th', null, 'tiba'), h('th', null, 'CO₂ kg'), h('th', null, 'waktu'), h('th')),
        ...SV.runs.map(r => h('tr', null,
          h('td', null, h('input', { type: 'checkbox', checked: SV.sel.has(r.id), onchange: e => { if (e.target.checked) SV.sel.add(r.id); else SV.sel.delete(r.id); } })),
          h('td', null, r.engine === 'sumo' ? 'SUMO' : 'Web', r.note ? h('div', { class: 'small mut' }, r.note) : null), h('td', null, r.version), h('td', null, r.totals.arrived), h('td', null, fmt((r.totals.CO2 || 0) / 1000, 1)),
          h('td', { class: 'small mut' }, new Date(r.created_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })),
          h('td', null, btn('Analisis', () => svShowAnalysis(r.id), 'sm'), btn('Word', () => svReport(r.id, 'docx'), 'sm'), btn('PDF', () => svReport(r.id, 'pdf'), 'sm'), btn('✕', async () => { await svApi('DELETE', `/runs/${r.id}`); SV.sel.delete(r.id); await svLoadRuns(); renderPanel(); }, 'sm bad')))))),
      h('div', { class: 'row' }, btn('Bandingkan yang dicentang', svCompare, 'sm pri'), h('span', { class: 'small mut' }, 'Analisis & perbandingan dihitung oleh layanan Python.')));
    } else rc.append(h('div', { class: 'small mut' }, 'Belum ada hasil tersimpan.'));
    p.append(rc);
    p.append(h('h3', null, 'Berbagi'), shareBox());
    p.append(h('h3', null, 'Ekspor dari server'), h('div', { class: 'row' }, ...['nod.xml', 'edg.xml', 'con.xml', 'tll.xml', 'rou.xml', 'add.xml', 'sumocfg', 'net.xml', 'build.sh', 'build.bat'].map(ext => btn(ext.startsWith('build') ? ext : '.' + ext, async () => {
      const j = await svApi('GET', `/projects/${SV.project.id}/export?version=${SV.version}`); const k = Object.keys(j.files).find(f => (ext.startsWith('build') ? f === ext : f.endsWith('.' + ext))); showText(k, j.files[k]);
    }, 'sm'))));
  }
  // daftar proyek
  p.append(h('h3', null, 'Proyek saya'));
  const lst = h('div', { class: 'card' });
  lst.append(h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, h('input', { type: 'text', placeholder: 'Cari proyek…', value: SV.q, onchange: async e => { SV.q = e.target.value; await svRefreshList(); renderPanel(); } }), btn('↻', async () => { await svRefreshList(); renderPanel(); }, 'sm')));
  if (!SV._listed) { SV._listed = true; svRefreshList().then(renderPanel); }
  const L = h('div', { class: 'list', style: { maxHeight: '320px' } });
  for (const pr of SV.list) {
    const st = pr.stats || {};
    L.append(h('div', { class: 'it' + (SV.project && SV.project.id === pr.id ? ' on' : '') },
      h('div', { style: { minWidth: 0 }, onclick: () => svOpen(pr.id) }, h('b', null, pr.name), pr.my_role && pr.my_role !== 'owner' ? h('span', { class: 'tag' }, `${pr.my_role === 'edit' ? 'boleh edit' : 'lihat'} · ${pr.owner}`) : null, pr.is_public ? h('span', { class: 'tag' }, 'publik') : null, pr.shares ? h('span', { class: 'tag' }, '👥 ' + pr.shares) : null, h('div', { class: 'small mut' }, `v${pr.current_version} · ${st.nodes || 0} simpul · ${st.edges || 0} ruas${st.elevated ? ' · ' + st.elevated + ' flyover' : ''}${st.underground ? ' · ' + st.underground + ' underpass' : ''} · ${pr.runs} hasil · ${new Date(pr.updated_at).toLocaleDateString('id-ID')}`)),
      h('span', { style: { whiteSpace: 'nowrap' } }, btn('Buka', () => svOpen(pr.id), 'sm'), btn('⎘', async () => { await svApi('POST', `/projects/${pr.id}/duplicate`, {}); await svRefreshList(); renderPanel(); toast('Diduplikasi'); }, 'sm'),
        btn(SV.confirmDel === pr.id ? 'Yakin?' : '🗑', async () => {
          if (SV.confirmDel !== pr.id) { SV.confirmDel = pr.id; renderPanel(); setTimeout(() => { if (SV.confirmDel === pr.id) { SV.confirmDel = null; renderPanel(); } }, 3000); return; }
          await svApi('DELETE', `/projects/${pr.id}`); SV.confirmDel = null; if (SV.project && SV.project.id === pr.id) { SV.project = null; svChip(); } await svRefreshList(); renderPanel();
        }, 'sm bad'))));
  }
  if (!SV.list.length) L.append(h('div', { class: 'mut small' }, 'Belum ada proyek tersimpan.'));
  lst.append(L); p.append(lst);
}
function panelLogin(p) {
  const mode = SV.loginMode || 'login';
  p.append(h('h3', null, mode === 'login' ? 'Masuk' : 'Daftar akun'), h('div', { class: 'small mut' }, 'Masuk untuk menyimpan proyek di server (PostgreSQL) dan membukanya lagi kapan saja dari perangkat mana pun.'));
  const f = h('form', { class: 'card', onsubmit: async e => {
    e.preventDefault();
    const body = { username: $('lgUser').value.trim(), password: $('lgPass').value, name: $('lgName') ? $('lgName').value : undefined };
    try {
      const j = await svApi('POST', mode === 'login' ? '/auth/login' : '/auth/register', body);
      SV.token = j.token; SV.user = j.user; store.set('optimus.token', j.token); SV._listed = false;
      toast('Selamat datang, ' + (j.user.display_name || j.user.username)); svChip(); renderPanel();
    } catch (er) { $('lgErr').textContent = er.message; }
  } },
  h('div', { class: 'grid2' }, ...field('Username', h('input', { type: 'text', id: 'lgUser', autocomplete: 'username', required: true })),
    ...(mode === 'register' ? field('Nama tampilan', h('input', { type: 'text', id: 'lgName' })) : []),
    ...field('Kata sandi', h('input', { type: 'password', id: 'lgPass', autocomplete: mode === 'login' ? 'current-password' : 'new-password', required: true, minLength: mode === 'register' ? 8 : undefined }))),
  h('div', { id: 'lgErr', class: 'small', style: { color: 'var(--bad)', minHeight: '16px' } }),
  h('div', { class: 'row' }, h('button', { class: 'btn pri', type: 'submit' }, mode === 'login' ? 'Masuk' : 'Daftar'),
    h('a', { href: '#', class: 'small', style: { color: 'var(--acc)' }, onclick: e => { e.preventDefault(); SV.loginMode = mode === 'login' ? 'register' : 'login'; renderPanel(); } }, mode === 'login' ? 'Belum punya akun? Daftar' : 'Sudah punya akun? Masuk')));
  p.append(f, h('div', { class: 'small mut' }, 'Tanpa masuk, aplikasi tetap bisa dipakai; proyek hanya tersimpan di peramban ini.'));
}
window.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 's' && SV.on) { e.preventDefault(); svSave($('svNote') ? $('svNote').value : ''); } });
window.addEventListener('beforeunload', e => { if (SV.on && SV.user && SV.dirty) { e.preventDefault(); e.returnValue = ''; } });

/* ---------- laporan Word / PDF ---------- */
async function svReport(runId, fmtx) {
  toast('Menyusun laporan ' + fmtx.toUpperCase() + '…', 6000);
  try {
    const o = S.pkjiOpt || SW.PKJI.defaults();
    const others = [...SV.sel].filter(x => x !== runId);
    const q = new URLSearchParams({ format: fmtx, population: o.population, environment: o.environment, friction: o.friction, ...(others[0] ? { compare: others[0] } : {}) });
    const r = await fetch(`${svBase()}/api/runs/${runId}/report?${q}`, { headers: { Authorization: 'Bearer ' + SV.token } });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || ('galat ' + r.status)); }
    const blob = await r.blob();
    const name = (/filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') || '') || [])[1] || ('laporan.' + fmtx);
    const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove();
    toast('Laporan diunduh: ' + name + (others[0] ? ' (dengan perbandingan hasil yang dicentang)' : ''), 4000);
  } catch (e) { toast('Gagal membuat laporan: ' + e.message, 5000); }
}

/* ---------- berbagi proyek ---------- */
function shareBox() {
  const box = h('div', { class: 'card' });
  if (SV.readonly) { box.append(h('div', { class: 'small mut' }, 'Tautan publik hanya-baca. Gunakan "Simpan sebagai baru" untuk menyalin proyek ke akun Anda.')); return box; }
  if (!SV.shares) { svApi('GET', `/projects/${SV.project.id}/shares`).then(j => { SV.shares = j; renderPanel(); }).catch(() => { }); box.append(h('div', { class: 'small mut' }, 'Memuat…')); return box; }
  const j = SV.shares, owner = j.my_role === 'owner';
  box.append(h('div', { class: 'small' }, owner ? 'Anda pemilik proyek ini.' : `Akses Anda: ${j.my_role === 'edit' ? 'boleh mengedit' : 'hanya lihat'}.`));
  if (j.shares.length) box.append(h('table', null, ...j.shares.map(x => h('tr', null, h('td', null, x.display_name || x.username, h('span', { class: 'small mut' }, ' @' + x.username)), h('td', null, x.role === 'edit' ? 'boleh edit' : 'lihat'),
    h('td', null, owner || x.username === SV.user.username ? btn(owner ? 'Cabut' : 'Keluar', async () => { await svApi('DELETE', `/projects/${SV.project.id}/shares/${encodeURIComponent(x.username)}`); SV.shares = null; if (!owner) { SV.project = null; svChip(); } renderPanel(); }, 'sm bad') : null)))));
  if (owner) {
    box.append(h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, h('input', { type: 'text', id: 'shUser', placeholder: 'username rekan / pembimbing' }), sel('view', [['view', 'lihat'], ['edit', 'edit']], v => { SV._shRole = v; }),
      btn('Bagikan', async () => { try { await svApi('POST', `/projects/${SV.project.id}/shares`, { username: $('shUser').value.trim(), role: SV._shRole || 'view' }); SV.shares = null; toast('Dibagikan'); renderPanel(); } catch (e) { toast(e.message); } }, 'sm pri')));
    const url = j.public_token ? `${location.origin}${svBase()}/?p=${j.public_token}` : null;
    box.append(h('div', { class: 'row' }, chk(!!url, 'Tautan publik hanya-baca (tanpa login)', async v => { const r = await svApi('POST', `/projects/${SV.project.id}/public`, { enable: v }); SV.shares = null; toast(v ? 'Tautan publik aktif' : 'Tautan publik dimatikan'); renderPanel(); void r; })));
    if (url) box.append(h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, h('input', { type: 'text', readonly: true, value: url, onclick: e => e.target.select() }), btn('Salin', async () => { try { await navigator.clipboard.writeText(url); toast('Tautan disalin'); } catch (e) { toast('Pilih lalu salin manual'); } }, 'sm')));
  }
  return box;
}

/* ---------- ambil jaringan dari peta OpenStreetMap ---------- */
async function osmDialog() {
  $('mTitle').textContent = 'Ambil jaringan dari OpenStreetMap';
  const body = $('mBody'); body.innerHTML = '';
  const mapDiv = h('div', { id: 'osmMap', style: { height: '46vh', borderRadius: '8px', border: '1px solid var(--line)', background: '#1b2028' } });
  const res = h('div', { class: 'list', style: { maxHeight: '140px' } });
  body.append(h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, h('input', { type: 'text', id: 'osmQ', placeholder: 'Cari lokasi, mis. "Tugu Kujang Bogor"', onkeydown: e => { if (e.key === 'Enter') osmSearch(res); } }), btn('Cari', () => osmSearch(res), 'sm pri')),
    res, mapDiv,
    h('div', { class: 'small mut' }, 'Geser/zoom peta sampai area kajian memenuhi layar (maks ±6 km²), lalu tekan Ambil. Tanpa peta: isi koordinat pusat & radius.'),
    h('div', { class: 'grid2' }, ...field('Lintang, bujur', h('input', { type: 'text', id: 'osmLL', placeholder: '-6.6005, 106.8053' })), ...field('Radius (m)', h('input', { type: 'number', id: 'osmR', value: 400 }))),
    chk(false, 'Sertakan jalan servis/gang', v => { SV._osmService = v; }),
    h('div', { class: 'row' }, h('button', { class: 'btn pri', id: 'osmGo', onclick: osmFetch }, '⬇ Ambil jaringan area ini'), h('span', { class: 'small', id: 'osmMsg' })));
  $('modal').classList.add('on');
  try {
    if (!window.L) {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = svBase() + '/vendor/leaflet/leaflet.css'; document.head.append(css);
      await loadScript(svBase() + '/vendor/leaflet/leaflet.js');
    }
    const loc = S.net && S.net.location && S.net.location.lat0 ? [S.net.location.lat0, S.net.location.lon0] : [-6.5971, 106.7996];
    SV._map = L.map('osmMap').setView(loc, 16);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(SV._map);
  } catch (e) { mapDiv.textContent = 'Peta tidak dapat dimuat (' + e.message + '). Gunakan isian koordinat.'; SV._map = null; }
}
async function osmSearch(res) {
  res.innerHTML = '';
  try {
    const j = await svApi('GET', '/geocode?q=' + encodeURIComponent($('osmQ').value));
    for (const r of j.results) res.append(h('div', { class: 'it', onclick: () => { $('osmLL').value = `${r.lat.toFixed(6)}, ${r.lon.toFixed(6)}`; if (SV._map) SV._map.setView([r.lat, r.lon], 17); } }, h('span', { class: 'small' }, r.name)));
    if (!j.results.length) res.append(h('div', { class: 'small mut' }, 'Tidak ditemukan.'));
  } catch (e) { res.append(h('div', { class: 'small' }, e.message)); }
}
async function osmFetch() {
  const msg = $('osmMsg'); let s_, w, n, e;
  const ll = ($('osmLL').value || '').split(',').map(Number);
  if (ll.length === 2 && ll.every(isFinite) && (!SV._map || $('osmLL').value)) {
    const r = Math.max(50, +$('osmR').value || 400), dLat = r / 110540, dLon = r / (111320 * Math.cos(ll[0] * Math.PI / 180));
    s_ = ll[0] - dLat; n = ll[0] + dLat; w = ll[1] - dLon; e = ll[1] + dLon;
  } else if (SV._map) { const b = SV._map.getBounds(); s_ = b.getSouth(); w = b.getWest(); n = b.getNorth(); e = b.getEast(); }
  else return toast('Isi koordinat pusat');
  msg.textContent = 'Mengunduh dari Overpass…'; $('osmGo').disabled = true;
  try {
    const r = await fetch(`${svBase()}/api/osm?s=${s_}&w=${w}&n=${n}&e=${e}${SV._osmService ? '&service=1' : ''}`, { headers: { Authorization: 'Bearer ' + SV.token } });
    const txt = await r.text();
    if (!r.ok) { let m = txt; try { m = JSON.parse(txt).error; } catch (er) { /* teks */ } throw new Error(m); }
    importTexts([['area.osm', txt]]);
    S.net.lefthand = true; S.net.connections = null; for (const id of Object.keys(S.net.tls)) delete S.net.tls[id]; netChanged(true); fitView();
    $('modal').classList.remove('on');
    toast(`Jaringan OSM dimuat: ${Object.keys(S.net.edges).length} ruas (lajur kiri). Tambahkan arus di tab Demand.`, 5000);
    setTab('net');
  } catch (er) { msg.textContent = '✗ ' + er.message; }
  $('osmGo').disabled = false;
}
