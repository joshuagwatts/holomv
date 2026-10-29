'use strict';
/* HoloMV Automator — standalone adaptation of the RMS Transitions spec
 * (~/workspace/goals/holomapper-live-performance-software/files/
 * rms-transitions-spec.md). The app IS the deck here, so instead of a sync
 * seq it watches its own transport, with the same guarantees:
 *   - ramp during the last RAMP_BARS (4) bars of a section,
 *     progress = 1 - barsToNext/4, clamped 0..1, 0 outside the window;
 *   - fire EXACTLY ONCE at a section boundary, only while playing and only
 *     on continuous playback (position advanced smoothly since last tick);
 *   - never fire on load, seek, pause, or (re)subscribe — those re-baseline
 *     silently;
 *   - no double-fires: a boundary fires once, then the fired-section marker
 *     blocks any repeat until the section actually changes again.
 *
 * BUILD 2 — sub-section TRANSFORMATIONS: inside a section, every
 * transformEvery bars (4/8/16, 0 = OFF) a transformation tick fires
 * (onTransform) — same discipline: exactly once per tick, only on
 * continuous playback, re-baselined silently on seek/pause/track change.
 * If a boundary and a tick land on the same update, the boundary wins and
 * the tick is consumed silently (one event, logged once).
 *
 * Fire modes: 'energy' (weighted random among the 3 shaders whose energy
 * tags are closest to the new section's energy, never the current shader —
 * BUILD 2: v1's deterministic single-closest pick was too predictable),
 * 'next' (next in library order), and BUILD 3 'journey': the track's
 * sections are mapped across a stage arc — Reality -> Fractality ->
 * Abstraction -> Visualization -> back to Reality (first section starts
 * in REALITY, middle sections distribute across the middle stages in
 * order, the FINAL section always lands back in REALITY) — and the look
 * is chosen by the energy-weighted rule among the target stage's looks.
 * Fresh seeds are the app's job.
 * Pure logic: no DOM, no audio. Feed it update(posSec, playing) per tick. */
(function (global) {
  const RAMP_BARS = 4;

  class Automator {
    constructor(opts) {
      opts = opts || {};
      this.enabled = opts.enabled !== false;
      this.mode = opts.mode || 'energy'; // 'energy' | 'next'
      this.rampBars = opts.rampBars || RAMP_BARS;
      this.transformEvery = opts.transformEvery != null ? opts.transformEvery : 8; // bars, 0 = off
      this.random = typeof opts.random === 'function' ? opts.random : Math.random;
      this.onFire = opts.onFire || (() => {});
      this.onCue = opts.onCue || (() => {}); // (shader, targetSectionIdx)
      this.onTransform = opts.onTransform || (() => {}); // ({sectionIndex, tick})
      this.sections = [];
      this.bpm = 0;
      this.beatOffsetSec = 0;
      this.journeyStages = []; // BUILD 3: stage per section ('journey' mode)
      this.library = [];       // [{id, energy, stage}] in library order
      this.currentId = null;   // shader currently on stage
      this.usedIds = new Set(); // shaders fired since last reset (manual fires count)
      this._resetTransport();
    }

    _resetTransport() {
      this.sectionIndex = -1;     // section we are baselined in (-1 = none)
      this.lastPos = null;        // last observed position
      this.lastTickMs = null;
      this.firedForSection = -1;  // section index a fire already happened FOR (as target)
      this.cuedForSection = -1;   // section index a cue (ramp target) was chosen for
      this.cuedId = null;
      this.rampProgress = 0;
      this.barsToNext = Infinity;
      this.barInSection = 0;
      this.transformTick = -1;    // last transformation tick k baselined/fired in this section
    }

    setTrack(sections, bpm, beatOffsetSec) {
      this.sections = sections || [];
      this.bpm = bpm || 0;
      this.beatOffsetSec = beatOffsetSec || 0;
      this.journeyStages = Automator.journeyFor(this.sections.length);
      this._resetTransport();
    }

    setTransformEvery(n) {
      this.transformEvery = Math.max(0, Math.floor(+n || 0));
      this.transformTick = -1; // next update re-baselines silently
    }

    setLibrary(list) { this.library = list || []; }

    setCurrent(id, manual) {
      this.currentId = id;
      if (id) this.usedIds.add(id);
      if (manual) { this.cuedId = null; this.cuedForSection = -1; }
    }

    resetUsed(keepId) {
      this.usedIds = new Set(keepId ? [keepId] : []);
    }

    barDurSec() { return this.bpm > 0 ? (4 * 60) / this.bpm : 0; }

    /* Locate position inside the section map. Returns null before the first
     * beat offset or when there is no map. */
    locate(posSec) {
      if (!this.sections.length || !this.bpm) return null;
      const bd = this.barDurSec();
      const t = posSec - this.beatOffsetSec;
      if (t < 0) return { index: 0, barFloat: 0, barInSection: 0, barsToNext: this.sections[0].lengthBars, beforeStart: true };
      const barFloat = t / bd;
      for (let i = 0; i < this.sections.length; i++) {
        const s = this.sections[i];
        if (barFloat < s.startBar + s.lengthBars || i === this.sections.length - 1) {
          const bis = Math.max(0, barFloat - s.startBar);
          return {
            index: i, barFloat,
            barInSection: Math.min(bis, s.lengthBars),
            barsToNext: Math.max(0, s.lengthBars - bis),
            beforeStart: false,
          };
        }
      }
      return null;
    }

    /* Weighted-random pick among the 3 pool entries whose energy tags are
     * closest to target, never the shader currently on stage. */
    _pickWeighted(pool, target) {
      const cand = (pool || []).filter((s) => s.id !== this.currentId);
      if (!cand.length) return this.currentId;
      cand.sort((a, b) => Math.abs(a.energy - target) - Math.abs(b.energy - target));
      const top = cand.slice(0, Math.min(3, cand.length));
      return top[Math.min(top.length - 1, Math.floor(this.random() * top.length))].id;
    }

    pickFor(sectionIdx) {
      if (!this.library.length) return null;
      if (this.mode === 'next') {
        const cur = this.library.findIndex((s) => s.id === this.currentId);
        return this.library[(cur + 1 + this.library.length) % this.library.length].id;
      }
      const target = this.sections[sectionIdx] ? this.sections[sectionIdx].energy : 0.5;
      if (this.mode === 'journey') {
        // stage first: looks from the section's journey stage only; the
        // energy-weighted rule picks within the stage. Falls back to the
        // whole library when a stage has no (other) looks.
        const stage = this.journeyStages[sectionIdx] || 'REALITY';
        const inStage = this.library.filter((s) => (s.stage || 'ABSTRACTION') === stage);
        return this._pickWeighted(inStage.length ? inStage : this.library, target);
      }
      // energy: weighted random among the 3 closest energy tags overall.
      return this._pickWeighted(this.library, target);
    }

    /* Main tick. Returns {fired, transformFired, rampProgress, cuedId, loc}. */
    update(posSec, playing, nowMs) {
      const out = { fired: false, transformFired: false, rampProgress: 0, cuedId: this.cuedId, loc: null };
      const loc = this.locate(posSec);
      out.loc = loc;
      if (!loc) { this.lastPos = posSec; return out; }
      out.loc = loc;
      this.barInSection = loc.barInSection;
      this.barsToNext = loc.barsToNext;

      // Continuity: expected advance from wall clock while playing. A
      // seek/teleport breaks the agreement between audio advance and
      // wall advance; a merely SLOW frame (throttled phone, heavy look)
      // does not — so there is no wallDt cap: agreement is the evidence,
      // with a tolerance that grows with the gap.
      let continuous = false;
      if (this.lastPos !== null && this.lastTickMs !== null && nowMs != null) {
        const wallDt = (nowMs - this.lastTickMs) / 1000;
        const posDt = posSec - this.lastPos;
        continuous = playing && wallDt > 0
          && Math.abs(posDt - wallDt) < 0.35 + wallDt * 0.15 && posDt >= -0.05;
      }
      this.lastPos = posSec;
      this.lastTickMs = nowMs != null ? nowMs : this.lastTickMs;

      // First observation / load / subscribe: baseline only, never fire.
      if (this.sectionIndex === -1) {
        this.sectionIndex = loc.index;
        this.transformTick = this.transformEvery > 0
          ? Math.floor(loc.barInSection / this.transformEvery) : 0;
        this.rampProgress = 0;
        out.rampProgress = 0;
        return out;
      }

      // Section changed — the boundary wins over any transformation tick
      // landing on the same update: the tick baseline resets with the new
      // section and no transform event is emitted for it.
      if (loc.index !== this.sectionIndex) {
        const canFire = this.enabled && playing && continuous && this.firedForSection !== loc.index;
        const prevCuedId = this.cuedId, prevCuedFor = this.cuedForSection;
        this.sectionIndex = loc.index;
        this.transformTick = this.transformEvery > 0
          ? Math.floor(loc.barInSection / this.transformEvery) : 0;
        this.cuedForSection = -1;
        this.cuedId = null;
        this.rampProgress = 0;
        if (canFire) {
          // fire the shader that was cued through the ramp when there is
          // one (ENERGY picks are random now — re-picking here could fire a
          // different shader than the one that crossfaded in)
          const id = (prevCuedFor === loc.index && prevCuedId)
            ? prevCuedId : (this.pickFor(loc.index) || this.currentId);
          this.firedForSection = loc.index;
          if (id && id !== this.currentId) {
            this.setCurrent(id, false);
            out.fired = true;
            this.onFire(id, loc.index, 'auto');
          } else if (id) {
            out.fired = true; // boundary consumed even if pick == current
          }
        }
        out.rampProgress = 0;
        out.cuedId = null;
        return out;
      }

      // Same section: transformation ticks every transformEvery bars.
      if (this.transformEvery > 0) {
        const k = Math.floor(loc.barInSection / this.transformEvery);
        if (this.transformTick === -1 || k < this.transformTick) {
          // re-baseline silently: setting changed, or the playhead
          // seeked back behind the tick schedule — re-arm the ticks
          // from here instead of starving transformations until the
          // old schedule catches up
          this.transformTick = k;
        } else if (k > this.transformTick) {
          const canTransform = this.enabled && playing && continuous;
          this.transformTick = k; // consumed either way — no catch-up bursts
          if (canTransform && k >= 1) {
            out.transformFired = true;
            this.onTransform({ sectionIndex: loc.index, tick: k });
          }
        }
      }

      // Same section: ramp in the last rampBars bars.
      if (this.enabled && playing && loc.index < this.sections.length - 1) {
        const win = Math.min(this.rampBars, this.sections[loc.index].lengthBars);
        if (loc.barsToNext <= win && loc.barsToNext > 0) {
          this.rampProgress = Math.min(1, Math.max(0, 1 - loc.barsToNext / win));
          const target = loc.index + 1;
          if (this.cuedForSection !== target) {
            this.cuedForSection = target;
            this.cuedId = this.pickFor(target);
            if (this.cuedId && this.cuedId !== this.currentId) this.onCue(this.cuedId, target);
          }
        } else {
          this.rampProgress = 0;
        }
      } else {
        this.rampProgress = 0;
      }
      out.rampProgress = this.rampProgress;
      out.cuedId = this.cuedId;
      return out;
    }
  }

  Automator.RAMP_BARS = RAMP_BARS;
  /* The JOURNEY arc: stage for each of n sections. First = REALITY,
   * last = REALITY (the journey comes home), middles distribute across
   * FRACTALITY / ABSTRACTION / VISUALIZATION in order, proportionally. */
  Automator.STAGES = ['REALITY', 'FRACTALITY', 'ABSTRACTION', 'VISUALIZATION'];
  Automator.journeyFor = (n) => {
    if (!n || n < 1) return [];
    if (n === 1) return ['REALITY'];
    const MID = ['FRACTALITY', 'ABSTRACTION', 'VISUALIZATION'];
    const out = [];
    for (let i = 0; i < n; i++) {
      if (i === 0 || i === n - 1) { out.push('REALITY'); continue; }
      const t = i / (n - 1); // 0..1 across the track
      out.push(MID[Math.min(MID.length - 1, Math.floor(t * MID.length))]);
    }
    return out;
  };
  global.Automator = Automator;
  if (typeof module !== 'undefined' && module.exports) module.exports = { Automator };
})(typeof window !== 'undefined' ? window : globalThis);
