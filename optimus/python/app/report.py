"""Laporan kajian lalu lintas (Word .docx / PDF) untuk Optimus.

Gambar dibuat dengan matplotlib, dokumen dengan python-docx, PDF dikonversi dengan LibreOffice.
"""
from __future__ import annotations

import datetime as dt
import io
import os
import shutil
import subprocess
import tempfile

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from docx import Document  # noqa: E402
from docx.enum.section import WD_ORIENT  # noqa: E402
from docx.enum.table import WD_TABLE_ALIGNMENT  # noqa: E402
from docx.enum.text import WD_ALIGN_PARAGRAPH  # noqa: E402
from docx.oxml import OxmlElement  # noqa: E402
from docx.oxml.ns import qn  # noqa: E402
from docx.shared import Cm, Pt, RGBColor  # noqa: E402

ACCENT = RGBColor(0x1F, 0x4E, 0x79)
GRID = "D0D7E2"
HEAD = "DCE6F2"

BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"]


def n(v, d=1):
    if v is None:
        return "–"
    try:
        s = f"{float(v):,.{d}f}"
    except (TypeError, ValueError):
        return str(v)
    return s.replace(",", "X").replace(".", ",").replace("X", ".")


# ------------------------------------------------------------------ gambar
def _png(fig) -> io.BytesIO:
    b = io.BytesIO()
    fig.savefig(b, format="png", dpi=170, bbox_inches="tight")
    plt.close(fig)
    b.seek(0)
    return b


def fig_network(geo: dict, add: dict) -> io.BytesIO:
    fig, ax = plt.subplots(figsize=(7.2, 5.2))
    order = sorted(geo["edges"], key=lambda e: e["layer"])
    for e in order:
        xs, ys = zip(*e["shape"]) if e["shape"] else ([], [])
        lw = 1.2 + e["lanes"] * 1.1
        if e["layer"] > 0:
            ax.plot(xs, ys, color="#1f4e79", lw=lw + 2.2, solid_capstyle="butt", zorder=4)
            ax.plot(xs, ys, color="#9db8d6", lw=lw, solid_capstyle="butt", zorder=5)
        elif e["layer"] < 0:
            ax.plot(xs, ys, color="#8a6d3b", lw=lw, ls=(0, (3, 2)), zorder=1)
        else:
            ax.plot(xs, ys, color="#7f8792", lw=lw, solid_capstyle="butt", zorder=2)
    tl = [nd for nd in geo["nodes"] if nd["type"] == "traffic_light"]
    if tl:
        ax.scatter([nd["x"] for nd in tl], [nd["y"] for nd in tl], s=40, c="#e74c3c", zorder=6, label="Simpang APILL")
    for b in add.get("busStops") or []:
        pass
    ax.set_aspect("equal")
    ax.axis("off")
    from matplotlib.lines import Line2D
    handles = [Line2D([], [], color="#7f8792", lw=3, label="Jalan permukaan")]
    if any(e["layer"] > 0 for e in geo["edges"]):
        handles.append(Line2D([], [], color="#9db8d6", lw=3, label="Flyover"))
    if any(e["layer"] < 0 for e in geo["edges"]):
        handles.append(Line2D([], [], color="#8a6d3b", lw=3, ls="--", label="Underpass"))
    if tl:
        handles.append(Line2D([], [], marker="o", color="w", markerfacecolor="#e74c3c", markersize=7, label="Simpang bersinyal"))
    ax.legend(handles=handles, loc="lower left", fontsize=7, frameon=True)
    xs = [p[0] for e in geo["edges"] for p in e["shape"]]
    ys = [p[1] for e in geo["edges"] for p in e["shape"]]
    if xs:
        span = max(max(xs) - min(xs), max(ys) - min(ys))
        L = 10 ** int(len(str(int(max(span / 5, 1)))) - 1)
        L = max(10, L * (5 if span / 5 >= 5 * L else 2 if span / 5 >= 2 * L else 1))
        x0, y0 = max(xs) - L, min(ys) - span * 0.04
        ax.plot([x0, x0 + L], [y0, y0], color="k", lw=2)
        ax.text(x0 + L / 2, y0 + span * 0.012, f"{L:g} m", ha="center", fontsize=7)
    return _png(fig)


def fig_summary(summary: list) -> io.BytesIO | None:
    if not summary:
        return None
    t = [s[0] / 60 for s in summary]
    fig, (a1, a2) = plt.subplots(2, 1, figsize=(7.2, 4.4), sharex=True)
    a1.plot(t, [s[1] for s in summary], color="#2e75b6", lw=1.3, label="kendaraan berjalan")
    a1.plot(t, [s[2] for s in summary], color="#c0392b", lw=1.1, label="kendaraan berhenti")
    a1.set_ylabel("kendaraan")
    a1.legend(fontsize=7, loc="upper left")
    a1.grid(alpha=0.3)
    a2.plot(t, [s[3] * 3.6 for s in summary], color="#27ae60", lw=1.2)
    a2.set_ylabel("km/jam")
    a2.set_xlabel("waktu simulasi (menit)")
    a2.grid(alpha=0.3)
    a2.set_title("Kecepatan rata-rata jaringan", fontsize=8, loc="left")
    a1.set_title("Jumlah kendaraan di jaringan", fontsize=8, loc="left")
    fig.tight_layout()
    return _png(fig)


def fig_hist(h: dict) -> io.BytesIO | None:
    if not h or not h.get("counts"):
        return None
    e, c = h["edges"], h["counts"]
    fig, ax = plt.subplots(figsize=(6.4, 2.6))
    ax.bar([(e[i] + e[i + 1]) / 2 for i in range(len(c))], c, width=(e[1] - e[0]) * 0.9, color="#5b9bd5")
    ax.set_xlabel("waktu tempuh (detik)")
    ax.set_ylabel("jumlah perjalanan")
    ax.grid(axis="y", alpha=0.3)
    fig.tight_layout()
    return _png(fig)


def fig_dj(apps: list) -> io.BytesIO | None:
    if not apps:
        return None
    fig, ax = plt.subplots(figsize=(6.4, 0.5 + 0.38 * len(apps)))
    lab = [f"{a['approach']} ({a['tl']})" for a in apps]
    v = [a["DJ"] or 0 for a in apps]
    col = ["#27ae60" if x < 0.75 else "#f39c12" if x < 0.85 else "#c0392b" for x in v]
    ax.barh(lab, v, color=col)
    ax.axvline(0.85, color="#c0392b", ls="--", lw=1)
    ax.text(0.86, len(apps) - 0.6, "DJ 0,85", color="#c0392b", fontsize=7)
    ax.set_xlabel("Derajat kejenuhan (DJ)")
    ax.set_xlim(0, max(1.0, max(v) * 1.1))
    ax.invert_yaxis()
    ax.grid(axis="x", alpha=0.3)
    fig.tight_layout()
    return _png(fig)


# ------------------------------------------------------------------ dokumen
def _shade(cell, hexcolor):
    tcPr = cell._tc.get_or_add_tcPr()
    sh = OxmlElement("w:shd")
    sh.set(qn("w:val"), "clear")
    sh.set(qn("w:color"), "auto")
    sh.set(qn("w:fill"), hexcolor)
    tcPr.append(sh)


def _borders(table):
    tbl = table._tbl
    tblPr = tbl.tblPr
    b = OxmlElement("w:tblBorders")
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        el = OxmlElement(f"w:{edge}")
        el.set(qn("w:val"), "single")
        el.set(qn("w:sz"), "4")
        el.set(qn("w:space"), "0")
        el.set(qn("w:color"), GRID)
        b.append(el)
    tblPr.append(b)


def table(doc, header, rows, widths_cm=None, font=8.5, align_num=True):
    t = doc.add_table(rows=1, cols=len(header))
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    _borders(t)
    for i, h in enumerate(header):
        c = t.rows[0].cells[i]
        c.text = ""
        r = c.paragraphs[0].add_run(str(h))
        r.bold = True
        r.font.size = Pt(font)
        _shade(c, HEAD)
    for row in rows:
        cells = t.add_row().cells
        for i, v in enumerate(row):
            cells[i].text = ""
            p = cells[i].paragraphs[0]
            r = p.add_run("" if v is None else str(v))
            r.font.size = Pt(font)
            if align_num and i > 0 and isinstance(v, str) and v[:1].isdigit():
                p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    rep = t.rows[0]._tr.get_or_add_trPr()
    th = OxmlElement("w:tblHeader")
    th.set(qn("w:val"), "true")
    rep.append(th)
    if widths_cm:
        for row in t.rows:
            for i, w in enumerate(widths_cm):
                row.cells[i].width = Cm(w)
    doc.add_paragraph()
    return t


def caption(doc, text):
    p = doc.add_paragraph()
    r = p.add_run(text)
    r.italic = True
    r.font.size = Pt(8.5)
    r.font.color.rgb = RGBColor(0x59, 0x59, 0x59)
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER


def picture(doc, png, width_cm=16, cap=None):
    if png is None:
        return
    doc.add_picture(png, width=Cm(width_cm))
    doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
    if cap:
        caption(doc, cap)


def bullet(doc, text):
    doc.add_paragraph(text, style="List Bullet")


def build_docx(body: dict, an: dict, cmp: dict | None) -> bytes:
    doc = Document()
    sec = doc.sections[0]
    sec.page_height, sec.page_width = Cm(29.7), Cm(21.0)
    sec.orientation = WD_ORIENT.PORTRAIT
    for side in ("left_margin", "right_margin"):
        setattr(sec, side, Cm(2.2))
    sec.top_margin, sec.bottom_margin = Cm(2.0), Cm(2.0)
    st = doc.styles
    st["Normal"].font.name = "Calibri"
    st["Normal"].font.size = Pt(10.5)
    st["Normal"].element.rPr.rFonts.set(qn("w:eastAsia"), "Calibri")
    st["Normal"].paragraph_format.space_after = Pt(4)
    for lvl, size in (("Title", 22), ("Heading 1", 15), ("Heading 2", 12)):
        s = st[lvl]
        s.font.name = "Calibri"
        s.font.size = Pt(size)
        s.font.bold = True
        s.font.color.rgb = ACCENT
        s.paragraph_format.space_before = Pt(14 if lvl != "Title" else 0)
        s.paragraph_format.space_after = Pt(6)
        s.paragraph_format.keep_with_next = True
    # footer page number
    fp = sec.footer.paragraphs[0]
    fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = fp.add_run()
    for tag, txt in (("begin", None), (None, "PAGE"), ("end", None)):
        if tag:
            f = OxmlElement("w:fldChar")
            f.set(qn("w:fldCharType"), tag)
            run._r.append(f)
        else:
            it = OxmlElement("w:instrText")
            it.set(qn("xml:space"), "preserve")
            it.text = txt
            run._r.append(it)
    run.font.size = Pt(8)

    P = body["project"]
    today = dt.date.today()
    tgl = f"{today.day} {BULAN[today.month - 1]} {today.year}"
    doc.add_paragraph(f"Laporan Kajian Lalu Lintas", style="Title")
    p = doc.add_paragraph()
    r = p.add_run(P["name"])
    r.font.size = Pt(14)
    r.bold = True
    if P.get("description"):
        doc.add_paragraph(P["description"])
    cfg = body.get("config") or {}
    eng = "Eclipse SUMO (server)" if an["engine"] == "sumo" else "Optimus (peramban)"
    meta = [("Versi skenario", f"v{P['version']}"), ("Mesin simulasi", eng), ("Durasi simulasi", f"{n(an['sim_time'] / 60, 0)} menit (langkah {n(cfg.get('stepLength', 0.5), 2)} s)"),
            ("Pemanasan (warm-up)", f"{n(cfg.get('warmup', 0), 0)} s"), ("Arah lalu lintas", "lajur kiri (Indonesia)" if body["geometry"]["lefthand"] else "lajur kanan"),
            ("Disusun oleh", body.get("author") or "–"), ("Tanggal", tgl)]
    table(doc, ["Butir", "Keterangan"], meta, [5, 11], font=9.5, align_num=False)

    # ---------------- ringkasan
    doc.add_heading("1. Ringkasan", level=1)
    pk = body.get("pkji")
    findings = [f"Sebanyak {n(an['trips'], 0)} perjalanan selesai dengan waktu tempuh rata-rata {n(an['duration'].get('mean'))} detik "
                f"(persentil-85 {n(an['duration'].get('p85'))} detik) dan tundaan rata-rata {n(an['timeLoss'].get('mean'))} detik per kendaraan."]
    if pk and pk.get("junctions"):
        for j in pk["junctions"]:
            findings.append(f"Simpang {j['tl']}: tundaan rata-rata hasil simulasi {n(j.get('T_sim'))} detik/SMP (tingkat pelayanan {j.get('los_sim') or '–'} menurut PM 96/2015); "
                            f"perhitungan PKJI 2023 {n(j['T_pkji'])} detik/SMP ({j['los_pkji']}); derajat kejenuhan maksimum {n(j['maxDJ'], 2)}.")
        hi = [a for a in pk["approaches"] if (a.get("DJ") or 0) >= 0.85]
        findings.append(("Pendekat dengan DJ ≥ 0,85 (mendekati jenuh): " + ", ".join(f"{a['approach']} ({n(a['DJ'], 2)})" for a in hi) + ".") if hi
                        else "Tidak ada pendekat simpang bersinyal dengan derajat kejenuhan ≥ 0,85.")
    tot = an.get("totals") or {}
    findings.append(f"Emisi total CO₂ {n((tot.get('CO2') or 0) / 1000, 1)} kg, NOx {n(tot.get('NOx'), 0)} g; konsumsi BBM {n((tot.get('fuel') or 0) / 1000, 1)} liter"
                    + (f" dan listrik {n((tot.get('elec') or 0) / 1000, 1)} kWh." if (tot.get('elec') or 0) > 0 else "."))
    if (tot.get("teleports") or 0) > 0:
        findings.append(f"Terjadi {tot['teleports']} teleport (kendaraan macet total lebih dari batas waktu) — periksa titik kemacetan.")
    for f in findings:
        bullet(doc, f)

    # ---------------- jaringan
    doc.add_heading("2. Jaringan jalan", level=1)
    picture(doc, fig_network(body["geometry"], body.get("add") or {}), 15.5, "Gambar 1. Peta jaringan jalan skenario")
    g = body["geometry"]
    stats = P.get("stats") or {}
    rows = [("Simpul (junction)", n(len(g["nodes"]), 0)), ("Ruas jalan (satu arah)", n(len(g["edges"]), 0)),
            ("Simpang bersinyal (program lampu)", n(len(g["tls"]), 0)), ("Ruas flyover", n(sum(1 for e in g["edges"] if e["layer"] > 0), 0)),
            ("Ruas underpass", n(sum(1 for e in g["edges"] if e["layer"] < 0), 0)), ("Halte", n(len((body.get('add') or {}).get('busStops') or []), 0)),
            ("Penyeberangan pejalan kaki", n(len((body.get('add') or {}).get('crossings') or []), 0)), ("Detektor E1 / E2", f"{(body.get('add') or {}).get('e1', 0)} / {(body.get('add') or {}).get('e2', 0)}")]
    table(doc, ["Komponen", "Jumlah"], rows, [10, 6], font=9.5)
    _ = stats

    # ---------------- demand
    doc.add_heading("3. Data lalu lintas", level=1)
    dm = body.get("demand") or {}
    table(doc, ["Tipe kendaraan", "Kelas", "Model", "Kelas emisi", "Kec. maks (km/j)"],
          [(t["id"], t["vClass"], t["model"], t["emission"], n((t.get("maxSpeed") or 0) * 3.6, 0)) for t in dm.get("vTypes", [])], [4, 3, 2.5, 4, 3])
    fl = dm.get("flows", [])
    if fl:
        rows = [(f["id"], f["type"], f["from"] or "–", f["to"] or "–", n(f["vph"], 0) if f.get("vph") else "–") for f in fl[:40]]
        table(doc, ["Arus (flow)", "Tipe", "Dari", "Ke", "kend/jam"], rows, [5, 3, 3, 3, 2.5])
        if len(fl) > 40:
            doc.add_paragraph(f"(… dan {len(fl) - 40} arus lainnya)")
        doc.add_paragraph(f"Total arus masuk: {n(sum((f.get('vph') or 0) for f in fl), 0)} kendaraan/jam" + (f", ditambah {dm.get('vehicles')} perjalanan individual." if dm.get("vehicles") else "."))

    # ---------------- lampu
    if g["tls"]:
        doc.add_heading("4. Pengaturan lampu lalu lintas", level=1)
        for t in g["tls"]:
            cyc = sum(p["duration"] for p in t["phases"])
            doc.add_heading(f"Program {t['id']} ({t['type']}, siklus {n(cyc, 0)} detik" + (f", gabungan {len(t['nodes'])} simpang" if len(t["nodes"]) > 1 else "") + ")", level=2)
            table(doc, ["Fase", "Durasi (s)", "State (G hijau, g hijau mengalah, y kuning, r merah)"],
                  [(str(i), n(p["duration"], 0), p["state"]) for i, p in enumerate(t["phases"])], [1.5, 2.5, 12], font=8)

    # ---------------- hasil
    doc.add_heading("5. Hasil simulasi", level=1)
    D, L, W, V = an["duration"], an["timeLoss"], an["waiting"], an["speed_kmh"]
    table(doc, ["Indikator", "Rata-rata", "p50", "p85", "p95", "Maks"],
          [("Waktu tempuh (s)", n(D.get("mean")), n(D.get("p50")), n(D.get("p85")), n(D.get("p95")), n(D.get("max"))),
           ("Tundaan / timeLoss (s)", n(L.get("mean")), n(L.get("p50")), n(L.get("p85")), n(L.get("p95")), n(L.get("max"))),
           ("Waktu berhenti (s)", n(W.get("mean")), n(W.get("p50")), n(W.get("p85")), n(W.get("p95")), n(W.get("max"))),
           ("Kecepatan perjalanan (km/j)", n(V.get("mean")), n(V.get("p50")), n(V.get("p85")), n(V.get("p95")), n(V.get("max")))], [5, 2.2, 2.2, 2.2, 2.2, 2.2])
    picture(doc, fig_summary(body.get("_summary") or []), 15.5, "Gambar 2. Jumlah kendaraan dan kecepatan rata-rata selama simulasi")
    picture(doc, fig_hist(an.get("hist_duration")), 13.5, "Gambar 3. Sebaran waktu tempuh")
    table(doc, ["Tipe", "n", "Tempuh (s)", "Tundaan (s)", "km/j", "CO₂ g/km", "BBM ml/km", "Wh/km"],
          [(t["type"], n(t["n"], 0), n(t["duration"]), n(t["timeLoss"]), n(t["speed_kmh"]), n(t["co2_g_per_km"], 0), n(t["fuel_ml_per_km"], 0), n(t["elec_wh_per_km"], 0)) for t in an["by_type"]],
          [3.2, 1.3, 2, 2, 1.6, 2, 2, 1.7])
    caption(doc, "Tabel kinerja per jenis kendaraan")

    # ---------------- PKJI
    doc.add_heading("6. Analisis kapasitas menurut PKJI 2023", level=1)
    if not pk:
        doc.add_paragraph("Data pendekat tidak tersedia untuk hasil ini (hasil dari SUMO asli atau hasil lama). Jalankan simulasi di Optimus lalu simpan hasilnya untuk analisis PKJI.")
    else:
        o = pk["options"]
        env = {"KOM": "komersial", "KIM": "permukiman", "AT": "akses terbatas"}.get(o["environment"], o["environment"])
        fr = {"T": "tinggi", "S": "sedang", "R": "rendah"}.get(o["friction"], o["friction"])
        doc.add_paragraph(f"Parameter: jumlah penduduk kota {n(o['population'], 0)} jiwa; lingkungan {env}; hambatan samping {fr}; lebar lajur {n(o['laneWidth'], 2)} m; "
                          f"periode analisis {n(pk['hours'] * 60, 0)} menit setelah pemanasan.")
        doc.add_paragraph("Ekivalen mobil penumpang (EMP) APILL: KR 1,00; KB 1,30; SM 0,15 (pendekat terlindung) / 0,40 (terlawan). "
                          "Arus jenuh dasar S₀ = 600 × Lₑ smp/jam hijau; S = S₀ × F_HS × F_UK × F_G × F_P × F_BKa × F_BKi; C = S × H/c; DJ = q/C.")
        if pk["approaches"]:
            doc.add_heading("Simpang bersinyal (APILL) — per pendekat", level=2)
            rows = [(a["approach"], a["type"][0], f"{a['counts']['KR']}/{a['counts']['KB']}/{a['counts']['SM']}", n(a["q_smp"], 0), n(a["S"], 0), f"{n(a['g'], 0)}/{n(a['cycle'], 0)}",
                     n(a["C"], 0), n(a["DJ"], 2), n(a["T_pkji"]), n(a["T_sim"]), n(a["PA"], 0), n(a["Q_sim_m"], 0)) for a in pk["approaches"]]
            table(doc, ["Pendekat", "Tipe", "KR/KB/SM", "q smp/j", "S", "H/c", "C", "DJ", "T PKJI", "T sim", "PA PKJI (m)", "Antrean sim (m)"], rows,
                  [1.8, 0.9, 2.1, 1.4, 1.3, 1.3, 1.3, 1.1, 1.3, 1.3, 1.6, 1.6], font=7.5)
            picture(doc, fig_dj(pk["approaches"]), 13.5, "Gambar 4. Derajat kejenuhan per pendekat")
            table(doc, ["Simpang", "q total (smp/j)", "DJ maks", "Tundaan PKJI (s/smp)", "LOS PKJI", "Tundaan simulasi (s/smp)", "LOS simulasi"],
                  [(j["tl"], n(j["q"], 0), n(j["maxDJ"], 2), n(j["T_pkji"]), j["los_pkji"], n(j.get("T_sim")), j.get("los_sim") or "–") for j in pk["junctions"]],
                  [2.5, 2.3, 1.8, 2.6, 1.6, 2.8, 1.8], font=8.5)
            doc.add_paragraph("Tingkat pelayanan simpang bersinyal menurut PM Perhubungan No. 96 Tahun 2015 (tundaan rata-rata): "
                              "A ≤ 5; B 5–15; C 15–25; D 25–40; E 40–60; F > 60 detik/SMP.")
        if pk["segments"]:
            doc.add_heading("Ruas jalan perkotaan", level=2)
            table(doc, ["Ruas", "Nama", "Tipe", "Panjang (m)", "q (smp/j)", "C (smp/j)", "DJ"],
                  [(s_["edge"], s_["name"] or "–", s_["type"], n(s_["length"], 0), n(s_["q_smp"], 0), n(s_["C"], 0), n(s_["DJ"], 2)) for s_ in pk["segments"]],
                  [3, 3.2, 3.2, 1.8, 1.8, 1.8, 1.2], font=8.5)
            doc.add_paragraph("Kapasitas ruas: C = C₀ × FC_LJ × FC_PA × FC_HS × FC_UK; C₀ = 1.700 smp/jam/lajur (terbagi/satu arah) atau 2.800 smp/jam (2/2-TT); "
                              "EMP ruas KB 1,2 (2/2-TT 1,3), SM 0,25.")

    # ---------------- pejalan & angkutan umum
    ex = body.get("extra") or {}
    if ex.get("crossings") or ex.get("busStops"):
        doc.add_heading("7. Pejalan kaki dan angkutan umum", level=1)
        if ex.get("crossings"):
            table(doc, ["Penyeberangan", "Jenis", "Pejalan menyeberang", "Tunggu rata-rata (s)"],
                  [(c["id"], {"zebra": "zebra cross", "pelican": "pelican (tombol)", "tls": "ikut lampu simpang"}.get(c["type"], c["type"]), n(c["crossed"], 0), n(c["meanWait"])) for c in ex["crossings"]],
                  [4, 4, 4, 4])
        if ex.get("busStops"):
            table(doc, ["Halte", "Nama", "Kedatangan", "Henti rata-rata (s)"],
                  [(b["id"], b.get("name") or "–", n(b["arrivals"], 0), n(b["dwell"])) for b in ex["busStops"]], [3.5, 6, 3, 3.5])

    # ---------------- perbandingan
    if cmp:
        doc.add_heading("8. Perbandingan dengan skenario lain", level=1)
        lab = [(r.get("note") or ("SUMO" if r["engine"] == "sumo" else "Optimus")) + f" (v{r['version']})" for r in cmp["runs"]]
        rows = []
        for row in cmp["rows"]:
            vals = [n(v) if isinstance(v, (int, float)) else (v or "–") for v in row["values"]]
            d = row["diff_pct"][1] if len(row["diff_pct"]) > 1 else None
            rows.append([row["metric"] + (f" ({row['unit']})" if row["unit"] else "")] + vals + [("+" if d and d > 0 else "") + n(d, 0) + "%" if d is not None else "–"])
        table(doc, ["Indikator", f"{lab[0]} (acuan)"] + lab[1:] + ["Selisih"], rows, None, font=8.5)

    doc.add_heading("Catatan metodologi", level=1)
    for t in ["Simulasi mikroskopik: model car-following Krauss/IDM, perpindahan lajur strategis dan speed-gain, sepeda motor dengan model sublane (dapat menyelip dan berjajar dalam lajur).",
              "Emisi dihitung dengan koefisien yang dikalibrasi terhadap HBEFA3 (mobil, kendaraan berat) dan HBEFA4 (sepeda motor ≤250 cc Euro-3) pada Eclipse SUMO 1.28.",
              "Hasil PKJI menggabungkan rumus PKJI 2023 dengan arus dan komposisi kendaraan dari simulasi; tundaan dan antrean hasil simulasi ditampilkan berdampingan sebagai pembanding.",
              "Hasil bergantung pada data masukan (arus, komposisi, waktu siklus). Kalibrasi dengan data lapangan disarankan sebelum dipakai untuk keputusan."]:
        bullet(doc, t)
    b = io.BytesIO()
    doc.save(b)
    return b.getvalue()


def to_pdf(docx_bytes: bytes) -> bytes:
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        raise RuntimeError("LibreOffice (soffice) tidak terpasang di server untuk konversi PDF")
    d = tempfile.mkdtemp(prefix="optimus_rep_")
    try:
        src = os.path.join(d, "laporan.docx")
        with open(src, "wb") as fh:
            fh.write(docx_bytes)
        prof = "file://" + os.path.join(d, "lo_profile")
        r = subprocess.run([soffice, f"-env:UserInstallation={prof}", "--headless", "--convert-to", "pdf", "--outdir", d, src], capture_output=True, text=True, timeout=180)
        out = os.path.join(d, "laporan.pdf")
        if not os.path.exists(out):
            raise RuntimeError("Konversi PDF gagal: " + (r.stderr or r.stdout)[-400:])
        with open(out, "rb") as fh:
            return fh.read()
    finally:
        shutil.rmtree(d, ignore_errors=True)
