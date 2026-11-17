/* ===== Optimus UI: 3D view (Three.js) — pengganti ringan SUMO2Unity ===== */
const V3 = { ready: false, topo: null, cam: { tx: 0, ty: 0, tz: 0, dist: 300, az: -0.7, el: 0.85 }, chase: false };
function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('gagal memuat ' + src)); document.head.append(s); });
}
async function load3D() {
  if (window.THREE) return;
  const local = /^https?:$/.test(location.protocol) && typeof SV !== 'undefined' && SV.on;
  try { await loadScript(local ? ((typeof svBase === 'function' ? svBase() : '') + '/vendor/three.min.js') : 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'); }
  catch (e) { if (!local) throw e; await loadScript('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'); }
}
async function toggle3D() {
  if (S.view3d) { S.view3d = false; $('stage').classList.remove('v3d'); $('b3d').classList.remove('on'); S.need = true; return; }
  try { await load3D(); } catch (e) { return toast('Tampilan 3D butuh pustaka Three.js: ' + e.message, 4000); }
  if (S.cmp) cmpClose();
  let c = $('c3d');
  if (!c) { c = h('canvas', { id: 'c3d' }); $('stage').insertBefore(c, $('tools')); init3DInput(c); }
  S.view3d = true; $('stage').classList.add('v3d'); $('b3d').classList.add('on');
  if (!V3.renderer) {
    V3.renderer = new THREE.WebGLRenderer({ canvas: c, antialias: true });
    V3.scene = new THREE.Scene(); V3.scene.background = new THREE.Color(0x9fc3e0); V3.scene.fog = new THREE.Fog(0x9fc3e0, 900, 3500);
    V3.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 8000);
    V3.scene.add(new THREE.HemisphereLight(0xffffff, 0x445544, 0.85));
    const sun = new THREE.DirectionalLight(0xffffff, 0.75); sun.position.set(300, 600, 200); V3.scene.add(sun);
  }
  V3.cam.tx = S.view.cx; V3.cam.tz = -S.view.cy; V3.cam.dist = Math.max(80, Math.min(2500, CW / S.view.scale * 0.9));
  V3.topo = null; S.need = true;
  toast('Tampilan 3D: seret untuk memutar, dua jari / Shift+seret untuk menggeser, roda / cubit untuk zoom');
}
/* --- static scene --- */
function ribbon(points, width, zOf, y0) {
  // returns positions array for a triangle strip ribbon along points
  const pos = [];
  for (let i = 0; i < points.length - 1; i++) {
    const A = points[i], B = points[i + 1];
    const dx = B.x - A.x, dy = B.y - A.y, l = Math.hypot(dx, dy) || 1e-6, nx = -dy / l * width / 2, ny = dx / l * width / 2;
    const za = zOf(i) + y0, zb = zOf(i + 1) + y0;
    const a1 = [A.x + nx, za, -(A.y + ny)], a2 = [A.x - nx, za, -(A.y - ny)], b1 = [B.x + nx, zb, -(B.y + ny)], b2 = [B.x - nx, zb, -(B.y - ny)];
    pos.push(...a1, ...a2, ...b1, ...b2, ...b1, ...a2);
  }
  return pos;
}
function meshFrom(pos, color, opts = {}) {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial(Object.assign({ color, side: THREE.DoubleSide }, opts)));
}
function build3D(T) {
  if (V3.group) { V3.scene.remove(V3.group); V3.group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
  const G = V3.group = new THREE.Group(); V3.scene.add(G);
  const W = SW.LANE_W;
  const hasUnder = Object.values(T.edges).some(te => te.layer < 0);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), new THREE.MeshLambertMaterial({ color: 0x5d7a4f, transparent: hasUnder, opacity: hasUnder ? 0.82 : 1, depthWrite: !hasUnder }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(S.view.cx, -0.05, -S.view.cy); G.add(ground);
  const asphalt = [], deck = [], under = [], marks = [];
  for (const L of Object.values(T.lanes)) {
    const z = i => L.elev ? SW.zAt(L.elev, L.cum[i]) : 0;
    const arr = L.layer > 0 ? deck : L.layer < 0 ? under : asphalt;
    arr.push(...ribbon(L.shape, W - 0.05, z, 0.02));
  }
  for (const c of T.conns) asphalt.push(...ribbon(c.shape, W - 0.05, () => 0, 0.015));
  if (asphalt.length) G.add(meshFrom(asphalt, 0x3a3f47));
  if (deck.length) G.add(meshFrom(deck, 0x5a606b));
  if (under.length) G.add(meshFrom(under, 0x2c3038));
  for (const tn of Object.values(T.nodes)) {
    const d = new THREE.Mesh(new THREE.CircleGeometry(Math.max(1.5, tn.r + 1), 24), new THREE.MeshLambertMaterial({ color: 0x3a3f47 }));
    d.rotation.x = -Math.PI / 2; d.position.set(tn.n.x, 0.01, -tn.n.y); G.add(d);
  }
  // lane separators
  for (const te of Object.values(T.edges)) for (let i = 1; i < te.lanes.length; i++) {
    const line = SW.geom.offset(te.center, te.lanes[i].off + (te.lanes[i - 1].off - te.lanes[i].off) / 2);
    const L = te.lanes[i], cum = SW.geom.cum(line);
    for (let k = 0; k < line.length - 1; k++) { const z0 = L.elev ? SW.zAt(L.elev, cum[k]) : 0, z1 = L.elev ? SW.zAt(L.elev, cum[k + 1]) : 0; marks.push(line[k].x, z0 + 0.06, -line[k].y, line[k + 1].x, z1 + 0.06, -line[k + 1].y); }
  }
  if (marks.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(marks, 3)); G.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xeeeeee }))); }
  // flyover barriers & pillars, underpass walls
  const pillarGeo = new THREE.CylinderGeometry(0.7, 0.9, 1, 10), pillarMat = new THREE.MeshLambertMaterial({ color: 0xb8b8b0 });
  const wallPos = [];
  for (const te of Object.values(T.edges)) {
    if (!te.layer || !te.elev) continue;
    const mid = te.mid, cum = SW.geom.cum(mid), n = te.lanes.length;
    for (const side of [-1, 1]) {
      const line = SW.geom.offset(mid, side * (n * W / 2 + 0.25)), lc = SW.geom.cum(line);
      for (let k = 0; k < line.length - 1; k++) {
        const z0 = SW.zAt(te.elev, lc[k] * te.length / Math.max(1, lc[lc.length - 1])), z1 = SW.zAt(te.elev, lc[k + 1] * te.length / Math.max(1, lc[lc.length - 1]));
        const A = line[k], B = line[k + 1], top = te.layer > 0 ? 1.1 : 0.4, bot = te.layer > 0 ? -0.6 : Math.max(0, -z0);
        const p = [[A.x, z0 + top, -A.y], [A.x, z0 - (te.layer > 0 ? 0.6 : 0) + (te.layer < 0 ? -z0 + 0.3 : 0), -A.y], [B.x, z1 + top, -B.y], [B.x, z1 - (te.layer > 0 ? 0.6 : 0) + (te.layer < 0 ? -z1 + 0.3 : 0), -B.y]];
        void bot; wallPos.push(...p[0], ...p[1], ...p[2], ...p[2], ...p[1], ...p[3]);
      }
    }
    if (te.layer > 0 && te.rev && T.edges[te.rev] && te.id > te.rev) continue;
    if (te.layer > 0) for (let s = 15; s < te.length - 5; s += 25) {
      const z = SW.zAt(te.elev, s); if (z < 2) continue;
      const q = SW.geom.posAt(mid, cum, s * cum[cum.length - 1] / te.length);
      const pl = new THREE.Mesh(pillarGeo, pillarMat); pl.scale.set(1, z - 0.6, 1); pl.position.set(q.x - Math.sin(q.a) * (te.rev ? -n * W / 2 * 0 : 0), (z - 0.6) / 2, -q.y); G.add(pl);
    }
  }
  if (wallPos.length) G.add(meshFrom(wallPos, 0xc9ccd1));
  // crossings & bus stops
  for (const cr of S.add.crossings || []) {
    const g = crossingGeom(T, cr); if (!g) continue;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(g.half * 2, g.width), new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }));
    m.rotation.x = -Math.PI / 2; m.rotation.z = g.P.a; m.position.set(g.P.x, 0.05, -g.P.y); G.add(m);
  }
  for (const b of S.add.busStops || []) {
    const L = T.lanes[b.lane]; if (!L) continue;
    const q = SW.geom.posAt(L.shape, L.cum, (+b.startPos + +b.endPos) / 2);
    const curb = L.edge.lanes.length > 1 ? Math.sign(L.edge.lanes[0].off - L.edge.lanes[1].off) || 1 : (S.net.lefthand ? 1 : -1);
    const sh = new THREE.Mesh(new THREE.BoxGeometry(Math.max(4, b.endPos - b.startPos) * 0.6, 2.6, 1.6), new THREE.MeshLambertMaterial({ color: 0xf2c94c }));
    sh.position.set(q.x - Math.sin(q.a) * curb * (W / 2 + 2), 1.3, -(q.y + Math.cos(q.a) * curb * (W / 2 + 2))); sh.rotation.y = q.a; G.add(sh);
  }
  // instanced dynamic objects
  const MAXV = 6000;
  if (!V3.veh) {
    V3.veh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), MAXV);
    V3.veh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); V3.scene.add(V3.veh);
    V3.ped = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.25, 1.7, 6), new THREE.MeshLambertMaterial({ color: 0xffe0b0 }), 3000); V3.scene.add(V3.ped);
    V3.tl = new THREE.InstancedMesh(new THREE.SphereGeometry(0.45, 8, 6), new THREE.MeshBasicMaterial(), 4000); V3.scene.add(V3.tl);
    V3.dummy = new THREE.Object3D(); V3.col = new THREE.Color();
  }
}
const H3 = { bus: 3.1, truck: 3.2, angkot: 1.9, motorcycle: 1.3, bicycle: 1.3, emergency: 2.2, evehicle: 1.5, passenger: 1.5 };
const TLCOL = { G: 0x00e000, g: 0x00a800, y: 0xffd400, Y: 0xffd400, r: 0xff2020, u: 0xff8000, o: 0x808080, O: 0x808080, s: 0xa000a0 };
function render3D() {
  if (!V3.renderer) return;
  const T = topo();
  if (V3.topo !== T) { build3D(T); V3.topo = T; }
  const c = $('c3d'), r = c.getBoundingClientRect();
  const w = Math.round(r.width), hh = Math.round(r.height);
  if (V3.w !== w || V3.h !== hh) { V3.renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1)); V3.renderer.setSize(w, hh, false); V3.camera.aspect = w / Math.max(1, hh); V3.camera.updateProjectionMatrix(); V3.w = w; V3.h = hh; }
  const d = V3.dummy, sim = S.sim;
  let k = 0;
  if (sim) for (const v of sim.vehs.values()) {
    if (k >= V3.veh.count) break;
    const p = sim.vehPose(v), z = sim.vehZ(v), len = v.vt.length, wd = v.vt.width || 1.8, ht = H3[v.vt.vClass] || 1.5;
    d.position.set(p.x - Math.cos(p.a) * len / 2, z + ht / 2 + 0.05, -(p.y - Math.sin(p.a) * len / 2));
    d.rotation.set(0, p.a, 0); d.scale.set(len, ht, wd); d.updateMatrix();
    V3.veh.setMatrixAt(k, d.matrix); V3.col.set(vehColor(v)); V3.veh.setColorAt(k, V3.col); k++;
    if (S.track === v.id) { V3.cam.tx = p.x; V3.cam.tz = -p.y; V3.cam.ty = z; if (V3.chase) V3.cam.az = -p.a + Math.PI / 2 * 0 - Math.PI / 2; }
  }
  V3.veh.count = k; V3.veh.instanceMatrix.needsUpdate = true; if (V3.veh.instanceColor) V3.veh.instanceColor.needsUpdate = true;
  let kp = 0;
  if (sim && sim.peds) for (const pd of sim.peds) { if (kp >= 3000) break; const q = sim.pedPose(pd); d.position.set(q.x, 0.9, -q.y); d.rotation.set(0, 0, 0); d.scale.set(1, 1, 1); d.updateMatrix(); V3.ped.setMatrixAt(kp++, d.matrix); }
  V3.ped.count = kp; V3.ped.instanceMatrix.needsUpdate = true;
  let kt = 0;
  const states = {};
  if (sim) for (const [id, st] of Object.entries(sim.tls)) states[id] = st.override || st.prog.phases[st.phase].state;
  else for (const id of T.tlsNodes) states[id] = S.net.tls[id].phases[0].state;
  for (const id of T.tlsNodes) for (const cn of T.tlsPrograms[id].links) {
    if (kt >= 4000) break;
    const L = cn.fromL, e = L.shape[L.shape.length - 1];
    d.position.set(e.x, 3.2, -e.y); d.rotation.set(0, 0, 0); d.scale.set(1, 1, 1); d.updateMatrix(); V3.tl.setMatrixAt(kt, d.matrix);
    V3.col.setHex(TLCOL[states[id][cn.tlIndex]] || 0x888888); V3.tl.setColorAt(kt, V3.col); kt++;
  }
  V3.tl.count = kt; V3.tl.instanceMatrix.needsUpdate = true; if (V3.tl.instanceColor) V3.tl.instanceColor.needsUpdate = true;
  const C = V3.cam, ce = Math.cos(C.el);
  V3.camera.position.set(C.tx + C.dist * ce * Math.cos(C.az), C.ty + C.dist * Math.sin(C.el), C.tz + C.dist * ce * Math.sin(C.az));
  V3.camera.lookAt(C.tx, C.ty, C.tz);
  V3.renderer.render(V3.scene, V3.camera);
}
function init3DInput(c) {
  const ptr = new Map(); let g = null;
  c.addEventListener('pointerdown', e => { c.setPointerCapture(e.pointerId); ptr.set(e.pointerId, { x: e.clientX, y: e.clientY }); g = { pan: e.shiftKey || e.button === 2 || ptr.size === 2, x: e.clientX, y: e.clientY, d0: null }; if (ptr.size === 2) { const [a, b] = [...ptr.values()]; g.d0 = Math.hypot(a.x - b.x, a.y - b.y); g.dist0 = V3.cam.dist; } });
  c.addEventListener('pointermove', e => {
    if (!ptr.has(e.pointerId) || !g) return;
    ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const C = V3.cam;
    if (ptr.size === 2 && g.d0) { const [a, b] = [...ptr.values()]; C.dist = Math.max(10, Math.min(5000, g.dist0 * g.d0 / Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)))); }
    const dx = e.clientX - g.x, dy = e.clientY - g.y; g.x = e.clientX; g.y = e.clientY;
    if (ptr.size === 2 || g.pan) { const s = C.dist / 600; C.tx -= (Math.cos(C.az + Math.PI / 2) * dx + Math.cos(C.az) * dy) * s; C.tz -= (Math.sin(C.az + Math.PI / 2) * dx + Math.sin(C.az) * dy) * s; S.track = null; }
    else { C.az += dx * 0.006; C.el = Math.max(0.08, Math.min(1.5, C.el + dy * 0.005)); }
    S.need = true;
  });
  const up = e => { ptr.delete(e.pointerId); if (!ptr.size) g = null; };
  c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
  c.addEventListener('contextmenu', e => e.preventDefault());
  c.addEventListener('wheel', e => { e.preventDefault(); V3.cam.dist = Math.max(10, Math.min(5000, V3.cam.dist * Math.pow(1.0015, e.deltaY))); S.need = true; }, { passive: false });
}
$('b3d').onclick = toggle3D;
