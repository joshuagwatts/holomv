'use strict';
/* HoloMV BUILD 3 — band analysis: the FEEL of the beat, not just level.
 *
 * Pre-analysis (analyzeBars / enrichSections): per-bar SUB (~20–60 Hz) and
 * BASS (~60–250 Hz) energies from the decoded buffer, separated in the
 * time domain with cascaded one-pole lowpasses (same family as tempo.js).
 * Each RMS section then gets a SUB-WEIGHTED energy:
 *     energy' = 0.55·RMS + 0.45·SUB,  normalised across sections,
 * so a loud section with real sub underneath out-ranks an equally loud
 * section without it. The original RMS energy is kept as energyRms.
 *
 * Live (BandTracker): per-frame smoothed bands (fast attack, ~150 ms
 * release — musical, no jitter), a KICK envelope from sub-band flux
 * transients near the beat grid, and smoothing shared by both sources:
 * the AnalyserNode on the playback chain (primary) or the precomputed
 * per-frame band table at the playhead (fallback when an analyser is
 * silent, e.g. some headless/embedded chains). The tracker records which
 * source fed it in .source ('analyser' | 'table' | 'idle'). */
(function (global) {
  const clamp01 = (v) => Math.min(1, Math.max(0, v || 0));

  /* One-pole coefficient for cutoff fc at sample rate sr. */
  const lpCoef = (fc, sr) => 1 - Math.exp((-2 * Math.PI * fc) / sr);

  /* Per-bar band RMS. Returns { barRms, barSub, barBass } (amplitudes).
   * Sub = two cascaded one-poles at ~60 Hz; bass = one-pole at ~250 Hz
   * minus the sub signal, so the bands partition the low end. */
  function analyzeBars(buffer, bpm, beatOffsetSec) {
    if (!buffer || !bpm || bpm <= 0) return { barRms: [], barSub: [], barBass: [] };
    const sr = buffer.sampleRate;
    const nCh = Math.max(1, buffer.numberOfChannels || 1);
    const chans = [];
    for (let c = 0; c < nCh; c++) chans.push(buffer.getChannelData(c));
    const offset = Math.max(0, beatOffsetSec || 0);
    const startSample = Math.floor(offset * sr);
    const barSamples = ((4 * 60) / bpm) * sr;
    const nBars = Math.max(0, Math.floor((buffer.length - startSample) / barSamples));
    const barRms = new Array(nBars).fill(0);
    const barSub = new Array(nBars).fill(0);
    const barBass = new Array(nBars).fill(0);
    if (nBars < 1) return { barRms, barSub, barBass };
    const aSub = lpCoef(60, sr), aBass = lpCoef(250, sr);
    let lp1 = 0, lp2 = 0, lpB = 0;
    // prime the filters from the offset so bar 0 isn't a ramp artefact
    const prime = Math.min(startSample, Math.floor(sr * 0.25));
    for (let i = startSample - prime; i < startSample; i++) {
      if (i < 0) continue;
      let x = 0; for (let c = 0; c < nCh; c++) x += chans[c][i];
      x /= nCh;
      lp1 += aSub * (x - lp1); lp2 += aSub * (lp1 - lp2); lpB += aBass * (x - lpB);
    }
    let bar = 0, sR = 0, sS = 0, sB = 0, cnt = 0;
    for (let i = startSample; i < buffer.length && bar < nBars; i++) {
      let x = 0; for (let c = 0; c < nCh; c++) x += chans[c][i];
      x /= nCh;
      lp1 += aSub * (x - lp1); lp2 += aSub * (lp1 - lp2); lpB += aBass * (x - lpB);
      const sub = lp2, bass = lpB - lp2;
      sR += x * x; sS += sub * sub; sB += bass * bass; cnt++;
      if ((i - startSample + 1) >= (bar + 1) * barSamples || i === buffer.length - 1) {
        barRms[bar] = Math.sqrt(sR / Math.max(1, cnt));
        barSub[bar] = Math.sqrt(sS / Math.max(1, cnt));
        barBass[bar] = Math.sqrt(sB / Math.max(1, cnt));
        bar++; sR = sS = sB = 0; cnt = 0;
      }
    }
    return { barRms, barSub, barBass };
  }

  const meanSlice = (a, i0, len) => {
    if (!a || !a.length) return 0;
    let s = 0, n = 0;
    for (let i = Math.max(0, i0); i < Math.min(a.length, i0 + len); i++) { s += a[i]; n++; }
    return n ? s / n : 0;
  };

  /* Enrich RMS sections with sub data + the sub-weighted energy.
   * Sections keep startBar/lengthBars/startSec/meanDb from RmsAnalyze. */
  function enrichSections(sections, bars) {
    if (!sections || !sections.length) return sections || [];
    const { barSub, barBass } = bars || { barSub: [], barBass: [] };
    const raw = sections.map((s) => {
      const sub = meanSlice(barSub, s.startBar, s.lengthBars);
      const bass = meanSlice(barBass, s.startBar, s.lengthBars);
      return { s, sub, bass, weighted: 0.55 * (s.meanRms || 0) + 0.45 * sub };
    });
    const maxW = Math.max(...raw.map((r) => r.weighted), 1e-6);
    const maxSub = Math.max(...raw.map((r) => r.sub), 1e-6);
    return raw.map(({ s, sub, bass, weighted }) => ({
      ...s,
      energyRms: s.energy,
      energy: +Math.min(1, weighted / maxW).toFixed(3),
      sub: +sub.toFixed(4),
      bass: +bass.toFixed(4),
      subNorm: +Math.min(1, sub / maxSub).toFixed(3),
    }));
  }

  /* Per-frame band table (hop frames over the whole buffer) — the live
   * fallback source, and the table the tracker reads at the playhead.
   * Returns { sub, bass, mid, high } Float32Arrays, raw amplitudes
   * (tracker scales them). High = first-difference energy (transients),
   * mid = what the lowpasses leave behind. */
  function frameBands(buffer, hop) {
    hop = hop || 2048;
    const sr = buffer.sampleRate;
    const nCh = Math.max(1, buffer.numberOfChannels || 1);
    const chans = [];
    for (let c = 0; c < nCh; c++) chans.push(buffer.getChannelData(c));
    const n = Math.max(1, Math.floor(buffer.length / hop));
    const sub = new Float32Array(n), bass = new Float32Array(n),
      mid = new Float32Array(n), high = new Float32Array(n);
    const aSub = lpCoef(60, sr), aBass = lpCoef(250, sr);
    let lp1 = 0, lp2 = 0, lpB = 0, prevX = 0;
    let f = 0, sS = 0, sB = 0, sM = 0, sH = 0, cnt = 0;
    for (let i = 0; i + 1 < buffer.length && f < n; i++) {
      let x = 0; for (let c = 0; c < nCh; c++) x += chans[c][i];
      x /= nCh;
      lp1 += aSub * (x - lp1); lp2 += aSub * (lp1 - lp2); lpB += aBass * (x - lpB);
      const s = lp2, b = lpB - lp2, m = x - lpB, h = x - prevX;
      prevX = x;
      sS += s * s; sB += b * b; sM += m * m; sH += h * h; cnt++;
      if (cnt >= hop) {
        sub[f] = Math.sqrt(sS / cnt); bass[f] = Math.sqrt(sB / cnt);
        mid[f] = Math.sqrt(sM / cnt); high[f] = Math.sqrt(sH / cnt);
        f++; sS = sB = sM = sH = 0; cnt = 0;
      }
    }
    return { sub, bass, mid, high, hopSec: hop / sr };
  }

  /* Read band levels (0..1-ish) from an AnalyserNode's byte frequency
   * data. fftSize 2048: sub 20–60, bass 60–250, mid 250–4k, high 4k–12k. */
  function readAnalyser(analyser, freqBuf) {
    analyser.getByteFrequencyData(freqBuf);
    const sr = analyser.context ? analyser.context.sampleRate : 44100;
    const binHz = sr / analyser.fftSize;
    const avg = (lo, hi) => {
      const i0 = Math.max(1, Math.floor(lo / binHz));
      const i1 = Math.min(freqBuf.length - 1, Math.ceil(hi / binHz));
      if (i1 <= i0) return 0;
      let s = 0;
      for (let i = i0; i < i1; i++) s += freqBuf[i];
      return s / ((i1 - i0) * 255);
    };
    const peak = (lo, hi) => {
      const i0 = Math.max(1, Math.floor(lo / binHz));
      const i1 = Math.min(freqBuf.length - 1, Math.ceil(hi / binHz));
      let m = 0;
      for (let i = i0; i < i1; i++) if (freqBuf[i] > m) m = freqBuf[i];
      return m / 255;
    };
    const out = {
      /* sub blends mean + peak with headroom: a pure mean at high gain
       * pins at 1.0 on hot low end (measured on the demo's loud
       * section), which flattens the feel and starves kick flux */
      sub: clamp01((avg(20, 60) * 0.55 + peak(20, 60) * 0.45) * 0.95),
      bass: clamp01(avg(60, 250) * 1.15),
      mid: clamp01(avg(250, 4000) * 1.1),
      high: clamp01(avg(4000, 12000) * 1.15),
      total: avg(20, 12000),
    };
    return out;
  }

  /* Scale raw table amplitudes into the same 0..1-ish space as the
   * analyser path (calibrated so demo kicks land ~0.5–0.9). */
  function scaleTableFrame(fr) {
    if (!fr) return { sub: 0, bass: 0, mid: 0, high: 0 };
    return {
      sub: clamp01(fr.sub * 2.4),
      bass: clamp01(fr.bass * 2.2),
      mid: clamp01(fr.mid * 1.5),
      high: clamp01(fr.high * 1.1),
    };
  }

  /* Live band tracker: smoothing + kick envelope + beat envelope. */
  class BandTracker {
    constructor() {
      this.sub = 0; this.bass = 0; this.mid = 0; this.high = 0;
      this.kick = 0; this.beatEnv = 0;
      this._fastSub = 0; this._prevFastSub = 0;
      this.source = 'idle';
    }
    /* raw: {sub,bass,mid,high} 0..1 instant levels (already scaled).
     * dt: seconds since last update. beatPhase: 0..1 or null.
     * beatDurSec: seconds per beat. playing: transport state. */
    update(raw, dt, beatPhase, beatDurSec, playing, source) {
      if (source) this.source = source;
      /* envelopes are wall-clock true: cap dt at 0.5 s (tab-stall guard)
       * rather than 0.1 — at low frame rates a 0.1 cap makes the kick
       * decay run many times slower than its ~1-beat design */
      dt = Math.min(0.5, Math.max(0.001, dt || 0.016));
      const atk = 1 - Math.exp(-dt / 0.008);   // ~8 ms attack
      const rel = 1 - Math.exp(-dt / 0.155);   // ~155 ms release
      for (const k of ['sub', 'bass', 'mid', 'high']) {
        const target = raw ? (raw[k] || 0) : 0;
        this[k] += (target - this[k]) * (target > this[k] ? atk : rel);
      }
      // kick: flux of a fast sub follower, triggered near the beat grid
      const fAtk = 1 - Math.exp(-dt / 0.005);
      const fRel = 1 - Math.exp(-dt / 0.06);
      const rSub = raw ? (raw.sub || 0) : 0;
      this._fastSub += (rSub - this._fastSub) * (rSub > this._fastSub ? fAtk : fRel);
      const flux = this._fastSub - this._prevFastSub;
      this._prevFastSub = this._fastSub;
      const nearBeat = beatPhase == null || beatPhase < 0.35 || beatPhase > 0.88;
      if (playing && nearBeat && flux > 0.03 && this.kick < 0.75) {
        this.kick = Math.min(1, 0.5 + flux * 2.4);
      }
      const bd = beatDurSec > 0 ? beatDurSec : 0.47;
      this.kick *= Math.exp(-dt / (bd * 0.85));
      if (this.kick < 0.001) this.kick = 0;
      // beat envelope: 1 on the beat, exponential decay across the beat
      this.beatEnv = beatPhase == null ? this.beatEnv * Math.exp(-dt / 0.2)
        : Math.exp(-3.1 * Math.min(1, Math.max(0, beatPhase)));
      return this.values();
    }
    values() {
      return {
        sub: +this.sub.toFixed(3), bass: +this.bass.toFixed(3),
        mid: +this.mid.toFixed(3), high: +this.high.toFixed(3),
        kick: +this.kick.toFixed(3), beatEnv: +this.beatEnv.toFixed(3),
        source: this.source,
      };
    }
  }

  const api = { analyzeBars, enrichSections, frameBands, readAnalyser, scaleTableFrame, BandTracker, clamp01 };
  global.HoloBands = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
