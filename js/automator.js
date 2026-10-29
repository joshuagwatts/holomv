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
 * Pure logic: no DOM, no audio. Feed it update(posSec, playing) per tick.
 * Fire modes: 'energy' (unused shader whose energy tag best matches the new
 * section) and 'next' (next in library order). */
(function (global) {
  const RAMP_BARS = 4;

  class Automator {
    constructor(opts) {
      opts = opts || {};
      this.enabled = opts.enabled !== false;
      this.mode = opts.mode || 'energy'; // 'energy' | 'next'
      this.rampBars = opts.rampBars || RAMP_BARS;
      this.onFire = opts.onFire || (() => {});
      this.onCue = opts.onCue || (() => {}); // (shader, targetSectionIdx)
      this.sections = [];
      this.bpm = 0;
      this.beatOffsetSec = 0;
      this.library = [];       // [{id, energy}] in library order
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
    }

    setTrack(sections, bpm, beatOffsetSec) {
      this.sections = sections || [];
      this.bpm = bpm || 0;
      this.beatOffsetSec = beatOffsetSec || 0;
      this._resetTransport();
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

    pickFor(sectionIdx) {
      if (!this.library.length) return null;
      if (this.mode === 'next') {
        const cur = this.library.findIndex((s) => s.id === this.currentId);
        return this.library[(cur + 1 + this.library.length) % this.library.length].id;
      }
      // energy: unused shader whose tag best matches the section energy;
      // when everything has been used, reset the used pool (keeping current).
      const target = this.sections[sectionIdx] ? this.sections[sectionIdx].energy : 0.5;
      let pool = this.library.filter((s) => s.id !== this.currentId && !this.usedIds.has(s.id));
      if (!pool.length) {
        this.resetUsed(this.currentId);
        pool = this.library.filter((s) => s.id !== this.currentId);
      }
      if (!pool.length) return this.currentId;
      pool.sort((a, b) => Math.abs(a.energy - target) - Math.abs(b.energy - target));
      return pool[0].id;
    }

    /* Main tick. Returns {fired, rampProgress, cuedId, loc}. */
    update(posSec, playing, nowMs) {
      const out = { fired: false, rampProgress: 0, cuedId: this.cuedId, loc: null };
      const loc = this.locate(posSec);
      out.loc = loc;
      if (!loc) { this.lastPos = posSec; return out; }
      out.loc = loc;
      this.barInSection = loc.barInSection;
      this.barsToNext = loc.barsToNext;

      // Continuity: expected advance from wall clock while playing.
      let continuous = false;
      if (this.lastPos !== null && this.lastTickMs !== null && nowMs != null) {
        const wallDt = (nowMs - this.lastTickMs) / 1000;
        const posDt = posSec - this.lastPos;
        continuous = playing && wallDt > 0 && wallDt < 2 && Math.abs(posDt - wallDt) < 0.35 && posDt >= -0.05;
      }
      this.lastPos = posSec;
      this.lastTickMs = nowMs != null ? nowMs : this.lastTickMs;

      // First observation / load / subscribe: baseline only, never fire.
      if (this.sectionIndex === -1) {
        this.sectionIndex = loc.index;
        this.rampProgress = 0;
        out.rampProgress = 0;
        return out;
      }

      // Section changed.
      if (loc.index !== this.sectionIndex) {
        const canFire = this.enabled && playing && continuous && this.firedForSection !== loc.index;
        this.sectionIndex = loc.index;
        this.cuedForSection = -1;
        this.cuedId = null;
        this.rampProgress = 0;
        if (canFire) {
          const id = this.pickFor(loc.index) || this.currentId;
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
  global.Automator = Automator;
  if (typeof module !== 'undefined' && module.exports) module.exports = { Automator };
})(typeof window !== 'undefined' ? window : globalThis);
