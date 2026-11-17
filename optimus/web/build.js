const fs = require('fs');
const path = require('path');

const here = __dirname;
const src = f => fs.readFileSync(path.join(here, 'src', f), 'utf-8');

const core = ['core_net.js', 'core_sim.js', 'core_io.js'].map(src).join('');
const ui = ['ui_view.js', 'ui_panels.js', 'ui_server.js', 'ui_compare.js', 'ui_3d.js', 'ui_main.js'].map(src).join('');

const page = src('template.html')
  .replace('/*CORE*/', core.replace("if (typeof module !== 'undefined') module.exports = SW;", "if (typeof module !== 'undefined') module.exports = SW;\nwindow.SW = SW;"))
  .replace('/*UI*/', ui);

const outHtml = path.join(here, '..', 'node', 'public', 'index.html');
const outCore = path.join(here, '..', 'node', 'src', 'optimus-core.js');
const rootHtml = path.join(here, '..', '..', 'optimus.html');

fs.mkdirSync(path.dirname(outHtml), { recursive: true });
fs.writeFileSync(outHtml, page, 'utf-8');
fs.writeFileSync(outCore, core, 'utf-8');
if (fs.existsSync(path.dirname(rootHtml))) {
  fs.writeFileSync(rootHtml, page, 'utf-8');
}

console.log(`Build complete:`);
console.log(`- node/public/index.html: ${Math.floor(page.length / 1024)} KB`);
console.log(`- node/src/optimus-core.js: ${Math.floor(core.length / 1024)} KB`);
console.log(`- optimus.html (root): ${Math.floor(page.length / 1024)} KB`);
