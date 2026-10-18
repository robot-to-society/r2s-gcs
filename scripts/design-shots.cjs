#!/usr/bin/env node
/* Retake the Glass prototype's reference screenshots (docs/spec/10-screens.md, design_base/screenshots/glass_*.png).
 * Run after editing design_base/project/RGCS Prototype Glass.dc.html:
 *
 *     node scripts/design-shots.cjs                 # all shots → design_base/screenshots/
 *     node scripts/design-shots.cjs --only network  # names containing "network"
 *     node scripts/design-shots.cjs --out /tmp/shots
 *
 * Needs the UI's dev dependencies (apps/rgcs-server/ui: npm install) for Playwright and Google Chrome installed
 * (the bundled headless shell cannot render the 3D map). Map tiles and fonts are fetched from the internet.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { createRequire } = require('module');

const ROOT = path.resolve(__dirname, '..');
const PROJECT = path.join(ROOT, 'design_base/project');
const PAGE = 'RGCS Prototype Glass.dc.html';
const VIEWPORT = { width: 1440, height: 813 };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

// Every shot starts from BASE, then applies its own state. `extra` names a step that needs more than setState.
const BASE = { view: 'ops', right: 'detail', modal: null, maxVideo: null, follow: null, mapMode: '2d', selectedId: 'UAV-03',
  userPop: false, logOpen: false, camProject: false, netSel: 'hub', netDemo: false, elevOpen: false, lang: 'ja' };
const SHOTS = [
  ['glass_ops_2d', {}], ['glass_ops_camera', {}],
  ['glass_ops_camera_mavlink', { selectedId: 'UAV-02' }], ['glass_ops_camera_none', { selectedId: 'UAV-04' }],
  ['glass_ops_commands', { modal: 'commands' }], ['glass_ops_ai', { right: 'ai' }], ['glass_user_pop', { userPop: true }],
  ['glass_ops_log', { logOpen: true }],
  ['glass_ops_3d_follow', { mapMode: '3d', follow: 'UAV-03' }],
  ['glass_ops_3d_gimbal', { mapMode: '3d' }, 'gimbal'], ['glass_ops_3d_gimbal_projected', { mapMode: '3d', camProject: true }, 'gimbalProj'],
  ['glass_ops_2d_gimbal_projected', { camProject: true }, 'gimbal2d'],
  ['glass_camera_settings_conn', {}, 'cam:conn'], ['glass_camera_settings_input', {}, 'cam:input'],
  ['glass_camera_settings_roi', {}, 'cam:roi'], ['glass_camera_settings_video', {}, 'cam:video'],
  ['glass_video_grid', { view: 'video' }], ['glass_cockpit_rgb', { view: 'video', maxVideo: 'UAV-03' }],
  ['glass_cockpit_ir', { view: 'video', maxVideo: 'UAV-01', selectedId: 'UAV-01' }],
  ['glass_cockpit_mavlink', { view: 'video', maxVideo: 'UAV-02', selectedId: 'UAV-02' }],
  ['glass_mission_2d', { view: 'mission' }], ['glass_mission_3d', { view: 'mission', mapMode: '3d', elevOpen: true }],
  ['glass_maint_params', { view: 'maint', maintTab: 'params' }], ['glass_maint_log', { view: 'maint', maintTab: 'log' }],
  ['glass_maint_app', { view: 'maint', maintTab: 'app' }],
  ['glass_network', { view: 'network' }], ['glass_network_route', { view: 'network', netSel: 'v:UAV-04' }],
  ['glass_network_field', { view: 'network', netSel: 'f:A' }],
  ['glass_network_100_sites', { view: 'network', netDemo: true }], ['glass_network_100_compact', { view: 'network', netDemo: true }, 'zoom:0.45'],
  ['glass_network_100_detail', { view: 'network', netDemo: true }, 'zoom:1'],
  ['glass_login', {}, 'login'],
];

function args() {
  const a = process.argv.slice(2), get = k => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  return { only: get('--only'), out: path.resolve(get('--out') || path.join(ROOT, 'design_base/screenshots')) };
}

function loadPlaywright() {
  try {
    return createRequire(path.join(ROOT, 'apps/rgcs-server/ui/package.json'))('playwright');
  } catch (e) {
    throw new Error('Playwright not found: run `npm install` in apps/rgcs-server/ui first');
  }
}

// Static server for design_base/project (the prototype fetches support.js and assets relative to the page).
function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
    const file = path.resolve(PROJECT, rel);
    if (!file.startsWith(PROJECT + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, body) => {
      if (err) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' }).end(body);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// Wait until the map (when there is one) has loaded its tiles and stopped moving.
async function settle(page) {
  await page.waitForTimeout(800);
  await page.waitForFunction(() => { const r = window.__rgcs, m = r && r.map;
    return !m || (r._mapReady && m.loaded() && m.areTilesLoaded() && !m.isMoving()); }, null, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(1500);
}

async function applyExtra(page, extra) {
  if (extra.startsWith('cam:')) {
    await page.evaluate(tab => window.__rgcs.openCamera(tab), extra.slice(4));
    await page.waitForTimeout(900);
  } else if (extra.startsWith('gimbal')) {
    // UAV-03 looks 30° left; the projected shots point it down so the footprint lands near the vehicle
    await page.evaluate(x => { const r = window.__rgcs, v = r.byName('UAV-03');
      v.camera = { ...v.camera, zoom: 1.5, roi: { active: null }, att: { yaw: -30, pitch: x === 'gimbal' ? -10 : -40 } };
      r.setState({ tick: r.state.tick + 1 });
      r.map.jumpTo(x === 'gimbal2d' ? { center: [v.lng, v.lat], zoom: 16.4 }
        : { center: [v.lng + 0.0006, v.lat + 0.0006], zoom: 16.8, pitch: 60, bearing: 70 }); }, extra);
    await settle(page);
  } else if (extra.startsWith('zoom:')) {
    await page.evaluate(k => { const r = window.__rgcs, rc = r._netEl.getBoundingClientRect();
      r.netZoomAt(k / r._nv.k, rc.width * 0.18, rc.height * 0.45); }, Number(extra.slice(5)));
    await page.waitForTimeout(900);
  }
}

async function main() {
  const { only, out } = args();
  const shots = SHOTS.filter(([name]) => !only || name.includes(only));
  if (!shots.length) throw new Error(`no shot matches --only ${only}`);
  fs.mkdirSync(out, { recursive: true });
  const { chromium } = loadPlaywright();
  const server = await serve();
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--headless=new'] })
    .catch(e => { server.close(); throw new Error(`Google Chrome is required (${e.message.split('\n')[0]})`); });
  try {
    const page = await browser.newPage({ viewport: VIEWPORT });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/${encodeURIComponent(PAGE)}#debug`);
    await page.waitForFunction(() => window.__rgcs, null, { timeout: 30000 });
    await page.evaluate(() => { const r = window.__rgcs; r.setState({ loginUser: 'admin', loginPass: 'admin' }, () => r.login()); });
    await settle(page);
    // the gimbal shots change vehicle cameras; every shot restores the fixture first
    await page.evaluate(() => { window.__camFixture = JSON.stringify(window.__rgcs.vehicles.map(v => v.camera)); });
    for (const [name, state, extra] of shots) {
      if (extra === 'login') {
        await page.evaluate(() => window.__rgcs.logout());
        await page.waitForTimeout(1200);
      } else {
        await page.evaluate(([base, st]) => { const r = window.__rgcs;
          JSON.parse(window.__camFixture).forEach((c, i) => { r.vehicles[i].camera = c; });
          if (r._nv) r._nv.fit = true;
          r.setState({ ...base, ...st }); }, [BASE, state]);
        await settle(page);
        if (extra) await applyExtra(page, extra);
      }
      await page.screenshot({ path: path.join(out, `${name}.png`) });
      console.log(`wrote ${path.relative(ROOT, path.join(out, `${name}.png`))}`);
    }
    if (errors.length) { console.error('page errors:\n  ' + errors.join('\n  ')); process.exitCode = 1; }
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(e => { console.error(`design-shots: ${e.message}`); process.exit(1); });
