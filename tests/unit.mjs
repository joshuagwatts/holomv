/* HoloMV unit prove-out (Node, headless):
 * 1) Synthetic 128 BPM buffer (16 quiet / 32 loud / 16 quiet bars) ->
 *    TempoDetect finds ~128, RmsAnalyze finds >=3 sections with the loud
 *    middle clearly above the quiet ends and true bar lengths.
 * 2) Automator replay over the section map: exactly one fire per boundary
 *    on continuous playback; ramp 0 outside the last-4-bars window and
 *    rising inside it; ZERO fires on seek, on pause-scrub, on subscribe. */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
globalThis.window = globalThis;
for (const f of ['js/tempo.js', 'js/rms.js', 'js/automator.js']) {
  eval(readFileSync(join(ROOT, f), 'utf8'));
}
const { TempoDetect, RmsAnalyze, Automator } = globalThis;

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
  { id: 'nebula', energy: 0.15 }, { id: 'flowfield', energy: 0.32 },
  { id: 'plasma', energy: 0.5 }, { id: 'tunnel', energy: 0.66 },
  { id: 'kaleido', energy: 0.85 }, { id: 'starforge', energy: 0.96 },
];
const sections = rms.sections.length >= 3 ? rms.sections
  : [{ startBar: 0, lengthBars: 16, energy: 0.15, startSec: 0 },
     { startBar: 16, lengthBars: 32, energy: 0.95, startSec: 30 },
     { startBar: 48, lengthBars: 16, energy: 0.15, startSec: 90 }];
const useBpm = rms.sections.length >= 3 ? tempo.bpm : 128;
const useOffset = rms.sections.length >= 3 ? tempo.beatOffsetSec : 0;

function makeAuto(fires, mode) {
  const a = new Automator({ enabled: true, mode: mode || 'energy', onFire: (id, idx) => fires.push({ id, idx }) });
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
  check('energy mode: boundary into loud picks intense shader',
    fires.length && ['kaleido', 'starforge', 'tunnel'].includes(fires[0].id), fires.length ? fires[0].id : 'none');
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

// next mode: library order
{
  const fires = [];
  const a = makeAuto(fires, 'next');
  for (let t = 0; t < dur - 0.2; t += 1 / 30) a.update(t, true, t * 1000);
  check('NEXT mode fires in library order',
    fires.length === sections.length - 1 && fires[0].id === 'flowfield' && (fires.length < 2 || fires[1].id === 'plasma'),
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

console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL UNIT CHECKS PASSED');
process.exit(fails ? 1 : 0);
