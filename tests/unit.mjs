/* HoloMV unit prove-out (Node, headless):
 * 1) Synthetic 128 BPM buffer (16 quiet / 32 loud / 16 quiet bars) ->
 *    TempoDetect finds ~128, RmsAnalyze finds >=3 sections with the loud
 *    middle clearly above the quiet ends and true bar lengths.
 * 2) Automator replay over the section map: exactly one fire per boundary
 *    on continuous playback; ramp 0 outside the last-4-bars window and
 *    rising inside it; ZERO fires on seek, on pause-scrub, on subscribe.
 * 3) BUILD 2: ENERGY picks are weighted-random among the 3 closest energy
 *    tags (never the current shader); transformation ticks fire exactly
 *    once per N bars inside a section, never on seek/pause, boundary wins
 *    over a coincident tick; transform combos are CHAOS-gated (0 = seed
 *    only, invert only above 0.7). */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
globalThis.window = globalThis;
for (const f of ['js/tempo.js', 'js/rms.js', 'js/automator.js', 'js/transforms.js']) {
  eval(readFileSync(join(ROOT, f), 'utf8'));
}
const { TempoDetect, RmsAnalyze, Automator, HoloTransforms } = globalThis;

let fails = 0;
const check = (name, cond, extra) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' — ' + extra : ''));
  if (!cond) fails++;
};

/* ---- synthetic buffer: 128 BPM, sections 16q / 32L / 16q (64 bars) ---- */
const SR = 22050, BPM = 128;
const beatDur = 60 / BPM, barDur = beatDur * 4;
const sectionBars = [16, 32, 16], sectionAmp = [0.14, 0.9, 0.14];
const totalBars = sectionBars.reduce((a, b) => a + b, 0);
const dur = totalBars * barDur;
const len = Math.floor(SR * dur);
const data = new Float32Array(len);
const ampAt = (t) => {
  const bar = Math.floor(t / barDur);
  let acc = 0;
  for (let s = 0; s < 3; s++) { if (bar < acc + sectionBars[s]) return sectionAmp[s]; acc += sectionBars[s]; }
  return sectionAmp[2];
};
for (let i = 0; i < len; i++) {
  const t = i / SR;
  data[i] = Math.sin(2 * Math.PI * 110 * t) * ampAt(t) * 0.35; // pad body
}
const nBeats = Math.floor(dur / beatDur);
for (let b = 0; b < nBeats; b++) {
  const t0 = b * beatDur, s0 = Math.floor(t0 * SR), amp = ampAt(t0);
  for (let i = 0; i < SR * 0.25; i++) {
    const lt = i / SR;
    data[s0 + i] += Math.sin(2 * Math.PI * 58 * lt) * amp * Math.exp(-lt * 16);
  }
}
const fakeBuffer = {
  length: len, sampleRate: SR, numberOfChannels: 1, duration: dur,
  getChannelData: () => data,
};

/* ---- tempo + rms ---- */
const tempo = TempoDetect.detect(fakeBuffer);
console.log('tempo:', JSON.stringify(tempo));
check('BPM detected ~128', Math.abs(tempo.bpm - 128) <= 2, 'got ' + tempo.bpm);
const rms = RmsAnalyze.analyzeSections(fakeBuffer, tempo.bpm, tempo.beatOffsetSec);
console.log('sections:', JSON.stringify(rms.sections));
check('>=3 sections found', rms.sections.length >= 3, 'got ' + rms.sections.length);
if (rms.sections.length >= 3) {
  const [a, b, c] = rms.sections;
  check('loud middle energy > quiet ends', b.energy > a.energy + 0.25 && b.energy > c.energy + 0.25,
    `energies ${a.energy}/${b.energy}/${c.energy}`);
  check('first section ~16 bars', Math.abs(a.lengthBars - 16) <= 3, 'got ' + a.lengthBars);
  check('middle section ~32 bars', Math.abs(b.lengthBars - 32) <= 4, 'got ' + b.lengthBars);
  check('last section ~16 bars', Math.abs(c.lengthBars - 16) <= 3, 'got ' + c.lengthBars);
}

/* ---- automator replay ---- */
const LIB = [
  { id: 'nebula', energy: 0.15 }, { id: 'orbital', energy: 0.25 },
  { id: 'flowfield', energy: 0.32 }, { id: 'fractal', energy: 0.40 },
  { id: 'plasma', energy: 0.5 }, { id: 'chrome', energy: 0.58 },
  { id: 'tunnel', energy: 0.66 }, { id: 'gridrunner', energy: 0.75 },
  { id: 'kaleido', energy: 0.85 }, { id: 'starforge', energy: 0.96 },
];
const sections = rms.sections.length >= 3 ? rms.sections
  : [{ startBar: 0, lengthBars: 16, energy: 0.15, startSec: 0 },
     { startBar: 16, lengthBars: 32, energy: 0.95, startSec: 30 },
     { startBar: 48, lengthBars: 16, energy: 0.15, startSec: 90 }];
const useBpm = rms.sections.length >= 3 ? tempo.bpm : 128;
const useOffset = rms.sections.length >= 3 ? tempo.beatOffsetSec : 0;

function makeAuto(fires, mode, extra) {
  const a = new Automator({
    enabled: true, mode: mode || 'energy',
    onFire: (id, idx) => fires.push({ id, idx }),
    ...(extra || {}),
  });
  a.setTrack(sections, useBpm, useOffset);
  a.setLibrary(LIB);
  a.setCurrent('nebula', false);
  return a;
}

// continuous playback across the whole track
{
  const fires = [];
  const a = makeAuto(fires);
  const step = 1 / 30;
  let rampBeforeWindow = null, rampInWindow = null;
  const s0 = sections[0], barD = (4 * 60) / useBpm;
  const windowStart = s0.startSec + (s0.lengthBars - 4) * barD;
  for (let t = 0; t < dur - 0.2; t += step) {
    const out = a.update(t, true, t * 1000);
    if (t < windowStart - 0.5 && rampBeforeWindow === null) rampBeforeWindow = out.rampProgress;
    if (t > windowStart + barD && t < windowStart + barD * 2 && rampInWindow === null) rampInWindow = out.rampProgress;
  }
  check('fires == boundaries', fires.length === sections.length - 1,
    `fires=${fires.length} boundaries=${sections.length - 1} ` + JSON.stringify(fires));
  check('fire targets are sections 1..n-1', fires.every((f, i) => f.idx === i + 1), JSON.stringify(fires.map((f) => f.idx)));
  check('no double-fire of same target', new Set(fires.map((f) => f.idx)).size === fires.length);
  check('energy mode: boundary into loud picks a top-3 energy match',
    fires.length && ['starforge', 'kaleido', 'gridrunner'].includes(fires[0].id), fires.length ? fires[0].id : 'none');
  check('ramp 0 before window', rampBeforeWindow === 0, 'got ' + rampBeforeWindow);
  check('ramp rising inside window', rampInWindow !== null && rampInWindow > 0.05 && rampInWindow < 1, 'got ' + rampInWindow);
}

// seek: no fire
{
  const fires = [];
  const a = makeAuto(fires);
  for (let t = 0; t < 10; t += 1 / 30) a.update(t, true, t * 1000);
  a.update(70, true, 10_000 + 33);           // jump across boundary while "playing"
  for (let t = 70; t < 74; t += 1 / 30) a.update(t, true, (10 + (t - 70)) * 1000);
  check('seek across boundary: no fire', fires.length === 0, 'fires=' + fires.length);
}

// pause-scrub + subscribe baseline: no fire
{
  const fires = [];
  const a = makeAuto(fires);
  a.update(50, false, 0);                     // subscribe mid-track, paused
  a.update(95, false, 500);                   // scrub across a boundary while paused
  for (let t = 95; t < 99; t += 1 / 30) a.update(t, false, 500 + (t - 95) * 1000);
  check('paused scrub/subscribe: no fire', fires.length === 0, 'fires=' + fires.length);
}

// next mode: library order (BUILD 2 library: nebula -> orbital -> flowfield)
{
  const fires = [];
  const a = makeAuto(fires, 'next');
  for (let t = 0; t < dur - 0.2; t += 1 / 30) a.update(t, true, t * 1000);
  check('NEXT mode fires in library order',
    fires.length === sections.length - 1 && fires[0].id === 'orbital' && (fires.length < 2 || fires[1].id === 'flowfield'),
    JSON.stringify(fires.map((f) => f.id)));
}

// automator disabled: no fire
{
  const fires = [];
  const a = makeAuto(fires);
  a.enabled = false;
  for (let t = 0; t < dur - 0.2; t += 1 / 30) a.update(t, true, t * 1000);
  check('disabled automator: no fires', fires.length === 0, 'fires=' + fires.length);
}

/* ---- BUILD 2: ENERGY weighted-random pick ---- */
{
  const mk = (rand) => {
    const a = new Automator({ enabled: true, mode: 'energy', random: rand, onFire: () => {} });
    a.setTrack([{ startBar: 0, lengthBars: 16, energy: 0.5, startSec: 0 }], 128, 0);
    a.setLibrary(LIB);
    a.setCurrent('starforge', false);
    return a;
  };
  // target energy 0.5, current starforge: closest 3 = plasma(0) chrome(.08) fractal(.10)
  check('energy pick rng=0 -> closest (plasma)', mk(() => 0).pickFor(0) === 'plasma');
  check('energy pick rng=0.5 -> 2nd closest (chrome)', mk(() => 0.5).pickFor(0) === 'chrome');
  check('energy pick rng=0.99 -> 3rd closest (fractal)', mk(() => 0.99).pickFor(0) === 'fractal');
  const a2 = mk(() => 0); a2.setCurrent('plasma', false);
  check('energy pick never returns the current shader', a2.pickFor(0) !== 'plasma', a2.pickFor(0));
  let varied = new Set();
  const a3 = mk(Math.random);
  for (let i = 0; i < 60; i++) varied.add(a3.pickFor(0));
  check('energy pick varies across the top-3 pool', varied.size >= 2 && [...varied].every((id) => ['plasma', 'chrome', 'fractal'].includes(id)),
    [...varied].join(','));
}

/* ---- BUILD 2: transformation ticks ---- */
const FIXED = [
  { startBar: 0, lengthBars: 16, energy: 0.15, startSec: 0 },
  { startBar: 16, lengthBars: 32, energy: 0.95, startSec: 30 },
  { startBar: 48, lengthBars: 16, energy: 0.15, startSec: 90 },
];
function makeFixed(transforms, extra) {
  const a = new Automator({
    enabled: true, mode: 'energy', transformEvery: 8,
    onFire: () => {}, onTransform: (e) => transforms.push(e), ...(extra || {}),
  });
  a.setTrack(FIXED, 128, 0);
  a.setLibrary(LIB);
  a.setCurrent('nebula', false);
  return a;
}
{
  const tr = [];
  const a = makeFixed(tr);
  for (let t = 0; t < 119.5; t += 1 / 30) a.update(t, true, t * 1000);
  // sec0 (16 bars): tick at bar 8 -> 1; sec1 (32): bars 8/16/24 -> 3; sec2 (16): bar 8 -> 1
  check('transform ticks: 5 across 16/32/16 at every-8', tr.length === 5,
    'got ' + tr.length + ' ' + JSON.stringify(tr));
  check('transform ticks land in the right sections',
    JSON.stringify(tr.map((e) => e.sectionIndex)) === '[0,1,1,1,2]', JSON.stringify(tr.map((e) => e.sectionIndex)));
}
{
  // seek skips ticks silently; the next tick after the seek still fires once
  const tr = [];
  const a = makeFixed(tr);
  for (let t = 0; t < 10; t += 1 / 30) a.update(t, true, t * 1000);
  a.update(50, true, 10_033); // seek into section 2 (barIn ~10.7 -> k=1 baselined)
  for (let t = 50; t < 66; t += 1 / 30) a.update(t, true, (10 + (t - 50)) * 1000);
  check('seek: tick under the playhead consumed, later tick fires once', tr.length === 1,
    'got ' + tr.length + ' ' + JSON.stringify(tr));
}
{
  // paused: no transforms even while position scrubs across tick points
  const tr = [];
  const a = makeFixed(tr);
  a.update(0, false, 0);
  a.update(20, false, 400); a.update(45, false, 800); a.update(100, false, 1200);
  check('paused scrub: no transforms', tr.length === 0, 'got ' + tr.length);
}
{
  // boundary wins: sections 16/16 with every-4 — the update that crosses
  // the boundary emits a fire, not a transform, and no transform is
  // double-counted around it
  const tr = [], fr = [];
  const a = new Automator({
    enabled: true, mode: 'next', transformEvery: 4,
    onFire: (id, idx) => fr.push(idx), onTransform: (e) => tr.push(e),
  });
  a.setTrack([
    { startBar: 0, lengthBars: 16, energy: 0.2, startSec: 0 },
    { startBar: 16, lengthBars: 16, energy: 0.9, startSec: 30 },
  ], 128, 0);
  a.setLibrary(LIB); a.setCurrent('nebula', false);
  for (let t = 0; t < 59.5; t += 1 / 30) a.update(t, true, t * 1000);
  check('boundary fired exactly once', fr.length === 1 && fr[0] === 1, JSON.stringify(fr));
  check('transforms at bars 4/8/12 of each 16-bar section (6, none at the boundary)',
    tr.length === 6, 'got ' + tr.length + ' ' + JSON.stringify(tr));
}
{
  const tr = [];
  const a = makeFixed(tr, { transformEvery: 0 });
  for (let t = 0; t < 119.5; t += 1 / 30) a.update(t, true, t * 1000);
  check('transformEvery OFF: no transforms', tr.length === 0, 'got ' + tr.length);
}

/* ---- BUILD 2: transform combo CHAOS gating ---- */
{
  const T = HoloTransforms;
  check('chaos 0 -> neutral combo (seed only) for any rng',
    [0, 0.42, 0.999].every((v) => T.isNeutral(T.makeTransform(() => v, 0))));
  check('describe(neutral) = "seed only"', T.describe(T.neutral()) === 'seed only');
  // invert gate: rng that would pass the invert roll (last call 0.1)
  const seq = (arr) => { let i = 0; return () => arr[Math.min(i++, arr.length - 1)]; };
  check('invert blocked at chaos 0.5', T.makeTransform(seq([0.99, 0.99, 0.99, 0.5, 0.5, 0.5, 0.5, 0.1]), 0.5).invert === false);
  check('invert allowed at chaos 0.9', T.makeTransform(seq([0.99, 0.99, 0.99, 0.5, 0.5, 0.5, 0.5, 0.1]), 0.9).invert === true);
  let rangesOk = true, anyWild = false;
  for (let i = 0; i < 300; i++) {
    const t = T.makeTransform(Math.random, 1);
    if (t.zoom < 0.8 || t.zoom > 1.45 || Math.abs(t.rotDeg) > 30 || Math.abs(t.hueDeg) > 180
      || t.speed < 0.5 || t.speed > 2 || ![0, 3, 4, 6].includes(t.kaleido)) rangesOk = false;
    if (!T.isNeutral(t)) anyWild = true;
  }
  check('chaos 1 combos stay inside pool ranges', rangesOk);
  check('chaos 1 produces non-neutral combos', anyWild);
  const d = T.describe({ mirrorX: true, mirrorY: false, kaleido: 4, hueDeg: 80, zoom: 1.2, rotDeg: 0, speed: 1, invert: false });
  check('describe lists combo parts', /kaleido 4/.test(d) && /hue \+80°/.test(d) && /mirror X/.test(d), d);
}

console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL UNIT CHECKS PASSED');
process.exit(fails ? 1 : 0);
