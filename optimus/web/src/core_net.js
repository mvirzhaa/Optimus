/* ===== Optimus core: utilities, geometry, XML, network topology ===== */
const SW = {};
SW.LANE_W = 3.2;
SW.VERSION = '1.1';

/* ---------- random ---------- */
SW.rng = function (seed) {
  let a = (seed >>> 0) || 1;
  const f = function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  f.normal = function (m, s) {
    const u = Math.max(1e-9, f()), v = f();
    return m + s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return f;
};

/* ---------- geometry ---------- */
const G = SW.geom = {};
G.dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
G.cum = function (p) {
  const c = [0];
  for (let i = 1; i < p.length; i++) c.push(c[i - 1] + G.dist(p[i - 1], p[i]));
  return c;
};
G.posAt = function (p, c, s) {
  const L = c[c.length - 1];
  if (p.length === 1) return { x: p[0].x, y: p[0].y, a: 0 };
  if (s <= 0) { const a = Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x); return { x: p[0].x + Math.cos(a) * s, y: p[0].y + Math.sin(a) * s, a }; }
  if (s >= L) {
    const n = p.length; const a = Math.atan2(p[n - 1].y - p[n - 2].y, p[n - 1].x - p[n - 2].x);
    return { x: p[n - 1].x + Math.cos(a) * (s - L), y: p[n - 1].y + Math.sin(a) * (s - L), a };
  }
  let lo = 0, hi = c.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= s) lo = m; else hi = m; }
  const seg = c[hi] - c[lo] || 1e-9, t = (s - c[lo]) / seg;
  const A = p[lo], B = p[hi];
  return { x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t, a: Math.atan2(B.y - A.y, B.x - A.x) };
};
G.cut = function (p, s0, s1) {
  const c = G.cum(p), L = c[c.length - 1];
  let a = s0, b = L - s1;
  if (b - a < 1) { const m = Math.min(Math.max((s0 + L - s1) / 2, 0.5), L - 0.5); a = Math.max(0, m - 0.5); b = Math.min(L, m + 0.5); }
  const out = [G.posAt(p, c, a)];
  for (let i = 0; i < p.length; i++) if (c[i] > a + 0.01 && c[i] < b - 0.01) out.push(p[i]);
  out.push(G.posAt(p, c, b));
  return out.map(q => ({ x: q.x, y: q.y }));
};
/* offset polyline to the left by off (negative = right) */
G.offset = function (p, off) {
  if (Math.abs(off) < 1e-9) return p.map(q => ({ x: q.x, y: q.y }));
  const n = p.length, segN = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = p[i + 1].x - p[i].x, dy = p[i + 1].y - p[i].y, l = Math.hypot(dx, dy) || 1e-9;
    segN.push({ x: -dy / l, y: dx / l });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    let nx, ny;
    if (i === 0) { nx = segN[0].x; ny = segN[0].y; }
    else if (i === n - 1) { nx = segN[n - 2].x; ny = segN[n - 2].y; }
    else {
      nx = segN[i - 1].x + segN[i].x; ny = segN[i - 1].y + segN[i].y;
      const l = Math.hypot(nx, ny) || 1e-9; nx /= l; ny /= l;
      const cosH = nx * segN[i].x + ny * segN[i].y;
      const k = 1 / Math.max(0.35, cosH); nx *= k; ny *= k;
    }
    out.push({ x: p[i].x + nx * off, y: p[i].y + ny * off });
  }
  return out;
};
G.normAng = function (a) { while (a > Math.PI) a -= 2 * Math.PI; while (a <= -Math.PI) a += 2 * Math.PI; return a; };
G.segInter = function (a, b, c, d) {
  const r = { x: b.x - a.x, y: b.y - a.y }, s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-9) return false;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
  return t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98;
};
G.polyInter = function (p, q) {
  for (let i = 0; i < p.length - 1; i++)
    for (let j = 0; j < q.length - 1; j++)
      if (G.segInter(p[i], p[i + 1], q[j], q[j + 1])) return true;
  return false;
};
G.bezier = function (p0, h0, p3, h3) {
  const d = G.dist(p0, p3);
  if (d < 0.05) return [{ x: p0.x, y: p0.y }, { x: p3.x + 0.05 * Math.cos(h3), y: p3.y + 0.05 * Math.sin(h3) }];
  const k = d * 0.42;
  const p1 = { x: p0.x + Math.cos(h0) * k, y: p0.y + Math.sin(h0) * k };
  const p2 = { x: p3.x - Math.cos(h3) * k, y: p3.y - Math.sin(h3) * k };
  const pts = [], N = 10;
  for (let i = 0; i <= N; i++) {
    const t = i / N, u = 1 - t;
    pts.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y
    });
  }
  return pts;
};
G.distToPoly = function (pt, p) {
  let best = Infinity, bestS = 0, acc = 0;
  for (let i = 0; i < p.length - 1; i++) {
    const A = p[i], B = p[i + 1], dx = B.x - A.x, dy = B.y - A.y, l2 = dx * dx + dy * dy || 1e-9;
    let t = ((pt.x - A.x) * dx + (pt.y - A.y) * dy) / l2; t = Math.max(0, Math.min(1, t));
    const x = A.x + dx * t, y = A.y + dy * t, d = Math.hypot(pt.x - x, pt.y - y), l = Math.sqrt(l2);
    if (d < best) { best = d; bestS = acc + t * l; }
    acc += l;
  }
  return { d: best, s: bestS };
};
G.fmt = (v, n = 2) => (Math.round(v * Math.pow(10, n)) / Math.pow(10, n)).toFixed(n);
G.shapeStr = p => p.map(q => G.fmt(q.x) + ',' + G.fmt(q.y)).join(' ');
G.parseShape = s => (s || '').trim().split(/\s+/).filter(Boolean).map(t => { const [x, y, z] = t.split(',').map(Number); return z !== undefined && !isNaN(z) ? { x, y, z } : { x, y }; });
G.shapeStr3 = p => p.map(q => G.fmt(q.x) + ',' + G.fmt(q.y) + (q.z !== undefined ? ',' + G.fmt(q.z) : '')).join(' ');

/* ---------- minimal XML parser (works in browser and node) ---------- */
SW.parseXML = function (txt) {
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[^>]*>|<\/?([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  const ar = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  const ent = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  let m;
  while ((m = re.exec(txt))) {
    const s = m[0];
    if (!m[1]) continue;
    if (s[1] === '/') {
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].tag === m[1]) { stack.length = i; break; }
      continue;
    }
    const el = { tag: m[1], attrs: {}, children: [] };
    let a; ar.lastIndex = 0;
    while ((a = ar.exec(m[2] || ''))) el.attrs[a[1]] = ent(a[3] !== undefined ? a[3] : a[4]);
    stack[stack.length - 1].children.push(el);
    if (!m[3]) stack.push(el);
  }
  return root;
};
SW.walk = function (el, fn) { fn(el); for (const c of el.children) SW.walk(c, fn); };
SW.findAll = function (el, tag) { const r = []; SW.walk(el, e => { if (e.tag === tag) r.push(e); }); return r; };
SW.xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
SW.attrs = o => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}="${SW.xmlEsc(v)}"`).join(' ');

/* ---------- network model ---------- */
SW.newNet = function () {
  return { nodes: {}, edges: {}, tls: {}, connections: null, location: null, ids: { J: 0, E: 0 } };
};
SW.nextId = function (net, prefix) {
  const coll = prefix === 'J' ? net.nodes : net.edges;
  let i = net.ids[prefix] || 0;
  while (coll[prefix + i] || coll['-' + prefix + i]) i++;
  net.ids[prefix] = i + 1;
  return prefix + i;
};
SW.addNode = function (net, x, y, type, id) {
  id = id || SW.nextId(net, 'J');
  net.nodes[id] = { id, x, y, type: type || 'priority' };
  return net.nodes[id];
};
SW.addEdge = function (net, from, to, o = {}) {
  const id = o.id || SW.nextId(net, 'E');
  net.edges[id] = {
    id, from, to, numLanes: o.numLanes || 1, speed: o.speed || 13.89,
    priority: o.priority !== undefined ? o.priority : -1, shape: o.shape || [], name: o.name || '',
    layer: o.layer || 0
  };
  if (o.height !== undefined) net.edges[id].height = o.height;
  if (typeof o.rampIn === 'boolean') net.edges[id].rampIn = o.rampIn;
  if (typeof o.rampOut === 'boolean') net.edges[id].rampOut = o.rampOut;
  return net.edges[id];
};
/* ---------- elevation (flyover / underpass) ---------- */
SW.LEVEL_NAMES = { '-2': 'Underpass 2', '-1': 'Underpass', '0': 'Permukaan', '1': 'Flyover', '2': 'Flyover 2 (susun)' };
SW.edgeHeight = e => !e.layer ? 0 : (e.height !== undefined && e.height !== null ? +e.height : e.layer > 0 ? e.layer * 7 : e.layer * 6);
SW.elevProfile = function (e, L, rin, rout) {
  const h = SW.edgeHeight(e);
  if (!h) return null;
  if (rin === undefined) rin = e.rampIn !== false;
  if (rout === undefined) rout = e.rampOut !== false;
  const n = (rin ? 1 : 0) + (rout ? 1 : 0);
  const R = n ? Math.min(L * (n === 2 ? 0.45 : 0.9), Math.max(30, Math.abs(h) / 0.06)) : 0;
  return { h, R, rin, rout, L };
};
SW.zAt = function (pr, s) {
  if (!pr) return 0;
  if (pr.rin && s < pr.R) return pr.h * Math.max(0, s) / pr.R;
  if (pr.rout && s > pr.L - pr.R) return pr.h * Math.max(0, pr.L - s) / pr.R;
  return pr.h;
};
SW.gradeAt = function (pr, s) {
  if (!pr || !pr.R) return 0;
  if (pr.rin && s < pr.R) return pr.h / pr.R;
  if (pr.rout && s > pr.L - pr.R) return -pr.h / pr.R;
  return 0;
};
/* polyline with z values, inserting the ramp break points */
SW.elevShape = function (pts, pr) {
  const c = G.cum(pts), L = c[c.length - 1];
  const extra = pr && pr.R ? [pr.rin ? pr.R : null, pr.rout ? L - pr.R : null].filter(v => v !== null && v > 0.5 && v < L - 0.5) : [];
  const items = pts.map((p, i) => ({ s: c[i], x: p.x, y: p.y }));
  for (const sx of extra) { const q = G.posAt(pts, c, sx); items.push({ s: sx, x: q.x, y: q.y }); }
  items.sort((a, b) => a.s - b.s);
  return items.map(it => ({ x: it.x, y: it.y, z: SW.zAt(pr, it.s) }));
};
SW.edgePriority = e => (e.priority !== undefined && e.priority >= 0) ? e.priority : (e.numLanes * 10 + Math.round(e.speed));
SW.removeNode = function (net, id) {
  for (const e of Object.values(net.edges)) if (e.from === id || e.to === id) delete net.edges[e.id];
  delete net.nodes[id]; delete net.tls[id];
  net.connections = null;
};
SW.removeEdge = function (net, id) {
  delete net.edges[id];
  net.connections = null;
  for (const n of Object.keys(net.nodes)) {
    const used = Object.values(net.edges).some(e => e.from === n || e.to === n);
    if (!used) { delete net.nodes[n]; delete net.tls[n]; }
  }
};
SW.splitEdge = function (net, id, pt) {
  const e = net.edges[id]; if (!e) return null;
  const A = net.nodes[e.from], B = net.nodes[e.to];
  const full = [A, ...e.shape, B], c = G.cum(full);
  const pr = G.distToPoly(pt, full); const s = pr.s;
  const P = G.posAt(full, c, s);
  const n = SW.addNode(net, P.x, P.y, 'priority');
  const sh1 = [], sh2 = [];
  for (let i = 1; i < full.length - 1; i++) (c[i] < s ? sh1 : sh2).push({ x: full[i].x, y: full[i].y });
  const rev = Object.values(net.edges).find(r => r.from === e.to && r.to === e.from);
  const base = { numLanes: e.numLanes, speed: e.speed, priority: e.priority, name: e.name, layer: e.layer || 0, height: e.height };
  delete net.edges[id];
  SW.addEdge(net, e.from, n.id, { ...base, id: id + '.a', shape: sh1, rampIn: e.rampIn });
  SW.addEdge(net, n.id, e.to, { ...base, id: id + '.b', shape: sh2, rampOut: e.rampOut });
  if (rev) {
    const rb = { numLanes: rev.numLanes, speed: rev.speed, priority: rev.priority, name: rev.name, layer: rev.layer || 0, height: rev.height };
    const rsh = rev.shape.slice();
    delete net.edges[rev.id];
    SW.addEdge(net, rev.from, n.id, { ...rb, id: rev.id + '.a', shape: sh2.slice().reverse(), rampIn: rev.rampIn });
    SW.addEdge(net, n.id, rev.to, { ...rb, id: rev.id + '.b', shape: sh1.slice().reverse(), rampOut: rev.rampOut });
    void rsh;
  }
  net.connections = null;
  return n;
};

/* ---------- topology (what netconvert computes) ---------- */
SW.buildTopo = function (net) {
  const W = SW.LANE_W;
  const LH = !!net.lefthand, NEAR = LH ? 'l' : 'r', FAR = LH ? 'r' : 'l', SG = LH ? -1 : 1;
  const T = { nodes: {}, edges: {}, lanes: {}, conns: [], connById: {}, succ: {}, lanesTo: {}, tlsNodes: [], lefthand: LH, near: NEAR, far: FAR };
  for (const n of Object.values(net.nodes)) T.nodes[n.id] = { id: n.id, n, inc: [], out: [], r: 1, conns: [], neighbors: new Set() };
  const pairKey = {};
  for (const e of Object.values(net.edges)) {
    if (!T.nodes[e.from] || !T.nodes[e.to] || e.from === e.to) continue;
    pairKey[e.from + '|' + e.to] = e.id;
  }
  for (const e of Object.values(net.edges)) {
    if (!T.nodes[e.from] || !T.nodes[e.to] || e.from === e.to) continue;
    const te = { id: e.id, e, from: e.from, to: e.to, lanes: [], rev: pairKey[e.to + '|' + e.from] || null };
    if (te.rev) { const re = net.edges[te.rev]; if (re.shape.length !== e.shape.length) te.rev = te.rev; }
    T.edges[e.id] = te;
    T.nodes[e.from].out.push(te); T.nodes[e.to].inc.push(te);
    T.nodes[e.from].neighbors.add(e.to); T.nodes[e.to].neighbors.add(e.from);
  }
  // junction radius
  for (const tn of Object.values(T.nodes)) {
    let maxW = 0;
    const seen = new Set();
    for (const te of [...tn.inc, ...tn.out]) {
      const other = te.from === tn.id ? te.to : te.from;
      if (seen.has(other)) continue; seen.add(other);
      let w = te.e.numLanes * W;
      if (te.rev && T.edges[te.rev]) w += T.edges[te.rev].e.numLanes * W;
      maxW = Math.max(maxW, w);
    }
    const deg = tn.neighbors.size;
    if (deg <= 1) tn.r = 0.6;
    else if (deg === 2) {
      // continuation: small joint unless lane counts change
      const lanes = new Set([...tn.inc, ...tn.out].map(t => t.e.numLanes));
      tn.r = lanes.size > 1 ? Math.max(3, maxW * 0.5) : 1.2;
    } else tn.r = Math.max(4, maxW * 0.55 + 1);
    if (tn.n.radius > 0) tn.r = tn.n.radius;
  }
  // lanes
  for (const te of Object.values(T.edges)) {
    const e = te.e, A = net.nodes[e.from], B = net.nodes[e.to];
    const full = [{ x: A.x, y: A.y }, ...e.shape.map(p => ({ x: p.x, y: p.y })), { x: B.x, y: B.y }];
    const fullLen = G.cum(full).slice(-1)[0];
    const rA = Math.min(T.nodes[e.from].r, fullLen * 0.45), rB = Math.min(T.nodes[e.to].r, fullLen * 0.45);
    te.center = G.cut(full, rA, rB);
    te.full = full;
    const spreadRight = !!te.rev;
    te.spreadRight = spreadRight;
    for (let i = 0; i < e.numLanes; i++) {
      // lane 0 is the outermost (curb) lane, as in SUMO
      const off = SG * (spreadRight ? -(e.numLanes - i - 0.5) * W : (i - (e.numLanes - 1) / 2) * W);
      const shape = G.offset(te.center, off);
      const cum = G.cum(shape);
      const lane = { id: e.id + '_' + i, edge: te, index: i, off, shape, cum, length: Math.max(0.1, cum[cum.length - 1]), speed: e.speed, vehs: [] };
      te.lanes.push(lane); T.lanes[lane.id] = lane;
    }
    te.length = te.lanes[0].length;
    te.layer = e.layer || 0;
    // ramps: automatic unless set explicitly -> no ramp where the road continues on the same level
    const autoRamp = nodeId => { const tn = T.nodes[nodeId]; const others = [...tn.inc, ...tn.out].filter(t => t !== te && !(t.from === e.to && t.to === e.from)); return !(others.length && others.every(t => (t.e.layer || 0) === te.layer)); };
    te.rin = typeof e.rampIn === 'boolean' ? e.rampIn : autoRamp(e.from);
    te.rout = typeof e.rampOut === 'boolean' ? e.rampOut : autoRamp(e.to);
    te.elev = SW.elevProfile(e, te.length, te.rin, te.rout);
    for (const l of te.lanes) { l.layer = te.layer; l.elev = te.elev ? SW.elevProfile(e, l.length, te.rin, te.rout) : null; }
    te.mid = spreadRight ? G.offset(te.center, -SG * e.numLanes * W / 2) : te.center;
    const c = te.center;
    te.angIn = Math.atan2(c[c.length - 1].y - c[c.length - 2].y, c[c.length - 1].x - c[c.length - 2].x); // heading at end
    te.angOut = Math.atan2(c[1].y - c[0].y, c[1].x - c[0].x); // heading at start
  }
  // connections
  const mk = (fromE, fromLane, toE, toLane, dir, extra) => {
    const fl = fromE.lanes[fromLane], tl = toE.lanes[toLane];
    if (!fl || !tl) return null;
    const p0 = fl.shape[fl.shape.length - 1], p3 = tl.shape[0];
    const path = G.bezier(p0, fromE.angIn, p3, toE.angOut);
    const cum = G.cum(path);
    const node = fromE.to;
    const c = {
      id: ':' + node + '_' + T.nodes[node].conns.length, node, from: fromE.id, fromLane, to: toE.id, toLane, dir,
      fromL: fl, toL: tl, shape: path, cum, length: Math.max(0.1, cum[cum.length - 1]), vehs: [], foes: [], yieldTo: [],
      linkIndex: -1, approaching: [], speed: dir === 's' ? Math.min(fl.speed, tl.speed) : dir === NEAR ? Math.min(fl.speed, tl.speed, 6.5) : dir === FAR ? Math.min(fl.speed, tl.speed, 8.5) : 3.5
    };
    if (extra && extra.linkIndex !== undefined) { c.linkIndex = extra.linkIndex; c.importedIndex = extra.linkIndex; }
    T.nodes[node].conns.push(c); T.conns.push(c); T.connById[c.id] = c;
    return c;
  };
  const turnDir = (inE, outE) => {
    if (outE.to === inE.from && outE.from === inE.to) return 't';
    const d = G.normAng(outE.angOut - inE.angIn) * 180 / Math.PI;
    if (Math.abs(d) > 155) return 't';
    if (d > 30) return 'l'; if (d < -30) return 'r'; return 's';
  };
  if (net.connections && net.connections.length) {
    for (const k of net.connections) {
      const fe = T.edges[k.from], te = T.edges[k.to];
      if (!fe || !te || fe.to !== te.from) continue;
      mk(fe, +k.fromLane, te, +k.toLane, k.dir || turnDir(fe, te), { linkIndex: k.linkIndex !== undefined ? +k.linkIndex : undefined });
    }
  } else {
    for (const tn of Object.values(T.nodes)) {
      for (const inE of tn.inc) {
        let outs = tn.out.filter(o => o.to !== inE.from && turnDir(inE, o) !== 't');
        if (!outs.length) outs = tn.out.slice(); // dead end -> allow turnaround
        if (!outs.length) continue;
        const items = outs.map(o => ({ o, dir: turnDir(inE, o), ang: G.normAng(o.angOut - inE.angIn) })).sort((a, b) => SG * (a.ang - b.ang));
        const nIn = inE.e.numLanes;
        const hasS = items.some(i => i.dir === 's');
        const W0 = { x: Math.cos(inE.angIn), y: Math.sin(inE.angIn) };
        const nodeP = net.nodes[tn.id];
        const sideOf = other => { const c = other.center, q = c[Math.max(0, c.length - 2)]; return W0.x * (q.y - nodeP.y) - W0.y * (q.x - nodeP.x); };
        const realOuts = tn.out.filter(o => o.to !== inE.from);
        const mergersAll = tn.inc.filter(o2 => o2 !== inE);
        // diverge (e.g. ramp to flyover / exit): several outgoing roads all straight -> split lanes by side
        const diverge = items.length > 1 && items.every(i => i.dir === 's') && nIn >= items.length;
        let divLanes = null;
        if (diverge) {
          const tot = items.reduce((a, i) => a + i.o.e.numLanes, 0);
          let start = 0; divLanes = new Map();
          items.forEach((it, k) => {
            let cnt = k === items.length - 1 ? nIn - start : Math.max(1, Math.round(nIn * it.o.e.numLanes / tot));
            cnt = Math.max(1, Math.min(cnt, nIn - start - (items.length - 1 - k)));
            divLanes.set(it, [...Array(cnt).keys()].map(x => x + start)); start += cnt;
          });
        }
        for (const it of items) {
          const nOut = it.o.e.numLanes;
          let shift = 0;
          if (it.dir === 's' && nOut > nIn) {
            const mergers = tn.inc.filter(o2 => o2 !== inE && o2.from !== it.o.to);
            if (mergers.some(m => SG * sideOf(m) < 0) && realOuts.length === 1) shift = nOut - nIn;
          }
          const dropLanes = (it.dir === 's' && nIn > nOut && realOuts.length === 1) ? nIn - nOut : 0;
          let fromLanes;
          if (it.dir === 's' || it.dir === 't' && items.length === 1) fromLanes = [...Array(nIn).keys()];
          else if (it.dir === NEAR) fromLanes = [0];
          else if (it.dir === FAR) fromLanes = [nIn - 1];
          else fromLanes = [nIn - 1];
          if (!hasS && nIn > 1 && items.length === 2) fromLanes = it === items[0] ? [...Array(Math.ceil(nIn / 2)).keys()] : [...Array(nIn).keys()].slice(Math.ceil(nIn / 2));
          if (items.length === 1) fromLanes = [...Array(nIn).keys()];
          if (divLanes) fromLanes = divLanes.get(it);
          for (const fl of fromLanes) {
            if (fl < dropLanes) continue;
            let tl;
            if (it.dir === NEAR) tl = 0;
            else if (it.dir === FAR || it.dir === 't') tl = nOut - 1;
            else if (divLanes) { const fls = divLanes.get(it); tl = Math.min(nOut - 1, Math.max(0, fl - fls[0] - Math.max(0, fls.length - nOut))); }
            else tl = Math.min(nOut - 1, Math.max(0, fl + shift - (nIn > nOut ? nIn - nOut : 0)));
            if (it.dir === 's' && nOut > nIn && fl === nIn - 1 && !shift && !divLanes && !mergersAll.length) {
              for (let x = fl; x < nOut; x++) mk(inE, fl, it.o, x, it.dir);
              continue;
            }
            mk(inE, fl, it.o, tl, it.dir);
          }
        }
      }
    }
  }
  // de-duplicate (same from lane -> same to edge keep the first)
  for (const tn of Object.values(T.nodes)) {
    const seen = new Set(), keep = [];
    for (const c of tn.conns) { const k = c.from + '_' + c.fromLane + '>' + c.to; if (seen.has(k)) { delete T.connById[c.id]; continue; } seen.add(k); keep.push(c); }
    tn.conns = keep;
  }
  T.conns = Object.values(T.nodes).flatMap(n => n.conns);
  // lane -> conns, edge successors, lanesTo
  for (const c of T.conns) {
    (c.fromL.out = c.fromL.out || []).push(c);
    (T.succ[c.from] = T.succ[c.from] || new Set()).add(c.to);
    const k = c.from + '>' + c.to;
    (T.lanesTo[k] = T.lanesTo[k] || new Set()).add(c.fromLane);
  }
  for (const l of Object.values(T.lanes)) l.out = l.out || [];
  T.connsInto = {};
  for (const c of T.conns) (T.connsInto[c.toL.id] = T.connsInto[c.toL.id] || []).push(c);
  // link indices + foes + yield rules
  for (const tn of Object.values(T.nodes)) {
    const N = tn.n;
    const bearing = te => { const a = Math.atan2(net.nodes[te.from].x - N.x, net.nodes[te.from].y - N.y); return (a + 2 * Math.PI) % (2 * Math.PI); };
    const order = { r: 0, s: 1, l: 2, t: 3 };
    const sorted = tn.conns.slice().sort((a, b) => {
      const ea = T.edges[a.from], eb = T.edges[b.from];
      return (bearing(ea) - bearing(eb)) || (a.from < b.from ? -1 : a.from > b.from ? 1 : 0) || (a.fromLane - b.fromLane) || (order[a.dir] - order[b.dir]);
    });
    sorted.sort((a, b) => (a.importedIndex !== undefined && b.importedIndex !== undefined) ? a.importedIndex - b.importedIndex : 0);
    sorted.forEach((c, i) => { c.linkIndex = i; });
    tn.links = sorted.slice().sort((a, b) => a.linkIndex - b.linkIndex);
    const cs = tn.conns;
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
      const a = cs[i], b = cs[j];
      const merge = a.to === b.to && a.toLane === b.toLane;
      if (a.from === b.from) {
        // two lanes of the same approach merging into one target lane: zip, the inner lane gives way
        if (merge && a.fromLane !== b.fromLane) { a.foes.push(b); b.foes.push(a); (a.fromLane > b.fromLane ? a : b).sameMergeYield = (a.fromLane > b.fromLane ? b : a); }
        continue;
      }
      const parallel = a.to === b.to && a.toLane !== b.toLane;
      if (merge || (!parallel && G.polyInter(a.shape, b.shape))) { a.foes.push(b); b.foes.push(a); }
    }
    const type = N.type;
    for (const c of cs) {
      const ec = T.edges[c.from];
      if (c.sameMergeYield) c.yieldTo.push(c.sameMergeYield);
      for (const f of c.foes) {
        if (f.from === c.from) continue;
        const ef = T.edges[f.from];
        let y = false;
        const pc = type === 'right_before_left' ? 0 : SW.edgePriority(ec.e), pf = type === 'right_before_left' ? 0 : SW.edgePriority(ef.e);
        if (pf > pc) y = true;
        else if (pf === pc) {
          if (c.dir === FAR && f.dir !== FAR && type !== 'right_before_left') y = true;
          else if (f.dir === FAR && c.dir !== FAR && type !== 'right_before_left') y = false;
          else {
            const rel = SG * G.normAng(ef.angIn - ec.angIn);
            if (rel > 0.35 && rel < Math.PI - 0.35) y = true;       // foe comes from the right
            else if (rel < -0.35 && rel > -Math.PI + 0.35) y = false;
            else y = c.from > f.from;
          }
        }
        if (y) c.yieldTo.push(f);
      }
    }
  }
  // traffic lights: one program may control several junctions (joined TLS, SUMO "tl" id)
  T.tlsPrograms = {};
  for (const tn of Object.values(T.nodes)) {
    if (tn.n.type !== 'traffic_light') continue;
    const pid = tn.n.tl || tn.id;
    (T.tlsPrograms[pid] = T.tlsPrograms[pid] || { id: pid, nodes: [], links: [] }).nodes.push(tn.id);
  }
  for (const pr of Object.values(T.tlsPrograms)) {
    pr.nodes.sort();
    const all = pr.nodes.flatMap(id => T.nodes[id].links);
    const imported = all.length && all.every(c => c.importedIndex !== undefined) && new Set(all.map(c => c.importedIndex)).size === all.length;
    let off = 0;
    for (const id of pr.nodes) {
      for (const c of T.nodes[id].links) { c.tl = pr.id; c.tlIndex = imported ? c.importedIndex : off + c.linkIndex; }
      off += T.nodes[id].links.length;
    }
    pr.links = all.slice().sort((a, b) => a.tlIndex - b.tlIndex);
    pr.joined = pr.nodes.length > 1;
    T.tlsNodes.push(pr.id);
    let prog = net.tls[pr.id];
    const nL = pr.links.length;
    if (!prog || !prog.phases || !prog.phases.length || prog.phases.some(p => p.state.length !== nL)) {
      net.tls[pr.id] = prog = SW.defaultTLS(pr, T, prog && prog.type);
    }
    prog.id = pr.id;
  }
  return T;
};

SW.defaultTLS = function (pr, T, type) {
  const links = pr.links;
  const nodes = new Set(pr.nodes || [pr.id]);
  const incs = [...new Set(links.map(c => c.from))].map(id => T.edges[id]);
  const groups = [], used = new Set();
  if (pr.joined || nodes.size > 1) {
    // joined program: one group per road axis (all parallel/opposite approaches green together)
    for (const e of incs) {
      if (used.has(e.id)) continue;
      used.add(e.id);
      const g = [e];
      for (const f of incs) if (!used.has(f.id)) {
        const d = Math.abs(G.normAng(f.angIn - e.angIn));
        if (d < 0.6 || d > Math.PI - 0.6) { used.add(f.id); g.push(f); }
      }
      groups.push(g);
    }
  } else {
    for (const e of incs) {
      if (used.has(e.id)) continue;
      used.add(e.id);
      const g = [e];
      let best = null, bd = 0;
      for (const f of incs) {
        if (used.has(f.id)) continue;
        const d = Math.abs(G.normAng(f.angIn - e.angIn));
        if (d > 2.3 && d > bd) { bd = d; best = f; }
      }
      if (best) { used.add(best.id); g.push(best); }
      groups.push(g);
    }
  }
  const phases = [];
  for (const g of groups) {
    const ids = new Set(g.map(e => e.id));
    let green = '', yellow = '';
    for (const c of links) {
      if (!ids.has(c.from)) { green += 'r'; yellow += 'r'; continue; }
      let ch = 'G';
      if ((c.dir === T.far || c.dir === 't') && c.foes.some(f => ids.has(f.from) && f.dir !== T.far)) ch = 'g';
      green += ch; yellow += 'y';
    }
    phases.push({ duration: 31, state: green, minDur: 5, maxDur: 50 });
    phases.push({ duration: 4, state: yellow });
  }
  if (!phases.length) phases.push({ duration: 31, state: 'G'.repeat(links.length) });
  return { id: pr.id, type: type || 'static', programID: '0', offset: 0, phases };
};

/* ---------- routing (duarouter-like shortest travel time) ---------- */
SW.route = function (T, from, to, via) {
  const pts = [from, ...(via || []), to];
  let res = [from];
  for (let i = 0; i < pts.length - 1; i++) {
    const r = SW.dijkstra(T, pts[i], pts[i + 1]);
    if (!r) return null;
    res = res.concat(r.slice(1));
  }
  return res;
};
SW.dijkstra = function (T, from, to, costFn) {
  if (!T.edges[from] || !T.edges[to]) return null;
  if (from === to) return [from];
  const cost = costFn || (id => T.edges[id].length / Math.max(0.1, T.edges[id].e.speed));
  const dist = { [from]: 0 }, prev = {}, done = new Set();
  const heap = [[0, from]];
  const push = (d, id) => { heap.push([d, id]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break;[heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (; ;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break;[heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  while (heap.length) {
    const [d, u] = pop();
    if (done.has(u)) continue; done.add(u);
    if (u === to) break;
    for (const v of (T.succ[u] || [])) {
      const nd = d + cost(v);
      if (dist[v] === undefined || nd < dist[v]) { dist[v] = nd; prev[v] = u; push(nd, v); }
    }
  }
  if (dist[to] === undefined) return null;
  const r = [to]; let c = to;
  while (c !== from) { c = prev[c]; r.push(c); }
  return r.reverse();
};
