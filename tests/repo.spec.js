// Repository consistency (Node only, no browser): cache-buster, file references, generated properties, project.json
const { test, expect } = require('@playwright/test');
const fs = require('fs'), path = require('path');

const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const html = read('index.html');

test('every script / stylesheet in index.html carries the same ?v= cache-buster, and CLAUDE.md names it', () => {
  const vs = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))\?v=(\d+)"/g)].map(m => [m[1], m[2]]);
  expect(vs.length).toBeGreaterThan(10);
  const v = vs[0][1];
  for (const [f, n] of vs) expect(n, `${f} ?v=`).toBe(v);
  // three.min.js is vendored and never changes: it is the only local asset allowed without a cache-buster
  const bare = [...html.matchAll(/(?:src|href)="(js\/[^"?]+\.js|[^"?:]+\.css)"/g)].map(m => m[1]).filter(f => f !== 'js/three.min.js');
  expect(bare, 'local scripts / styles without ?v=').toEqual([]);
  expect(read('CLAUDE.md'), 'CLAUDE.md "Current: v=N"').toContain('Current: `v=' + v + '`');
});

test('every file referenced by index.html exists and every js/ file is loaded', () => {
  const refs = [...html.matchAll(/(?:src|href)="([^"?#:]+)(?:\?[^"]*)?"/g)].map(m => m[1]);
  for (const f of refs) expect(fs.existsSync(path.join(root, f)), f).toBe(true);
  const loaded = new Set(refs.filter(f => f.startsWith('js/')));
  for (const f of fs.readdirSync(path.join(root, 'js'))) expect(loaded.has('js/' + f), `js/${f} is loaded by index.html`).toBe(true);
});

test('scripts load in the order documented in CLAUDE.md', () => {
  const order = [...html.matchAll(/src="js\/([\w.]+)\.js/g)].map(m => m[1]);
  expect(order[0]).toBe('three.min');
  const doc = /`(core(?: → \w+)+)`/.exec(read('CLAUDE.md'));
  expect(doc, 'load order line in CLAUDE.md').toBeTruthy();
  expect(order.slice(1)).toEqual(doc[1].split(' → '));
  expect(order[order.length - 1]).toBe('settings');
});

test('js/properties.js is generated from project.json (run tools/gen_properties.py)', () => {
  const props = JSON.parse(read('project.json')).general.properties;
  const src = read('js/properties.js');
  const m = /const WE_PROPERTIES = ([\s\S]*);\s*$/.exec(src);
  expect(m, 'WE_PROPERTIES literal').toBeTruthy();
  expect(JSON.parse(m[1])).toEqual(props);
});

test('project.json is a complete Wallpaper Engine web project', () => {
  const p = JSON.parse(read('project.json'));
  expect(p.type).toBe('web');
  expect(p.file).toBe('index.html');
  expect(fs.existsSync(path.join(root, p.preview)), 'preview image').toBe(true);
  for (const k of ['title', 'description']) expect(p[k], k).toBeTruthy();
  expect(p.general.supportsaudioprocessing).toBe(true);
  for (const [k, prop] of Object.entries(p.general.properties)) {
    expect(typeof prop.order, `${k}.order`).toBe('number');
    expect(prop.text, `${k}.text`).toBeTruthy();
    expect(['bool', 'slider', 'combo', 'color', 'textinput'], `${k}.type`).toContain(prop.type);
    if (prop.type === 'slider') { expect(prop.min).toBeLessThanOrEqual(prop.value); expect(prop.value).toBeLessThanOrEqual(prop.max); }
    if (prop.type === 'combo') expect(prop.options.map(o => o.value), `${k} default is an option`).toContain(prop.value);
  }
});

test('every WE property is read by applyUserProperties', () => {
  const props = Object.keys(JSON.parse(read('project.json')).general.properties).filter(k => k !== 'schemecolor');
  const main = read('js/main.js');
  for (const k of props) expect(main, `has('${k}') in main.js`).toContain(`has('${k}')`);
});
