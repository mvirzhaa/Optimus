/* ===== Optimus UI: simulation loop, TraCI scripting (Python via Pyodide / JavaScript), init ===== */
function updateTime() {
  const t = S.sim ? S.sim.t : S.cfg.begin;
  $('simTime').textContent = fmt(t, 1) + ' s' + (S.scripting ? ' · TraCI' : '');
}
function togglePlay() {
  if (S.scripting) return toast('Simulasi sedang dikendalikan skrip TraCI');
  if (S.running) { stopSim(); return; }
  const sim = ensureSim();
  if (S.finished || sim.t >= S.cfg.end) { S.sim = null; ensureSim(); }
  S.running = true; $('bPlay').textContent = '⏸'; S.lastFrame = performance.now(); S.acc = 0;
}
function doStep() {
  const sim = ensureSim();
  sim.step();
  if (S.cmp) cmpStep(sim.t);
  if (sim.t >= S.cfg.end - 1e-9 || (sim.t > 5 && sim.minExpected() === 0)) {
    if (S.running) { stopSim(); S.finished = true; toast(`Simulasi selesai pada ${fmt(sim.t, 1)} s · ${sim.arrived.length} kendaraan tiba`); }
  }
}
let panelTick = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (S.running && S.sim) {
    const delay = +S.cfg.delay;
    const t0 = performance.now();
    if (delay <= 0) { while (performance.now() - t0 < 14 && S.running) doStep(); }
    else {
      S.acc += now - S.lastFrame;
      let n = 0;
      while (S.acc >= delay && n < 50 && S.running) { doStep(); S.acc -= delay; n++; }
      if (S.acc > delay * 5) S.acc = 0;
    }
    S.need = true;
  }
  S.lastFrame = now;
  if (S.track && S.sim) { const v = S.sim.vehs.get(S.track); if (v) { const p = S.sim.vehPose(v); S.view.cx = p.x; S.view.cy = p.y; S.need = true; } else S.track = null; }
  if (S.sim && S.sim.vehs.size && S.colorVeh !== 'none') S.need = S.need || [...S.sim.vehs.values()].some(v => v.vt.vClass === 'emergency');
  if (S.need) { if (S.view3d) render3D(); else { draw(); if (S.cmp) drawCompare(); } S.need = false; updateTime(); }
  if (++panelTick % 15 === 0 && (S.running || S.scripting)) livePanels();
}
function livePanels() {
  if (S.cmp) updateCmpTable();
  if (S.tab === 'sim') { updateLive(); const m = $('simMsgs'); if (m && S.sim) m.textContent = S.sim.messages.slice(-30).map(x => `[${fmt(x.t, 1)}] ${x.m}`).join('\n') || 'Tidak ada peringatan.'; }
  if (S.sel && S.sel.kind === 'veh') { const el = $('vehInsp'); if (el) el.replaceWith(vehInspector(S.sel.id)); }
  if (S.tab === 'det' && S.sim) document.querySelectorAll('[data-live]').forEach(td => { const id = td.dataset.live; const a = S.sim.e1.find(x => x.d.id === id); const b = S.sim.e2.find(x => x.d.id === id); td.textContent = a ? `${a.acc.n} kend · ${fmt(a.last.occ, 0)}%` : b ? `${b.last.n} kend · macet ${fmt(b.last.jamM, 0)} m` : '–'; });
  if (S.tab === 'tls' && S.sim && S.selPid) { const el = $('tlsLive'); const live = S.sim.tls[S.selPid]; if (el && live) el.textContent = `Live: fase ${live.phase} · ${live.override ? 'override TraCI' : 'sisa ' + fmt(Math.max(0, (live.endOverride !== null ? live.endOverride : live.start + live.prog.phases[live.phase].duration) - S.sim.t), 0) + ' s'}`; }
  if (S.tab === 'out' && panelTick % 120 === 0) renderPanel();
}

/* ---------- TraCI scripting ---------- */
const TRACI_EXAMPLES = {
  'Part 3.1 – Latihan 1: baca kecepatan kendaraan': `import traci

traci.start(["sumo-gui", "-c", "scenario.sumocfg"])
step = 0
while step < 300:
    traci.simulationStep()
    ids = traci.vehicle.getIDList()
    if ids:
        v = ids[0]
        speed = traci.vehicle.getSpeed(v)
        print(f"t={traci.simulation.getTime():6.1f}  {v:>10}  speed={speed:5.2f} m/s  edge={traci.vehicle.getRoadID(v)}")
    step += 1
traci.close()
`,
  'Part 3.1 – Latihan 2: kendalikan satu kendaraan': `import traci

traci.start(["sumo-gui", "-c", "scenario.sumocfg"])
target = None
for step in range(1200):
    traci.simulationStep()
    ids = traci.vehicle.getIDList()
    if target is None and ids:
        target = ids[0]
        traci.vehicle.setColor(target, (255, 0, 255, 255))
        traci.gui.trackVehicle("View #0", target)
        print("Mengendalikan", target)
    if target in ids:
        t = traci.simulation.getTime()
        if t < 40:
            traci.vehicle.setSpeed(target, 4)       # paksa pelan 4 m/s
        elif t < 41:
            traci.vehicle.setSpeed(target, -1)      # lepaskan kontrol
            traci.vehicle.changeLane(target, 1, 10) # coba pindah ke lajur 1
        if step % 20 == 0:
            print(f"{t:6.1f}s speed={traci.vehicle.getSpeed(target):5.2f} lane={traci.vehicle.getLaneID(target)}")
    elif target is not None:
        print("Kendaraan tiba di tujuan pada", traci.simulation.getTime())
        break
traci.close()
`,
  'Part 3.1 – Latihan 3: kecepatan rata-rata & batas kecepatan ruas': `import traci

traci.start(["sumo-gui", "-c", "scenario.sumocfg"])
edges = [e for e in traci.edge.getIDList()]
for step in range(600):
    traci.simulationStep()
    if step % 60 == 59:
        print(f"--- t = {traci.simulation.getTime():.0f} s ---")
        for e in edges:
            n = traci.edge.getLastStepVehicleNumber(e)
            if n == 0:
                continue
            lane0 = e + "_0"
            print(f"{e:>8}: {n:3d} kend  rata2={traci.edge.getLastStepMeanSpeed(e)*3.6:5.1f} km/j  batas={traci.lane.getMaxSpeed(lane0)*3.6:5.1f} km/j")
traci.close()
`,
  'Lampu adaptif berbasis antrean (Part 3 / 8)': `import traci

traci.start(["sumo-gui", "-c", "scenario.sumocfg"])
tls = traci.trafficlight.getIDList()
print("Lampu:", list(tls))

def queue(tl, phase_state):
    """jumlah kendaraan berhenti di lajur yang mendapat merah"""
    lanes = traci.trafficlight.getControlledLanes(tl)
    q = 0
    for i, ln in enumerate(lanes):
        if phase_state[i] in "r":
            q += traci.lane.getLastStepHaltingNumber(ln)
    return q

for step in range(3000):
    traci.simulationStep()
    for tl in tls:
        state = traci.trafficlight.getRedYellowGreenState(tl)
        spent = traci.trafficlight.getSpentDuration(tl)
        if "y" in state or spent < 8:
            continue
        # beri hijau lebih cepat bila antrean di arah merah > 6 kendaraan
        if queue(tl, state) > 6:
            traci.trafficlight.setPhaseDuration(tl, 0)
    if step % 200 == 0:
        print(f"t={traci.simulation.getTime():.0f}s berjalan={traci.vehicle.getIDCount()}")
traci.close()
`,
  'Part 9 – Prioritas sinyal kendaraan darurat': `import traci

traci.start(["sumo-gui", "-c", "scenario.sumocfg"])
for step in range(4000):
    traci.simulationStep()
    for v in traci.vehicle.getIDList():
        if traci.vehicle.getVehicleClass(v) != "emergency":
            continue
        for tl, link, dist, st in traci.vehicle.getNextTLS(v):
            if dist < 80:
                s = list(traci.trafficlight.getRedYellowGreenState(tl))
                lanes = traci.trafficlight.getControlledLanes(tl)
                mylane = traci.vehicle.getLaneID(v)
                new = "".join("G" if lanes[i] == mylane else "r" for i in range(len(s)))
                if new != "".join(s):
                    traci.trafficlight.setRedYellowGreenState(tl, new)
                    print(f"{traci.simulation.getTime():.0f}s: hijau untuk {v} di {tl}")
            else:
                if traci.trafficlight.getProgram(tl) == "online":
                    traci.trafficlight.setProgram(tl, "0")
    # kembalikan program normal bila tidak ada kendaraan darurat
    if not any(traci.vehicle.getVehicleClass(v) == "emergency" for v in traci.vehicle.getIDList()):
        for tl in traci.trafficlight.getIDList():
            if traci.trafficlight.getProgram(tl) == "online":
                traci.trafficlight.setProgram(tl, "0")
traci.close()
`,
  'Part 10 – Pantau baterai kendaraan listrik': `import traci

traci.start(["sumo-gui", "-c", "scenario.sumocfg"])
for step in range(1200):
    traci.simulationStep()
    if step % 100 == 0:
        evs = [v for v in traci.vehicle.getIDList() if traci.vehicle.getEmissionClass(v) == "Energy"]
        for v in evs[:5]:
            soc = float(traci.vehicle.getParameter(v, "device.battery.actualBatteryCapacity"))
            print(f"{traci.simulation.getTime():6.0f}s {v:>10} baterai={soc/1000:6.2f} kWh  konsumsi={traci.vehicle.getElectricityConsumption(v):5.2f} Wh/s")
        co2 = sum(traci.vehicle.getCO2Emission(v) for v in traci.vehicle.getIDList())
        print(f"   total CO2 saat ini: {co2/1000:.1f} g/s")
traci.close()
`,
  'Reroute saat macet (rerouteTraveltime)': `import traci

traci.start(["sumo-gui", "-c", "scenario.sumocfg"])
for step in range(2400):
    traci.simulationStep()
    if step % 60 == 0:
        n = 0
        for v in traci.vehicle.getIDList():
            if traci.vehicle.getWaitingTime(v) > 20:
                traci.vehicle.rerouteTraveltime(v)
                n += 1
        if n:
            print(f"{traci.simulation.getTime():.0f}s: {n} kendaraan dirutekan ulang")
traci.close()
`,
  'Part 8 – Q-learning lampu lalu lintas (Python)': `import traci, random

traci.start(["sumo-gui", "-c", "scenario.sumocfg"])
tls = traci.trafficlight.getIDList()[0]
logic = traci.trafficlight.getAllProgramLogics(tls)[0]
greens = [i for i, p in enumerate(logic["phases"]) if "G" in p["state"] or "g" in p["state"]]
lanes = traci.trafficlight.getControlledLanes(tls)
Q, alpha, gamma, eps = {}, 0.1, 0.9, 0.2

def level(n):
    return 0 if n == 0 else 1 if n <= 3 else 2 if n <= 8 else 3

def state():
    ph = traci.trafficlight.getPhase(tls)
    q = tuple(level(sum(traci.lane.getLastStepHaltingNumber(l) for l in set(lanes) if l in lanes_of(g))) for g in greens)
    return (ph, q)

def lanes_of(g):
    st = logic["phases"][g]["state"]
    return {lanes[i] for i, c in enumerate(st) if c in "Gg"}

prev = None
for step in range(3600):
    traci.simulationStep()
    t = traci.simulation.getTime()
    if traci.trafficlight.getPhase(tls) not in greens or traci.trafficlight.getSpentDuration(tls) < 10 or step % 5:
        continue
    s = state()
    q = Q.setdefault(s, [0.0, 0.0])
    r = -sum(traci.lane.getLastStepHaltingNumber(l) for l in set(lanes))
    if prev:
        ps, pa = prev
        Q[ps][pa] += alpha * (r + gamma * max(q) - Q[ps][pa])
    a = random.randrange(2) if random.random() < eps else (1 if q[1] > q[0] else 0)
    if a == 1 or traci.trafficlight.getSpentDuration(tls) > 60:
        traci.trafficlight.setPhaseDuration(tls, 0)   # akhiri hijau -> fase kuning berikutnya
    prev = (s, a)
    if step % 300 == 0:
        print(f"t={t:.0f}s  keadaan={len(Q)}  berhenti={-r}")
traci.close()
`,
  'JavaScript – contoh dasar': `// Mode JavaScript: API sama seperti TraCI Python (traci.vehicle.getSpeed, dst.)
for (let step = 0; step < 300; step++) {
  await traci.simulationStep();
  const ids = traci.vehicle.getIDList();
  if (step % 20 === 0) print(\`t=\${traci.simulation.getTime().toFixed(1)} berjalan=\${ids.length}\`);
  for (const v of ids) if (traci.vehicle.getSpeed(v) < 0.1) traci.vehicle.setColor(v, [255, 0, 0, 255]);
}
`
};
const PY_PRELUDE = `
import ast, sys, types, os, inspect
from pyodide.ffi import to_js, JsException
import _traci_js
os.environ.setdefault("SUMO_HOME", "/sumo")
class TraCIException(Exception):
    pass
class FatalTraCIError(Exception):
    pass
def _conv(r):
    if hasattr(r, "then"):
        return r
    if hasattr(r, "to_py"):
        return r.to_py()
    return r
def _arg(a):
    if isinstance(a, (list, tuple, dict)):
        return to_js(a)
    return a
class _Domain:
    def __init__(self, js):
        self._js = js
    def __getattr__(self, name):
        f = getattr(self._js, name)
        if callable(f):
            def w(*a):
                try:
                    return _conv(f(*[_arg(x) for x in a]))
                except JsException as e:
                    raise TraCIException(str(e).split(":", 1)[-1].strip())
            w.__name__ = name
            return w
        return _conv(f)
traci = types.ModuleType("traci")
for _d in ["simulation", "vehicle", "vehicletype", "route", "edge", "lane", "junction", "trafficlight", "inductionloop", "lanearea", "gui"]:
    setattr(traci, _d, _Domain(getattr(_traci_js, _d)))
traci.simulationStep = lambda *a: _traci_js.simulationStep(*a)
traci.start = lambda *a, **k: (0, "Optimus")
traci.init = lambda *a, **k: (0, "Optimus")
traci.close = lambda *a, **k: None
traci.switch = lambda *a, **k: None
traci.isLoaded = lambda: True
traci.getVersion = lambda: (21, "Optimus")
traci.TraCIException = TraCIException
traci.FatalTraCIError = FatalTraCIError
traci.exceptions = types.SimpleNamespace(TraCIException=TraCIException, FatalTraCIError=FatalTraCIError)
traci.constants = types.ModuleType("traci.constants")
traci.constants.INVALID_DOUBLE_VALUE = -1073741824.0
sys.modules["traci"] = traci
sys.modules["traci.constants"] = traci.constants
sys.modules["libsumo"] = traci
sumolib = types.ModuleType("sumolib")
sumolib.checkBinary = lambda name: name
sys.modules["sumolib"] = sumolib

def _is_step(call):
    f = call.func
    return isinstance(f, ast.Attribute) and f.attr == "simulationStep"
def _callee(call):
    f = call.func
    if isinstance(f, ast.Name): return f.id
    if isinstance(f, ast.Attribute): return f.attr
    return None
def _transform(src):
    tree = ast.parse(src)
    asyncs = set()
    changed = True
    while changed:
        changed = False
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef) and node.name not in asyncs:
                for sub in ast.walk(node):
                    if isinstance(sub, ast.Call) and (_is_step(sub) or _callee(sub) in asyncs):
                        asyncs.add(node.name); changed = True; break
    class T(ast.NodeTransformer):
        def visit_FunctionDef(self, node):
            self.generic_visit(node)
            if node.name in asyncs:
                kw = {f: getattr(node, f) for f in node._fields if hasattr(node, f)}
                new = ast.AsyncFunctionDef(**kw)
                return ast.copy_location(new, node)
            return node
        def visit_Call(self, node):
            self.generic_visit(node)
            if _is_step(node) or _callee(node) in asyncs:
                return ast.copy_location(ast.Await(value=node), node)
            return node
    tree = ast.fix_missing_locations(T().visit(tree))
    return compile(tree, "<traci-script>", "exec", flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)

async def _run_user(src):
    code = _transform(src)
    g = {"__name__": "__main__"}
    r = eval(code, g)
    if inspect.iscoroutine(r):
        await r
`;
let pyodideP = null;
function loadPyodideOnce(log) {
  if (pyodideP) return pyodideP;
  pyodideP = new Promise((res, rej) => {
    log('Memuat Python (Pyodide ~10 MB, sekali saja)…');
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js';
    s.onload = async () => { try { const py = await loadPyodide({ stdout: t => log(t), stderr: t => log(t) }); res(py); } catch (e) { rej(e); } };
    s.onerror = () => rej(new Error('Gagal memuat Pyodide dari CDN (butuh koneksi internet).'));
    document.head.append(s);
  });
  pyodideP.catch(() => { pyodideP = null; });
  return pyodideP;
}
class StopScript extends Error { }
function makeCtl(log) {
  let lastYield = performance.now();
  const ctl = {
    stop: false,
    step: () => { doStepScripted(); },
    track: id => { S.track = id; }, zoom: z => { S.view.scale = z / 100 * 2; S.need = true; }, offset: (x, y) => { S.view.cx = x; S.view.cy = y; S.need = true; }, getZoom: () => S.view.scale / 2 * 100,
    close: () => { }
  };
  const pace = async () => {
    if (ctl.stop) throw new StopScript('Dihentikan');
    S.need = true;
    const delay = +S.cfg.delay;
    if (delay > 0) await new Promise(r => setTimeout(r, delay));
    else if (performance.now() - lastYield > 15) { await new Promise(r => requestAnimationFrame(() => r())); lastYield = performance.now(); }
    if (ctl.stop) throw new StopScript('Dihentikan');
  };
  const base = SW.makeTraci(() => ensureSim(), ctl);
  const api = Object.assign({}, base, { simulationStep: async t => { base.simulationStep(t); await pace(); return []; } });
  ctl.api = api;
  return ctl;
}
function doStepScripted() {
  const sim = ensureSim();
  if (sim.t >= S.cfg.end - 1e-9) throw new SW.TraCIException('Simulasi sudah mencapai end time (' + S.cfg.end + ' s)');
  sim.step();
}
async function runScript() {
  if (S.scripting) return;
  stopSim();
  const code = $('traciCode').value; const lang = S.traciLang;
  store.set('optimus.traci', code);
  const out = $('traciOut'); out.textContent = '';
  const log = (...a) => { out.textContent += a.join(' ') + '\n'; if (out.textContent.length > 60000) out.textContent = out.textContent.slice(-40000); out.scrollTop = out.scrollHeight; };
  if ($('traciReset').checked || !S.sim) { S.sim = null; }
  ensureSim();
  const ctl = makeCtl(log); S._ctl = ctl;
  S.scripting = true; renderTraciButtons();
  const t0 = performance.now();
  try {
    if (lang === 'js') {
      const src = code.replace(/(^|[^\w.])(?<!await\s)(traci\.simulationStep\s*\()/g, '$1await $2');
      const fn = new (Object.getPrototypeOf(async function () { }).constructor)('traci', 'print', 'console', src);
      await fn(ctl.api, log, { log, error: log, warn: log });
    } else {
      const py = await loadPyodideOnce(log);
      py.setStdout({ batched: t => log(t) }); py.setStderr({ batched: t => log(t) });
      py.runPython("import sys; sys.modules.pop('_traci_js', None)");
      py.registerJsModule('_traci_js', ctl.api);
      await py.runPythonAsync(PY_PRELUDE);
      py.globals.set('_user_src', code);
      await py.runPythonAsync('await _run_user(_user_src)');
    }
    log(`\n✓ Skrip selesai pada t=${fmt(S.sim.t, 1)} s (${fmt((performance.now() - t0) / 1000, 1)} detik nyata)`);
  } catch (e) {
    const msg = String(e && e.message || e);
    if (e instanceof StopScript || /StopScript|Dihentikan/.test(msg)) log('■ Dihentikan oleh pengguna.');
    else log('✗ ' + (msg.length > 1500 ? msg.slice(-1500) : msg));
  } finally {
    S.scripting = false; S._ctl = null; renderTraciButtons(); S.need = true; updateTime();
  }
}
function renderTraciButtons() {
  const r = $('traciRun'), s = $('traciStop');
  if (r) r.disabled = S.scripting; if (s) s.disabled = !S.scripting;
}
function panelTraci(p) {
  S.traciLang = S.traciLang || 'py';
  p.append(h('h3', null, 'TraCI – kontrol simulasi dari skrip'),
    h('div', { class: 'small mut' }, 'Tulis skrip seperti TraCI Python asli (import traci, traci.start, traci.simulationStep, traci.vehicle.*, traci.trafficlight.*, …). Python dijalankan di peramban via Pyodide; mode JavaScript tidak perlu unduhan.'),
    h('div', { class: 'row' }, sel(S.traciLang, [['py', 'Python (Pyodide)'], ['js', 'JavaScript']], v => { S.traciLang = v; }),
      sel('', [['', 'Contoh skrip…'], ...Object.keys(TRACI_EXAMPLES)], v => { if (!v) return; $('traciCode').value = TRACI_EXAMPLES[v]; S.traciLang = v.startsWith('JavaScript') ? 'js' : 'py'; renderPanel(); $('traciCode').value = TRACI_EXAMPLES[v]; })));
  const ta = h('textarea', { id: 'traciCode', class: 'code', spellcheck: false, onkeydown: e => { if (e.key === 'Tab') { e.preventDefault(); const t = e.target, s = t.selectionStart; t.value = t.value.slice(0, s) + '    ' + t.value.slice(t.selectionEnd); t.selectionStart = t.selectionEnd = s + 4; } } });
  ta.value = S._traciCode || store.get('optimus.traci') || TRACI_EXAMPLES['Part 3.1 – Latihan 1: baca kecepatan kendaraan'];
  ta.addEventListener('input', () => S._traciCode = ta.value);
  p.append(ta, h('div', { class: 'row' },
    h('button', { class: 'btn ok', id: 'traciRun', onclick: runScript }, '▶ Jalankan'),
    h('button', { class: 'btn bad', id: 'traciStop', onclick: () => { if (S._ctl) S._ctl.stop = true; } }, '■ Stop'),
    h('label', { class: 'row small', style: { margin: 0 } }, h('input', { type: 'checkbox', id: 'traciReset', checked: true }), 'mulai dari t=0')),
    h('pre', { class: 'console', id: 'traciOut' }, 'Output skrip muncul di sini.'));
  const doms = Object.entries(SW.makeTraci(() => null, {})).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 3);
  const ref = h('div', { class: 'small mut', style: { wordBreak: 'break-word' } });
  for (const [k, v] of doms) ref.append(h('div', { style: { marginBottom: '4px' } }, h('b', null, 'traci.' + k), ': ' + Object.keys(v).join(', ')));
  p.append(h('details', null, h('summary', null, 'Fungsi TraCI yang didukung'), ref));
  renderTraciButtons();
}

/* ---------- simbar ---------- */
$('bPlay').onclick = togglePlay;
$('bStep').onclick = () => { if (S.scripting) return; stopSim(); try { doStep(); } catch (e) { toast(e.message); } S.need = true; livePanels(); };
$('bReset').onclick = () => { if (S.scripting) return toast('Hentikan skrip TraCI dulu'); stopSim(); S.sim = null; if (S.cmp) S.cmp.sim = null; S.finished = false; S.track = null; S.need = true; updateTime(); renderPanel(); toast('Simulasi dimuat ulang (t = ' + S.cfg.begin + ')'); };
$('bFit').onclick = fitView;
$('delay').oninput = e => { S.cfg.delay = +e.target.value; $('delayV').textContent = S.cfg.delay; };
$('stepLen').onchange = e => { S.cfg.stepLength = +e.target.value; demandChanged(); if (S.tab === 'sim') renderPanel(); toast('Step length ' + S.cfg.stepLength + ' s (simulasi dimuat ulang)'); };

/* ---------- init ---------- */
function init() {
  const tabs = $('tabs');
  for (const [t, l] of TABS) tabs.append(h('button', { 'data-t': t, onclick: () => setTab(t) }, l));
  window.addEventListener('resize', () => { resize(); });
  resize();
  let loaded = false;
  const saved = store.get('optimus.project');
  if (saved) {
    try { const o = JSON.parse(saved); if (o.net && Object.keys(o.net.nodes).length) { S.cfg = Object.assign(SW.defaultConfig(), o.cfg || {}); loadScenario({ net: o.net, demand: o.demand, add: o.add }, o.name); loaded = true; } } catch (e) { console.warn(e); }
  }
  if (!loaded) loadScenario(SW.examples['Part 1.2 – Persimpangan bersinyal'](), 'persimpangan');
  $('delay').value = S.cfg.delay; $('delayV').textContent = S.cfg.delay; $('stepLen').value = String(S.cfg.stepLength);
  setTab(loaded ? 'net' : 'sim');
  requestAnimationFrame(() => { resize(); fitView(); });
  requestAnimationFrame(frame);
  if (!loaded) toast('Contoh "Persimpangan bersinyal" dimuat. Tekan ▶ untuk mulai.', 3500);
  if (typeof svInit === 'function') svInit();
}
init();
