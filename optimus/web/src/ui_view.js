/* ===== Optimus UI: state, rendering (sumo-gui view), input ===== */
const $ = id => document.getElementById(id);
/* skip null/false children so conditional UI parts never show up as the text "null" */
for (const P of [Element.prototype, DocumentFragment.prototype]) for (const m of ['append', 'prepend']) {
  const orig = P[m]; P[m] = function (...a) { return orig.apply(this, a.filter(x => x !== null && x !== undefined && x !== false)); };
}
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && k !== 'list' && k !== 'type') { try { el[k] = v; } catch (e) { el.setAttribute(k, v); } }
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
const kmh = v => v * 3.6, mps = v => v / 3.6;
const fmt = (v, n = 1) => (v === undefined || v === null || isNaN(v)) ? '–' : Number(v).toFixed(n);
function toast(msg, ms = 2200) { const t = $('toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(toast._t); toast._t = setTimeout(() => t.style.display = 'none', ms); }
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
};

const S = {
  net: null, demand: null, add: null, cfg: SW.defaultConfig(), T: null, sim: null,
  tab: 'net', mode: 'inspect', sel: null, hover: null,
  view: { cx: 0, cy: 0, scale: 2 }, running: false, scripting: false,
  opts: { twoWay: true, lanes: 1, speedKmh: 50, nodeType: 'priority', snap: 0, priority: -1, layer: 0 },
  colorVeh: 'type', colorEdge: 'none', labels: { edges: false, nodes: false, veh: false, links: false, det: true },
  bg: null, chain: null, routeBuild: [], pick: null, detTool: 'e1', track: null, undo: [], redo: [], drag: null,
  lastFrame: 0, acc: 0, need: true, scenarioName: 'scenario', finished: false
};
window.S = S;

/* ---------- model helpers ---------- */
function loadScenario(ex, name) {
  S.net = ex.net; S.demand = ex.demand; S.add = ex.add || SW.newAdditional();
  if (ex.cfg) Object.assign(S.cfg, ex.cfg);
  S.sel = null; S.chain = null; S.routeBuild = []; S.track = null; S.undo = []; S.redo = [];
  if (name) S.scenarioName = name;
  if (typeof SV !== 'undefined' && SV.on && !SV._loading) { SV.project = null; SV.runs = []; SV.dirty = false; if (typeof svChip === 'function') svChip(); }
  netChanged(true);
  fitView();
}
function snapshot() { return JSON.stringify({ net: S.net, demand: S.demand, add: S.add }); }
function restore(js) { const o = JSON.parse(js); S.net = o.net; S.demand = o.demand; S.add = o.add; netChanged(true); }
function pushUndo() { S.undo.push(snapshot()); if (S.undo.length > 60) S.undo.shift(); S.redo = []; }
function undo() { if (!S.undo.length) return toast('Tidak ada yang bisa di-undo'); S.redo.push(snapshot()); restore(S.undo.pop()); S.sel = null; renderPanel(); }
function redo() { if (!S.redo.length) return toast('Tidak ada yang bisa di-redo'); S.undo.push(snapshot()); restore(S.redo.pop()); S.sel = null; renderPanel(); }
function netChanged(keepPanel) {
  stopSim();
  S.sim = null; S.finished = false;
  try { S.T = SW.buildTopo(S.net); } catch (e) { console.error(e); toast('Galat topologi: ' + e.message); }
  S.need = true;
  autosave();
  if (!keepPanel) renderPanel();
  updateTime();
}
function demandChanged() { stopSim(); S.sim = null; S.finished = false; S.need = true; autosave(); updateTime(); }
let _saveT = null;
function autosave() { if (typeof svMarkDirty === 'function') svMarkDirty(); clearTimeout(_saveT); _saveT = setTimeout(() => store.set('optimus.project', JSON.stringify({ net: S.net, demand: S.demand, add: S.add, cfg: S.cfg, name: S.scenarioName })), 600); }
function topo() { return S.sim ? S.sim.T : S.T; }
function ensureSim() {
  if (!S.sim) {
    S.sim = new SW.Sim(S.net, S.demand, S.add, S.cfg);
    S.sim.hooks.step = () => { };
    S.finished = false;
  }
  return S.sim;
}
function stopSim() { S.running = false; const b = $('bPlay'); if (b) b.textContent = '▶'; }

/* ---------- view transform ---------- */
const cv = $('cv'); let ctx = cv.getContext('2d');
let DPR = 1, CW = 0, CH = 0;
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  const r = cv.getBoundingClientRect(); CW = r.width; CH = r.height;
  cv.width = Math.max(1, Math.round(CW * DPR)); cv.height = Math.max(1, Math.round(CH * DPR));
  S.need = true;
}
const w2s = (x, y) => [(x - S.view.cx) * S.view.scale + CW / 2, CH / 2 - (y - S.view.cy) * S.view.scale];
const s2w = (sx, sy) => [(sx - CW / 2) / S.view.scale + S.view.cx, (CH / 2 - sy) / S.view.scale + S.view.cy];
function fitView() {
  const ns = Object.values(S.net.nodes);
  if (!ns.length) { S.view = { cx: 0, cy: 0, scale: 2 }; S.need = true; return; }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of ns) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); }
  for (const e of Object.values(S.net.edges)) for (const p of e.shape) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  const pad = 40, bottom = 70;
  const sc = Math.min((CW - pad * 2) / Math.max(20, x1 - x0), (CH - pad - bottom) / Math.max(20, y1 - y0));
  S.view = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 - bottom / 2 / sc + pad / 2 / sc, scale: Math.max(0.02, Math.min(40, sc)) };
  S.need = true;
}

/* ---------- colors ---------- */
function speedColor(v, vmax) {
  const t = Math.max(0, Math.min(1, v / Math.max(0.1, vmax)));
  const stops = [[0, [230, 40, 40]], [0.5, [255, 210, 0]], [1, [40, 210, 80]]];
  let a = stops[0], b = stops[2];
  for (let i = 0; i < stops.length - 1; i++) if (t >= stops[i][0] && t <= stops[i + 1][0]) { a = stops[i]; b = stops[i + 1]; }
  const u = (t - a[0]) / Math.max(1e-6, b[0] - a[0]);
  const c = a[1].map((x, i) => Math.round(x + (b[1][i] - x) * u));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
function rampColor(t) { t = Math.max(0, Math.min(1, t)); return `rgb(${Math.round(40 + 215 * t)},${Math.round(200 - 160 * t)},${Math.round(90 - 50 * t)})`; }
const routeColorCache = {};
function hashColor(s) { if (routeColorCache[s]) return routeColorCache[s]; let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return routeColorCache[s] = `hsl(${h % 360},70%,60%)`; }
function vehColor(v) {
  switch (S.colorVeh) {
    case 'speed': return speedColor(v.v, Math.min(v.vt.maxSpeed, v.seg.speed));
    case 'waiting': return v.wait > 0 ? rampColor(Math.min(1, v.wait / 60)) : '#3fbf6f';
    case 'co2': return rampColor(Math.min(1, v.emStep.CO2 / S.sim.dt / 8));
    case 'route': return hashColor(v.route[0] + '>' + v.route[v.route.length - 1]);
    case 'battery': return v.vt.emissionClass === 'Energy' ? rampColor(1 - v.battery / (v.vt.batteryCapacity || 35000)) : '#555';
    case 'accel': return v.a < -0.5 ? '#ff5050' : v.a > 0.3 ? '#50ff70' : '#d0d0d0';
    default: return v.color;
  }
}
function edgeValue(id) {
  const sim = S.sim; if (!sim || S.colorEdge === 'none') return null;
  const st = sim.edgeStats[id], te = sim.T.edges[id];
  switch (S.colorEdge) {
    case 'speed': return st.n ? speedColor(st.speed, te.e.speed) : null;
    case 'density': { const d = st.n / Math.max(0.01, te.length * te.lanes.length / 1000); return st.n ? rampColor(d / 120) : null; }
    case 'co2': { const iv = st.intervals[st.intervals.length - 1]; const val = st.co2 || (iv ? iv.CO2_abs / Math.max(1, iv.end - iv.begin) : 0); return val > 0 ? rampColor(val / 20) : null; }
    case 'halting': return st.halting ? rampColor(st.halting / Math.max(1, te.length * te.lanes.length / 7.5) * 1.5) : null;
    default: return null;
  }
}

/* ---------- rendering ---------- */
function strokePoly(pts) { ctx.beginPath(); pts.forEach((p, i) => { const [x, y] = w2s(p.x, p.y); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.stroke(); }
function draw() {
  const T = topo(); if (!T) return;
  const sc = S.view.scale, W = SW.LANE_W;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#10141a'; ctx.fillRect(0, 0, CW, CH);
  // background (GIS map)
  if (S.bg && S.bg.img) {
    const b = S.bg; const [x, y] = w2s(b.x, b.y + b.h);
    ctx.globalAlpha = b.alpha; ctx.drawImage(b.img, x, y, b.w * sc, b.h * sc); ctx.globalAlpha = 1;
  }
  // grid
  if (S.opts.snap > 0 && S.tab === 'net' && S.opts.snap * sc > 6) {
    ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.lineWidth = 1;
    const [x0, y1] = s2w(0, 0), [x1, y0] = s2w(CW, CH), g = S.opts.snap;
    ctx.beginPath();
    for (let x = Math.floor(x0 / g) * g; x <= x1; x += g) { const [sx] = w2s(x, 0); ctx.moveTo(sx, 0); ctx.lineTo(sx, CH); }
    for (let y = Math.floor(y0 / g) * g; y <= y1; y += g) { const [, sy] = w2s(0, y); ctx.moveTo(0, sy); ctx.lineTo(CW, sy); }
    ctx.stroke();
  }
  const laneW = W * sc, thin = laneW < 1.4;
  ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
  const selEdge = S.sel && S.sel.kind === 'edge' ? S.sel.id : null;
  const routeSet = new Set(S.routeBuild);
  const layers = [...new Set(Object.values(T.edges).map(te => te.layer || 0))].sort((a, b) => a - b);
  function drawLayer(lay, labelsOnly) {
    const tes = Object.values(T.edges).filter(te => (te.layer || 0) === lay);
    if (!tes.length) return;
    if (!labelsOnly && lay !== 0) {
      for (const te of tes) {
        const w = Math.max(thin ? 2 : 3, (te.lanes.length * W + (lay > 0 ? 1.4 : 1.0)) * sc);
        if (lay > 0) {
          ctx.save(); ctx.translate(Math.min(14, 0.45 * sc * lay + 1), Math.min(16, 0.6 * sc * lay + 1));
          ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = w; strokePoly(te.mid); ctx.restore();
        }
        ctx.strokeStyle = lay > 0 ? '#b7c0cc' : '#1a1e25'; ctx.lineWidth = w;
        if (lay < 0 && thin) ctx.setLineDash([6, 4]);
        strokePoly(te.mid); ctx.setLineDash([]);
      }
    }
    const base = lay > 0 ? '#5a6271' : lay < 0 ? '#2f3540' : '#4a5262';
    if (!labelsOnly) for (const te of tes) {
      const col = edgeValue(te.id);
      const hi = te.id === selEdge || routeSet.has(te.id) || (S.hover && S.hover.kind === 'edge' && S.hover.id === te.id);
      if (thin) {
        ctx.strokeStyle = hi ? '#4f9dff' : (col || (lay > 0 ? '#8d9cb2' : lay < 0 ? '#3b4351' : '#5a6474')); ctx.lineWidth = Math.max(1, te.lanes.length * laneW);
        strokePoly(te.center); continue;
      }
      for (const L of te.lanes) {
        ctx.strokeStyle = hi ? (routeSet.has(te.id) ? '#2f7d5b' : '#2c5a96') : (col || base);
        ctx.lineWidth = laneW; strokePoly(L.shape);
      }
      if (laneW > 5) {
        ctx.setLineDash([3 * sc, 6 * sc]); ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = Math.max(0.6, 0.12 * sc);
        for (let i = 1; i < te.lanes.length; i++) strokePoly(SW.geom.offset(te.center, te.lanes[i].off + W / 2));
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,255,255,.65)';
        for (const L of te.lanes) {
          if (L.length < 12) continue;
          const p = SW.geom.posAt(L.shape, L.cum, L.length - 6);
          drawArrows(p, new Set(L.out.map(c => c.dir)), sc);
        }
      }
    }
    if (lay !== 0 && sc > 0.5 && (labelsOnly || lay > 0)) {
      ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
      const seen = new Set();
      for (const te of tes) {
        const key = [te.from, te.to].sort().join('|'); if (seen.has(key)) continue; seen.add(key);
        const c = te.mid, cc = SW.geom.cum(c); if (cc[cc.length - 1] * sc < 90) continue;
        const p = SW.geom.posAt(c, cc, cc[cc.length - 1] / 2), [x, y] = w2s(p.x, p.y);
        const txt = (lay > 0 ? '▲ ' : '▼ ') + (SW.LEVEL_NAMES[lay] || 'Level ' + lay) + ' ' + Math.abs(te.elev ? te.elev.h : 0) + ' m';
        const tw = ctx.measureText(txt).width;
        ctx.fillStyle = lay > 0 ? 'rgba(20,40,70,.85)' : 'rgba(0,0,0,.75)'; ctx.fillRect(x - tw / 2 - 4, y - 8, tw + 8, 15);
        ctx.fillStyle = lay > 0 ? '#9fd0ff' : '#ffcf8a'; ctx.fillText(txt, x, y + 3);
      }
    }
  }
  for (const lay of layers.filter(l => l < 0)) { drawLayer(lay); if (S.sim) { ctx.globalAlpha = 0.85; drawVehicles(lay); ctx.globalAlpha = 1; } }
  // junctions
  for (const tn of Object.values(T.nodes)) {
    const [x, y] = w2s(tn.n.x, tn.n.y);
    const r = Math.max(tn.r * sc, thin ? 1.5 : 2);
    ctx.fillStyle = '#353c49';
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  }
  // internal lanes
  if (!thin) {
    ctx.strokeStyle = '#353c49'; ctx.lineWidth = laneW;
    for (const c of T.conns) strokePoly(c.shape);
  }
  drawLayer(0);
  // edge border for selected edge (shape points)
  if (selEdge && S.net.edges[selEdge] && S.tab === 'net') {
    for (const p of S.net.edges[selEdge].shape) { const [x, y] = w2s(p.x, p.y); ctx.fillStyle = '#4f9dff'; ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.fill(); }
  }
  // traffic light states
  const tlsStates = {};
  if (S.sim) for (const [id, st] of Object.entries(S.sim.tls)) tlsStates[id] = st.override || st.prog.phases[st.phase].state;
  else for (const id of T.tlsNodes) { const p = S.net.tls[id]; const pi = S.tab === 'tls' && S.selPid === id && S.selPhase !== undefined ? S.selPhase : 0; if (p && p.phases[pi]) tlsStates[id] = p.phases[pi].state; }
  const chCol = { G: '#00e000', g: '#00a800', y: '#ffd400', Y: '#ffd400', r: '#ff2020', u: '#ff8000', o: '#808080', O: '#808080', s: '#a000a0' };
  for (const tn of Object.values(T.nodes)) {
    const isTL = tn.links.length > 0 && tn.links[0].tl && tlsStates[tn.links[0].tl] !== undefined;
    if (!isTL && !(S.labels.links && sc > 2)) continue;
    const byLane = {};
    for (const c of tn.links) (byLane[c.fromL.id] = byLane[c.fromL.id] || []).push(c);
    for (const list of Object.values(byLane)) {
      const L = list[0].fromL, n = list.length;
      const end = L.shape[L.shape.length - 1], a = SW.geom.posAt(L.shape, L.cum, L.length).a;
      const nx = -Math.sin(a), ny = Math.cos(a);
      list.forEach((c, i) => {
        const o0 = -W / 2 + W * i / n, o1 = -W / 2 + W * (i + 1) / n;
        const p0 = w2s(end.x + nx * o0, end.y + ny * o0), p1 = w2s(end.x + nx * o1, end.y + ny * o1);
        if (isTL) {
          const ch = tlsStates[c.tl][c.tlIndex] || 'r';
          ctx.strokeStyle = chCol[ch] || '#888'; ctx.lineWidth = Math.max(2, 0.6 * sc);
          ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
        }
        if (S.labels.links && sc > 2.5) {
          ctx.fillStyle = '#fff'; ctx.font = `${Math.max(9, Math.min(13, sc * 1.2))}px sans-serif`; ctx.textAlign = 'center';
          const q = w2s(end.x + nx * (o0 + o1) / 2 - Math.cos(a) * 2.2, end.y + ny * (o0 + o1) / 2 - Math.sin(a) * 2.2);
          ctx.fillText(c.tl ? c.tlIndex : c.linkIndex, q[0], q[1] + 4);
        }
      });
    }
  }
  if (S.sim) drawVehicles(0);
  for (const lay of layers.filter(l => l > 0)) { drawLayer(lay); if (S.sim) drawVehicles(lay); }
  for (const lay of layers.filter(l => l < 0)) drawLayer(lay, true);
  drawFacilities(T, sc);
  // detectors
  if (S.labels.det) {
    for (const d of S.add.e2) {
      const L = T.lanes[d.lane]; if (!L) continue;
      const s1 = Math.min(L.length, d.pos + d.length), pts = [SW.geom.posAt(L.shape, L.cum, d.pos)];
      for (let i = 0; i < L.shape.length; i++) if (L.cum[i] > d.pos && L.cum[i] < s1) pts.push(L.shape[i]);
      pts.push(SW.geom.posAt(L.shape, L.cum, s1));
      ctx.strokeStyle = (S.sel && S.sel.kind === 'e2' && S.sel.id === d.id) ? 'rgba(120,200,255,.75)' : 'rgba(40,140,255,.38)'; ctx.lineWidth = Math.max(2, laneW * 0.8); strokePoly(pts);
    }
    for (const d of S.add.e1) {
      const L = T.lanes[d.lane]; if (!L) continue;
      const p = SW.geom.posAt(L.shape, L.cum, Math.min(d.pos, L.length)), nx = -Math.sin(p.a), ny = Math.cos(p.a);
      const a = w2s(p.x + nx * W * 0.45, p.y + ny * W * 0.45), b = w2s(p.x - nx * W * 0.45, p.y - ny * W * 0.45);
      const act = S.sim && S.sim.e1.find(x => x.d.id === d.id && x.last.occ > 0);
      ctx.strokeStyle = (S.sel && S.sel.kind === 'e1' && S.sel.id === d.id) ? '#fff' : act ? '#ff4040' : '#ffd400'; ctx.lineWidth = Math.max(2, 1.2 * sc);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
  }
  // nodes (edit markers)
  const showNodes = S.tab === 'net' || S.tab === 'tls';
  if (showNodes) {
    for (const tn of Object.values(T.nodes)) {
      const [x, y] = w2s(tn.n.x, tn.n.y);
      const sel = S.sel && S.sel.kind === 'node' && S.sel.id === tn.id, ch = S.chain === tn.id;
      const hov = S.hover && S.hover.kind === 'node' && S.hover.id === tn.id;
      ctx.strokeStyle = sel || ch ? '#4f9dff' : hov ? '#9cc7ff' : tn.n.type === 'traffic_light' ? '#ffb347' : 'rgba(255,255,255,.35)';
      ctx.lineWidth = sel || ch ? 2.5 : 1.2;
      ctx.beginPath(); ctx.arc(x, y, Math.max(5, tn.r * sc), 0, 7); ctx.stroke();
    }
  }
  // labels
  ctx.textAlign = 'center';
  if (S.labels.edges && sc > 0.6) {
    ctx.font = '11px sans-serif';
    for (const te of Object.values(T.edges)) {
      const c = te.center, cc = SW.geom.cum(c), p = SW.geom.posAt(c, cc, cc[cc.length - 1] / 2);
      const off = te.spreadRight ? -te.lanes.length * W / 2 : 0;
      const [x, y] = w2s(p.x - Math.sin(p.a) * off, p.y + Math.cos(p.a) * off);
      ctx.fillStyle = 'rgba(0,0,0,.6)'; const tw = ctx.measureText(te.id).width; ctx.fillRect(x - tw / 2 - 2, y - 7, tw + 4, 13);
      ctx.fillStyle = '#cfe3ff'; ctx.fillText(te.id, x, y + 3);
    }
  }
  if (S.labels.nodes) {
    ctx.font = 'bold 11px sans-serif';
    for (const tn of Object.values(T.nodes)) { const [x, y] = w2s(tn.n.x, tn.n.y); ctx.fillStyle = '#ffd88a'; ctx.fillText(tn.id, x, y - Math.max(7, tn.r * sc) - 3); }
  }
  // create-mode preview
  if (S.tab === 'net' && S.mode === 'create' && S.chain && S.mouseW && S.net.nodes[S.chain]) {
    const n = S.net.nodes[S.chain], [x0, y0] = w2s(n.x, n.y), [x1, y1] = w2s(S.mouseW[0], S.mouseW[1]);
    ctx.strokeStyle = '#4f9dff'; ctx.setLineDash([6, 4]); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.setLineDash([]);
  }
  // scale bar
  drawScale();
}
/* zebra / pelican crossings, pedestrians, bus stops */
function crossingGeom(T, cr) {
  const te = T.edges[cr.edge]; if (!te) return null;
  const c = te.center, cc = SW.geom.cum(c), pos = Math.max(2, Math.min(cc[cc.length - 1] - 1, +cr.pos));
  const P = SW.geom.posAt(c, cc, pos);
  const n = te.lanes.length + (te.rev && T.edges[te.rev] ? T.edges[te.rev].lanes.length : 0);
  return { P, width: n * SW.LANE_W + 1, half: (cr.width || 4) / 2 };
}
function drawFacilities(T, sc) {
  const W = SW.LANE_W;
  const live = {}; if (S.sim && S.sim.crossings) for (const c of S.sim.crossings) live[c.d.id] = c;
  for (const cr of S.add.crossings || []) {
    const g = crossingGeom(T, cr); if (!g) continue;
    const { P, width, half } = g, a = P.a, ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux;
    const sel = S.sel && S.sel.kind === 'crossing' && S.sel.id === cr.id;
    if (sc * half * 2 > 3) {
      const stripes = Math.max(3, Math.round(width / 0.9));
      ctx.fillStyle = sel ? 'rgba(120,190,255,.95)' : 'rgba(245,245,245,.9)';
      for (let k = 0; k < stripes; k += 2) {
        const o0 = -width / 2 + k * width / stripes, o1 = o0 + width / stripes;
        const q = [[-half, o0], [half, o0], [half, o1], [-half, o1]].map(([l, t]) => w2s(P.x + ux * l + vx * t, P.y + uy * l + vy * t));
        ctx.beginPath(); q.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.fill();
      }
    } else { const [x, y] = w2s(P.x, P.y); ctx.fillStyle = '#eee'; ctx.fillRect(x - 2, y - 2, 4, 4); }
    const lc = live[cr.id];
    if (cr.type === 'pelican' || cr.type === 'tls') {
      const col = lc ? (cr.type === 'pelican' ? (lc.phase === 'ped' ? '#00e000' : lc.phase === 'clr' ? '#ffd400' : '#ff2020') : (lc.walkOk ? '#00e000' : '#ff2020')) : '#888';
      for (const sgn of [-1, 1]) { const [x, y] = w2s(P.x + vx * sgn * (width / 2 + 0.8), P.y + vy * sgn * (width / 2 + 0.8)); ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(x, y, Math.max(3, sc * 0.6), 0, 7); ctx.fill(); ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, Math.max(2, sc * 0.45), 0, 7); ctx.fill(); }
    }
    if (sc > 1.2) { const [x, y] = w2s(P.x + vx * (width / 2 + 2.5), P.y + vy * (width / 2 + 2.5)); ctx.fillStyle = '#ddd'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText({ zebra: 'zebra', pelican: 'pelican', tls: 'ikut lampu' }[cr.type] || cr.type, x, y); }
  }
  if (S.sim && S.sim.peds) for (const p of S.sim.peds) {
    const q = S.sim.pedPose(p), [x, y] = w2s(q.x, q.y);
    ctx.fillStyle = p.state === 'walk' ? '#ffffff' : '#ffa53a';
    ctx.beginPath(); ctx.arc(x, y, Math.max(1.8, 0.32 * sc), 0, 7); ctx.fill();
  }
  for (const b of S.add.busStops || []) {
    const L = T.lanes[b.lane]; if (!L) continue;
    const s0 = Math.max(0, +b.startPos), s1 = Math.min(L.length, +b.endPos);
    const curb = L.edge.lanes.length > 1 ? Math.sign(L.edge.lanes[0].off - L.edge.lanes[1].off) || 1 : (S.net.lefthand ? 1 : -1);
    const pts = []; for (let s = s0; s <= s1 + 0.01; s += Math.max(1, (s1 - s0) / 8)) { const q = SW.geom.posAt(L.shape, L.cum, s); pts.push({ x: q.x - Math.sin(q.a) * curb * (W / 2 + 1), y: q.y + Math.cos(q.a) * curb * (W / 2 + 1) }); }
    const sel = S.sel && S.sel.kind === 'busStop' && S.sel.id === b.id;
    ctx.strokeStyle = sel ? '#ffffff' : '#ffd400'; ctx.lineWidth = Math.max(3, 1.6 * sc); strokePoly(pts);
    if (sc > 0.8) { const m = pts[Math.floor(pts.length / 2)], [x, y] = w2s(m.x, m.y); ctx.fillStyle = '#ffd400'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('🚏 ' + (b.name || b.id), x, y - 6); }
  }
}
function drawArrows(p, dirs, sc) {
  const [x, y] = w2s(p.x, p.y), a = -p.a, s = Math.min(1.1 * sc, 14);
  ctx.save(); ctx.translate(x, y); ctx.rotate(a);
  for (const d of dirs) {
    ctx.beginPath();
    if (d === 's') { ctx.moveTo(-s, 0); ctx.lineTo(s * 0.6, 0); ctx.moveTo(s, 0); ctx.lineTo(s * 0.3, -s * 0.35); ctx.lineTo(s * 0.3, s * 0.35); ctx.closePath(); }
    else if (d === 'l') { ctx.moveTo(-s, 0); ctx.lineTo(0, 0); ctx.lineTo(0, -s * 0.6); ctx.moveTo(0, -s); ctx.lineTo(-s * 0.35, -s * 0.5); ctx.lineTo(s * 0.35, -s * 0.5); ctx.closePath(); }
    else if (d === 'r') { ctx.moveTo(-s, 0); ctx.lineTo(0, 0); ctx.lineTo(0, s * 0.6); ctx.moveTo(0, s); ctx.lineTo(-s * 0.35, s * 0.5); ctx.lineTo(s * 0.35, s * 0.5); ctx.closePath(); }
    else continue;
    ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = Math.max(0.8, s * 0.12); ctx.stroke(); ctx.fill();
  }
  ctx.restore();
}
function drawVehicles(layer) {
  const sim = S.sim, sc = S.view.scale;
  const flash = Math.floor(performance.now() / 250) % 2;
  for (const v of sim.vehs.values()) {
    if (layer !== undefined && sim.vehLayer(v) !== layer) continue;
    const p = sim.vehPose(v);
    const [x, y] = w2s(p.x, p.y);
    if (x < -50 || y < -50 || x > CW + 50 || y > CH + 50) continue;
    const L = v.vt.length * sc, Wd = (v.vt.width || 1.8) * sc;
    ctx.save(); ctx.translate(x, y); ctx.rotate(-p.a);
    ctx.fillStyle = vehColor(v);
    if (L < 2.5) { ctx.fillRect(-Math.max(2, L), -1.2, Math.max(2, L), 2.4); }
    else {
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(-L * 0.18, -Wd / 2); ctx.lineTo(-L, -Wd / 2); ctx.lineTo(-L, Wd / 2); ctx.lineTo(-L * 0.18, Wd / 2); ctx.closePath(); ctx.fill();
      if (L > 10) { ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(-L * 0.42, -Wd * 0.38, L * 0.16, Wd * 0.76); }
      if (v.vt.vClass === 'emergency') { ctx.fillStyle = flash ? '#2f6bff' : '#ff2f2f'; ctx.fillRect(-L * 0.5, -Wd * 0.3, L * 0.12, Wd * 0.6); }
      if (v.a < -1 && L > 8) { ctx.fillStyle = '#ff2020'; ctx.fillRect(-L - 0.6, -Wd / 2, 1.2, Wd * 0.25); ctx.fillRect(-L - 0.6, Wd / 4, 1.2, Wd * 0.25); }
    }
    ctx.restore();
    if (v.dwell > 0 && L > 4) { ctx.fillStyle = '#ffd400'; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 7); ctx.fill(); }
    const isSel = (S.sel && S.sel.kind === 'veh' && S.sel.id === v.id) || S.track === v.id;
    if (isSel || (v.highlight && v.highlight > sim.t)) { ctx.strokeStyle = '#4f9dff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, Math.max(10, L * 0.7), 0, 7); ctx.stroke(); }
    if (S.labels.veh && sc > 2) { ctx.fillStyle = '#fff'; ctx.font = '10px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(v.id, x + 6, y - 6); }
  }
}
function drawScale() {
  const sc = S.view.scale; const target = 120 / sc;
  const pow = Math.pow(10, Math.floor(Math.log10(target)));
  let m = pow; for (const k of [1, 2, 5, 10]) if (k * pow <= target) m = k * pow;
  const px = m * sc, x = CW - px - 14, y = CH - 70;
  ctx.strokeStyle = '#cfd6e0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + px, y); ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4); ctx.moveTo(x + px, y - 4); ctx.lineTo(x + px, y + 4); ctx.stroke();
  ctx.fillStyle = '#cfd6e0'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(m >= 1000 ? (m / 1000) + ' km' : m + ' m', x + px / 2, y - 6);
}

/* ---------- hit testing ---------- */
function hitTest(wx, wy, kinds) {
  const T = topo(), pt = { x: wx, y: wy }, tol = 6 / S.view.scale;
  kinds = kinds || ['veh', 'busStop', 'crossing', 'e1', 'e2', 'node', 'edge'];
  if (kinds.includes('veh') && S.sim) {
    let best = null, bd = Infinity;
    for (const v of S.sim.vehs.values()) {
      const p = S.sim.vehPose(v);
      const cx = p.x - Math.cos(p.a) * v.vt.length / 2, cy = p.y - Math.sin(p.a) * v.vt.length / 2;
      const d = Math.hypot(cx - wx, cy - wy);
      if (d < Math.max(v.vt.length * 0.7, tol * 1.5) && d < bd) { bd = d; best = v; }
    }
    if (best) return { kind: 'veh', id: best.id };
  }
  if (kinds.includes('busStop')) for (const b of S.add.busStops || []) { const L = T.lanes[b.lane]; if (!L) continue; const r = SW.geom.distToPoly(pt, L.shape); if (r.d < SW.LANE_W && r.s >= b.startPos - 2 && r.s <= b.endPos + 2) return { kind: 'busStop', id: b.id }; }
  if (kinds.includes('crossing')) for (const cr of S.add.crossings || []) { const g = crossingGeom(T, cr); if (g && Math.hypot(g.P.x - wx, g.P.y - wy) < Math.max(g.width / 2, tol * 2)) return { kind: 'crossing', id: cr.id }; }
  if (kinds.includes('e1')) for (const d of S.add.e1) { const L = T.lanes[d.lane]; if (!L) continue; const p = SW.geom.posAt(L.shape, L.cum, d.pos); if (Math.hypot(p.x - wx, p.y - wy) < Math.max(2, tol)) return { kind: 'e1', id: d.id }; }
  if (kinds.includes('node')) {
    let best = null, bd = Infinity;
    for (const tn of Object.values(T.nodes)) { const d = Math.hypot(tn.n.x - wx, tn.n.y - wy); if (d < Math.max(tn.r, tol * 1.6) && d < bd) { bd = d; best = tn; } }
    if (best) return { kind: 'node', id: best.id };
  }
  if (kinds.includes('e2')) for (const d of S.add.e2) { const L = T.lanes[d.lane]; if (!L) continue; const r = SW.geom.distToPoly(pt, L.shape); if (r.d < SW.LANE_W / 2 && r.s >= d.pos && r.s <= d.pos + d.length) return { kind: 'e2', id: d.id }; }
  if (kinds.includes('edge') || kinds.includes('lane')) {
    let best = null, bd = Infinity, bl = -99;
    for (const L of Object.values(T.lanes)) {
      const r = SW.geom.distToPoly(pt, L.shape), lay = L.layer || 0;
      if (r.d < Math.max(SW.LANE_W / 2, tol) && (lay > bl || (lay === bl && r.d < bd))) { bd = r.d; bl = lay; best = { kind: kinds.includes('lane') ? 'lane' : 'edge', id: kinds.includes('lane') ? L.id : L.edge.id, lane: L.id, s: r.s, layer: lay }; }
    }
    if (best) return best;
  }
  return null;
}

/* ---------- input (mouse / touch / pinch) ---------- */
const pointers = new Map();
let gesture = null;
cv.addEventListener('pointerdown', e => {
  cv.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    gesture = { pinch: true, d0: Math.hypot(a.x - b.x, a.y - b.y), s0: S.view.scale, c: s2w((a.x + b.x) / 2, (a.y + b.y) / 2) };
    S.drag = null; return;
  }
  const [wx, wy] = s2w(e.offsetX, e.offsetY);
  gesture = { x0: e.offsetX, y0: e.offsetY, cx: S.view.cx, cy: S.view.cy, moved: false, t: Date.now() };
  if (S.tab === 'net' && S.mode === 'move') {
    const hn = hitTest(wx, wy, ['node']);
    if (hn) { pushUndo(); S.drag = { kind: 'node', id: hn.id }; return; }
    // shape point?
    for (const ed of Object.values(S.net.edges)) {
      const i = ed.shape.findIndex(p => Math.hypot(p.x - wx, p.y - wy) < 8 / S.view.scale);
      if (i >= 0) { pushUndo(); S.drag = { kind: 'shape', id: ed.id, i }; S.sel = { kind: 'edge', id: ed.id }; return; }
    }
    const he = hitTest(wx, wy, ['edge']);
    if (he) {
      pushUndo();
      const ed = S.net.edges[he.id], A = S.net.nodes[ed.from], B = S.net.nodes[ed.to];
      const full = [A, ...ed.shape, B]; const r = SW.geom.distToPoly({ x: wx, y: wy }, full); const c = SW.geom.cum(full);
      let idx = 0; while (idx < c.length - 1 && c[idx + 1] < r.s) idx++;
      ed.shape.splice(idx, 0, { x: wx, y: wy });
      const rev = Object.values(S.net.edges).find(x => x.from === ed.to && x.to === ed.from && x.shape.length === ed.shape.length - 1);
      S.drag = { kind: 'shape', id: ed.id, i: idx, rev: rev ? rev.id : null };
      if (rev) rev.shape.splice(rev.shape.length - idx, 0, { x: wx, y: wy });
      S.sel = { kind: 'edge', id: ed.id };
      return;
    }
  }
});
cv.addEventListener('pointermove', e => {
  const [wx, wy] = s2w(e.offsetX, e.offsetY);
  S.mouseW = [wx, wy];
  const g = S.net && SW.geoOf(S.net, wx, wy);
  $('coords').textContent = `x ${wx.toFixed(1)}  y ${wy.toFixed(1)}` + (g ? `  |  ${g.lat.toFixed(6)}, ${g.lon.toFixed(6)}` : '');
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
  if (gesture && gesture.pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    S.view.scale = Math.max(0.02, Math.min(60, gesture.s0 * d / Math.max(1, gesture.d0)));
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const [nx, ny] = s2w(mx, my); S.view.cx += gesture.c[0] - nx; S.view.cy += gesture.c[1] - ny;
    S.need = true; return;
  }
  if (!gesture || !pointers.has(e.pointerId)) {
    if (S.tab === 'net' || S.tab === 'tls' || S.tab === 'demand') { const hv = hitTest(wx, wy, ['node', 'edge']); if (JSON.stringify(hv) !== JSON.stringify(S.hover)) { S.hover = hv; S.need = true; } }
    if (S.mode === 'create') S.need = true;
    return;
  }
  const dx = e.offsetX - gesture.x0, dy = e.offsetY - gesture.y0;
  if (Math.hypot(dx, dy) > 5) gesture.moved = true;
  if (S.drag) {
    let x = wx, y = wy;
    if (S.opts.snap > 0) { x = Math.round(x / S.opts.snap) * S.opts.snap; y = Math.round(y / S.opts.snap) * S.opts.snap; }
    if (S.drag.kind === 'node') { const n = S.net.nodes[S.drag.id]; n.x = x; n.y = y; }
    else { const ed = S.net.edges[S.drag.id]; ed.shape[S.drag.i] = { x, y }; if (S.drag.rev) { const r = S.net.edges[S.drag.rev]; r.shape[r.shape.length - 1 - S.drag.i] = { x, y }; } }
    S.T = SW.buildTopo(S.net); S.sim = null; S.need = true; return;
  }
  if (gesture.moved) { S.view.cx = gesture.cx - dx / S.view.scale; S.view.cy = gesture.cy + dy / S.view.scale; S.track = null; S.need = true; }
});
function endPointer(e) {
  pointers.delete(e.pointerId);
  if (gesture && gesture.pinch) { if (pointers.size === 0) gesture = null; return; }
  if (S.drag) { S.drag = null; netChanged(); return; }
  if (gesture && !gesture.moved && e.type === 'pointerup') { const [wx, wy] = s2w(e.offsetX, e.offsetY); onClick(wx, wy, e); }
  gesture = null;
}
cv.addEventListener('pointerup', endPointer);
cv.addEventListener('pointercancel', endPointer);
cv.addEventListener('wheel', e => {
  e.preventDefault();
  const [wx, wy] = s2w(e.offsetX, e.offsetY);
  S.view.scale = Math.max(0.02, Math.min(60, S.view.scale * Math.pow(1.0015, -e.deltaY)));
  const [nx, ny] = s2w(e.offsetX, e.offsetY); S.view.cx += wx - nx; S.view.cy += wy - ny; S.need = true;
}, { passive: false });
window.addEventListener('keydown', e => {
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  if (e.key === 'Escape') { S.chain = null; S.pick = null; S.routeBuild = S.mode === 'route' ? [] : S.routeBuild; S.need = true; setHint(); }
  else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  else if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
  else if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); redo(); }
  else if (S.tab === 'net') {
    const m = { i: 'inspect', e: 'create', m: 'move', d: 'delete' }[e.key];
    if (m) setMode(m);
    if (e.key === 'Delete' && S.sel) deleteSel();
  }
});
