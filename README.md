# HoloMV

Standalone phone-first **RMS-detecting shader automator** for producing
shader-code music videos. Extracted from the HoloDecks / HoloSYNC RMS
Transitions setup (2026-10-29) into its own app.

**Live:** https://joshuagwatts.github.io/holomv/

## What it does

1. **Load a track** from the phone — or run the built-in **DEMO TRACK**
   (synthesized in-code at 128 BPM: 16 bars quiet → 32 bars loud → 16 bars
   quiet).
2. On load it runs **TempoDetect** (BPM + first beat, copied verbatim from
   HoloDecks), **RmsAnalyze** (per-bar RMS section map — true lengths
   16/24/32 bars, never forced), and **BandAnalyze** (BUILD 3): per-bar
   SUB (~20–60 Hz) and BASS (~60–250 Hz) separation, so every section's
   energy is **sub-weighted** — `energy = 0.55·RMS + 0.45·sub`,
   normalised. The section list shows each section's sub contribution
   (`SUB ▮▮▮▯`). Sections are drawn as shaded bands on the waveform.
3. **Shader stage** (WebGL, 9:16 / 1:1 / 16:9) with **16 built-in looks**
   spanning calm → intense, each tagged with an energy value **and a
   journey stage** (see 5). Uniforms ride the real beat clock + the live
   band engine: `u_time`, `u_resolution`, `u_beat`, `u_energy`, `u_rms`,
   `u_bars`, `u_seed`, `u_p1`/`u_p2`, plus (BUILD 3) smoothed per-band
   `u_sub` / `u_bass` / `u_mid` / `u_high` (AnalyserNode FFT 2048, fast
   attack / ~150 ms release), a beat-grid **kick envelope** `u_kick`
   (sub-band flux transient, decays over ~a beat) and a beat envelope
   `u_beatEnv`. Shadertoy `mainImage` code is supported
   (`iTime`/`iResolution` aliases included).
4. **The feel is global**: the composite stage applies a sub-driven zoom
   pulse, kick brightness/contrast punch and beat FOV breathing to every
   look — including pasted shaders — scaled by **REACT** and the **SUB**
   dial (0–2, default 1).
5. **AUTOMATOR** (on by default): during the last 4 bars of a section the
   next look is cued and crossfaded in on the ramp; at the boundary it
   fires fully — exactly once, never on load/seek/pause. Fire modes:
   **JOURNEY** (BUILD 3, default for new loads — see 6), **ENERGY**
   (weighted random among the 3 closest energy tags, never the current
   look) or **NEXT** (library order). Tap any look to fire it manually.
6. **THE JOURNEY** (BUILD 3): every look carries a stage —
   **REALITY** (Fractal Highlands, Planetfall), **FRACTALITY**
   (Mandelbulb, Fractal Cathedral, Fractal Bloom), **ABSTRACTION**
   (Plasma Pulse, Liquid Chrome, Flow Field, Tunnel, Kaleido Burst),
   **VISUALIZATION** (Nebula Drift, Orbital Rings, Sonic Rings, Spectrum
   Terrain, Grid Runner, Starforge). In JOURNEY mode the track's
   sections map across the arc Reality → Fractality → Abstraction →
   Visualization → back to Reality: the first section starts in REALITY,
   middle sections progress proportionally, and the final section always
   lands back in REALITY. Within a stage the look is picked by the
   energy-weighted-random rule. The UI shows journey progress and the
   section list annotates each section's stage.
7. **Raymarched looks** (BUILD 3): Fractal Highlands (fBm terrain
   flyover), Planetfall (planet + atmosphere), Mandelbulb (power-8 DE)
   and Fractal Cathedral (box-fold architecture) render through a
   **quality governor** — internal render scale starts at 0.65 while a
   raymarcher is on stage and auto-steps 0.5↔1.0 to hold ~45 fps.
   **QUALITY** dial: AUTO / HIGH / LOW.
8. **Look transitions** (BUILD 3): the composite blends looks with a
   style pool — **CROSSFADE, ZOOM THROUGH, DISSOLVE, SPIN BLEND**, and
   **GLITCH CUT** (boundary fires only, high energy/chaos). Boundary
   fires get the bigger styles, transform ticks get soft ones; the style
   rides the ramp window and is named in the fire log.
9. **Cooperative overlays** (BUILD 3): a second lightweight look —
   Starfield Drift, Dust Particles, Sacred Geometry, Light Leaks,
   Spectrum Halo — blended SCREEN / ADD / SOFT over the main look.
   Pairings follow the main look's stage (REALITY→Starfield/Dust,
   FRACTALITY→Geometry/Dust, ABSTRACTION→Light Leaks/Geometry,
   VISUALIZATION→Halo/Starfield). Opacity is capped at 0.45, scales
   **down** when the main section is high-energy and up when calm, rides
   the sub pulse, and changes only on ticks/boundaries with a slow
   2-bar crossfade. Controls: **OVERLAY** selector AUTO / OFF / by name,
   **BLEND** dial (default 0.6). Overlays are part of the composite, so
   they appear in REC EXPORT.
10. **TRANSFORMATIONS** (BUILD 2): sections no longer sit still. Every
    **4 / 8 / 16 bars** inside a section (selector, default 8) a
    transformation fires — a fresh `u_seed` re-rolls the pattern plus a
    random transform combo (mirror X/Y, kaleido 3/4/6, hue rotation,
    zoom, rotation, speed; invert only at high CHAOS) crossfaded over
    ~1 bar on the composite stage. A 64-bar section gets 7
    transformations at the default.
11. **🎲 RANDOMIZE**: instant full random look — new shader, seed, combo
    and dial values — beat-quantized to the next beat while playing.
12. **DIALS**: global **SPEED / HUE / ZOOM / REACT / CHAOS / SUB /
    BLEND** sliders, plus per-shader **PARAM 1 / PARAM 2** sliders
    wired to `u_p1`/`u_p2` with per-shader labels. **AUTO-DIAL** (on by
    default) re-rolls the incoming shader's params on every fire and
    transformation. CHAOS scales how wild combos get — at 0,
    transformations change only the seed.
13. **Code view**: tap `</>` on a shader to see/edit its GLSL. APPLY
    recompiles — a bad shader shows the error and the old one keeps
    running. Edits and user shaders autosave to localStorage.
    **+ ADD SHADER** takes Shadertoy pastes; pasted shaders get the
    band uniforms and the global feel automatically.
14. **● REC EXPORT**: plays the track from the top with the automator
    running, captures canvas (60 fps) + audio into one MediaRecorder
    webm and downloads `holomv-<trackname>.webm`.

## Prove-out

- `tests/unit.mjs` — Node: synthetic 128 BPM buffer → tempo/RMS section
  assertions; band analysis (a sub-heavy loud section outranks an
  equal-RMS sub-less one); kick/beat-envelope tracker behaviour;
  automator replay (exactly one fire per boundary, zero on
  seek/pause/subscribe), transformation ticks, ENERGY weighted-random
  picks, CHAOS combo gating; journey arc distribution (first + final
  section REALITY, middles in stage order) and stage-locked journey
  picks across the real 16-look library.
- `tests/browser.mjs` — headless Chromium at 390×844: demo via the UI,
  all 16 looks + 5 overlays compile, all 5 transition styles probed at
  the composite (progress 0 = old look, 1 = new look, mid distinct),
  journey stage annotations, automator crossfade + stage-locked fire at
  a real boundary with the transition style logged, live sub/kick feel
  sampled in-page, SUB-dial pixel proof, cooperative overlay pairing +
  energy-scaled opacity, transformation tick (seed + pixel change,
  exactly once), CHAOS 0/high through the slider, dice through the
  button, every dial moved through its UI slider asserting pixel
  changes, raymarch pixel structure at governor quality, editor error
  path, REC EXPORT blob > 100 KB.

Run: `node tests/unit.mjs` · `node tests/browser.mjs`
