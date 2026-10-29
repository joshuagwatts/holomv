/* HoloMV browser prove-out: drives the real UI in headless Chromium at a
 * phone viewport (390x844) — demo load through the DEMO button, shader
 * compile of the whole library, waveform-seek + playback so the automator
 * crossfades and fires at a real section boundary, code-editor error path
 * through the actual APPLY button, and a REC EXPORT capture asserted on
 * blob size. Serves the app on :8941, boots via a file:// bootstrap page
 * (Chromium 152 local-network rule — see AGENTS.md). */
import { createRequire } from 'module';
import { createServer } from 'http';
import { readFileSync, existsSync, writeFileSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { extname, join, dirname } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(new URL('../../limbo-test/package.json', import.meta.url));
const { chromium } = require('playwright-core');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8941;
const BASE = `http://127.0.0.1:${PORT}/`;
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.md': 'text/plain' };

const server = createServer((req, res) => {
  const clean = req.url.split('?')[0];
  const p = join(ROOT, clean === '/' ? 'index.html' : clean);
  if (!existsSync(p) || !statSync(p).isFile()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(readFileSync(p));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
writeFileSync('/tmp/holomv-bootstrap.html', `<script>location.replace(${JSON.stringify(BASE)})</script>`);

let fails = 0;
const check = (name, cond, extra) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' — ' + extra : ''));
  if (!cond) fails++;
};

// this Chromium build requires the Hatch WebGL domain policy flags
const POLICY_PATH = '/var/lib/hatch-browser/rootfs-base/usr/share/hatch/chromium/webgl-allowed-domains.txt';
const policy = readFileSync(POLICY_PATH);
const POLICY_ARGS = [
  `--hatch-webgl-allowed-domains-file=${POLICY_PATH}`,
  `--hatch-webgl-allowed-domains-sha256=${createHash('sha256').update(policy).digest('hex')}`,
];
const browser = await chromium.launch({
  executablePath: '/opt/meta-chromium/chrome',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--ignore-certificate-errors', '--mute-audio', '--allow-file-access-from-files',
    '--autoplay-policy=no-user-gesture-required', ...POLICY_ARGS],
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => { errors.push(String(e)); console.log('[pageerror]', String(e).slice(0, 220)); });
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 200)); });
let downloadSeen = null;
page.on('download', async (d) => { downloadSeen = d.suggestedFilename(); });

console.log('== boot (phone viewport 390x844)');
await page.goto('file:///tmp/holomv-bootstrap.html');
await page.waitForURL((u) => u.href.startsWith(BASE), { timeout: 20000 });
await page.waitForFunction(() => !!window.__HOLOMV__, null, { timeout: 20000 });
check('debug handle present', true);
check('BUILD stamp = 1', await page.evaluate(() => window.__HOLOMV__.BUILD === 1));

console.log('== shader library compiles');
const comp = await page.evaluate(() => window.__HOLOMV__.compileAll());
console.log('compile results:', comp.map((c) => c.id + ':' + (c.ok ? 'ok' : 'ERR ' + c.error)).join(' '));
check('all built-in shaders compile', comp.length >= 6 && comp.every((c) => c.ok), comp.length + ' shaders');
await page.waitForTimeout(600);
check('no GL errors after renders', await page.evaluate(() => window.__HOLOMV__.state.glErrors === 0));

console.log('== aspect toggle through UI');
await page.click('.aspect-btn[data-aspect="1:1"]');
check('1:1 sets canvas 960x960', await page.evaluate(() => {
  const c = document.getElementById('gl'); return c.width === 960 && c.height === 960;
}));
await page.click('.aspect-btn[data-aspect="9:16"]');
check('9:16 sets canvas 720x1280', await page.evaluate(() => {
  const c = document.getElementById('gl'); return c.width === 720 && c.height === 1280;
}));

console.log('== demo load through DEMO button');
await page.click('#demo-btn');
await page.waitForFunction(() => !!window.__HOLOMV__.state.track, null, { timeout: 90000 });
const tr = await page.evaluate(() => window.__HOLOMV__.state.track);
console.log('track:', JSON.stringify(tr));
check('demo BPM ~128', Math.abs(tr.bpm - 128) <= 4, 'bpm=' + tr.bpm);
check('demo sections >= 3', tr.sections.length >= 3, 'n=' + tr.sections.length);
if (tr.sections.length >= 3) {
  const mid = tr.sections.reduce((a, b) => (b.energy > a.energy ? b : a), tr.sections[0]);
  const midIdx = tr.sections.indexOf(mid);
  check('loudest section is the middle one', midIdx === 1, 'idx=' + midIdx + ' energies=' + tr.sections.map((s) => s.energy).join('/'));
  check('true lengths ~16/32/16', Math.abs(tr.sections[0].lengthBars - 16) <= 4
    && Math.abs(tr.sections[1].lengthBars - 32) <= 6
    && Math.abs(tr.sections[2].lengthBars - 16) <= 4,
    tr.sections.map((s) => s.lengthBars).join('/'));
}
const secDom = await page.locator('#section-list li').count();
check('section list rendered in DOM', secDom === tr.sections.length, 'li=' + secDom);
const chipCount = await page.locator('.shader-chip').count();
check('shader grid rendered', chipCount >= 6, 'chips=' + chipCount);

console.log('== code editor: error keeps old shader, good code applies');
const beforeShader = await page.evaluate(() => window.__HOLOMV__.state.currentShader);
await page.click('.shader-chip[data-id="plasma"] .code-btn');
await page.waitForSelector('#editor:not(.hidden)');
await page.fill('#editor-code', 'void mainImage(out vec4 c, in vec2 f){ c = vec4(BROKEN; }');
await page.click('#editor-apply');
const errTxt = await page.textContent('#editor-error');
check('bad GLSL shows plain error', /⚠/.test(errTxt || ''), (errTxt || '').slice(0, 90));
check('old shader still current after error', await page.evaluate((b) => window.__HOLOMV__.state.currentShader === b, beforeShader));
const goodCode = await page.evaluate(() => window.__HOLOMV__.S.library.find((s) => s.id === 'plasma').code);
await page.fill('#editor-code', goodCode.replace('0.5 + 0.5*cos', '0.55 + 0.45*cos'));
await page.click('#editor-apply');
const okTxt = await page.textContent('#editor-error');
check('fixed GLSL applies', /✓/.test(okTxt || ''), (okTxt || '').slice(0, 60));
await page.click('#editor-close');

console.log('== automator fires at a real boundary during playback');
await page.click('#play-btn');
await page.waitForFunction(() => !document.getElementById('audio').paused, null, { timeout: 10000 });
// seek (via the real waveform) to ~2 bars before the section-2 boundary,
// inside section 1, then let playback carry across it
const seekInfo = await page.evaluate(() => {
  const st = window.__HOLOMV__.state;
  const barDur = (4 * 60) / st.track.bpm;
  const target = st.track.sections[1].startSec - 2 * barDur - 0.1;
  return { ratio: target / st.track.duration, target };
});
const waveBox = await page.locator('#wave').boundingBox();
await page.mouse.click(waveBox.x + waveBox.width * seekInfo.ratio, waveBox.y + waveBox.height / 2);
console.log('seeked via waveform to', seekInfo.target.toFixed(2) + 's');
await page.waitForFunction(() => window.__HOLOMV__.state.mix > 0.25, null, { timeout: 12000 })
  .then(() => check('crossfade mix rides ramp during last bars', true))
  .catch(() => check('crossfade mix rides ramp during last bars', false, 'mix never rose'));
await page.waitForFunction(() => window.__HOLOMV__.state.fireLog.length >= 1, null, { timeout: 20000 })
  .catch(() => {});
const stAfter = await page.evaluate(() => window.__HOLOMV__.state);
console.log('after boundary:', JSON.stringify({ fires: stAfter.fireLog, current: stAfter.currentShader }));
check('automator fired exactly once at the boundary', stAfter.fireLog.length === 1, 'fires=' + stAfter.fireLog.length);
check('fire source is auto into section 2', stAfter.fireLog.length === 1 && stAfter.fireLog[0].source === 'auto' && stAfter.fireLog[0].section === 1);
check('stage switched to the fired shader', stAfter.fireLog.length === 1 && stAfter.currentShader === stAfter.fireLog[0].shaderId,
  'current=' + stAfter.currentShader);
check('energy mode picked an intense shader for the loud section',
  stAfter.fireLog.length === 1 && ['kaleido', 'starforge', 'tunnel', 'plasma'].includes(stAfter.fireLog[0].shaderId),
  stAfter.fireLog.length ? stAfter.fireLog[0].shaderId : 'none');
await page.screenshot({ path: join(ROOT, 'tests/prove-mobile.png') });

console.log('== REC EXPORT produces a real webm');
await page.evaluate(() => { window.__HOLOMV__.S.lastExportBlob = null; });
await page.click('#export-btn');
await page.waitForFunction(() => window.__HOLOMV__.state.exporting, null, { timeout: 10000 });
check('recorder running', true);
await page.waitForTimeout(7000);
await page.click('#export-btn'); // STOP
await page.waitForFunction(() => !!window.__HOLOMV__.state.lastExport, null, { timeout: 20000 })
  .catch(() => {});
const exp = await page.evaluate(() => window.__HOLOMV__.state.lastExport);
console.log('export:', JSON.stringify(exp), 'download event:', downloadSeen);
check('export blob produced', !!exp, exp ? exp.name : 'none');
check('export size > 100 KB', !!exp && exp.size > 100 * 1024, exp ? (exp.size / 1024).toFixed(0) + ' KB' : 'none');
check('export is webm', !!exp && /webm/.test(exp.type || ''), exp ? exp.type : 'none');
check('download fired with holomv- name', !!downloadSeen && /^holomv-.*\.webm$/.test(downloadSeen), String(downloadSeen));

check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
server.close();
console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL BROWSER CHECKS PASSED');
process.exit(fails ? 1 : 0);
