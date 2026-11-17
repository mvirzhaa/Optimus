"""Bangun antarmuka Optimus menjadi satu berkas HTML dan salin inti simulasi ke server Node.
   Jalankan dari folder ini:  python3 build.py"""
import os
here = os.path.dirname(os.path.abspath(__file__))
src = lambda f: open(os.path.join(here, 'src', f), encoding='utf-8').read()
core = ''.join(src(f) for f in ['core_net.js', 'core_sim.js', 'core_io.js'])
ui = ''.join(src(f) for f in ['ui_view.js', 'ui_panels.js', 'ui_server.js', 'ui_compare.js', 'ui_3d.js', 'ui_main.js'])
page = src('template.html').replace('/*CORE*/', core.replace("if (typeof module !== 'undefined') module.exports = SW;", "if (typeof module !== 'undefined') module.exports = SW;\nwindow.SW = SW;")).replace('/*UI*/', ui)
out_html = os.path.join(here, '..', 'node', 'public', 'index.html')
out_core = os.path.join(here, '..', 'node', 'src', 'optimus-core.js')
os.makedirs(os.path.dirname(out_html), exist_ok=True)
open(out_html, 'w', encoding='utf-8').write(page)
open(out_core, 'w', encoding='utf-8').write(core)
print('index.html', len(page) // 1024, 'KB  |  optimus-core.js', len(core) // 1024, 'KB')
