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
   HoloDecks) and **RmsAnalyze** (per-bar RMS section map — true lengths
   16/24/32 bars, never forced), drawn as shaded bands on the waveform.
3. **Shader stage** (WebGL, 9:16 / 1:1 / 16:9) with **10 built-in shaders**
   spanning calm → intense, each tagged with an energy value. Uniforms ride
   the real beat clock + live RMS: `u_time`, `u_resolution`, `u_beat`,
   `u_energy`, `u_rms`, `u_bars`, `u_seed`, `u_p1`/`u_p2` (Shadertoy
   `mainImage` code supported, `iTime`/`iResolution` aliases included).
4. **AUTOMATOR** (on by default): during the last 4 bars of a section the
   next shader is cued and crossfaded in on the ramp; at the boundary it
   fires fully — exactly once, never on load/seek/pause. Fire modes:
   **ENERGY** (weighted random among the 3 closest energy tags, never the
   current shader, always a fresh seed) or **NEXT** (library order).
   Tap any shader to fire it manually.
5. **TRANSFORMATIONS** (BUILD 2): sections no longer sit still. Every
   **4 / 8 / 16 bars** inside a section (selector, default 8) a
   transformation fires — a fresh `u_seed` re-rolls the pattern plus a
   random transform combo (mirror X/Y, kaleido 3/4/6, hue rotation,
   zoom, rotation, speed; invert only at high CHAOS) crossfaded over
   ~1 bar on the composite stage, so it works on every shader including
   pasted ones. A 64-bar section gets 7 transformations at the default.
6. **🎲 RANDOMIZE**: instant full random look — new shader, seed, combo
   and dial values — beat-quantized to the next beat while playing.
7. **DIALS**: global **SPEED / HUE / ZOOM / REACT / CHAOS** sliders, plus
   per-shader **PARAM 1 / PARAM 2** sliders wired to `u_p1`/`u_p2` with
   per-shader labels (Tunnel: Twist/Glow, Plasma: Zoom/Speed, …).
   **AUTO-DIAL** (on by default) re-rolls the incoming shader's params
   on every fire and transformation. CHAOS scales how wild combos get —
   at 0, transformations change only the seed.
8. **Code view**: tap `</>` on a shader to see/edit its GLSL. APPLY
   recompiles — a bad shader shows the error and the old one keeps running.
   Edits and user shaders autosave to localStorage. **+ ADD SHADER** takes
   Shadertoy pastes.
9. **● REC EXPORT**: plays the track from the top with the automator
   running, captures canvas (60 fps) + audio into one MediaRecorder webm
   and downloads `holomv-<trackname>.webm`.

## Prove-out

- `tests/unit.mjs` — Node: synthetic 128 BPM buffer → tempo/RMS section
  assertions + automator replay (exactly one fire per boundary, zero on
  seek/pause/subscribe) + transformation ticks, ENERGY weighted-random
  picks, and CHAOS combo gating.
- `tests/browser.mjs` — headless Chromium at 390×844: demo via the UI,
  all 10 shaders compile, automator crossfade + fire at a real boundary,
  transformation tick (seed + pixel change, exactly once), CHAOS 0/high
  through the slider, dice through the button, every dial moved through
  its UI slider asserting pixel changes, editor error path, REC EXPORT
  blob > 100 KB.

Run: `node tests/unit.mjs` · `node tests/browser.mjs`
