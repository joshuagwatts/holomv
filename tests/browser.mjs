/* HoloMV browser prove-out: drives the real UI in headless Chromium at a
 * phone viewport (390x844) — demo load through the DEMO button, shader
 * compile of the whole library, waveform-seek + playback so the automator
 * crossfades and fires at a real section boundary, code-editor error path
 * through the actual APPLY button, and a REC EXPORT capture asserted on
 * blob size. BUILD 2 adds: transformation ticks inside the long section
 * (seed change + visible pixel change + exactly once), CHAOS gating
 * through the slider, the 🎲 dice button (never the same shader twice),
 * and every slider moved through its UI setter changing rendered pixels.
 * Serves the app on :8941, boots via a file:// bootstrap page
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

/* helpers — everything goes through the real UI elements */
const state = () => page.evaluate(() => window.__HOLOMV__.state);
const pixelHash = () => page.evaluate(() => {
  const c = document.getElementById('gl');
  const t = document.createElement('canvas'); t.width = 48; t.height = 48;
  const g = t.getContext('2d'); g.drawImage(c, 0, 0, 48, 48);
  const d = g.getImageData(0, 0, 48, 48).data;
  let h = 0; for (let i = 0; i < d.length; i += 7) h = (h * 31 + d[i]) >>> 0;
  return h;
});
const setRange = (sel, v) => page.evaluate(([s, val]) => {
  const el = document.querySelector(s);
  el.value = val;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, [sel, v]);
const seekToTime = async (t) => {
  const { ratio } = await page.evaluate((tt) => ({ ratio: tt / window.__HOLOMV__.state.track.duration }), t);
  const box = await page.locator('#wave').boundingBox();
  await page.mouse.click(box.x + box.width * ratio, box.y + box.height / 2);
};
const transformsInLog = () => page.evaluate(() =>
  window.__HOLOMV__.state.fireLog.filter((f) => f.source === 'transform').length);
const waitPausedSettled = async () => {
  let prev = await pixelHash();
  for (let i = 0; i < 24; i++) {
    await page.waitForTimeout(300);
    const h = await pixelHash();
    if (h === prev) return h;
    prev = h;
  }
  return prev;
};

console.log('== boot (phone viewport 390x844)');
await page.goto('file:///tmp/holomv-bootstrap.html');
await page.waitForURL((u) => u.href.startsWith(BASE), { timeout: 20000 });
await page.waitForFunction(() => !!window.__HOLOMV__, null, { timeout: 20000 });
check('debug handle present', true);
check('BUILD stamp = 2', await page.evaluate(() => window.__HOLOMV__.BUILD === 2));

console.log('== shader library compiles');
const comp = await page.evaluate(() => window.__HOLOMV__.compileAll());
console.log('compile results:', comp.map((c) => c.id + ':' + (c.ok ? 'ok' : 'ERR ' + c.error)).join(' '));
check('all 10 built-in shaders compile', comp.length === 10 && comp.every((c) => c.ok), comp.length + ' shaders');
await page.waitForTimeout(600);
check('no GL errors after renders', (await state()).glErrors === 0);

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
await page.waitForFunction(() => !!window.__HOLOMV__.state.track, null, { timeout: 120000 });
const tr = (await state()).track;
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
check('shader grid renders all 10 chips', chipCount === 10, 'chips=' + chipCount);

console.log('== code editor: error keeps old shader, good code applies');
const beforeShader = (await state()).currentShader;
await page.click('.shader-chip[data-id="plasma"] .code-btn');
await page.waitForSelector('#editor:not(.hidden)');
await page.fill('#editor-code', 'void mainImage(out vec4 c, in vec2 f){ c = vec4(BROKEN; }');
await page.click('#editor-apply');
const errTxt = await page.textContent('#editor-error');
check('bad GLSL shows plain error', /⚠/.test(errTxt || ''), (errTxt || '').slice(0, 90));
check('old shader still current after error', (await state()).currentShader === beforeShader);
const goodCode = await page.evaluate(() => window.__HOLOMV__.S.library.find((s) => s.id === 'plasma').code);
await page.fill('#editor-code', goodCode.replace('0.5 + 0.5*cos', '0.55 + 0.45*cos'));
await page.click('#editor-apply');
const okTxt = await page.textContent('#editor-error');
check('fixed GLSL applies', /✓/.test(okTxt || ''), (okTxt || '').slice(0, 60));
await page.click('#editor-close');

console.log('== automator fires at a real boundary during playback');
await page.click('#play-btn');
await page.waitForFunction(() => !document.getElementById('audio').paused, null, { timeout: 10000 });
const seekInfo = await page.evaluate(() => {
  const st = window.__HOLOMV__.state;
  const barDur = (4 * 60) / st.track.bpm;
  const target = st.track.sections[1].startSec - 2 * barDur - 0.1;
  return { ratio: target / st.track.duration, target };
});
const waveBox = await page.locator('#wave').boundingBox();
await page.mouse.click(waveBox.x + waveBox.width * seekInfo.ratio, waveBox.y + waveBox.height / 2);
console.log('seeked via waveform to', seekInfo.target.toFixed(2) + 's');
await page.waitForFunction(() => window.__HOLOMV__.state.mix > 0.25, null, { timeout: 15000 })
  .then(() => check('crossfade mix rides ramp during last bars', true))
  .catch(() => check('crossfade mix rides ramp during last bars', false, 'mix never rose'));
await page.waitForFunction(() => window.__HOLOMV__.state.fireLog.filter((f) => f.source === 'auto').length >= 1, null, { timeout: 25000 })
  .catch(() => {});
const stAfter = await state();
const autoFires = stAfter.fireLog.filter((f) => f.source === 'auto');
console.log('after boundary:', JSON.stringify({ fires: autoFires, current: stAfter.currentShader }));
check('automator fired exactly once at the boundary', autoFires.length === 1, 'fires=' + autoFires.length);
check('fire source is auto into section 2', autoFires.length === 1 && autoFires[0].section === 1);
check('stage switched to the fired shader', autoFires.length === 1 && stAfter.currentShader === autoFires[0].shaderId,
  'current=' + stAfter.currentShader);
check('energy mode picked a top-3 match for the loud section',
  autoFires.length === 1 && ['starforge', 'kaleido', 'gridrunner'].includes(autoFires[0].shaderId),
  autoFires.length ? autoFires[0].shaderId : 'none');
await page.screenshot({ path: join(ROOT, 'tests/prove-mobile.png') });

console.log('== BUILD 2: transformation tick inside the long loud section');
// pause, seek (paused) to bar 7 of section 2, resume — tick lands at bar 8
await page.click('#play-btn');
await page.waitForFunction(() => document.getElementById('audio').paused, null, { timeout: 10000 });
const sec2 = tr.sections[1];
const barDur = (4 * 60) / tr.bpm;
await seekToTime(sec2.startSec + 7 * barDur + 0.05);
await page.waitForTimeout(700); // paused seek settles
const seedBeforeTick = (await state()).seed;
await page.click('#play-btn');
await page.waitForFunction(() => !document.getElementById('audio').paused, null, { timeout: 10000 });
const hashBeforeTick = await pixelHash();
await page.waitForFunction(() => window.__HOLOMV__.state.fireLog.some((f) => f.source === 'transform'), null, { timeout: 20000 })
  .catch(() => {});
const nTr1 = await transformsInLog();
const stTick = await state();
check('transformation fired inside the section', nTr1 >= 1, 'transforms=' + nTr1);
check('transformation changed the seed', stTick.seed !== seedBeforeTick, seedBeforeTick + ' -> ' + stTick.seed);
const tlog = stTick.fireLog.find((f) => f.source === 'transform');
check('transform log entry is distinct + readable', !!tlog && /⟳ TRANSFORM · seed \d+/.test(tlog.text || ''), tlog ? tlog.text : 'none');
// let the ~1-bar look fade finish, then confirm pixels really moved
await page.waitForFunction(() => window.__HOLOMV__.state.lookMix >= 1, null, { timeout: 8000 }).catch(() => {});
const hashAfterTick = await pixelHash();
check('rendered pixels changed across the transformation', hashAfterTick !== hashBeforeTick,
  hashBeforeTick + ' -> ' + hashAfterTick);
// keep playing past the fade + a couple of seconds: no second tick yet
await page.waitForTimeout(2500);
check('no double transformation for the same tick', (await transformsInLog()) === nTr1,
  'count=' + (await transformsInLog()));

console.log('== BUILD 2: CHAOS 0 = seed-only transformations');
await page.click('#play-btn'); // pause
await page.waitForFunction(() => document.getElementById('audio').paused, null, { timeout: 10000 });
await setRange('#dial-chaos', 0);
check('CHAOS slider set to 0 through UI', (await state()).dials.chaos === 0);
const trBefore = await transformsInLog();
await seekToTime(sec2.startSec + 15.2 * barDur); // k=1 baselined; tick at bar 16
await page.waitForTimeout(800); // let the paused seek settle before resuming
await page.click('#play-btn'); // play
const firedChaos0 = await page.waitForFunction((n) => window.__HOLOMV__.state.fireLog.filter((f) => f.source === 'transform').length > n,
  trBefore, { timeout: 30000 }).then(() => true).catch(() => false);
const stChaos0 = await state();
const tlog0 = stChaos0.fireLog.filter((f) => f.source === 'transform').pop();
check('chaos-0 transformation fired', firedChaos0 && (await transformsInLog()) === trBefore + 1,
  'before=' + trBefore + ' after=' + (await transformsInLog()));
check('chaos-0 combo is neutral (log says seed only)', !!tlog0 && /seed only/.test(tlog0.text || ''),
  tlog0 ? tlog0.text : 'none');
check('chaos-0 state combo has no mirror/kaleido/invert',
  !!stChaos0.combo && !stChaos0.combo.mirrorX && !stChaos0.combo.mirrorY && !stChaos0.combo.kaleido && !stChaos0.combo.invert,
  JSON.stringify(stChaos0.combo));
await page.click('#play-btn'); // pause again
await page.waitForFunction(() => document.getElementById('audio').paused, null, { timeout: 10000 });

console.log('== BUILD 2: dice through the 🎲 button (paused = immediate)');
await waitPausedSettled();
const hashDice0 = await pixelHash();
// zero the current shader's params through the UI so the auto-dial re-roll is visible
await setRange('#dial-p1', 0.5); await setRange('#dial-p2', 0.5);
const diceSeq = [];
for (let i = 0; i < 2; i++) {
  await page.click('#dice-btn');
  await page.waitForFunction(() => window.__HOLOMV__.state.lookMix >= 1, null, { timeout: 9000 }).catch(() => {});
  await waitPausedSettled();
  diceSeq.push((await state()).currentShader);
}
check('dice changed the shader', diceSeq[0] !== stChaos0.currentShader, stChaos0.currentShader + ' -> ' + diceSeq[0]);
check('dice never repeats the showing shader', diceSeq[1] !== diceSeq[0], diceSeq.join(' -> '));
check('dice changed the rendered pixels', (await pixelHash()) !== hashDice0);
const stDice = await state();
check('AUTO-DIAL re-rolled the new shader params off 0.50/0.50',
  !!stDice.currentParams && (Math.abs(stDice.currentParams.p1 - 0.5) > 0.02 || Math.abs(stDice.currentParams.p2 - 0.5) > 0.02),
  JSON.stringify(stDice.currentParams));

console.log('== BUILD 2: CHAOS high produces pooled transform effects');
await setRange('#dial-chaos', 100);
let sawEffect = false; const combosSeen = [];
for (let i = 0; i < 6 && !sawEffect; i++) {
  await page.click('#dice-btn');
  await page.waitForTimeout(250);
  const c = (await state()).combo;
  combosSeen.push(JSON.stringify(c));
  if (c.kaleido > 0 || c.mirrorX || c.mirrorY || c.invert) sawEffect = true;
}
check('chaos-100 combos include mirror/kaleido/invert within 6 dice', sawEffect, combosSeen.join(' '));
await setRange('#dial-chaos', 50);

console.log('== BUILD 2: dials change pixels through their UI sliders (paused, settled frame)');
// reset the look to neutral-ish for clean per-dial reads
await setRange('#dial-hue', 0); await setRange('#dial-zoom', 1);
await page.click('.shader-chip[data-id="plasma"]');
await page.waitForTimeout(400);
const hBase = await waitPausedSettled();
await setRange('#dial-hue', 140); await page.waitForTimeout(500);
const hHue = await pixelHash();
check('HUE slider changes pixels', hHue !== hBase, hBase + ' -> ' + hHue);
await setRange('#dial-hue', 0); await page.waitForTimeout(400);
const hBase2 = await waitPausedSettled();
await setRange('#dial-zoom', 0.6); await page.waitForTimeout(500);
check('ZOOM slider changes pixels', (await pixelHash()) !== hBase2);
await setRange('#dial-zoom', 1); await page.waitForTimeout(400);
const hBase3 = await waitPausedSettled();
await setRange('#dial-react', 0); await page.waitForTimeout(700);
check('REACT slider changes pixels', (await pixelHash()) !== hBase3);
await setRange('#dial-react', 1); await page.waitForTimeout(400);
const hBase4 = await waitPausedSettled();
const p1Label = await page.textContent('#param1-name');
check('PARAM 1 label is the shader’s own (Plasma = ZOOM)', /ZOOM/.test(p1Label || ''), p1Label);
await setRange('#dial-p1', 0.05); await page.waitForTimeout(500);
check('PARAM 1 slider changes pixels on the active shader', (await pixelHash()) !== hBase4);
await setRange('#dial-p1', 0.5);

console.log('== BUILD 2: SPEED dial drives the shader clock');
await page.click('#play-btn');
await page.waitForFunction(() => !document.getElementById('audio').paused, null, { timeout: 10000 });
/* measure effTime gained per AUDIO second (audio runs at real time; the
 * rAF dt-clamp factor is common to both windows, so the ratio isolates
 * the SPEED multiplier from headless frame-rate noise) */
const effPerAudioSec = async (ms) => {
  const a = await page.evaluate(() => ({
    eff: window.__HOLOMV__.state.effTime, pos: document.getElementById('audio').currentTime,
  }));
  await page.waitForTimeout(ms);
  const b = await page.evaluate(() => ({
    eff: window.__HOLOMV__.state.effTime, pos: document.getElementById('audio').currentTime,
  }));
  return (b.eff - a.eff) / Math.max(0.1, b.pos - a.pos);
};
await setRange('#dial-speed', 1);
await page.waitForTimeout(500);
const rate1 = await effPerAudioSec(2200);
await setRange('#dial-speed', 3);
await page.waitForTimeout(500);
const rate3 = await effPerAudioSec(2200);
/* NB: the absolute eff/audio rate is capped by the headless dt clamp
 * (SwiftShader frames can be ~0.6s apart here -> ceiling ~0.17); the
 * RATIO between the two windows is the multiplier proof. */
check('shader clock advances ~3x faster at SPEED 3', rate1 > 0.05 && rate3 / rate1 > 1.7 && rate3 > rate1 + 0.2,
  'eff/audio @1=' + rate1.toFixed(2) + ' @3=' + rate3.toFixed(2) + ' ratio=' + (rate3 / rate1).toFixed(2));
await setRange('#dial-speed', 1);
await page.click('#play-btn'); // pause
await page.waitForFunction(() => document.getElementById('audio').paused, null, { timeout: 10000 });

console.log('== REC EXPORT produces a real webm');
await page.evaluate(() => { window.__HOLOMV__.S.lastExportBlob = null; });
await page.click('#export-btn');
await page.waitForFunction(() => window.__HOLOMV__.state.exporting, null, { timeout: 10000 });
check('recorder running', true);
await page.waitForTimeout(7000);
await page.click('#export-btn'); // STOP
await page.waitForFunction(() => !!window.__HOLOMV__.state.lastExport, null, { timeout: 20000 })
  .catch(() => {});
const exp = (await state()).lastExport;
console.log('export:', JSON.stringify(exp), 'download event:', downloadSeen);
check('export blob produced', !!exp, exp ? exp.name : 'none');
check('export size > 100 KB', !!exp && exp.size > 100 * 1024, exp ? (exp.size / 1024).toFixed(0) + ' KB' : 'none');
check('export is webm', !!exp && /webm/.test(exp.type || ''), exp ? exp.type : 'none');
check('download fired with holomv- name', !!downloadSeen && /^holomv-.*\.webm$/.test(downloadSeen), String(downloadSeen));

check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
check('no GL errors at end', (await state()).glErrors === 0);

await browser.close();
server.close();
console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL BROWSER CHECKS PASSED');
process.exit(fails ? 1 : 0);
