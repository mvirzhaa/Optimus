/* ===== Optimus core: generators, XML import/export, OSM import, TraCI API ===== */

/* ---------- netgenerate-like generators ---------- */
SW.genGrid = function (o = {}) {
  const nx = o.nx || 3, ny = o.ny || 3, L = o.length || 150, lanes = o.lanes || 1, speed = o.speed || 13.89, attach = o.attach === undefined ? 100 : o.attach;
  const net = SW.newNet();
  const id = (i, j) => 'J' + i + '_' + j;
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) SW.addNode(net, i * L, j * L, o.tls ? 'traffic_light' : 'priority', id(i, j));
  const two = (a, b, eid) => {
    SW.addEdge(net, a, b, { id: eid, numLanes: lanes, speed });
    SW.addEdge(net, b, a, { id: '-' + eid, numLanes: lanes, speed });
  };
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    if (i < nx - 1) two(id(i, j), id(i + 1, j), 'E' + id(i, j).slice(1) + 'x');
    if (j < ny - 1) two(id(i, j), id(i, j + 1), 'E' + id(i, j).slice(1) + 'y');
  }
  if (attach > 0) {
    let k = 0;
    const fr = (i, j, dx, dy) => { const n = 'F' + (k++); SW.addNode(net, i * L + dx * attach, j * L + dy * attach, 'priority', n); two(n, id(i, j), 'A' + n.slice(1)); };
    for (let i = 0; i < nx; i++) { fr(i, 0, 0, -1); fr(i, ny - 1, 0, 1); }
    for (let j = 0; j < ny; j++) { fr(0, j, -1, 0); fr(nx - 1, j, 1, 0); }
  }
  net.ids = { J: 0, E: 0 };
  return net;
};
SW.genSpider = function (o = {}) {
  const arms = o.arms || 6, circles = o.circles || 3, L = o.length || 100, lanes = o.lanes || 1, speed = o.speed || 13.89;
  const net = SW.newNet();
  SW.addNode(net, 0, 0, o.tls ? 'traffic_light' : 'priority', 'C');
  const nid = (a, c) => 'J' + a + '_' + c;
  for (let a = 0; a < arms; a++) for (let c = 1; c <= circles; c++) {
    const ang = 2 * Math.PI * a / arms, r = c * L;
    SW.addNode(net, Math.cos(ang) * r, Math.sin(ang) * r, o.tls && c < circles ? 'traffic_light' : 'priority', nid(a, c));
  }
  const two = (x, y, e) => { SW.addEdge(net, x, y, { id: e, numLanes: lanes, speed }); SW.addEdge(net, y, x, { id: '-' + e, numLanes: lanes, speed }); };
  for (let a = 0; a < arms; a++) {
    two('C', nid(a, 1), 'R' + a + '_0');
    for (let c = 1; c < circles; c++) two(nid(a, c), nid(a, c + 1), 'R' + a + '_' + c);
    for (let c = 1; c <= circles; c++) two(nid(a, c), nid((a + 1) % arms, c), 'C' + a + '_' + c);
  }
  return net;
};
SW.fringeEdges = function (T) {
  const src = [], dst = [];
  for (const tn of Object.values(T.nodes)) if (tn.neighbors.size === 1) {
    for (const e of tn.out) src.push(e.id);
    for (const e of tn.inc) dst.push(e.id);
  }
  return { src, dst };
};
/* randomTrips.py -like: creates trips with fixed period between random (fringe) edges */
SW.randomTrips = function (T, demand, o = {}) {
  const r = SW.rng(o.seed || 7);
  const begin = o.begin || 0, end = o.end || 3600, period = o.period || 2;
  let { src, dst } = SW.fringeEdges(T);
  if (!o.fringe || src.length < 2) { src = Object.keys(T.edges); dst = src; }
  let k = 0, made = 0;
  const vtypes = o.types && o.types.length ? o.types : ['DEFAULT_VEHTYPE'];
  for (let t = begin; t < end; t += period) {
    for (let tries = 0; tries < 20; tries++) {
      const a = src[Math.floor(r() * src.length)], b = dst[Math.floor(r() * dst.length)];
      if (a === b || T.edges[a].rev === b) continue;
      const rt = SW.route(T, a, b);
      if (!rt || rt.length < (o.minEdges || 2)) continue;
      demand.vehicles.push({ id: (o.prefix || 'rt') + (k++), type: vtypes[Math.floor(r() * vtypes.length)], from: a, to: b, depart: +t.toFixed(2) });
      made++; break;
    }
  }
  return made;
};

/* ---------- example scenarios (tutorial parts) ---------- */
SW.examples = {
  'Part 1.2 – Persimpangan bersinyal': () => {
    const net = SW.newNet();
    SW.addNode(net, 0, 0, 'traffic_light', 'C');
    const arms = { W: [-200, 0], E: [200, 0], S: [0, -200], N: [0, 200] };
    for (const [k, [x, y]] of Object.entries(arms)) SW.addNode(net, x, y, 'priority', k);
    for (const k of Object.keys(arms)) {
      const lanes = (k === 'W' || k === 'E') ? 2 : 1;
      SW.addEdge(net, k, 'C', { id: k + 'in', numLanes: lanes, speed: 13.89 });
      SW.addEdge(net, 'C', k, { id: k + 'out', numLanes: lanes, speed: 13.89 });
    }
    const d = SW.newDemand();
    d.vTypes.bus = SW.makeVType('bus', 'bus');
    const fl = (id, f, t, vph, type) => d.flows.push({ id, type: type || 'DEFAULT_VEHTYPE', from: f, to: t, begin: 0, end: 3600, vehsPerHour: vph, departLane: 'best', departSpeed: 'max' });
    fl('WE', 'Win', 'Eout', 500); fl('EW', 'Ein', 'Wout', 450); fl('SN', 'Sin', 'Nout', 200); fl('NS', 'Nin', 'Sout', 220);
    fl('WN', 'Win', 'Nout', 120); fl('ES', 'Ein', 'Sout', 100); fl('SE', 'Sin', 'Eout', 80); fl('NW', 'Nin', 'Wout', 90); fl('busWE', 'Win', 'Eout', 20, 'bus');
    const add = SW.newAdditional();
    add.e1.push({ id: 'e1_Win_0', lane: 'Win_0', pos: 150, period: 60 }, { id: 'e1_Sin_0', lane: 'Sin_0', pos: 150, period: 60 });
    add.e2.push({ id: 'e2_Win_1', lane: 'Win_1', pos: 80, length: 110, period: 60 });
    return { net, demand: d, add };
  },
  'Part 1.2 – Persimpangan tanpa sinyal (prioritas)': () => {
    const net = SW.newNet();
    SW.addNode(net, 0, 0, 'priority', 'C');
    for (const [k, x, y] of [['W', -200, 0], ['E', 200, 0], ['S', 0, -150], ['N', 0, 150]]) SW.addNode(net, x, y, 'priority', k);
    for (const k of ['W', 'E']) { SW.addEdge(net, k, 'C', { id: k + 'in', numLanes: 1, speed: 16.67, priority: 3 }); SW.addEdge(net, 'C', k, { id: k + 'out', numLanes: 1, speed: 16.67, priority: 3 }); }
    for (const k of ['S', 'N']) { SW.addEdge(net, k, 'C', { id: k + 'in', numLanes: 1, speed: 11.11, priority: 1 }); SW.addEdge(net, 'C', k, { id: k + 'out', numLanes: 1, speed: 11.11, priority: 1 }); }
    const d = SW.newDemand();
    const fl = (id, f, t, vph) => d.flows.push({ id, type: 'DEFAULT_VEHTYPE', from: f, to: t, begin: 0, end: 3600, vehsPerHour: vph });
    fl('WE', 'Win', 'Eout', 400); fl('EW', 'Ein', 'Wout', 400); fl('SN', 'Sin', 'Nout', 120); fl('NS', 'Nin', 'Sout', 120); fl('SW', 'Sin', 'Wout', 60);
    return { net, demand: d, add: SW.newAdditional() };
  },
  'Part 2.2 – Jalan tol 3 lajur + on-ramp': () => {
    const net = SW.newNet();
    SW.addNode(net, 0, 0, 'priority', 'A'); SW.addNode(net, 600, 0, 'priority', 'M'); SW.addNode(net, 850, 0, 'priority', 'K'); SW.addNode(net, 1500, 0, 'priority', 'B');
    SW.addNode(net, 300, -120, 'priority', 'R');
    SW.addEdge(net, 'A', 'M', { id: 'hw1', numLanes: 3, speed: 33.33, priority: 10 });
    SW.addEdge(net, 'M', 'K', { id: 'acc', numLanes: 4, speed: 33.33, priority: 10, name: 'lajur percepatan' });
    SW.addEdge(net, 'K', 'B', { id: 'hw2', numLanes: 3, speed: 33.33, priority: 10 });
    SW.addEdge(net, 'R', 'M', { id: 'ramp', numLanes: 1, speed: 22.22, priority: 2, shape: [{ x: 480, y: -40 }] });
    const d = SW.newDemand();
    d.vTypes.truck = SW.makeVType('truck', 'truck');
    d.vTypes.idm = SW.makeVType('idm', 'passenger', { carFollowModel: 'IDM', color: '#f2994a' });
    d.flows.push({ id: 'main', type: 'DEFAULT_VEHTYPE', from: 'hw1', to: 'hw2', begin: 0, end: 3600, vehsPerHour: 2400, departLane: 'random' });
    d.flows.push({ id: 'mainIDM', type: 'idm', from: 'hw1', to: 'hw2', begin: 0, end: 3600, vehsPerHour: 600, departLane: 'random' });
    d.flows.push({ id: 'trucks', type: 'truck', from: 'hw1', to: 'hw2', begin: 0, end: 3600, vehsPerHour: 300, departLane: '0' });
    d.flows.push({ id: 'onramp', type: 'DEFAULT_VEHTYPE', from: 'ramp', to: 'hw2', begin: 0, end: 3600, vehsPerHour: 500 });
    const add = SW.newAdditional();
    add.e1.push({ id: 'loop_hw2_0', lane: 'hw2_0', pos: 300, period: 60 }, { id: 'loop_hw2_1', lane: 'hw2_1', pos: 300, period: 60 }, { id: 'loop_hw2_2', lane: 'hw2_2', pos: 300, period: 60 });
    return { net, demand: d, add };
  },
  'netgenerate – Grid 3×3 bersinyal': () => {
    const net = SW.genGrid({ nx: 3, ny: 3, length: 150, lanes: 1, tls: true, attach: 100 });
    const T = SW.buildTopo(net), d = SW.newDemand();
    d.vTypes.bus = SW.makeVType('bus', 'bus'); d.vTypes.ev = SW.makeVType('ev', 'evehicle'); d.vTypes.moto = SW.makeVType('moto', 'motorcycle');
    SW.randomTrips(T, d, { end: 1800, period: 1.5, fringe: true, types: ['DEFAULT_VEHTYPE', 'DEFAULT_VEHTYPE', 'DEFAULT_VEHTYPE', 'ev', 'moto', 'bus'] });
    return { net, demand: d, add: SW.newAdditional() };
  },
  'Part 9 – Kendaraan darurat (bluelight)': () => {
    const ex = SW.examples['Part 1.2 – Persimpangan bersinyal']();
    ex.demand.vTypes.rescue = SW.makeVType('rescue', 'emergency');
    ex.demand.flows.push({ id: 'ambulans', type: 'rescue', from: 'Sin', to: 'Nout', begin: 20, end: 3600, period: 90 });
    return ex;
  },
  'Part 10 – Emisi & kendaraan listrik': () => {
    const ex = SW.examples['Part 2.2 – Jalan tol 3 lajur + on-ramp']();
    ex.demand.vTypes.ev = SW.makeVType('ev', 'evehicle');
    ex.demand.vTypes.diesel = SW.makeVType('diesel', 'passenger', { emissionClass: 'PC_D_EU4', color: '#bdbdbd' });
    ex.demand.flows.push({ id: 'evs', type: 'ev', from: 'hw1', to: 'hw2', begin: 0, end: 3600, vehsPerHour: 600, departLane: 'random' });
    ex.demand.flows.push({ id: 'diesels', type: 'diesel', from: 'hw1', to: 'hw2', begin: 0, end: 3600, vehsPerHour: 400, departLane: 'random' });
    return ex;
  },
  'Flyover di atas persimpangan bersinyal': () => SW.genGradeSeparated('flyover'),
  'Underpass di bawah persimpangan bersinyal': () => SW.genGradeSeparated('underpass'),
  'Simpang Indonesia: lajur kiri, motor, angkot, halte & penyeberangan': () => SW.genIndonesia(),
  'Bundaran (lajur kiri)': () => { const ex = SW.genIndonesia(); SW.makeRoundabout(ex.net, 'C', { radius: 24 }); ex.add.crossings = ex.add.crossings.filter(c => c.type !== 'tls'); SW.repairRoutes(ex.net, ex.demand); return ex; },
  'Kosong (mulai dari nol)': () => ({ net: SW.newNet(), demand: SW.newDemand(), add: SW.newAdditional() })
};

/* grade-separated corridor: through traffic uses a flyover (layer +1) or underpass (layer -1)
   in the median, turning traffic uses the at-grade signalized junction */
SW.genGradeSeparated = function (kind, lefthand) {
  const up = kind !== 'underpass';
  const layer = up ? 1 : -1, name = up ? 'Flyover' : 'Underpass';
  const net = SW.newNet();
  if (lefthand) net.lefthand = true;
  const my = lefthand ? -1 : 1; // mirror the layout for left-hand traffic
  const N = (id, x, y, t) => SW.addNode(net, x, my * y, t || 'priority', id);
  // frontage roads pass the cross street at two signalized junctions (C1 south side, C2 north side)
  N('W', -700, 0); N('D1', -330, 0); N('C1', 0, -17, 'traffic_light'); N('C2', 0, 17, 'traffic_light'); N('D2', 330, 0); N('E', 700, 0); N('N', 0, 380); N('S', 0, -380);
  const v60 = 16.67, v50 = 13.89, v40 = 11.11;
  const E = (id, a, b, o) => SW.addEdge(net, a, b, Object.assign({ id }, o));
  const two = (id, a, b, o) => { E(id, a, b, o); E(id.split('_').reverse().join('_'), b, a, o); };
  two('W_D1', 'W', 'D1', { numLanes: 3, speed: v60, priority: 8 });
  two('D2_E', 'D2', 'E', { numLanes: 3, speed: v60, priority: 8 });
  E('fly_EB', 'D1', 'D2', { numLanes: 2, speed: v60, priority: 9, layer, name: name + ' arah timur' });
  E('fly_WB', 'D2', 'D1', { numLanes: 2, speed: v60, priority: 9, layer, name: name + ' arah barat' });
  E('g_EB1', 'D1', 'C1', { numLanes: 1, speed: v40, priority: 4, shape: [{ x: -230, y: -17 * my }], name: 'Jalur samping' });
  E('g_EB2', 'C1', 'D2', { numLanes: 1, speed: v40, priority: 4, shape: [{ x: 230, y: -17 * my }], name: 'Jalur samping' });
  E('g_WB1', 'D2', 'C2', { numLanes: 1, speed: v40, priority: 4, shape: [{ x: 230, y: 17 * my }], name: 'Jalur samping' });
  E('g_WB2', 'C2', 'D1', { numLanes: 1, speed: v40, priority: 4, shape: [{ x: -230, y: 17 * my }], name: 'Jalur samping' });
  two('N_C2', 'N', 'C2', { numLanes: 1, speed: v50, priority: 3 });
  two('C2_C1', 'C2', 'C1', { numLanes: 1, speed: v50, priority: 3 });
  two('C1_S', 'C1', 'S', { numLanes: 1, speed: v50, priority: 3 });
  const d = SW.newDemand();
  d.vTypes.truck = SW.makeVType('truck', 'truck'); d.vTypes.moto = SW.makeVType('moto', 'motorcycle');
  const fl = (id, edges, vph, type) => d.flows.push({ id, type: type || 'DEFAULT_VEHTYPE', edges, begin: 0, end: 3600, vehsPerHour: vph, departLane: 'best' });
  fl('lurus_timur', ['W_D1', 'fly_EB', 'D2_E'], 900); fl('lurus_barat', ['E_D2', 'fly_WB', 'D1_W'], 850);
  fl('truk_timur', ['W_D1', 'fly_EB', 'D2_E'], 120, 'truck'); fl('motor_barat', ['E_D2', 'fly_WB', 'D1_W'], 150, 'moto');
  fl('W_ke_N', ['W_D1', 'g_EB1', 'C1_C2', 'C2_N'], 110); fl('W_ke_S', ['W_D1', 'g_EB1', 'C1_S'], 100);
  fl('E_ke_S', ['E_D2', 'g_WB1', 'C2_C1', 'C1_S'], 100); fl('E_ke_N', ['E_D2', 'g_WB1', 'C2_N'], 90);
  fl('N_ke_S', ['N_C2', 'C2_C1', 'C1_S'], 180); fl('S_ke_N', ['S_C1', 'C1_C2', 'C2_N'], 170);
  fl('N_ke_E', ['N_C2', 'C2_C1', 'g_EB2', 'D2_E'], 80); fl('S_ke_W', ['S_C1', 'C1_C2', 'g_WB2', 'D1_W'], 80);
  // both junctions are driven by ONE joined signal program (SUMO: shared tl id)
  net.nodes.C1.tl = net.nodes.C2.tl = 'TL_simpang';
  const T = SW.buildTopo(net);
  const links = T.tlsPrograms.TL_simpang.links;
  const role = { C1: { frontage: 'g_EB1', side: 'S_C1', inner: 'C2_C1' }, C2: { frontage: 'g_WB1', side: 'N_C2', inner: 'C1_C2' } };
  const st = f => links.map(c => f(c, role[c.node]) ? 'G' : 'r').join('');
  const A = st((c, r) => c.from === r.side || (c.from === r.inner && c.dir !== T.far));
  const B = st((c, r) => c.from === r.inner);
  const C = st((c, r) => c.from === r.frontage);
  const y = g => g.replace(/G/g, 'y');
  net.tls.TL_simpang = { id: 'TL_simpang', type: 'static', programID: '0', offset: 0, phases: [
    { duration: 30, state: A, minDur: 10, maxDur: 45, name: 'jalan silang' }, { duration: 3, state: y(A) },
    { duration: 12, state: B, minDur: 5, maxDur: 20, name: 'jalur dalam terlindung' }, { duration: 3, state: y(B) },
    { duration: 25, state: C, minDur: 8, maxDur: 40, name: 'jalur samping' }, { duration: 3, state: y(C) }] };
  const add = SW.newAdditional();
  add.e1.push({ id: 'loop_' + name.toLowerCase(), lane: 'fly_EB_0', pos: 200, period: 60 }, { id: 'loop_samping', lane: 'g_EB1_0', pos: 150, period: 60 });
  add.e2.push({ id: 'antrean_N', lane: 'N_C2_0', pos: 250, length: 110, period: 60 });
  return { net, demand: d, add };
};

/* typical Indonesian urban junction: left-hand traffic, motorcycle-dominated, angkot, bus line with stops, crossings */
SW.genIndonesia = function () {
  const net = SW.newNet(); net.lefthand = true;
  SW.addNode(net, 0, 0, 'traffic_light', 'C');
  const arms = { W: [-320, 0], E: [320, 0], S: [0, -260], N: [0, 260] };
  for (const [k, [x, y]] of Object.entries(arms)) SW.addNode(net, x, y, 'priority', k);
  for (const k of Object.keys(arms)) {
    const main = k === 'W' || k === 'E';
    SW.addEdge(net, k, 'C', { id: k + 'in', numLanes: main ? 2 : 1, speed: main ? 13.89 : 11.11, name: main ? 'Jl. Pajajaran' : 'Jl. Otista' });
    SW.addEdge(net, 'C', k, { id: k + 'out', numLanes: main ? 2 : 1, speed: main ? 13.89 : 11.11, name: main ? 'Jl. Pajajaran' : 'Jl. Otista' });
  }
  const d = SW.newDemand();
  d.vTypes.motor = SW.makeVType('motor', 'motorcycle');
  d.vTypes.angkot = SW.makeVType('angkot', 'angkot');
  d.vTypes.bus = SW.makeVType('bus', 'bus');
  d.vTypes.truk = SW.makeVType('truk', 'truck');
  const add = SW.newAdditional();
  add.busStops.push({ id: 'halte_W', lane: 'Win_0', startPos: 150, endPos: 175, name: 'Halte Pajajaran Barat', lines: 'Biskita K1' });
  add.busStops.push({ id: 'halte_E', lane: 'Eout_0', startPos: 120, endPos: 145, name: 'Halte Pajajaran Timur', lines: 'Biskita K1' });
  add.crossings.push({ id: 'zebra_E', edge: 'Eout', pos: 230, type: 'zebra', pedPerHour: 240, compliance: 0.5 });
  add.crossings.push({ id: 'pelican_S', edge: 'Sin', pos: 140, type: 'pelican', pedPerHour: 180, minVehGreen: 30, walk: 10 });
  add.crossings.push({ id: 'simpang_N', edge: 'Nin', pos: 252, type: 'tls', pedPerHour: 150 });
  add.e1.push({ id: 'loop_Win', lane: 'Win_1', pos: 100, period: 60 });
  add.e2.push({ id: 'antrean_Win', lane: 'Win_0', pos: 190, length: 120, period: 60 });
  const fl = (id, type, f, t, vph, extra) => d.flows.push(Object.assign({ id, type, from: f, to: t, begin: 0, end: 3600, vehsPerHour: vph, departLane: 'best' }, extra || {}));
  // composition roughly 65% motorcycles, 25% cars, 5% angkot, 5% heavy
  const od = [['Win', 'Eout', 700], ['Ein', 'Wout', 650], ['Sin', 'Nout', 260], ['Nin', 'Sout', 240], ['Win', 'Nout', 140], ['Win', 'Sout', 120], ['Ein', 'Sout', 130], ['Ein', 'Nout', 110], ['Sin', 'Wout', 90], ['Sin', 'Eout', 80], ['Nin', 'Eout', 80], ['Nin', 'Wout', 70]];
  for (const [f, t, q] of od) {
    fl(`motor_${f}_${t}`, 'motor', f, t, Math.round(q * 0.65));
    fl(`mobil_${f}_${t}`, 'DEFAULT_VEHTYPE', f, t, Math.round(q * 0.25));
    if (q > 200) fl(`angkot_${f}_${t}`, 'angkot', f, t, Math.round(q * 0.05));
    if (q > 200) fl(`truk_${f}_${t}`, 'truk', f, t, Math.round(q * 0.03));
  }
  d.flows.push({ id: 'biskita_K1', type: 'bus', edges: ['Win', 'Eout'], begin: 30, end: 3600, period: 300, stops: [{ busStop: 'halte_W', duration: 25 }, { busStop: 'halte_E', duration: 20 }] });
  return { net, demand: d, add };
};

/* ---------- joined traffic lights & roundabouts (NetEdit tools) ---------- */
SW.joinTLS = function (net, nodeIds, id) {
  id = id || 'TL_' + nodeIds.join('_');
  for (const n of nodeIds) { const nd = net.nodes[n]; if (!nd) continue; if (nd.tl && nd.tl !== id) delete net.tls[nd.tl]; delete net.tls[n]; nd.type = 'traffic_light'; nd.tl = id; }
  delete net.tls[id];
  return id;
};
SW.splitTLS = function (net, progId) {
  for (const nd of Object.values(net.nodes)) if ((nd.tl || nd.id) === progId) { delete nd.tl; delete net.tls[nd.id]; }
  delete net.tls[progId];
};
/* replace a junction by a one-way ring road (counter-clockwise for right-hand, clockwise for left-hand traffic) */
SW.makeRoundabout = function (net, nodeId, o = {}) {
  const c = net.nodes[nodeId]; if (!c) throw new Error('Simpul tidak ada');
  const R = o.radius || 20, lanes = o.lanes || 1, speed = o.speed || 8.33;
  const inc = Object.values(net.edges).filter(e => e.to === nodeId), out = Object.values(net.edges).filter(e => e.from === nodeId);
  const roads = new Map(); // neighbour node -> {ang, inc:[], out:[]}
  const dirOf = (e, atStart) => {
    const A = net.nodes[e.from], B = net.nodes[e.to];
    const pts = [A, ...e.shape, B];
    const q = atStart ? pts[1] : pts[pts.length - 2];
    return Math.atan2(q.y - c.y, q.x - c.x);
  };
  for (const e of inc) { const k = e.from; const r = roads.get(k) || { ang: dirOf(e, false), inc: [], out: [] }; r.inc.push(e); roads.set(k, r); }
  for (const e of out) { const k = e.to; const r = roads.get(k) || { ang: dirOf(e, true), inc: [], out: [] }; r.out.push(e); roads.set(k, r); }
  if (roads.size < 3) throw new Error('Bundaran butuh minimal 3 lengan jalan');
  let list = [...roads.values()].sort((a, b) => a.ang - b.ang);
  // roads whose attachment points would be closer than ~14 m along the ring share one ring node
  const minArc = Math.max(14, (o.lanes || 1) * SW.LANE_W * 3) / R;
  const merged = [];
  for (const r of list) {
    const last = merged[merged.length - 1];
    if (last && r.ang - last.ang1 < minArc) { last.inc.push(...r.inc); last.out.push(...r.out); last.ang1 = r.ang; last.ang = (last.ang0 + r.ang) / 2; }
    else merged.push({ ang: r.ang, ang0: r.ang, ang1: r.ang, inc: r.inc.slice(), out: r.out.slice() });
  }
  if (merged.length > 1 && merged[0].ang0 + 2 * Math.PI - merged[merged.length - 1].ang1 < minArc) {
    const a = merged.pop(), b = merged[0]; b.inc.push(...a.inc); b.out.push(...a.out); b.ang = ((a.ang0 - 2 * Math.PI) + b.ang1) / 2; b.ang0 = a.ang0 - 2 * Math.PI;
  }
  list = merged.sort((a, b) => a.ang - b.ang);
  if (list.length < 3) throw new Error('Bundaran butuh minimal 3 titik masuk/keluar yang cukup berjauhan; perbesar radius');
  for (const r of list) {
    for (const e of [...r.inc, ...r.out]) {
      const A = net.nodes[e.from], B = net.nodes[e.to];
      const len = SW.geom.cum([A, ...e.shape, B]).slice(-1)[0];
      if (len < R + 10) throw new Error(`Ruas ${e.id} terlalu pendek untuk radius ${R} m`);
    }
  }
  const ringIds = list.map((r, k) => {
    const id = nodeId + '_r' + k;
    SW.addNode(net, c.x + Math.cos(r.ang) * R, c.y + Math.sin(r.ang) * R, 'priority', id);
    for (const e of r.inc) { e.to = id; e.shape = e.shape.filter(p => Math.hypot(p.x - c.x, p.y - c.y) > R + 2); }
    for (const e of r.out) { e.from = id; e.shape = e.shape.filter(p => Math.hypot(p.x - c.x, p.y - c.y) > R + 2); }
    return id;
  });
  const ccw = !net.lefthand, n = list.length, edges = [];
  for (let k = 0; k < n; k++) {
    const a = ccw ? k : (k + 1) % n, b = ccw ? (k + 1) % n : k;
    let a0 = list[a].ang, a1 = list[b].ang;
    if (ccw) { while (a1 <= a0) a1 += 2 * Math.PI; } else { while (a1 >= a0) a1 -= 2 * Math.PI; }
    const steps = Math.max(2, Math.ceil(Math.abs(a1 - a0) / 0.25)), shape = [];
    for (let s = 1; s < steps; s++) { const t = a0 + (a1 - a0) * s / steps; shape.push({ x: c.x + Math.cos(t) * R, y: c.y + Math.sin(t) * R }); }
    const id = nodeId + '_ring' + k;
    SW.addEdge(net, ringIds[a], ringIds[b], { id, numLanes: lanes, speed, priority: 100, shape, name: 'Bundaran ' + nodeId });
    edges.push(id);
  }
  delete net.nodes[nodeId]; delete net.tls[nodeId];
  net.connections = null;
  (net.roundabouts = net.roundabouts || []).push({ center: nodeId, nodes: ringIds, edges, radius: R });
  return { nodes: ringIds, edges };
};
/* make explicit routes consistent after network edits (fills gaps with shortest paths) */
SW.repairRoutes = function (net, demand, T) {
  T = T || SW.buildTopo(net);
  let fixed = 0, broken = 0;
  const fix = edges => {
    const out = [];
    for (const e of edges) {
      if (!T.edges[e]) continue;
      if (out.length && !(T.succ[out[out.length - 1]] || new Set()).has(e)) {
        const p = SW.dijkstra(T, out[out.length - 1], e);
        if (p) { out.push(...p.slice(1)); fixed++; continue; }
        broken++;
      }
      out.push(e);
    }
    return out;
  };
  for (const r of Object.values(demand.routes)) r.edges = fix(r.edges);
  for (const f of demand.flows) if (f.edges) f.edges = fix(f.edges);
  for (const v of demand.vehicles) if (v.edges) v.edges = fix(v.edges);
  return { fixed, broken };
};

/* ---------- export ---------- */
SW.f2 = v => SW.geom.fmt(v, 2);
SW.toNetXML = function (net, T) {
  T = T || SW.buildTopo(net);
  const G = SW.geom, o = [];
  const xs = Object.values(net.nodes).map(n => n.x), ys = Object.values(net.nodes).map(n => n.y);
  const bb = xs.length ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(SW.f2).join(',') : '0,0,0,0';
  o.push('<?xml version="1.0" encoding="UTF-8"?>');
  o.push(`<!-- generated by Optimus ${SW.VERSION} -->`);
  o.push('<net version="1.20" junctionCornerDetail="5" limitTurnSpeed="5.50" ' + (net.lefthand ? 'lefthand="true" ' : '') + 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://sumo.dlr.de/xsd/net_file.xsd">');
  const loc = net.location;
  o.push(`    <location netOffset="0.00,0.00" convBoundary="${bb}" origBoundary="${loc ? loc.origBoundary || '-180,-90,180,90' : bb}" projParameter="${loc ? SW.xmlEsc(loc.proj || '+proj=eqc') : '!'}"/>`);
  for (const tn of Object.values(T.nodes)) for (const c of tn.conns) {
    o.push(`    <edge id="${c.id}" function="internal">`);
    o.push(`        <lane id="${c.id}_0" index="0" speed="${SW.f2(c.speed)}" length="${SW.f2(c.length)}" shape="${G.shapeStr(c.shape)}"/>`);
    o.push('    </edge>');
  }
  for (const te of Object.values(T.edges)) {
    const e = te.e;
    const fullPr = te.elev ? SW.elevProfile(e, G.cum(te.full).slice(-1)[0], te.rin, te.rout) : null;
    o.push(`    <edge ${SW.attrs({ id: e.id, from: e.from, to: e.to, name: e.name, priority: SW.edgePriority(e), shape: e.shape.length || fullPr ? G.shapeStr3(fullPr ? SW.elevShape(te.full, fullPr) : te.full) : '' })}>`);
    for (const l of te.lanes) o.push(`        <lane id="${l.id}" index="${l.index}" speed="${SW.f2(l.speed)}" length="${SW.f2(l.length)}" shape="${l.elev ? G.shapeStr3(SW.elevShape(l.shape, l.elev)) : G.shapeStr(l.shape)}"/>`);
    o.push('    </edge>');
  }
  for (const id of T.tlsNodes) {
    const p = net.tls[id];
    o.push(`    <tlLogic id="${id}" type="${p.type === 'rl' ? 'static' : p.type}" programID="${p.programID || '0'}" offset="${p.offset || 0}">`);
    for (const ph of p.phases) o.push(`        <phase ${SW.attrs({ duration: ph.duration, state: ph.state, minDur: p.type === 'actuated' ? ph.minDur : '', maxDur: p.type === 'actuated' ? ph.maxDur : '', name: ph.name })}/>`);
    o.push('    </tlLogic>');
  }
  for (const tn of Object.values(T.nodes)) {
    const n = tn.n;
    const incLanes = tn.inc.flatMap(e => e.lanes.map(l => l.id)).join(' ');
    const intLanes = tn.conns.map(c => c.id + '_0').join(' ');
    const type = tn.neighbors.size <= 1 && n.type !== 'traffic_light' ? 'dead_end' : n.type;
    const r = tn.r, sh = [];
    for (let k = 0; k < 8; k++) sh.push({ x: n.x + Math.cos(k * Math.PI / 4) * r, y: n.y + Math.sin(k * Math.PI / 4) * r });
    o.push(`    <junction id="${n.id}" type="${type}" x="${SW.f2(n.x)}" y="${SW.f2(n.y)}" incLanes="${incLanes}" intLanes="${intLanes}" shape="${G.shapeStr(sh)}"/>`);
  }
  for (const c of T.conns) {
    const isTL = !!c.tl;
    o.push(`    <connection ${SW.attrs({ from: c.from, to: c.to, fromLane: c.fromLane, toLane: c.toLane, via: c.id + '_0', tl: isTL ? c.tl : '', linkIndex: isTL ? c.tlIndex : '', dir: c.dir, state: isTL ? 'O' : (c.yieldTo.length ? 'm' : 'M') })}/>`);
  }
  for (const r of net.roundabouts || []) if (r.nodes.every(n => net.nodes[n])) o.push(`    <roundabout nodes="${r.nodes.join(' ')}" edges="${r.edges.filter(e => net.edges[e]).join(' ')}"/>`);
  o.push('</net>');
  return o.join('\n');
};
SW.toNodXML = function (net) {
  const o = ['<?xml version="1.0" encoding="UTF-8"?>', '<nodes>'];
  for (const n of Object.values(net.nodes)) o.push(`    <node ${SW.attrs({ id: n.id, x: SW.f2(n.x), y: SW.f2(n.y), type: n.type, tl: n.type === 'traffic_light' && n.tl ? n.tl : '' })}/>`);
  o.push('</nodes>'); return o.join('\n');
};
SW.toEdgXML = function (net) {
  const o = ['<?xml version="1.0" encoding="UTF-8"?>', '<edges>'];
  const T = SW.buildTopo(net);
  for (const e of Object.values(net.edges)) {
    let shape = e.shape.length ? SW.geom.shapeStr(e.shape) : '';
    if (e.layer) {
      const A = net.nodes[e.from], B = net.nodes[e.to], full = [{ x: A.x, y: A.y }, ...e.shape, { x: B.x, y: B.y }];
      const te = T.edges[e.id];
      shape = SW.geom.shapeStr3(SW.elevShape(full, SW.elevProfile(e, SW.geom.cum(full).slice(-1)[0], te && te.rin, te && te.rout)));
    }
    o.push(`    <edge ${SW.attrs({ id: e.id, from: e.from, to: e.to, numLanes: e.numLanes, speed: SW.f2(e.speed), priority: e.priority >= 0 ? e.priority : '', name: e.name, shape })}/>`);
  }
  for (const r of net.roundabouts || []) if (r.nodes.every(n => net.nodes[n])) o.push(`    <roundabout nodes="${r.nodes.join(' ')}" edges="${r.edges.filter(e => net.edges[e]).join(' ')}"/>`);
  o.push('</edges>'); return o.join('\n');
};
/* netconvert inputs that keep Optimus's own lane connections and signal programs */
SW.toConXML = function (net, T) {
  T = T || SW.buildTopo(net);
  const o = ['<?xml version="1.0" encoding="UTF-8"?>', '<connections>'];
  // only signalized junctions need fixed lane connections (their link indices are used by the signal program);
  // elsewhere netconvert computes its own connections and right-of-way
  for (const c of T.conns) if (c.tl) o.push(`    <connection from="${c.from}" to="${c.to}" fromLane="${c.fromLane}" toLane="${c.toLane}"/>`);
  o.push('</connections>'); return o.join('\n');
};
SW.toTllXML = function (net, T) {
  T = T || SW.buildTopo(net);
  const o = ['<?xml version="1.0" encoding="UTF-8"?>', '<tlLogics>'];
  for (const id of T.tlsNodes) {
    const p = net.tls[id];
    o.push(`    <tlLogic id="${id}" type="${p.type === 'actuated' ? 'actuated' : 'static'}" programID="0" offset="${p.offset || 0}">`);
    for (const ph of p.phases) o.push(`        <phase ${SW.attrs({ duration: ph.duration, state: ph.state, minDur: p.type === 'actuated' ? ph.minDur : '', maxDur: p.type === 'actuated' ? ph.maxDur : '' })}/>`);
    o.push('    </tlLogic>');
  }
  for (const id of T.tlsNodes) for (const c of T.tlsPrograms[id].links) o.push(`    <connection from="${c.from}" to="${c.to}" fromLane="${c.fromLane}" toLane="${c.toLane}" tl="${id}" linkIndex="${c.tlIndex}"/>`);
  o.push('</tlLogics>'); return o.join('\n');
};
SW.toRouXML = function (d) {
  const o = ['<?xml version="1.0" encoding="UTF-8"?>', '<routes xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://sumo.dlr.de/xsd/routes_file.xsd">'];
  const hex2rgb = c => { if (!c || c[0] !== '#') return c; const n = parseInt(c.slice(1), 16); return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`; };
  for (const t of Object.values(d.vTypes)) {
    o.push(`    <vType ${SW.attrs({ id: t.id, vClass: ({ angkot: 'taxi' })[t.vClass] || t.vClass, latAlignment: (t.vClass === 'motorcycle' || t.vClass === 'bicycle') ? 'arbitrary' : '', length: t.length, minGap: t.minGap, accel: t.accel, decel: t.decel, emergencyDecel: t.emergencyDecel, sigma: t.sigma, tau: t.tau, maxSpeed: SW.f2(t.maxSpeed), speedFactor: t.speedFactor, speedDev: t.speedDev, carFollowModel: t.carFollowModel, lcSpeedGain: t.lcSpeedGain, lcKeepRight: t.lcKeepRight, emissionClass: SW.EMISSION_SUMO[t.emissionClass] || 'HBEFA3/' + t.emissionClass, color: hex2rgb(t.color), mass: t.mass })}>`);
    if (t.emissionClass === 'Energy') o.push(`        <param key="device.battery.capacity" value="${t.batteryCapacity || 35000}"/>`);
    o.push('    </vType>');
  }
  for (const r of Object.values(d.routes)) o.push(`    <route id="${r.id}" edges="${r.edges.join(' ')}"/>`);
  const items = [...d.vehicles.map(v => ['v', +v.depart || 0, v]), ...d.flows.map(f => ['f', +f.begin || 0, f])].sort((a, b) => a[1] - b[1]);
  for (const [k, , x] of items) {
    const stopsXml = (x.stops || []).map(st => `        <stop busStop="${SW.xmlEsc(st.busStop)}" duration="${st.duration || 20}"/>`);
    if (k === 'v') {
      if (x.route && !stopsXml.length) o.push(`    <vehicle ${SW.attrs({ id: x.id, type: x.type, route: x.route, depart: x.depart, departLane: x.departLane, departSpeed: x.departSpeed })}/>`);
      else if (x.route) { o.push(`    <vehicle ${SW.attrs({ id: x.id, type: x.type, route: x.route, depart: x.depart, departLane: x.departLane, departSpeed: x.departSpeed })}>`); o.push(...stopsXml); o.push('    </vehicle>'); }
      else if (x.edges) { o.push(`    <vehicle ${SW.attrs({ id: x.id, type: x.type, depart: x.depart, departLane: x.departLane, departSpeed: x.departSpeed })}>`); o.push(`        <route edges="${x.edges.join(' ')}"/>`); o.push(...stopsXml); o.push('    </vehicle>'); }
      else o.push(`    <trip ${SW.attrs({ id: x.id, type: x.type, depart: x.depart, from: x.from, to: x.to, via: (x.via || []).join(' '), departLane: x.departLane, departSpeed: x.departSpeed })}/>`);
    } else {
      const fa = SW.attrs({ id: x.id, type: x.type, begin: x.begin, end: x.end, vehsPerHour: x.vehsPerHour, period: x.period, probability: x.probability, number: x.number, route: x.route, from: x.route || x.edges ? '' : x.from, to: x.route || x.edges ? '' : x.to, via: (x.via || []).join(' '), departLane: x.departLane, departSpeed: x.departSpeed });
      if (x.edges && !x.route) { o.push(`    <flow ${fa}>`); o.push(`        <route edges="${x.edges.join(' ')}"/>`); o.push(...stopsXml); o.push('    </flow>'); }
      else if (stopsXml.length) { o.push(`    <flow ${fa}>`); o.push(...stopsXml); o.push('    </flow>'); }
      else o.push(`    <flow ${fa}/>`);
    }
  }
  o.push('</routes>'); return o.join('\n');
};
SW.toAddXML = function (a) {
  const o = ['<?xml version="1.0" encoding="UTF-8"?>', '<additional>'];
  for (const d of a.e1) o.push(`    <inductionLoop ${SW.attrs({ id: d.id, lane: d.lane, pos: SW.f2(d.pos), period: d.period || 60, file: 'e1_output.xml' })}/>`);
  for (const d of a.e2) o.push(`    <laneAreaDetector ${SW.attrs({ id: d.id, lane: d.lane, pos: SW.f2(d.pos), length: SW.f2(d.length), period: d.period || 60, file: 'e2_output.xml' })}/>`);
  for (const b of a.busStops || []) o.push(`    <busStop ${SW.attrs({ id: b.id, lane: b.lane, startPos: SW.f2(b.startPos), endPos: SW.f2(b.endPos), name: b.name, lines: b.lines })}/>`);
  if ((a.crossings || []).length) o.push('    <!-- penyeberangan Optimus (zebra/pelican) tidak diekspor ke SUMO; untuk pejalan kaki di SUMO pakai opsi netconvert crossings.guess -->');
  o.push('</additional>'); return o.join('\n');
};
SW.toSumocfg = function (cfg, name) {
  name = name || 'scenario';
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<configuration xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://sumo.dlr.de/xsd/sumoConfiguration.xsd">',
    '    <input>', `        <net-file value="${name}.net.xml"/>`, `        <route-files value="${name}.rou.xml"/>`, `        <additional-files value="${name}.add.xml"/>`, '    </input>',
    '    <time>', `        <begin value="${cfg.begin}"/>`, `        <end value="${cfg.end}"/>`, `        <step-length value="${cfg.stepLength}"/>`, '    </time>',
    '    <processing>', `        <time-to-teleport value="${cfg.timeToTeleport}"/>`, '    </processing>',
    '    <random_number>', `        <seed value="${cfg.seed}"/>`, '    </random_number>',
    '    <output>', '        <tripinfo-output value="tripinfo.xml"/>', '        <summary-output value="summary.xml"/>', '    </output>',
    '    <gui_only>', `        <delay value="${cfg.delay}"/>`, '    </gui_only>', '</configuration>'].join('\n');
};
/* build scripts: netconvert builds the SUMO .net.xml from nod/edg/con/tll (keeps Optimus's lanes & signals) */
SW.toBuildScript = function (net, name, win) {
  name = name || 'scenario';
  const lh = net.lefthand ? ' --lefthand true' : '';
  const cmd = `netconvert -n ${name}.nod.xml -e ${name}.edg.xml -x ${name}.con.xml -i ${name}.tll.xml -o ${name}.net.xml --no-turnarounds true${lh}`;
  if (win) return ['@echo off', 'REM Optimus -> SUMO: bangun jaringan lalu buka di sumo-gui', 'cd /d "%~dp0"', cmd, 'if errorlevel 1 exit /b 1', `sumo-gui -c ${name}.sumocfg`].join('\r\n') + '\r\n';
  return ['#!/bin/sh', '# Optimus -> SUMO: bangun jaringan lalu buka di sumo-gui', 'cd "$(dirname "$0")" || exit 1', `${cmd} || exit 1`, `sumo-gui -c ${name}.sumocfg`].join('\n') + '\n';
};
SW.toTripinfoXML = function (sim) {
  const o = ['<?xml version="1.0" encoding="UTF-8"?>', '<tripinfos>'];
  for (const r of sim.tripinfo) {
    o.push(`    <tripinfo ${SW.attrs({ id: r.id, depart: SW.f2(r.depart), departDelay: SW.f2(r.departDelay), arrival: SW.f2(r.arrival), duration: SW.f2(r.duration), routeLength: SW.f2(r.routeLength), waitingTime: SW.f2(r.waitingTime), timeLoss: SW.f2(r.timeLoss), vType: r.type, vaporized: r.vaporized })}>`);
    o.push(`        <emissions ${SW.attrs({ CO_abs: SW.f2(r.CO * 1000), CO2_abs: SW.f2(r.CO2 * 1000), HC_abs: SW.f2(r.HC * 1000), PMx_abs: SW.f2(r.PMx * 1000), NOx_abs: SW.f2(r.NOx * 1000), fuel_abs: SW.f2(r.fuel * 1000), electricity_abs: SW.f2(r.elec) })}/>`);
    o.push('    </tripinfo>');
  }
  o.push('</tripinfos>'); return o.join('\n');
};
SW.toSummaryXML = function (sim) {
  const o = ['<?xml version="1.0" encoding="UTF-8"?>', '<summary>'];
  for (const s of sim.summary) o.push(`    <step time="${SW.f2(s.t)}" loaded="${sim.loaded}" inserted="${s.departed}" running="${s.running}" waiting="${s.waiting}" ended="${s.arrived}" halting="${s.halting}" meanSpeed="${SW.f2(s.meanSpeed)}"/>`);
  o.push('</summary>'); return o.join('\n');
};
SW.toDetectorXML = function (sim) {
  const o = ['<?xml version="1.0" encoding="UTF-8"?>', '<detector>'];
  for (const d of sim.e1) for (const i of d.intervals) o.push(`    <interval ${SW.attrs({ begin: SW.f2(i.begin), end: SW.f2(i.end), id: d.d.id, nVehContrib: i.nVehContrib, flow: SW.f2(i.flow), occupancy: SW.f2(i.occupancy), speed: SW.f2(i.speed), length: SW.f2(i.length) })}/>`);
  for (const d of sim.e2) for (const i of d.intervals) o.push(`    <interval ${SW.attrs({ begin: SW.f2(i.begin), end: SW.f2(i.end), id: d.d.id, meanSpeed: SW.f2(i.meanSpeed), meanOccupancy: SW.f2(i.meanOccupancy), meanVehicleNumber: SW.f2(i.meanVehicleNumber), maxJamLengthInMeters: SW.f2(i.maxJamLengthInMeters), meanMaxJamLengthInMeters: SW.f2(i.meanJamLengthInMeters) })}/>`);
  o.push('</detector>'); return o.join('\n');
};
SW.toEdgeDataXML = function (sim) {
  const byInt = {};
  for (const [id, st] of Object.entries(sim.edgeStats)) for (const i of st.intervals) { const k = i.begin + '|' + i.end; (byInt[k] = byInt[k] || []).push([id, i]); }
  const o = ['<?xml version="1.0" encoding="UTF-8"?>', '<meandata>'];
  for (const [k, list] of Object.entries(byInt)) {
    const [b, e] = k.split('|');
    o.push(`    <interval begin="${SW.f2(+b)}" end="${SW.f2(+e)}" id="edgedata">`);
    for (const [id, i] of list) o.push(`        <edge ${SW.attrs({ id, sampledSeconds: SW.f2(i.sampledSeconds), density: SW.f2(i.density), speed: SW.f2(i.speed), entered: i.entered, waitingTime: SW.f2(i.waitingTime), CO2_abs: SW.f2(i.CO2_abs * 1000) })}/>`);
    o.push('    </interval>');
  }
  o.push('</meandata>'); return o.join('\n');
};

/* ---------- PKJI 2023 (Pedoman Kapasitas Jalan Indonesia) ----------
   Simpang APILL: S0 = 600 x LE, S = S0 x FHS x FUK x FG x FP x FBKa x FBKi, C = S x H / c, DJ = q / C
   Ruas jalan perkotaan: C = C0 x FCLJ x FCPA x FCHS x FCUK
   EMP: KR 1,0; KB 1,3 (APILL) / 1,2 (ruas); SM 0,15 terlindung / 0,40 terlawan (APILL), 0,25 (ruas)
   Tingkat pelayanan simpang APILL: PM Perhubungan 96/2015 (tundaan rata-rata, detik/SMP) */
SW.PKJI = {
  FUK: [[3e6, 1.05], [1e6, 1.0], [5e5, 0.94], [1e5, 0.83], [0, 0.82]],
  FHS: { KOM: { T: 0.93, S: 0.94, R: 0.95 }, KIM: { T: 0.96, S: 0.97, R: 0.98 }, AT: { T: 1.0, S: 1.0, R: 1.0 } },
  FCHS: { T: 0.92, S: 0.95, R: 0.98 },
  LOS_APILL: [[5, 'A'], [15, 'B'], [25, 'C'], [40, 'D'], [60, 'E']],
  defaults: () => ({ population: 1100000, environment: 'KOM', friction: 'S', warmup: 300, laneWidth: SW.LANE_W })
};
SW.pkjiLos = d => { for (const [lim, g] of SW.PKJI.LOS_APILL) if (d <= lim) return g; return 'F'; };
SW.pkji = function (net, res, opt) {
  opt = Object.assign(SW.PKJI.defaults(), opt || {});
  const T = SW.buildTopo(net);
  const hours = Math.max(1 / 60, (res.simTime - (res.warmup || 0)) / 3600);
  const FUK = SW.PKJI.FUK.find(([p]) => opt.population >= p)[1];
  const FHS = (SW.PKJI.FHS[opt.environment] || SW.PKJI.FHS.KOM)[opt.friction] || 0.94;
  const far = T.far, near = T.near;
  const approaches = [];
  for (const id of T.tlsNodes) {
    const pr = T.tlsPrograms[id], prog = net.tls[id];
    const cycle = prog.phases.reduce((a, p) => a + p.duration, 0);
    const froms = [...new Set(pr.links.map(c => c.from))];
    for (const e of froms) {
      const te = T.edges[e], links = pr.links.filter(c => c.from === e);
      // effective green: phases where any movement of this approach may go (+ yellow as lost/extension ~ equal)
      let g = 0, opposed = false;
      for (const ph of prog.phases) if (links.some(c => /[Gg]/.test(ph.state[c.tlIndex]))) { g += ph.duration; if (links.some(c => ph.state[c.tlIndex] === 'g')) opposed = true; }
      const st = (res.approaches || {})[e] || { n: 0, KR: 0, KB: 0, SM: 0, delaySum: 0, maxQm: 0, maxQveh: 0, byDir: {} };
      const empSM = opposed ? 0.4 : 0.15;
      const q = (st.KR * 1.0 + st.KB * 1.3 + st.SM * empSM) / hours;               // smp/jam
      const nTot = Math.max(1, st.n), pFar = ((st.byDir || {})[far] || 0) / nTot, pNear = ((st.byDir || {})[near] || 0) / nTot;
      const LE = te.lanes.length * opt.laneWidth;
      const S0 = 600 * LE;
      const FBKa = 1 + 0.26 * pFar, FBKi = Math.max(0.7, 1 - 0.16 * pNear);
      const S = S0 * FHS * FUK * 1.0 * 1.0 * FBKa * FBKi;
      const C = S * g / Math.max(1, cycle);
      const DJ = C > 0 ? q / C : null;
      const RH = g / Math.max(1, cycle);
      // PKJI queue & delay
      let NQ1 = 0; if (DJ > 0.5) NQ1 = 0.25 * C * ((DJ - 1) + Math.sqrt((DJ - 1) ** 2 + 8 * (DJ - 0.5) / C));
      const dj = Math.min(DJ || 0, 0.99);
      const NQ2 = cycle * (1 - RH) / (1 - RH * dj) * q / 3600;
      const NQ = NQ1 + NQ2;
      const PA = NQ * 20 / Math.max(1, LE);
      const TL = cycle * 0.5 * (1 - RH) ** 2 / (1 - RH * dj) + (C > 0 ? NQ1 * 3600 / C : 0);
      const TG = (pFar + pNear) * 6 * 0.7 + 4 * 0.3 * 0;
      const Tpkji = TL + TG;
      const Tsim = st.n ? st.delaySum / st.n : null;
      approaches.push({
        node: te.to, tl: id, approach: e, name: te.e.name || '', lanes: te.lanes.length, LE, type: opposed ? 'O (terlawan)' : 'P (terlindung)',
        counts: { KR: st.KR, KB: st.KB, SM: st.SM, KTB: st.KTB || 0 }, q_kend: st.n / hours, q_smp: q, pFar, pNear,
        S0, FUK, FHS, FBKa, FBKi, S, g, cycle, C, DJ, NQ, PA, T_pkji: Tpkji, T_sim: Tsim, Q_sim_m: st.maxQm, los_pkji: SW.pkjiLos(Tpkji), los_sim: Tsim !== null ? SW.pkjiLos(Tsim) : null
      });
    }
  }
  // junction totals (weighted by flow)
  const junctions = {};
  for (const a of approaches) {
    const j = junctions[a.tl] = junctions[a.tl] || { tl: a.tl, q: 0, dq: 0, dqs: 0, maxDJ: 0, n: 0 };
    j.q += a.q_smp; j.dq += a.T_pkji * a.q_smp; if (a.T_sim !== null) { j.dqs += a.T_sim * a.q_smp; j.n += a.q_smp; } j.maxDJ = Math.max(j.maxDJ, a.DJ || 0);
  }
  for (const j of Object.values(junctions)) { j.T_pkji = j.q ? j.dq / j.q : 0; j.T_sim = j.n ? j.dqs / j.n : null; j.los_pkji = SW.pkjiLos(j.T_pkji); j.los_sim = j.T_sim !== null ? SW.pkjiLos(j.T_sim) : null; }
  // road segments
  const segments = [];
  const seen = new Set();
  for (const te of Object.values(T.edges)) {
    if (seen.has(te.id)) continue;
    const rev = te.rev ? T.edges[te.rev] : null;
    seen.add(te.id); if (rev) seen.add(rev.id);
    if (te.length < 50) continue;
    const cnt = id => (res.edgeCls || {})[id] || { KR: 0, KB: 0, SM: 0 };
    const undivided = !!rev && te.lanes.length === 1 && rev.lanes.length === 1;
    const empKB = undivided ? 1.3 : 1.2, empSM = 0.25;
    const qd = id => { const c = cnt(id); return (c.KR + c.KB * empKB + c.SM * empSM) / hours; };
    const q1 = qd(te.id), q2 = rev ? qd(rev.id) : 0;
    const W = opt.laneWidth, FCLJ = W >= 3.5 ? 1.0 : W >= 3.25 ? 0.96 + (W - 3.25) * 0.16 : 0.92 + (W - 3.0) * 0.16;
    const FCHS = SW.PKJI.FCHS[opt.friction] || 0.95;
    if (undivided) {
      const split = (q1 + q2) > 0 ? Math.max(q1, q2) / (q1 + q2) : 0.5;
      const FCPA = split <= 0.5 ? 1 : split <= 0.55 ? 0.97 : split <= 0.6 ? 0.94 : split <= 0.65 ? 0.91 : 0.88;
      const C = 2800 * FCLJ * FCPA * FCHS * FUK;
      segments.push({ edge: te.id + (rev ? ' + ' + rev.id : ''), name: te.e.name || '', type: '2/2-TT', length: te.length, q_smp: q1 + q2, C, DJ: C ? (q1 + q2) / C : null, FCLJ, FCPA, FCHS, FCUK: FUK });
    } else {
      for (const x of rev ? [te, rev] : [te]) {
        const q = qd(x.id), C = 1700 * x.lanes.length * FCLJ * FCHS * FUK;
        segments.push({ edge: x.id, name: x.e.name || '', type: x.lanes.length + ' lajur/arah' + (rev ? ' (terbagi)' : ' (satu arah)'), length: x.length, q_smp: q, C, DJ: C ? q / C : null, FCLJ, FCPA: 1, FCHS, FCUK: FUK });
      }
    }
  }
  return { options: opt, hours, approaches, junctions: Object.values(junctions), segments };
};
SW.pkjiInput = sim => ({ simTime: sim.t, warmup: sim.cfg.warmup || 0, approaches: sim.approach, edgeCls: sim.edgeCls });

/* ---------- RL training (Part 8): episodes of the same scenario with exploration ---------- */
SW.trainRL = async function (net, demand, add, cfg, o = {}) {
  const ids = o.programs || Object.keys(net.tls);
  for (const id of ids) { const p = net.tls[id]; if (!p) continue; p.type = 'rl'; p.rl = p.rl && !o.reset ? p.rl : { q: {}, minGreen: o.minGreen || 10, maxGreen: o.maxGreen || 60, interval: o.interval || 5 }; }
  const episodes = o.episodes || 30, horizon = o.horizon || Math.min(cfg.end || 3600, 1800), curve = [];
  for (let ep = 0; ep < episodes; ep++) {
    const eps = Math.max(0.02, (o.eps0 || 0.3) * (1 - ep / Math.max(1, episodes - 1)));
    const sim = new SW.Sim(net, demand, add, Object.assign({}, cfg, { seed: (cfg.seed || 1) + ep, end: horizon }));
    sim.rlTrain = { eps, alpha: o.alpha || 0.1, gamma: o.gamma || 0.9, rewardSum: 0, decisions: 0 };
    let tl = 0, n = 0;
    while (sim.t < horizon) { sim.step(); for (const v of sim.vehs.values()) if (v.v < 0.1) tl++; n++; if (o.yieldEvery && n % o.yieldEvery === 0) await o.yieldEvery_fn(); }
    const trips = sim.tripinfo;
    curve.push({ episode: ep + 1, eps, meanHalting: tl / n, meanTimeLoss: trips.length ? trips.reduce((a, r) => a + r.timeLoss, 0) / trips.length : 0, arrived: trips.length, states: ids.reduce((a, id) => a + Object.keys((net.tls[id].rl || {}).q || {}).length, 0) });
    if (o.onProgress) await o.onProgress(curve[curve.length - 1]);
  }
  return curve;
};
SW.evalTLS = function (net, demand, add, cfg, horizon) {
  const sim = new SW.Sim(net, demand, add, Object.assign({}, cfg, { end: horizon }));
  while (sim.t < horizon) sim.step();
  const tr = sim.tripinfo;
  return { arrived: tr.length, meanTimeLoss: tr.length ? tr.reduce((a, r) => a + r.timeLoss, 0) / tr.length : 0, meanWait: tr.length ? tr.reduce((a, r) => a + r.waitingTime, 0) / tr.length : 0, teleports: sim.teleports };
};

/* ---------- compact result payload (stored in PostgreSQL by the server) ---------- */
SW.runPayload = function (sim, note) {
  const r2 = v => Math.round(v * 100) / 100;
  return {
    engine: 'sumoweb', note: note || '', config: Object.assign({}, sim.cfg), sim_time: sim.t,
    totals: Object.assign({}, sim.totals, { arrived: sim.arrived.length, departed: sim.departed, loaded: sim.loaded, teleports: sim.teleports }),
    summary: sim.summary.map(s => [s.t, s.running, s.halting, r2(s.meanSpeed), s.arrived, r2(s.co2)]),
    tripinfo: sim.tripinfo.map(r => [r.id, r.type, r2(r.depart), r2(r.duration), r2(r.routeLength), r2(r.waitingTime), r2(r.timeLoss), r2(r.CO2), r2(r.fuel), r2(r.elec)]),
    detectors: [...sim.e1.map(d => ({ id: d.d.id, kind: 'e1', intervals: d.intervals })), ...sim.e2.map(d => ({ id: d.d.id, kind: 'e2', intervals: d.intervals }))],
    extra: { pkji: SW.pkjiInput(sim), peds: sim.pedStats, crossings: (sim.crossings || []).map(c => ({ id: c.d.id, type: c.type, crossed: c.crossed, meanWait: c.crossed ? c.waitSum / c.crossed : 0 })), busStops: Object.values(sim.busStops || {}).map(b => ({ id: b.d.id, name: b.d.name, arrivals: b.arrivals, dwell: b.arrivals ? b.dwellSum / b.arrivals : 0 })) }
  };
};

/* ---------- import ---------- */
SW.importAny = function (txt, state) {
  const doc = SW.parseXML(txt);
  const top = doc.children.find(c => c.tag) || {};
  const tag = top.tag;
  if (tag === 'net') { state.net = SW.importNet(top); return 'net'; }
  if (tag === 'osm') { state.net = SW.importOSM(top); return 'osm'; }
  if (tag === 'routes') { SW.importRoutes(top, state.demand); return 'routes'; }
  if (tag === 'additional' || tag === 'add') { SW.importAdditional(top, state.add, state.demand); return 'additional'; }
  if (tag === 'configuration') { SW.importCfg(top, state.cfg); return 'sumocfg'; }
  if (tag === 'nodes') { for (const n of SW.findAll(top, 'node')) SW.addNode(state.net, +n.attrs.x, +n.attrs.y, n.attrs.type || 'priority', n.attrs.id); return 'nodes'; }
  if (tag === 'edges') {
    for (const e of SW.findAll(top, 'edge')) if (state.net.nodes[e.attrs.from] && state.net.nodes[e.attrs.to])
      { const sh = SW.geom.parseShape(e.attrs.shape); SW.addEdge(state.net, e.attrs.from, e.attrs.to, { id: e.attrs.id, numLanes: +e.attrs.numLanes || 1, speed: +e.attrs.speed || 13.89, priority: e.attrs.priority !== undefined ? +e.attrs.priority : -1, name: e.attrs.name, shape: sh.slice(1, -1).filter(p => !sh.some(q => q.z !== undefined) || true).map(p => ({ x: p.x, y: p.y })), ...SW.zInfo([sh]) }); }
    return 'edges';
  }
  throw new Error('Format tidak dikenali: <' + tag + '>');
};
SW.importNet = function (top) {
  const net = SW.newNet();
  if (top.attrs.lefthand === 'true' || top.attrs.lefthand === '1') net.lefthand = true;
  const loc = SW.findAll(top, 'location')[0];
  if (loc) net.location = { proj: loc.attrs.projParameter, origBoundary: loc.attrs.origBoundary, netOffset: loc.attrs.netOffset };
  for (const j of SW.findAll(top, 'junction')) {
    if (j.attrs.type === 'internal') continue;
    let type = j.attrs.type;
    if (/traffic_light/.test(type)) type = 'traffic_light';
    else if (type === 'right_before_left' || type === 'allway_stop') type = 'right_before_left';
    else type = 'priority';
    SW.addNode(net, +j.attrs.x, +j.attrs.y, type, j.attrs.id);
  }
  const edges = SW.findAll(top, 'edge').filter(e => !e.attrs.function || e.attrs.function === 'normal');
  const pair = new Set(edges.map(e => e.attrs.from + '|' + e.attrs.to));
  for (const e of edges) {
    const lanes = e.children.filter(c => c.tag === 'lane');
    if (!net.nodes[e.attrs.from] || !net.nodes[e.attrs.to] || !lanes.length) continue;
    let shape = [];
    if (e.attrs.shape) shape = SW.geom.parseShape(e.attrs.shape).slice(1, -1);
    else {
      const shapes = lanes.map(l => SW.geom.parseShape(l.attrs.shape));
      const n = shapes[0].length;
      if (n > 2 && shapes.every(s => s.length === n)) {
        let avg = shapes[0].map((p, i) => ({ x: shapes.reduce((a, s) => a + s[i].x, 0) / shapes.length, y: shapes.reduce((a, s) => a + s[i].y, 0) / shapes.length }));
        if (pair.has(e.attrs.to + '|' + e.attrs.from)) avg = SW.geom.offset(avg, lanes.length * SW.LANE_W / 2);
        shape = avg.slice(1, -1);
      }
    }
    const speed = Math.max(...lanes.map(l => +l.attrs.speed || 13.89));
    shape = shape.map(p => ({ x: p.x, y: p.y }));
    const el = SW.zInfo(lanes.map(l => SW.geom.parseShape(l.attrs.shape)));
    SW.addEdge(net, e.attrs.from, e.attrs.to, { id: e.attrs.id, numLanes: lanes.length, speed, priority: e.attrs.priority !== undefined ? +e.attrs.priority : -1, name: e.attrs.name || '', shape, ...el });
  }
  const conns = SW.findAll(top, 'connection').filter(c => !c.attrs.from.startsWith(':') && net.edges[c.attrs.from] && net.edges[c.attrs.to]);
  if (conns.length) net.connections = conns.map(c => ({ from: c.attrs.from, to: c.attrs.to, fromLane: +c.attrs.fromLane, toLane: +c.attrs.toLane, dir: { R: 'r', L: 'l', t: 't', T: 't', s: 's', r: 'r', l: 'l' }[c.attrs.dir] || undefined, linkIndex: c.attrs.linkIndex !== undefined ? +c.attrs.linkIndex : undefined }));
  // TLS programs: a tl id may control one or several junctions (joined)
  const tlNodes = {};
  for (const c of conns) if (c.attrs.tl) { const fromE = net.edges[c.attrs.from]; if (fromE) (tlNodes[c.attrs.tl] = tlNodes[c.attrs.tl] || new Set()).add(fromE.to); }
  for (const tl of SW.findAll(top, 'tlLogic')) {
    const nodes = tlNodes[tl.attrs.id] ? [...tlNodes[tl.attrs.id]] : (net.nodes[tl.attrs.id] ? [tl.attrs.id] : []);
    if (!nodes.length) continue;
    for (const nid of nodes) { net.nodes[nid].type = 'traffic_light'; if (nodes.length > 1 || nid !== tl.attrs.id) net.nodes[nid].tl = tl.attrs.id; }
    net.tls[tl.attrs.id] = { id: tl.attrs.id, type: tl.attrs.type === 'actuated' || tl.attrs.type === 'delay_based' ? 'actuated' : 'static', programID: tl.attrs.programID || '0', offset: +tl.attrs.offset || 0, phases: tl.children.filter(p => p.tag === 'phase').map(p => ({ duration: +p.attrs.duration, state: p.attrs.state, minDur: p.attrs.minDur !== undefined ? +p.attrs.minDur : undefined, maxDur: p.attrs.maxDur !== undefined ? +p.attrs.maxDur : undefined, name: p.attrs.name })) };
  }
  if (net.roundaboutsXML) delete net.roundaboutsXML;
  return net;
};
SW.zInfo = function (shapes) {
  let zmax = 0, z0 = 0, z1 = 0;
  for (const sh of shapes) { if (!sh.length) continue; for (const p of sh) if (p.z !== undefined && Math.abs(p.z) > Math.abs(zmax)) zmax = p.z; z0 = sh[0].z || 0; z1 = sh[sh.length - 1].z || 0; }
  if (Math.abs(zmax) < 1.5) return {};
  return { layer: zmax > 0 ? (zmax > 12 ? 2 : 1) : (zmax < -10 ? -2 : -1), height: +zmax.toFixed(2), rampIn: Math.abs(z0) < Math.abs(zmax) * 0.5, rampOut: Math.abs(z1) < Math.abs(zmax) * 0.5 };
};
SW.importRoutes = function (top, d) {
  const rgb2hex = c => { if (!c) return undefined; if (c[0] === '#') return c; const named = { red: '#ff0000', green: '#00ff00', blue: '#0000ff', yellow: '#ffff00', white: '#ffffff', cyan: '#00ffff', magenta: '#ff00ff' }; if (named[c]) return named[c]; const p = c.split(',').map(Number); if (p.length < 3) return undefined; const k = p.every(x => x <= 1) && p.some(x => x % 1) ? 255 : 1; return '#' + p.slice(0, 3).map(x => Math.round(x * k).toString(16).padStart(2, '0')).join(''); };
  for (const t of SW.findAll(top, 'vType')) {
    const a = t.attrs, num = k => a[k] !== undefined ? +a[k] : undefined;
    const ec = (a.emissionClass || '').toLowerCase();
    let emissionClass;
    if (ec.includes('energy') || ec.includes('mmpevem')) emissionClass = 'Energy';
    else if (ec.includes('zero')) emissionClass = 'zero';
    else if (ec.includes('hdv') || ec.includes('bus') || ec.includes('coach')) emissionClass = 'HDV_D_EU4';
    else if (ec.includes('_d_') || ec.includes('diesel')) emissionClass = 'PC_D_EU4';
    else if (ec.includes('mc_') || ec.includes('moped') || ec.includes('motorcycle')) emissionClass = 'MC_4S_EU3';
    else if (ec.includes('ldv')) emissionClass = 'LDV_G_EU4';
    else if (ec) emissionClass = 'PC_G_EU4';
    const o = {};
    for (const k of ['length', 'minGap', 'accel', 'decel', 'emergencyDecel', 'sigma', 'tau', 'maxSpeed', 'speedFactor', 'speedDev', 'lcSpeedGain', 'lcKeepRight', 'mass']) if (num(k) !== undefined && !isNaN(num(k))) o[k] = num(k);
    if (a.carFollowModel) o.carFollowModel = a.carFollowModel === 'IDM' ? 'IDM' : 'Krauss';
    if (emissionClass) o.emissionClass = emissionClass;
    if (a.color) o.color = rgb2hex(a.color);
    const cap = t.children.find(c => c.tag === 'param' && /battery.*capacity/i.test(c.attrs.key));
    if (cap) o.batteryCapacity = +cap.attrs.value;
    let vc = a.vClass || 'passenger';
    if (!SW.VCLASS[vc]) vc = { delivery: 'truck', trailer: 'truck', coach: 'bus', tram: 'bus', moped: 'motorcycle', taxi: 'angkot', private: 'passenger', authority: 'emergency' }[vc] || 'passenger';
    d.vTypes[a.id] = SW.makeVType(a.id, vc, o);
  }
  for (const r of top.children.filter(c => c.tag === 'route')) d.routes[r.attrs.id] = { id: r.attrs.id, edges: r.attrs.edges.trim().split(/\s+/) };
  const getRoute = (el) => { const rr = el.children.find(c => c.tag === 'route'); return rr ? rr.attrs.edges.trim().split(/\s+/) : null; };
  for (const el of top.children) {
    const a = el.attrs;
    if (el.tag === 'vehicle' || el.tag === 'trip') {
      const v = { id: a.id, type: a.type || 'DEFAULT_VEHTYPE', depart: a.depart === 'triggered' ? 0 : +a.depart || 0, departLane: a.departLane, departSpeed: a.departSpeed };
      const sts = el.children.filter(c => c.tag === 'stop' && c.attrs.busStop).map(c => ({ busStop: c.attrs.busStop, duration: +c.attrs.duration || 20 }));
      if (sts.length) v.stops = sts;
      const inner = getRoute(el);
      if (inner) v.edges = inner; else if (a.route) v.route = a.route; else { v.from = a.from; v.to = a.to; if (a.via) v.via = a.via.split(/\s+/); }
      d.vehicles.push(v);
    } else if (el.tag === 'flow') {
      const f = { id: a.id, type: a.type || 'DEFAULT_VEHTYPE', begin: +a.begin || 0, end: a.end !== undefined ? +a.end : undefined, departLane: a.departLane, departSpeed: a.departSpeed };
      const fst = el.children.filter(c => c.tag === 'stop' && c.attrs.busStop).map(c => ({ busStop: c.attrs.busStop, duration: +c.attrs.duration || 20 }));
      if (fst.length) f.stops = fst;
      for (const k of ['vehsPerHour', 'period', 'probability', 'number']) if (a[k] !== undefined) f[k] = +String(a[k]).replace(/^exp\(|\)$/g, '');
      if (a.perHour) f.vehsPerHour = +a.perHour;
      const inner = getRoute(el);
      if (inner) f.edges = inner; else if (a.route) f.route = a.route; else { f.from = a.from; f.to = a.to; if (a.via) f.via = a.via.split(/\s+/); }
      d.flows.push(f);
    }
  }
};
SW.importAdditional = function (top, add, demand) {
  add.busStops = add.busStops || [];
  for (const e of [...SW.findAll(top, 'busStop'), ...SW.findAll(top, 'trainStop')]) add.busStops.push({ id: e.attrs.id, lane: e.attrs.lane, startPos: +e.attrs.startPos || 0, endPos: +e.attrs.endPos || 20, name: e.attrs.name || '', lines: e.attrs.lines || '' });
  for (const e of [...SW.findAll(top, 'inductionLoop'), ...SW.findAll(top, 'e1Detector')]) add.e1.push({ id: e.attrs.id, lane: e.attrs.lane, pos: +e.attrs.pos || 0, period: +(e.attrs.period || e.attrs.freq) || 60 });
  for (const e of [...SW.findAll(top, 'laneAreaDetector'), ...SW.findAll(top, 'e2Detector')]) add.e2.push({ id: e.attrs.id, lane: e.attrs.lane, pos: +e.attrs.pos || 0, length: +e.attrs.length || 50, period: +(e.attrs.period || e.attrs.freq) || 60 });
  if (demand && SW.findAll(top, 'vType').length) SW.importRoutes(top, demand);
};
SW.importCfg = function (top, cfg) {
  const val = t => { const e = SW.findAll(top, t)[0]; return e ? e.attrs.value : undefined; };
  if (val('begin') !== undefined) cfg.begin = +val('begin');
  if (val('end') !== undefined) cfg.end = +val('end');
  if (val('step-length') !== undefined) cfg.stepLength = +val('step-length');
  if (val('seed') !== undefined) cfg.seed = +val('seed');
  if (val('time-to-teleport') !== undefined) cfg.timeToTeleport = +val('time-to-teleport');
  if (val('delay') !== undefined) cfg.delay = +val('delay');
};

/* ---------- OSM import (netconvert --osm-files) ---------- */
SW.OSM_TYPES = {
  motorway: [3, 33.33, 13], motorway_link: [1, 22.22, 12], trunk: [2, 27.78, 11], trunk_link: [1, 22.22, 10], primary: [2, 22.22, 9], primary_link: [1, 22.22, 8],
  secondary: [1, 16.67, 7], secondary_link: [1, 16.67, 6], tertiary: [1, 13.89, 6], tertiary_link: [1, 13.89, 5], unclassified: [1, 13.89, 5], residential: [1, 13.89, 4], living_street: [1, 2.78, 3], service: [1, 5.56, 2]
};
SW.importOSM = function (top, opts = {}) {
  const nodes = {}, ways = [];
  for (const el of top.children) {
    if (el.tag === 'node') nodes[el.attrs.id] = { lat: +el.attrs.lat, lon: +el.attrs.lon, tags: {} , el };
    if (el.tag === 'way') {
      const tags = {}; for (const c of el.children) if (c.tag === 'tag') tags[c.attrs.k] = c.attrs.v;
      const nds = el.children.filter(c => c.tag === 'nd').map(c => c.attrs.ref);
      if (!tags.highway || !SW.OSM_TYPES[tags.highway]) continue;
      if (!opts.service && tags.highway === 'service') continue;
      if (tags.area === 'yes') continue;
      ways.push({ id: el.attrs.id, tags, nds: nds.filter(n => nodes[n]) });
    }
  }
  for (const n of Object.values(nodes)) for (const c of n.el.children) if (c.tag === 'tag') n.tags[c.attrs.k] = c.attrs.v;
  const used = {};
  for (const w of ways) w.nds.forEach((n, i) => { used[n] = (used[n] || 0) + (i === 0 || i === w.nds.length - 1 ? 2 : 1); });
  const ll = Object.keys(used).map(k => nodes[k]);
  if (!ll.length) throw new Error('OSM tidak berisi jalan (highway)');
  const lat0 = ll.reduce((a, n) => a + n.lat, 0) / ll.length, lon0 = ll.reduce((a, n) => a + n.lon, 0) / ll.length;
  const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
  const proj = n => ({ x: (n.lon - lon0) * kx, y: (n.lat - lat0) * ky });
  const net = SW.newNet();
  const minLat = Math.min(...ll.map(n => n.lat)), maxLat = Math.max(...ll.map(n => n.lat)), minLon = Math.min(...ll.map(n => n.lon)), maxLon = Math.max(...ll.map(n => n.lon));
  net.location = { lat0, lon0, kx, ky, proj: `+proj=eqc +lat_0=${lat0.toFixed(6)} +lon_0=${lon0.toFixed(6)}`, origBoundary: [minLon, minLat, maxLon, maxLat].map(v => v.toFixed(6)).join(',') };
  const ensure = id => {
    if (!net.nodes[id]) { const p = proj(nodes[id]); const sig = nodes[id].tags.highway === 'traffic_signals'; SW.addNode(net, p.x, p.y, sig ? 'traffic_light' : 'priority', id); }
    return id;
  };
  const parseSpeed = s => { if (!s) return null; const m = /([\d.]+)\s*(mph)?/.exec(s); if (!m) return null; return +m[1] * (m[2] ? 0.44704 : 1 / 3.6); };
  for (const w of ways) {
    const def = SW.OSM_TYPES[w.tags.highway];
    let oneway = ['yes', 'true', '1', '-1'].includes(w.tags.oneway) || w.tags.highway === 'motorway' || w.tags.junction === 'roundabout';
    if (w.tags.oneway === 'no') oneway = false;
    let nds = w.nds.slice(); if (w.tags.oneway === '-1') nds.reverse();
    let lanes = +w.tags.lanes || 0;
    let fw = lanes ? (oneway ? lanes : Math.max(1, Math.ceil(lanes / 2))) : def[0];
    let bw = lanes ? Math.max(1, lanes - fw) : def[0];
    if (+w.tags['lanes:forward']) fw = +w.tags['lanes:forward'];
    if (+w.tags['lanes:backward']) bw = +w.tags['lanes:backward'];
    const speed = parseSpeed(w.tags.maxspeed) || def[1];
    let layer = parseInt(w.tags.layer) || 0;
    if (!layer && w.tags.bridge && w.tags.bridge !== 'no') layer = 1;
    if (!layer && w.tags.tunnel && w.tags.tunnel !== 'no') layer = -1;
    if (layer > 0 && !(w.tags.bridge && w.tags.bridge !== 'no')) layer = 0;   // layer tag without bridge = ground level
    if (layer < 0 && !(w.tags.tunnel && w.tags.tunnel !== 'no') && w.tags.covered !== 'yes') layer = 0;
    layer = Math.max(-2, Math.min(2, layer));
    let seg = [nds[0]], k = 0;
    for (let i = 1; i < nds.length; i++) {
      seg.push(nds[i]);
      if (used[nds[i]] > 1 || i === nds.length - 1 || nodes[nds[i]].tags.highway === 'traffic_signals') {
        if (seg.length >= 2 && seg[0] !== seg[seg.length - 1]) {
          const a = ensure(seg[0]), b = ensure(seg[seg.length - 1]);
          const shape = seg.slice(1, -1).map(n => proj(nodes[n]));
          const id = w.id + '#' + k;
          if (!Object.values(net.edges).some(e => e.from === a && e.to === b))
            SW.addEdge(net, a, b, { id, numLanes: Math.min(fw, 6), speed, priority: def[2], name: w.tags.name || '', shape, layer, rampIn: false, rampOut: false });
          if (!oneway && !Object.values(net.edges).some(e => e.from === b && e.to === a))
            SW.addEdge(net, b, a, { id: '-' + id, numLanes: Math.min(bw, 6), speed, priority: def[2], name: w.tags.name || '', shape: shape.slice().reverse(), layer, rampIn: false, rampOut: false });
          k++;
        }
        seg = [nds[i]];
      }
    }
  }
  // join traffic-signal nodes that are mid-way (degree 2) into plain priority nodes
  return net;
};
SW.geoOf = function (net, x, y) {
  const L = net.location; if (!L || !L.kx) return null;
  return { lon: L.lon0 + x / L.kx, lat: L.lat0 + y / L.ky };
};

/* ---------- TraCI API ---------- */
SW.TraCIException = class extends Error { constructor(m) { super(m); this.name = 'TraCIException'; } };
SW.makeTraci = function (getSim, ctl) {
  const sim = () => getSim();
  const ex = m => { throw new SW.TraCIException(m); };
  const V = id => sim().vehs.get(String(id)) || ex(`Vehicle '${id}' is not known`);
  const E = id => sim().T.edges[id] || ex(`Edge '${id}' is not known`);
  const Ln = id => sim().T.lanes[id] || ex(`Lane '${id}' is not known`);
  const TL = id => sim().tls[id] || ex(`Traffic light '${id}' is not known`);
  const E1 = id => sim().e1.find(d => d.d.id === id) || ex(`Induction loop '${id}' is not known`);
  const E2 = id => sim().e2.find(d => d.d.id === id) || ex(`Lane area detector '${id}' is not known`);
  const sumoAngle = a => ((90 - a * 180 / Math.PI) % 360 + 360) % 360;
  const roadId = v => v.kind === 'lane' ? v.seg.edge.id : ':' + v.seg.node;
  const laneId = v => v.kind === 'lane' ? v.seg.id : v.seg.id + '_0';
  const lastStep = (lanes) => { let n = 0, sp = 0, h = 0; const ids = []; for (const L of lanes) for (const v of L.vehs) { n++; sp += v.v; if (v.v < 0.1) h++; ids.push(v.id); } return { n, sp, h, ids }; };
  const hex = c => { const n = parseInt((c || '#ffff00').slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255]; };
  const toHex = c => { if (typeof c === 'string') return c; const a = Array.from(c); return '#' + a.slice(0, 3).map(x => Math.max(0, Math.min(255, Math.round(+x))).toString(16).padStart(2, '0')).join(''); };
  const api = {
    INVALID_DOUBLE_VALUE: -1073741824,
    start: () => true, close: () => { if (ctl && ctl.close) ctl.close(); return true; }, load: () => true, isLoaded: () => true, getVersion: () => [21, 'Optimus ' + SW.VERSION],
    simulationStep: (t) => { const s = sim(); if (t && t > s.t) { while (s.t < t - 1e-9) ctl.step(); } else ctl.step(); return []; },
    simulation: {
      getTime: () => sim().t, getCurrentTime: () => Math.round(sim().t * 1000), getDeltaT: () => sim().dt, getEndTime: () => sim().cfg.end,
      getMinExpectedNumber: () => sim().minExpected(), getDepartedNumber: () => sim().stepDeparted.length, getArrivedNumber: () => sim().stepArrived.length,
      getDepartedIDList: () => sim().stepDeparted.slice(), getArrivedIDList: () => sim().stepArrived.slice(), getLoadedNumber: () => sim().loaded,
      getStartingTeleportNumber: () => 0, getCollidingVehiclesNumber: () => 0, getBusStopWaiting: () => 0,
      convertGeo: (x, y, fromGeo) => { const s = sim(); if (fromGeo) { const L = s.net.location; if (!L || !L.kx) return [x, y]; return [(x - L.lon0) * L.kx, (y - L.lat0) * L.ky]; } const g = SW.geoOf(s.net, x, y); return g ? [g.lon, g.lat] : [x, y]; },
      getNetBoundary: () => { const n = Object.values(sim().net.nodes); return [[Math.min(...n.map(a => a.x)), Math.min(...n.map(a => a.y))], [Math.max(...n.map(a => a.x)), Math.max(...n.map(a => a.y))]]; },
      findRoute: (from, to) => { const r = SW.route(sim().T, from, to); return { edges: r || [], travelTime: r ? r.reduce((a, e) => a + sim().T.edges[e].length / sim().T.edges[e].e.speed, 0) : -1 }; },
      getParameter: () => ''
    },
    vehicle: {
      getIDList: () => [...sim().vehs.keys()], getIDCount: () => sim().vehs.size,
      getSpeed: id => V(id).v, getAcceleration: id => V(id).a, getPosition: id => { const p = sim().vehPose(V(id)); return [p.x, p.y]; },
      getPosition3D: id => { const v = V(id), p = sim().vehPose(v); return [p.x, p.y, sim().vehZ(v)]; },
      getSlope: id => Math.atan(sim().gradeOf(V(id))) * 180 / Math.PI,
      getAngle: id => sumoAngle(sim().vehPose(V(id)).a), getRoadID: id => roadId(V(id)), getLaneID: id => laneId(V(id)),
      getLaneIndex: id => { const v = V(id); return v.kind === 'lane' ? v.seg.index : 0; }, getLanePosition: id => V(id).pos,
      getRoute: id => V(id).route.slice(), getRouteIndex: id => V(id).ri, getTypeID: id => V(id).typeId, getVehicleClass: id => V(id).vt.vClass,
      getWaitingTime: id => V(id).wait, getAccumulatedWaitingTime: id => V(id).waitTotal, getTimeLoss: id => V(id).timeLoss, getDistance: id => V(id).dist,
      getCO2Emission: id => V(id).emStep.CO2 * 1000 / sim().dt, getCOEmission: id => V(id).emStep.CO * 1000 / sim().dt, getHCEmission: id => V(id).emStep.HC * 1000 / sim().dt,
      getNOxEmission: id => V(id).emStep.NOx * 1000 / sim().dt, getPMxEmission: id => V(id).emStep.PMx * 1000 / sim().dt, getFuelConsumption: id => V(id).emStep.fuel * 1000 / sim().dt,
      getElectricityConsumption: id => V(id).emStep.elec / sim().dt, getEmissionClass: id => V(id).vt.emissionClass,
      getMaxSpeed: id => { const v = V(id); return v.maxSpeed !== undefined ? v.maxSpeed : v.vt.maxSpeed; }, getAllowedSpeed: id => V(id).seg.speed, getSpeedFactor: id => V(id).speedFactor,
      getLength: id => V(id).vt.length, getWidth: id => V(id).vt.width, getMinGap: id => V(id).vt.minGap, getAccel: id => V(id).vt.accel, getDecel: id => V(id).vt.decel, getTau: id => V(id).vt.tau, getImperfection: id => V(id).vt.sigma,
      getColor: id => hex(V(id).color), getLateralLanePosition: id => V(id).latOff,
      getLeader: (id, dist = 100) => { const v = V(id); const obs = sim().obstaclesFor(v).filter(o => o.id); if (!obs.length) return null; obs.sort((a, b) => a.g - b.g); return obs[0].g <= dist ? [obs[0].id, obs[0].g - v.vt.minGap] : null; },
      getNextTLS: id => { const v = V(id); const c = v.nextConn; if (!c || !c.tl || !sim().tls[c.tl]) return []; return [[c.tl, c.tlIndex, v.seg.length - v.pos, sim().linkState(c)]]; },
      getParameter: (id, key) => { const v = V(id); if (/battery.*actualBatteryCapacity|chargeLevel/.test(key)) return String(v.battery); if (/battery.*maximumBatteryCapacity|capacity/.test(key)) return String(v.vt.batteryCapacity || 0); return ''; },
      setSpeed: (id, s) => { V(id).forcedSpeed = s < 0 ? null : +s; }, setMaxSpeed: (id, s) => { V(id).maxSpeed = +s; }, setSpeedMode: () => { }, setLaneChangeMode: () => { },
      slowDown: (id, s, dur) => { const v = V(id); v.slowDown = { v0: v.v, v: +s, start: sim().t, end: sim().t + +dur }; },
      changeLane: (id, lane, dur) => { V(id).forcedLane = { lane: +lane, until: sim().t + +dur }; },
      changeLaneRelative: (id, d, dur) => { const v = V(id); v.forcedLane = { lane: Math.max(0, (v.kind === 'lane' ? v.seg.index : 0) + +d), until: sim().t + +dur }; },
      setColor: (id, c) => { V(id).color = toHex(c); },
      setRoute: (id, edges) => { const v = V(id); edges = Array.from(edges); const cur = v.route[v.ri]; if (edges[0] !== cur) ex('Route must start at current edge ' + cur); v.route = v.route.slice(0, v.ri).concat(edges); v.nextConn = sim().connFor(v); v.committed = null; },
      changeTarget: (id, target) => { const v = V(id); const cur = v.route[v.ri]; const r = v.kind === 'conn' ? SW.route(sim().T, v.route[v.ri + 1], target) : SW.route(sim().T, cur, target); if (!r) ex('No route to ' + target); v.route = v.kind === 'conn' ? v.route.slice(0, v.ri + 1).concat(r) : v.route.slice(0, v.ri).concat(r); v.nextConn = sim().connFor(v); v.committed = null; },
      rerouteTraveltime: id => { const v = V(id); const s = sim(); const dest = v.route[v.route.length - 1]; const cost = e => { const st = s.edgeStats[e]; const te = s.T.edges[e]; return te.length / Math.max(0.5, st.speed > 0 ? st.speed : te.e.speed); }; const start = v.kind === 'conn' ? v.route[v.ri + 1] : v.route[v.ri]; const r = SW.dijkstra(s.T, start, dest, cost); if (r) { v.route = v.route.slice(0, v.kind === 'conn' ? v.ri + 1 : v.ri).concat(r); v.nextConn = s.connFor(v); } },
      setType: (id, t) => { const v = V(id); v.vt = sim().vType(t); v.typeId = t; },
      add: (id, routeID, typeID = 'DEFAULT_VEHTYPE', depart, departLane, departPos, departSpeed) => { const s = sim(); const edges = s.routes[routeID] || ex(`Route '${routeID}' is not known`); s.addVehicle(String(id), edges, typeID, departLane, departSpeed); },
      remove: (id) => { const s = sim(); s.arrive(V(id), 'vaporized'); },
      highlight: (id) => { V(id).highlight = sim().t + 5; },
      isAtBusStop: id => { const v = V(id); return v.dwell > 0 && !v.adhocActive; }, isStopped: id => V(id).dwell > 0,
      getStops: id => V(id).stops.map(s => [s.busStop, s.duration]), getLateralLanePosition: id => V(id).lat || 0
    },
    vehicletype: {
      getIDList: () => Object.keys(sim().demand.vTypes), getMaxSpeed: id => sim().vType(id).maxSpeed, getLength: id => sim().vType(id).length, getAccel: id => sim().vType(id).accel, getDecel: id => sim().vType(id).decel, getVehicleClass: id => sim().vType(id).vClass, getEmissionClass: id => sim().vType(id).emissionClass,
      setMaxSpeed: (id, s) => { sim().vType(id).maxSpeed = +s; }, setAccel: (id, a) => { sim().vType(id).accel = +a; }, setDecel: (id, a) => { sim().vType(id).decel = +a; }, setImperfection: (id, s) => { sim().vType(id).sigma = +s; }, setTau: (id, s) => { sim().vType(id).tau = +s; }, setColor: (id, c) => { sim().vType(id).color = toHex(c); }
    },
    route: {
      getIDList: () => Object.keys(sim().routes), getEdges: id => (sim().routes[id] || ex(`Route '${id}' is not known`)).slice(),
      add: (id, edges) => { sim().routes[id] = Array.from(edges); }
    },
    edge: {
      getIDList: () => Object.keys(sim().T.edges), getIDCount: () => Object.keys(sim().T.edges).length, getLaneNumber: id => E(id).lanes.length,
      getLastStepVehicleNumber: id => lastStep(E(id).lanes).n, getLastStepMeanSpeed: id => { const r = lastStep(E(id).lanes); return r.n ? r.sp / r.n : E(id).e.speed; },
      getLastStepHaltingNumber: id => lastStep(E(id).lanes).h, getLastStepVehicleIDs: id => lastStep(E(id).lanes).ids, getLastStepOccupancy: id => { const te = E(id); let occ = 0; for (const L of te.lanes) for (const v of L.vehs) occ += v.vt.length; return 100 * occ / (te.length * te.lanes.length); },
      getTraveltime: id => { const r = lastStep(E(id).lanes), te = E(id); return te.length / Math.max(0.1, r.n ? r.sp / r.n : te.e.speed); },
      getCO2Emission: id => sim().edgeStats[E(id).id].co2 * 1000, getWaitingTime: id => { let w = 0; for (const L of E(id).lanes) for (const v of L.vehs) w += v.wait; return w; },
      getStreetName: id => E(id).e.name, getFromJunction: id => E(id).from, getToJunction: id => E(id).to,
      setMaxSpeed: (id, s) => { for (const L of E(id).lanes) L.speed = +s; }
    },
    lane: {
      getIDList: () => Object.keys(sim().T.lanes), getLength: id => Ln(id).length, getMaxSpeed: id => Ln(id).speed, getEdgeID: id => Ln(id).edge.id, getWidth: () => SW.LANE_W,
      getShape: id => Ln(id).shape.map(p => [p.x, p.y]), getLinkNumber: id => Ln(id).out.length,
      getLinks: id => Ln(id).out.map(c => [c.to + '_' + c.toLane, !c.yieldTo.length, false, false, c.id + '_0', sim().linkState(c) || (c.yieldTo.length ? 'm' : 'M'), c.dir, c.length]),
      getLastStepVehicleNumber: id => Ln(id).vehs.length, getLastStepMeanSpeed: id => { const L = Ln(id); return L.vehs.length ? L.vehs.reduce((a, v) => a + v.v, 0) / L.vehs.length : L.speed; },
      getLastStepHaltingNumber: id => Ln(id).vehs.filter(v => v.v < 0.1).length, getLastStepVehicleIDs: id => Ln(id).vehs.map(v => v.id),
      getLastStepOccupancy: id => { const L = Ln(id); return 100 * L.vehs.reduce((a, v) => a + v.vt.length, 0) / L.length; },
      setMaxSpeed: (id, s) => { Ln(id).speed = +s; }
    },
    busstop: {
      getIDList: () => Object.keys(sim().busStops), getLaneID: id => (sim().busStops[id] || ex(`Bus stop '${id}' is not known`)).lane.id,
      getStartPos: id => sim().busStops[id].startPos, getEndPos: id => sim().busStops[id].endPos, getName: id => sim().busStops[id].d.name || '',
      getVehicleIDs: id => [...sim().vehs.values()].filter(v => v.dwell > 0 && v.stops[0] && v.stops[0].busStop === id).map(v => v.id),
      getVehicleCount: id => [...sim().vehs.values()].filter(v => v.dwell > 0 && v.stops[0] && v.stops[0].busStop === id).length
    },
    person: {
      getIDList: () => sim().peds.map(p => p.id), getIDCount: () => sim().peds.length,
      getPosition: id => { const p = sim().peds.find(x => x.id === id) || ex(`Person '${id}' is not known`); const q = sim().pedPose(p); return [q.x, q.y]; },
      getWaitingTime: id => { const p = sim().peds.find(x => x.id === id) || ex(`Person '${id}' is not known`); return p.state === 'wait' ? sim().t - p.since : 0; },
      getRoadID: id => { const p = sim().peds.find(x => x.id === id) || ex(`Person '${id}' is not known`); return ':' + p.cr.d.id; }
    },
    junction: { getIDList: () => Object.keys(sim().T.nodes), getPosition: id => { const n = sim().net.nodes[id] || ex(`Junction '${id}' is not known`); return [n.x, n.y]; } },
    trafficlight: {
      getIDList: () => Object.keys(sim().tls), getIDCount: () => Object.keys(sim().tls).length,
      getRedYellowGreenState: id => { const st = TL(id); return st.override || st.prog.phases[st.phase].state; },
      setRedYellowGreenState: (id, s) => { const st = TL(id); if (s.length !== st.prog.phases[0].state.length) ex(`State length ${s.length} must be ${st.prog.phases[0].state.length}`); st.override = s; },
      getPhase: id => TL(id).phase, setPhase: (id, i) => { const st = TL(id); if (i < 0 || i >= st.prog.phases.length) ex('Phase index out of range'); st.override = null; st.phase = +i; st.start = sim().t; st.endOverride = null; },
      getPhaseDuration: id => TL(id).prog.phases[TL(id).phase].duration, setPhaseDuration: (id, d) => { const st = TL(id); st.endOverride = sim().t + +d; },
      getPhaseName: id => TL(id).prog.phases[TL(id).phase].name || '', getNextSwitch: id => { const st = TL(id); return st.endOverride !== null ? st.endOverride : st.start + st.prog.phases[st.phase].duration; },
      getSpentDuration: id => sim().t - TL(id).start,
      getProgram: id => TL(id).override ? 'online' : (TL(id).prog.programID || '0'), setProgram: (id, p) => { const st = TL(id); if (p === 'off') st.override = 'O'.repeat(st.prog.phases[0].state.length); else st.override = null; },
      getControlledLanes: id => sim().T.tlsPrograms[TL(id).id].links.map(c => c.fromL.id), getControlledLinks: id => sim().T.tlsPrograms[TL(id).id].links.map(c => [[c.fromL.id, c.toL.id, c.id + '_0']]), getControlledJunctions: id => sim().T.tlsPrograms[TL(id).id].nodes.slice(),
      getAllProgramLogics: id => { const st = TL(id); return [{ programID: st.prog.programID || '0', type: st.prog.type, currentPhaseIndex: st.phase, phases: st.prog.phases.map(p => ({ duration: p.duration, state: p.state, minDur: p.minDur, maxDur: p.maxDur })) }]; },
      getCompleteRedYellowGreenDefinition: id => api.trafficlight.getAllProgramLogics(id)
    },
    inductionloop: {
      getIDList: () => sim().e1.map(d => d.d.id), getIDCount: () => sim().e1.length, getLaneID: id => E1(id).d.lane, getPosition: id => E1(id).d.pos,
      getLastStepVehicleNumber: id => E1(id).last.n, getLastStepMeanSpeed: id => E1(id).last.speed, getLastStepOccupancy: id => E1(id).last.occ,
      getLastStepVehicleIDs: id => E1(id).last.ids.slice(), getTimeSinceDetection: id => { const d = E1(id); return d.lastDetect < 0 ? sim().t : sim().t - d.lastDetect; },
      getIntervalVehicleNumber: id => E1(id).acc.n, getLastIntervalVehicleNumber: id => E1(id).lastIntervalN,
      getVehicleData: id => E1(id).last.ids.map(v => [v, sim().vehs.get(v) ? sim().vehs.get(v).vt.length : 0, sim().t, -1, sim().vehs.get(v) ? sim().vehs.get(v).typeId : ''])
    },
    lanearea: {
      getIDList: () => sim().e2.map(d => d.d.id), getIDCount: () => sim().e2.length, getLaneID: id => E2(id).d.lane, getPosition: id => E2(id).d.pos, getLength: id => E2(id).d.length,
      getLastStepVehicleNumber: id => E2(id).last.n, getLastStepMeanSpeed: id => E2(id).last.speed, getLastStepOccupancy: id => E2(id).last.occ,
      getJamLengthVehicle: id => E2(id).last.jamV, getJamLengthMeters: id => E2(id).last.jamM, getLastStepHaltingNumber: id => E2(id).last.halting, getLastStepVehicleIDs: id => E2(id).last.ids.slice()
    },
    gui: {
      DEFAULT_VIEW: 'View #0',
      trackVehicle: (view, id) => { if (ctl && ctl.track) ctl.track(id); }, setZoom: (view, z) => { if (ctl && ctl.zoom) ctl.zoom(z); }, setOffset: (view, x, y) => { if (ctl && ctl.offset) ctl.offset(x, y); },
      getZoom: () => ctl && ctl.getZoom ? ctl.getZoom() : 100, setSchema: () => { }, screenshot: () => { }, hasView: () => true
    },
    constants: {}
  };
  api.tc = { LAST_STEP_VEHICLE_NUMBER: 0x10, VAR_SPEED: 0x40, VAR_POSITION: 0x42 };
  return api;
};

if (typeof module !== 'undefined') module.exports = SW;
