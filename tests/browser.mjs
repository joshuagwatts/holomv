/* HoloMV browser prove-out: drives the real UI in headless Chromium at a
 * phone viewport (390x844) — demo load through the DEMO button, shader
 * compile of the whole library, waveform-seek + playback so the automator
 * crossfades and fires at a real section boundary, code-editor error path
 * through the actual APPLY button, and a REC EXPORT capture asserted on
 * blob size. BUILD 2 adds: transformation ticks inside the long section
 * (seed change + visible pixel change + exactly once), CHAOS gating
 * through the slider, the 🎲 dice button (never the same shader twice),
 * and every slider moved through its UI setter changing rendered pixels.
 * BUILD 3 adds: the composite transition-style probe (frozen clock,
 * progress 0/mid/1 pixel checks for all 5 styles), 16 looks + 5 overlays
 * compile, JOURNEY arc state (sections start/end in REALITY, boundary
 * fires are stage-locked and log their transition style), live band
 * feel (u_sub moves, kick envelope observed, SUB dial changes pixels
 * through the composite pulse), cooperative overlays (table pairing,
 * energy-backed-off opacity, OFF vs ON pixels), and raymarch looks
 * rendering structured non-black pixels at governor LOW.
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
/* SwiftShader renders this app's shader passes at ~2 fps in this VM, and
 * Playwright's click machinery needs composited frames — real clicks on
 * the real elements routinely take 5-20 s here (measured). Give actions
 * a generous default timeout; every waitForFunction below keeps its own
 * explicit timeout. On a real GPU (the phone) frames are 60 fps. */
page.setDefaultTimeout(90000);
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
const pixelStats = () => page.evaluate(() => {
  const c = document.getElementById('gl');
  const t = document.createElement('canvas'); t.width = 40; t.height = 40;
  const g = t.getContext('2d'); g.drawImage(c, 0, 0, 40, 40);
  const d = g.getImageData(0, 0, 40, 40).data;
  let sum = 0, n = 0; const vals = [];
  for (let i = 0; i < d.length; i += 4) { const v = (d[i] + d[i + 1] + d[i + 2]) / 3; vals.push(v); sum += v; n++; }
  const mean = sum / n;
  let sq = 0; for (const v of vals) sq += (v - mean) * (v - mean);
  return { mean: +mean.toFixed(1), std: +Math.sqrt(sq / n).toFixed(1) };
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
check('BUILD stamp = 3', await page.evaluate(() => window.__HOLOMV__.BUILD === 3));

console.log('== shader library compiles (16 looks + 5 overlays)');
const comp = await page.evaluate(() => window.__HOLOMV__.compileAll());
console.log('compile results:', comp.map((c) => c.id + ':' + (c.ok ? 'ok' : 'ERR ' + c.error)).join(' '));
check('all 16 built-in shaders compile', comp.length === 16 && comp.every((c) => c.ok), comp.length + ' shaders');
const ocomp = await page.evaluate(() => window.__HOLOMV__.compileOverlays());
console.log('overlay compile:', ocomp.map((c) => c.id + ':' + (c.ok ? 'ok' : 'ERR ' + c.error)).join(' '));
check('all 5 overlays compile', ocomp.length === 5 && ocomp.every((c) => c.ok), ocomp.length + ' overlays');
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

console.log('== BUILD 3: transition styles at the composite (frozen clock, no track)');
await page.evaluate(() => window.__HOLOMV__.setOverlaySel('off')); // isolate the transition
const TRANS_NAMES = ['CROSSFADE', 'ZOOM THROUGH', 'DISSOLVE', 'SPIN BLEND', 'GLITCH CUT'];
for (let type = 0; type < 5; type++) {
  await page.evaluate((ty) => window.__HOLOMV__.testComposite({ fromId: 'nebula', toId: 'plasma', type: ty, mix: 0 }), type);
  await page.waitForTimeout(400);
  const hA = await pixelHash(); const mA = (await pixelStats()).mean;
  await page.evaluate(() => { window.__HOLOMV__.S.renderer.setMix(0.5); });
  await page.waitForTimeout(400);
  const hMid = await pixelHash(); const mMid = (await pixelStats()).mean;
  await page.evaluate(() => { window.__HOLOMV__.S.renderer.setMix(1); });
  await page.waitForTimeout(400);
  const hB = await pixelHash(); const mB = (await pixelStats()).mean;
  check(TRANS_NAMES[type] + ': progress 0 / 0.5 / 1 are three distinct frames',
    hA !== hMid && hMid !== hB && hA !== hB, hA + ' / ' + hMid + ' / ' + hB);
  if (type === 0) {
    const lo = Math.min(mA, mB) - 16, hi = Math.max(mA, mB) + 16;
    check('CROSSFADE mid-frame brightness sits between the two looks',
      mMid >= lo && mMid <= hi, 'A=' + mA + ' mid=' + mMid + ' B=' + mB);
  }
}
await page.evaluate(() => {
  window.__HOLOMV__.setFreeze(false);
  window.__HOLOMV__.S.renderer.setMix(0);
  window.__HOLOMV__.setOverlaySel('auto');
});

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
check('shader grid renders all 16 chips', chipCount === 16, 'chips=' + chipCount);

console.log('== BUILD 3: journey state + section annotations');
const jst = (await state()).journey;
console.log('journey:', JSON.stringify(jst));
check('journey stages computed per section', jst.stages.length === tr.sections.length, jst.stages.join('>'));
check('journey starts + ends in REALITY', jst.stages[0] === 'REALITY' && jst.stages[jst.stages.length - 1] === 'REALITY',
  jst.stages.join('>'));
check('opening look is a REALITY look', jst.stageOfCurrentShader === 'REALITY',
  'current=' + (await state()).currentShader + ' stage=' + jst.stageOfCurrentShader);
const liFirst = await page.locator('#section-list li').first().textContent();
check('section list annotates SUB meter + journey stage', /SUB [▮▯]+/.test(liFirst || '') && /REALITY/.test(liFirst || ''),
  (liFirst || '').slice(0, 120));
const journeyLine = await page.textContent('#journey-line');
check('journey progress line renders the arc', /JOURNEY/.test(journeyLine || '') && /FRACTALITY/.test(journeyLine || ''),
  (journeyLine || '').slice(0, 110));
const subNorms = tr.sections.map((s) => s.subNorm);
check('sections carry sub data (subNorm present, loud section sub-heavy)',
  subNorms.every((v) => typeof v === 'number') && Math.max(...subNorms) > 0.9, JSON.stringify(subNorms));

console.log('== BUILD 3: mode button cycles JOURNEY -> ENERGY -> NEXT -> JOURNEY');
// pin render scale down while the heavy REALITY opener is on stage, so
// SwiftShader frames stay short enough for reliable UI clicks
await page.click('.seg-btn[data-quality="low"]');
const modeLabel = () => page.textContent('#mode-toggle');
check('mode starts at JOURNEY', /JOURNEY/.test((await modeLabel()) || ''));
await page.click('#mode-toggle');
check('mode cycles to ENERGY', /ENERGY/.test((await modeLabel()) || ''));
await page.click('#mode-toggle');
check('mode cycles to NEXT', /NEXT/.test((await modeLabel()) || ''));
await page.click('#mode-toggle');
check('mode cycles back to JOURNEY', /JOURNEY/.test((await modeLabel()) || ''));

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
check('JOURNEY: fired look belongs to section 2\u2019s stage',
  autoFires.length === 1 &&
  (stAfter.shaderStages.find((s) => s.id === autoFires[0].shaderId) || {}).stage === stAfter.journey.stages[1],
  'fired=' + (autoFires[0] || {}).shaderId + ' stage=' + ((stAfter.shaderStages.find((s) => s.id === (autoFires[0] || {}).shaderId) || {}).stage) +
  ' want=' + stAfter.journey.stages[1]);
const autoLog = stAfter.fireLog.find((f) => f.source === 'auto');
check('boundary fire logs its transition style',
  !!autoLog && /(CROSSFADE|ZOOM THROUGH|DISSOLVE|SPIN BLEND|GLITCH CUT)/.test(autoLog.text || ''),
  autoLog ? autoLog.text : 'none');
await page.screenshot({ path: join(ROOT, 'tests/prove-mobile.png') });

console.log('== BUILD 3: live band feel on the loud section');
/* in-page probe at rAF cadence — CDP polling is too sparse to catch a
 * decaying kick envelope at headless frame rates */
await page.evaluate(() => {
  window.__feel = { sub: 0, kick: 0, beatEnv: 0, src: '' };
  const loop = () => {
    const b = window.__HOLOMV__.state.bands;
    const f = window.__feel;
    f.sub = Math.max(f.sub, b.sub); f.kick = Math.max(f.kick, b.kick);
    f.beatEnv = Math.max(f.beatEnv, b.beatEnv); f.src = b.source;
    if (f.on) requestAnimationFrame(loop);
  };
  window.__feel.on = true;
  requestAnimationFrame(loop);
});
let feel = { sub: 0, kick: 0, beatEnv: 0, src: '' };
for (let i = 0; i < 60; i++) {
  feel = await page.evaluate(() => window.__feel);
  /* all three must be seen — breaking on sub+kick alone can stop after
   * 1-2 samples (the section-edge kick trigger) before any sample lands
   * near a beat start, leaving beatEnv's max at a late-phase value */
  if (feel.sub > 0.12 && feel.kick > 0.25 && feel.beatEnv > 0.3) break;
  await page.waitForTimeout(300);
}
await page.evaluate(() => { window.__feel.on = false; });
console.log('feel:', JSON.stringify(feel));
check('live u_sub moves on the loud section', feel.sub > 0.10, 'sub=' + feel.sub.toFixed(2));
check('kick envelope observed live', feel.kick > 0.2, 'kick=' + feel.kick.toFixed(2));
check('beat envelope pulses live', feel.beatEnv > 0.6, 'beatEnv=' + feel.beatEnv.toFixed(2));
check('band source is analyser or table', ['analyser', 'table'].includes(feel.src), feel.src);

console.log('== BUILD 2: transformation tick inside the long loud section');
// pause, seek (paused) to bar 7 of section 2, resume — tick lands at bar 8
await page.click('#play-btn');
await page.waitForFunction(() => document.getElementById('audio').paused, null, { timeout: 10000 });
const sec2 = tr.sections[1];
const barDur = (4 * 60) / tr.bpm;
await setRange('#dial-p1', 0.5); await setRange('#dial-p2', 0.5); // known params, so the transform's AUTO-DIAL re-roll is visible
await seekToTime(sec2.startSec + 7 * barDur + 0.05);
await page.waitForTimeout(700); // paused seek settles
/* baseline AFTER the seek settles: earlier playback (boundary/feel blocks)
 * can legitimately have logged a transform on its own bar-8 tick — key the
 * assertions below on a NEW transform past this count, not the stale entry */
const nTrBefore = await transformsInLog();
const seedBeforeTick = (await state()).seed;
await page.click('#play-btn');
await page.waitForFunction(() => !document.getElementById('audio').paused, null, { timeout: 10000 });
const hashBeforeTick = await pixelHash();
await page.waitForFunction((n) => window.__HOLOMV__.state.fireLog.filter((f) => f.source === 'transform').length > n,
  nTrBefore, { timeout: 20000 })
  .catch(() => {});
const nTr1 = await transformsInLog();
const stTick = await state();
check('transformation fired inside the section', nTr1 > nTrBefore, 'transforms=' + nTr1 + ' baseline=' + nTrBefore);
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
const stAutoDial = await state();
check('AUTO-DIAL re-rolled params on the transformation',
  !!stAutoDial.currentParams && (Math.abs(stAutoDial.currentParams.p1 - 0.5) > 0.02 || Math.abs(stAutoDial.currentParams.p2 - 0.5) > 0.02),
  JSON.stringify(stAutoDial.currentParams));

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

console.log('== BUILD 3: SUB dial drives the composite pulse (paused, sub-heavy frame)');
// park on a fresh kick at a loud-section bar start (sub peak in the table)
await seekToTime(sec2.startSec + 16 * barDur + 0.03);
await page.waitForTimeout(1200); // tracker settles onto the table bands here
const subHere = (await state()).bands.sub;
check('parked frame has real sub to feel', subHere > 0.05, 'u_sub=' + subHere.toFixed(2));
await setRange('#dial-react', 2);
await setRange('#dial-sub', 0);
await page.waitForTimeout(450);
const hashSub0 = await pixelHash();
await setRange('#dial-sub', 2);
await page.waitForTimeout(450);
const hashSub2 = await pixelHash();
check('SUB dial 0 vs 2 changes pixels (composite zoom pulse)', hashSub0 !== hashSub2, hashSub0 + ' -> ' + hashSub2);
await setRange('#dial-sub', 1); await setRange('#dial-react', 1);
await page.waitForTimeout(300);

console.log('== BUILD 3: cooperative overlays (pairing, energy cap, pixels)');
const stOv0 = await state();
check('AUTO overlay is paired from the table for the current main stage',
  !!stOv0.overlay.id && stOv0.overlay.allowedForCurrent.includes(stOv0.overlay.id),
  JSON.stringify(stOv0.overlay));
await seekToTime(tr.sections[0].startSec + 2);
await page.waitForTimeout(800);
const opCalm = (await state()).overlay.opacity;
await seekToTime(sec2.startSec + 16 * barDur + 0.03);
await page.waitForTimeout(800);
const opLoud = (await state()).overlay.opacity;
check('overlay opacity backs off as section energy rises', opCalm > opLoud + 0.02,
  'calm=' + opCalm.toFixed(3) + ' loud=' + opLoud.toFixed(3));
await page.selectOption('#overlay-select', 'off');
await page.waitForTimeout(600);
const stOvOff = await state();
check('overlay OFF clears the pairing', !stOvOff.overlay.id && stOvOff.overlay.opacity === 0,
  JSON.stringify(stOvOff.overlay));
const hashOvOff = await pixelHash();
await page.selectOption('#overlay-select', 'auto');
await page.waitForFunction(() => window.__HOLOMV__.state.overlay.mix >= 1, null, { timeout: 14000 }).catch(() => {});
await page.waitForTimeout(400);
const stOvOn = await state();
check('overlay AUTO re-pairs from the table', !!stOvOn.overlay.id && stOvOn.overlay.allowedForCurrent.includes(stOvOn.overlay.id),
  JSON.stringify(stOvOn.overlay));
check('overlay ON changes pixels vs OFF', (await pixelHash()) !== hashOvOff);

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
const rate1 = await effPerAudioSec(4500);
await setRange('#dial-speed', 3);
await page.waitForTimeout(500);
const rate3 = await effPerAudioSec(4500);
/* NB: the absolute eff/audio rate is capped by the headless dt clamp
 * (SwiftShader frames can be ~0.6s apart here -> ceiling ~0.17); the
 * RATIO between the two windows is the multiplier proof. (An earlier
 * additive rate3 > rate1 + 0.2 clause assumed an absolute scale the
 * clamp does not guarantee at ~1 fps and failed spuriously at ratio
 * 2.38; the ratio is the assertion.) */
check('shader clock advances ~3x faster at SPEED 3', rate1 > 0.05 && rate3 / rate1 > 1.7,
  'eff/audio @1=' + rate1.toFixed(2) + ' @3=' + rate3.toFixed(2) + ' ratio=' + (rate3 / rate1).toFixed(2));
await setRange('#dial-speed', 1);
await page.click('#play-btn'); // pause
await page.waitForFunction(() => document.getElementById('audio').paused, null, { timeout: 10000 });

console.log('== BUILD 3: raymarch looks render structured pixels (governor LOW)');
await page.click('.seg-btn[data-quality="low"]');
check('QUALITY LOW pins the governor scale at 0.5', (await state()).governor.scale === 0.5,
  'scale=' + (await state()).governor.scale);
await page.click('.shader-chip[data-id="highlands"]');
await page.waitForTimeout(2200);
const stHigh = await pixelStats();
check('Fractal Highlands: non-black, structured pixels', stHigh.mean > 4 && stHigh.std > 7, JSON.stringify(stHigh));
await page.click('.shader-chip[data-id="mandelbulb"]');
await page.waitForTimeout(3000);
const stBulb = await pixelStats();
check('Mandelbulb: non-black, structured pixels', stBulb.mean > 4 && stBulb.std > 7, JSON.stringify(stBulb));
await page.click('.seg-btn[data-quality="auto"]');
check('no GL errors after raymarch looks', (await state()).glErrors === 0);
// back to a light look for the export capture (export restarts at 0 and
// the automator will not fire until the first boundary at ~30 s)
await page.click('.shader-chip[data-id="nebula"]');
await page.waitForTimeout(600);

console.log('== REC EXPORT produces a real webm');
await page.evaluate(() => { window.__HOLOMV__.S.lastExportBlob = null; });
await page.click('#export-btn');
await page.waitForFunction(() => window.__HOLOMV__.state.exporting, null, { timeout: 10000 });
check('recorder running', true);
const ovDuring = (await state()).overlay;
check('cooperative overlay is active inside the export composite', !!ovDuring.id && ovDuring.opacity > 0,
  JSON.stringify(ovDuring));
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
