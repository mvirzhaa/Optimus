"""Optimus layanan Python (FastAPI)

- /analyze      : statistik hasil simulasi (persentil, LOS, profil waktu, emisi per jenis, detektor)
- /compare      : perbandingan beberapa hasil simulasi
- /sumo/run     : menjalankan skenario di Eclipse SUMO asli (netconvert + sumo) lalu
                  mengembalikan hasil dalam format yang sama dengan Optimus
"""
from __future__ import annotations

import math
import os
import re
import shutil
import statistics
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from typing import Any

import psycopg
from fastapi import FastAPI, HTTPException
from psycopg.rows import dict_row
from pydantic import BaseModel, Field

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://optimus:optimus@localhost:5432/optimus")
SUMO_TIMEOUT = int(os.environ.get("SUMO_TIMEOUT", "900"))

app = FastAPI(title="Optimus Python service", version="1.0")


# ---------------------------------------------------------------- SUMO lokasi
def sumo_home() -> str | None:
    if os.environ.get("SUMO_HOME") and os.path.isdir(os.environ["SUMO_HOME"]):
        return os.environ["SUMO_HOME"]
    try:  # paket pip "eclipse-sumo"
        import sumo  # type: ignore
        return sumo.SUMO_HOME
    except Exception:
        return None


def sumo_bin(name: str) -> str | None:
    home = sumo_home()
    if home:
        p = os.path.join(home, "bin", name)
        if os.path.exists(p):
            return p
    return shutil.which(name)


def sumo_version() -> str | None:
    b = sumo_bin("sumo")
    if not b:
        return None
    try:
        out = subprocess.run([b, "--version"], capture_output=True, text=True, timeout=20).stdout
        m = re.search(r"sumo\s+v?(\d[\w.]*)", out, re.I)
        return m.group(1) if m else "unknown"
    except Exception:
        return None


_SUMO_VERSION = sumo_version()


def db():
    return psycopg.connect(DATABASE_URL, row_factory=dict_row)


def load_run(run_id: str) -> dict:
    with db() as conn:
        r = conn.execute("SELECT * FROM runs WHERE id = %s", (run_id,)).fetchone()
    if not r:
        raise HTTPException(404, "Hasil simulasi tidak ditemukan")
    return r


@app.get("/health")
def health():
    ok_db = True
    try:
        with db() as conn:
            conn.execute("SELECT 1")
    except Exception:
        ok_db = False
    return {"ok": True, "db": ok_db, "sumo": _SUMO_VERSION}


# ---------------------------------------------------------------- statistik
TRIP_COLS = ["id", "type", "depart", "duration", "routeLength", "waitingTime", "timeLoss", "CO2", "fuel", "elec"]


def trips_of(run: dict) -> list[dict]:
    out = []
    for row in run["tripinfo"] or []:
        if isinstance(row, dict):
            out.append(row)
        else:
            out.append(dict(zip(TRIP_COLS, row)))
    return out


def pct(values: list[float], q: float) -> float | None:
    if not values:
        return None
    v = sorted(values)
    k = (len(v) - 1) * q / 100
    f, c = math.floor(k), math.ceil(k)
    return v[f] if f == c else v[f] + (v[c] - v[f]) * (k - f)


def describe(values: list[float]) -> dict:
    if not values:
        return {"n": 0}
    return {
        "n": len(values), "mean": statistics.fmean(values), "std": statistics.pstdev(values) if len(values) > 1 else 0.0,
        "min": min(values), "p50": pct(values, 50), "p85": pct(values, 85), "p95": pct(values, 95), "max": max(values),
    }


# HCM: tingkat pelayanan berdasar tundaan rata-rata per kendaraan (detik)
LOS_SIGNAL = [(10, "A"), (20, "B"), (35, "C"), (55, "D"), (80, "E")]


def los(delay: float | None) -> str | None:
    if delay is None:
        return None
    for lim, g in LOS_SIGNAL:
        if delay <= lim:
            return g
    return "F"


def histogram(values: list[float], bins: int = 20) -> dict:
    if not values:
        return {"edges": [], "counts": []}
    lo, hi = min(values), pct(values, 99) or max(values)
    if hi <= lo:
        hi = lo + 1
    w = (hi - lo) / bins
    counts = [0] * bins
    for x in values:
        i = min(bins - 1, max(0, int((x - lo) / w)))
        counts[i] += 1
    return {"edges": [lo + i * w for i in range(bins + 1)], "counts": counts}


def analyze_run(run: dict) -> dict:
    trips = trips_of(run)
    dur = [t["duration"] for t in trips]
    wait = [t["waitingTime"] for t in trips]
    loss = [t["timeLoss"] for t in trips]
    speed = [t["routeLength"] / t["duration"] * 3.6 for t in trips if t["duration"] > 0]
    by_type: dict[str, dict] = {}
    for t in trips:
        b = by_type.setdefault(t["type"], {"n": 0, "dur": 0.0, "wait": 0.0, "loss": 0.0, "len": 0.0, "co2": 0.0, "fuel": 0.0, "elec": 0.0})
        b["n"] += 1
        b["dur"] += t["duration"]; b["wait"] += t["waitingTime"]; b["loss"] += t["timeLoss"]
        b["len"] += t["routeLength"]; b["co2"] += t["CO2"] or 0; b["fuel"] += t["fuel"] or 0; b["elec"] += t["elec"] or 0
    types = []
    for k, b in sorted(by_type.items(), key=lambda kv: -kv[1]["n"]):
        km = max(b["len"] / 1000, 1e-6)
        types.append({
            "type": k, "n": b["n"], "duration": b["dur"] / b["n"], "waiting": b["wait"] / b["n"], "timeLoss": b["loss"] / b["n"],
            "speed_kmh": b["len"] / max(b["dur"], 1e-6) * 3.6, "co2_g_per_km": b["co2"] / km, "fuel_ml_per_km": b["fuel"] / km,
            "elec_wh_per_km": b["elec"] / km, "los": los(b["loss"] / b["n"]),
        })
    # profil per 15 menit (berdasar waktu berangkat)
    bucket = 900
    prof: dict[int, list] = {}
    for t in trips:
        prof.setdefault(int(t["depart"] // bucket), []).append(t)
    profile = [{
        "begin": k * bucket, "end": (k + 1) * bucket, "trips": len(v), "flow_vph": len(v) * 3600 / bucket,
        "mean_timeLoss": statistics.fmean(x["timeLoss"] for x in v), "mean_duration": statistics.fmean(x["duration"] for x in v),
        "los": los(statistics.fmean(x["timeLoss"] for x in v)),
    } for k, v in sorted(prof.items())]
    # deret ringkasan: [t, running, halting, meanSpeed, arrived, co2]
    summ = run["summary"] or []
    peak = None
    if summ:
        mx = max(summ, key=lambda s: s[1] if isinstance(s, list) else s.get("running", 0))
        peak = {"t": mx[0], "running": mx[1]} if isinstance(mx, list) else {"t": mx["t"], "running": mx["running"]}
    dets = []
    for d in run["detectors"] or []:
        iv = d.get("intervals") or []
        if d.get("kind") == "e2":
            dets.append({"id": d["id"], "kind": "e2", "intervals": len(iv),
                         "mean_occupancy": statistics.fmean([i.get("meanOccupancy", 0) for i in iv]) if iv else None,
                         "max_jam_m": max([i.get("maxJamLengthInMeters", 0) for i in iv], default=None)})
        else:
            flows = [i.get("flow", 0) for i in iv]
            dets.append({"id": d["id"], "kind": "e1", "intervals": len(iv),
                         "mean_flow_vph": statistics.fmean(flows) if flows else None, "peak_flow_vph": max(flows, default=None),
                         "mean_occupancy": statistics.fmean([i.get("occupancy", 0) for i in iv]) if iv else None})
    mean_loss = statistics.fmean(loss) if loss else None
    return {
        "run_id": str(run["id"]), "engine": run["engine"], "version": run["version"], "sim_time": run["sim_time"], "note": run.get("note") or "",
        "trips": len(trips), "totals": run["totals"],
        "duration": describe(dur), "waiting": describe(wait), "timeLoss": describe(loss), "speed_kmh": describe(speed),
        "los": los(mean_loss), "los_basis": "HCM, tundaan rata-rata per kendaraan (timeLoss)",
        "by_type": types, "profile_15min": profile, "peak": peak,
        "hist_duration": histogram(dur), "detectors": dets,
    }


class AnalyzeReq(BaseModel):
    run_id: str


@app.post("/analyze")
def analyze(req: AnalyzeReq):
    return analyze_run(load_run(req.run_id))


class CompareReq(BaseModel):
    run_ids: list[str] = Field(min_length=2, max_length=8)


METRICS = [
    ("Perjalanan selesai", lambda a: a["trips"], ""),
    ("Waktu tempuh rata-rata", lambda a: a["duration"].get("mean"), "s"),
    ("Waktu tempuh p85", lambda a: a["duration"].get("p85"), "s"),
    ("Waktu tunggu rata-rata", lambda a: a["waiting"].get("mean"), "s"),
    ("Tundaan (timeLoss) rata-rata", lambda a: a["timeLoss"].get("mean"), "s"),
    ("Kecepatan perjalanan rata-rata", lambda a: a["speed_kmh"].get("mean"), "km/j"),
    ("CO2 total", lambda a: (a["totals"] or {}).get("CO2", 0) / 1000, "kg"),
    ("NOx total", lambda a: (a["totals"] or {}).get("NOx"), "g"),
    ("BBM total", lambda a: (a["totals"] or {}).get("fuel", 0) / 1000, "L"),
    ("Listrik total", lambda a: (a["totals"] or {}).get("elec", 0) / 1000, "kWh"),
    ("Teleport", lambda a: (a["totals"] or {}).get("teleports"), ""),
]


@app.post("/compare")
def compare(req: CompareReq):
    an = [analyze_run(load_run(i)) for i in req.run_ids]
    rows = []
    for label, fn, unit in METRICS:
        vals = []
        for a in an:
            try:
                v = fn(a)
            except Exception:
                v = None
            vals.append(v)
        base = vals[0]
        diffs = [None if (v is None or base in (None, 0)) else (v - base) / abs(base) * 100 for v in vals]
        rows.append({"metric": label, "unit": unit, "values": vals, "diff_pct": diffs})
    rows.append({"metric": "Tingkat pelayanan (LOS)", "unit": "", "values": [a["los"] for a in an], "diff_pct": [None] * len(an)})
    return {"runs": [{"id": a["run_id"], "engine": a["engine"], "version": a["version"], "note": a["note"]} for a in an], "rows": rows}


# ---------------------------------------------------------------- SUMO asli
class SumoReq(BaseModel):
    name: str = "scenario"
    files: dict[str, str]
    begin: float = 0
    end: float = 3600
    step_length: float = 0.5
    seed: int = 42
    time_to_teleport: float = 300
    period: float = 60
    keep_tls: bool = True   # pakai koneksi & program lampu dari Optimus (con.xml + tll.xml)
    lefthand: bool = False  # lalu lintas lajur kiri (Indonesia)


def _f(x: str | None, d: float = 0.0) -> float:
    try:
        return float(x) if x not in (None, "") else d
    except ValueError:
        return d


def _prepare_additional(xml: str, out_e1: str) -> str:
    try:
        root = ET.fromstring(xml)
    except ET.ParseError as e:
        raise HTTPException(422, f"Berkas additional tidak valid: {e}")
    for el in root:
        if el.tag in ("inductionLoop", "e1Detector", "laneAreaDetector", "e2Detector"):
            el.set("friendlyPos", "true")
            el.set("file", out_e1)
        elif el.tag in ("busStop", "trainStop"):
            el.set("friendlyPos", "true")
    return ET.tostring(root, encoding="unicode")


@app.post("/sumo/run")
def sumo_run(req: SumoReq):
    netconvert, sumo = sumo_bin("netconvert"), sumo_bin("sumo")
    if not netconvert or not sumo:
        raise HTTPException(503, "Eclipse SUMO tidak terpasang di server (pip install eclipse-sumo atau set SUMO_HOME)")
    n = re.sub(r"[^\w.-]", "_", req.name) or "scenario"
    need = [f"{n}.nod.xml", f"{n}.edg.xml", f"{n}.rou.xml"]
    for k in need:
        if k not in req.files:
            raise HTTPException(400, f"Berkas {k} tidak dikirim")
    work = tempfile.mkdtemp(prefix="optimus_")
    warnings: list[str] = []
    try:
        P = lambda f: os.path.join(work, f)  # noqa: E731
        for k in need:
            with open(P(k), "w", encoding="utf-8") as fh:
                fh.write(req.files[k])
        add_xml = req.files.get(f"{n}.add.xml", "<additional/>")
        with open(P("det.add.xml"), "w", encoding="utf-8") as fh:
            fh.write(_prepare_additional(add_xml, "det_out.xml"))
        # 1) bangun jaringan dengan netconvert. Bila tersedia, koneksi lajur & program lampu Optimus ikut dipakai
        base = [netconvert, "-n", P(need[0]), "-e", P(need[1]), "-o", P("net.net.xml"),
                "--no-turnarounds", "true", "--tls.default-type", "static", "--junctions.corner-detail", "5"]
        if req.lefthand:
            base += ["--lefthand", "true"]
        extra = []
        if req.keep_tls and f"{n}.con.xml" in req.files and f"{n}.tll.xml" in req.files:
            for k, fn in ((f"{n}.con.xml", "con.xml"), (f"{n}.tll.xml", "tll.xml")):
                with open(P(fn), "w", encoding="utf-8") as fh:
                    fh.write(req.files[k])
            extra = ["-x", P("con.xml"), "-i", P("tll.xml")]
        nc = subprocess.run(base + extra, capture_output=True, text=True, timeout=300)
        tls_source = "Optimus" if extra else "SUMO (bawaan netconvert)"
        if nc.returncode != 0 and extra:
            warnings.append("Koneksi/program lampu Optimus ditolak netconvert, memakai bawaan SUMO: " + (nc.stderr or "")[-300:])
            nc = subprocess.run(base, capture_output=True, text=True, timeout=300)
            tls_source = "SUMO (bawaan netconvert)"
        if nc.returncode != 0:
            raise HTTPException(422, "netconvert gagal: " + (nc.stderr or nc.stdout)[-1500:])
        warnings += [l for l in (nc.stderr or "").splitlines() if l.startswith("Warning")][:20]
        # 2) jalankan sumo
        args = [sumo, "-n", P("net.net.xml"), "-r", P(need[2]), "-a", P("det.add.xml"),
                "-b", str(req.begin), "-e", str(req.end), "--step-length", str(req.step_length), "--seed", str(req.seed),
                "--time-to-teleport", str(req.time_to_teleport), "--ignore-route-errors", "true",
                "--device.emissions.probability", "1", "--tripinfo-output", P("tripinfo.xml"),
                "--summary-output", P("summary.xml"), "--statistic-output", P("stats.xml"),
                "--no-step-log", "true", "--duration-log.disable", "true", "--no-warnings", "false"]
        if 'latAlignment="arbitrary"' in req.files[need[2]]:
            args += ["--lateral-resolution", "0.8"]   # model sublane: sepeda motor menyelip
        sr = subprocess.run(args, capture_output=True, text=True, timeout=SUMO_TIMEOUT)
        log = (sr.stdout or "") + (sr.stderr or "")
        if sr.returncode != 0:
            raise HTTPException(422, "sumo gagal: " + log[-1500:])
        warnings += [l for l in log.splitlines() if l.startswith("Warning")][:30]
        out = _collect(work, req, log, warnings)
        out["tls_source"] = tls_source
        return out
    except subprocess.TimeoutExpired:
        raise HTTPException(504, "SUMO melebihi batas waktu")
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _collect(work: str, req: SumoReq, log: str, warnings: list[str]) -> dict:
    P = lambda f: os.path.join(work, f)  # noqa: E731
    trips, totals = [], {"CO2": 0.0, "CO": 0.0, "HC": 0.0, "NOx": 0.0, "PMx": 0.0, "fuel": 0.0, "elec": 0.0, "dist": 0.0}
    arrivals = []
    for _, el in ET.iterparse(P("tripinfo.xml")):
        if el.tag != "tripinfo":
            continue
        em = el.find("emissions")
        g = (lambda k: _f(em.get(k)) / 1000.0) if em is not None else (lambda k: 0.0)  # mg -> g
        fuel_ml = (_f(em.get("fuel_abs")) / 1000.0 / 0.75) if em is not None else 0.0     # mg -> g -> ml (≈0,75 g/ml)
        elec = _f(em.get("electricity_abs")) if em is not None else 0.0
        row = [el.get("id"), el.get("vType"), _f(el.get("depart")), _f(el.get("duration")), _f(el.get("routeLength")),
               _f(el.get("waitingTime")), _f(el.get("timeLoss")), g("CO2_abs"), fuel_ml, elec]
        trips.append(row)
        arrivals.append((_f(el.get("arrival")), row[7]))
        for k, key in (("CO2", "CO2_abs"), ("CO", "CO_abs"), ("HC", "HC_abs"), ("NOx", "NOx_abs"), ("PMx", "PMx_abs")):
            totals[k] += g(key)
        totals["fuel"] += fuel_ml
        totals["elec"] += elec
        totals["dist"] += row[4]
        el.clear()
    arrivals.sort()
    summary, last_t, ai, co2 = [], -1e9, 0, 0.0
    for _, el in ET.iterparse(P("summary.xml")):
        if el.tag != "step":
            continue
        t = _f(el.get("time"))
        while ai < len(arrivals) and arrivals[ai][0] <= t:
            co2 += arrivals[ai][1]; ai += 1
        if t - last_t >= 1 - 1e-9:
            summary.append([t, int(_f(el.get("running"))), int(_f(el.get("halting"))), max(0.0, _f(el.get("meanSpeed"))), int(_f(el.get("ended", el.get("arrived")))), co2])
            last_t = t
        el.clear()
    st = ET.parse(P("stats.xml")).getroot()
    veh = st.find("vehicles")
    tel = st.find("teleports")
    totals.update({
        "arrived": len(trips), "departed": int(_f(veh.get("inserted"))) if veh is not None else len(trips),
        "loaded": int(_f(veh.get("loaded"))) if veh is not None else None,
        "teleports": int(_f(tel.get("total"))) if tel is not None else 0,
    })
    dets: dict[str, dict] = {}
    if os.path.exists(P("det_out.xml")):
        for _, el in ET.iterparse(P("det_out.xml")):
            if el.tag != "interval":
                continue
            did = el.get("id")
            if el.get("nVehContrib") is not None:
                d = dets.setdefault(did, {"id": did, "kind": "e1", "intervals": []})
                d["intervals"].append({"begin": _f(el.get("begin")), "end": _f(el.get("end")), "nVehContrib": int(_f(el.get("nVehContrib"))),
                                       "flow": _f(el.get("flow")), "occupancy": _f(el.get("occupancy")), "speed": _f(el.get("speed"), -1)})
            else:
                d = dets.setdefault(did, {"id": did, "kind": "e2", "intervals": []})
                d["intervals"].append({"begin": _f(el.get("begin")), "end": _f(el.get("end")), "meanSpeed": _f(el.get("meanSpeed"), -1),
                                       "meanOccupancy": _f(el.get("meanOccupancy")), "maxJamLengthInMeters": _f(el.get("maxJamLengthInMeters")),
                                       "meanVehicleNumber": _f(el.get("meanVehicleNumber"))})
            el.clear()
    sim_time = summary[-1][0] if summary else req.end
    return {"sumo_version": _SUMO_VERSION, "totals": totals, "summary": summary, "tripinfo": trips,
            "detectors": list(dets.values()), "sim_time": sim_time, "warnings": warnings, "log": log[-3000:]}


# ---------------------------------------------------------------- laporan Word / PDF
from fastapi import Response  # noqa: E402

from .report import build_docx, to_pdf  # noqa: E402


class ReportReq(BaseModel):
    format: str = "docx"
    run_id: str
    compare_run_id: str | None = None
    author: str | None = None
    project: dict
    config: dict = {}
    geometry: dict
    demand: dict = {}
    add: dict = {}
    pkji: dict | None = None
    extra: dict = {}


@app.post("/report")
def report(req: ReportReq):
    run = load_run(req.run_id)
    an = analyze_run(run)
    cmp = compare(CompareReq(run_ids=[req.run_id, req.compare_run_id])) if req.compare_run_id else None
    body = req.model_dump()
    body["_summary"] = run["summary"] or []
    data = build_docx(body, an, cmp)
    if req.format == "pdf":
        try:
            data = to_pdf(data)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(500, str(e))
        return Response(content=data, media_type="application/pdf")
    return Response(content=data, media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document")
