'use strict';
/* HoloMV — standalone phone-first RMS shader automator.
 * BUILD 2 adds, on top of the v1 pipeline (load -> TempoDetect -> RmsAnalyze
 * -> automator boundary ramp/fires -> REC EXPORT):
 *   - SUB-SECTION TRANSFORMATIONS: every N bars inside a section the
 *     automator ticks a transformation — fresh u_seed + a CHAOS-scaled
 *     transform combo (mirror/kaleido/hue/zoom/rotation/speed/invert)
 *     crossfaded over ~1 bar on the renderer's composite stage;
 *   - 🎲 RANDOMIZE: full random look (shader + seed + combo + dials),
 *     beat-quantized to the next beat while playing;
 *   - DIALS: global SPEED/HUE/ZOOM/REACT/CHAOS sliders + per-shader
 *     PARAM 1/2 (u_p1/u_p2) with labels from the shader definition;
 *   - AUTO-DIAL: fires/transformations re-roll the incoming shader's
 *     PARAM dials (ON by default);
 *   - ENERGY boundary picks are weighted-random among the 3 closest
 *     energy tags (never the current shader), always with a fresh seed. */
(function () {
  const BUILD = 2;
  const $ = (id) => document.getElementById(id);
  const els = {
    status: $('status-line'), gl: $('gl'), stageWrap: $('stage-wrap'),
    nowName: $('now-shader-name'), nowTag: $('now-shader-tag'),
    recBadge: $('rec-badge'), recTime: $('rec-time'),
    xfade: $('xfade-badge'), xfadeName: $('xfade-name'),
    play: $('play-btn'), timeCur: $('time-cur'), timeDur: $('time-dur'),
    trackName: $('track-name'), readout: $('section-readout'),
    wave: $('wave'), bpmInput: $('bpm-input'), bpmConf: $('bpm-conf'),
    analysis: $('analysis-line'), sections: $('section-list'),
    load: $('load-btn'), file: $('file-input'), demo: $('demo-btn'),
    auto: $('auto-toggle'), mode: $('mode-toggle'), add: $('add-shader-btn'),
    dice: $('dice-btn'), autodial: $('autodial-toggle'),
    export: $('export-btn'), exportLine: $('export-line'),
    grid: $('shader-grid'), fireLog: $('fire-log'),
    editor: $('editor'), edSelect: $('editor-select'), edName: $('editor-name'),
    edEnergy: $('editor-energy'), edEnergyVal: $('editor-energy-val'),
    edCode: $('editor-code'), edError: $('editor-error'), edDelete: $('editor-delete'),
    audio: $('audio'),
    dialSpeed: $('dial-speed'), dialHue: $('dial-hue'), dialZoom: $('dial-zoom'),
    dialReact: $('dial-react'), dialChaos: $('dial-chaos'),
    dialP1: $('dial-p1'), dialP2: $('dial-p2'),
    p1Name: $('param1-name'), p2Name: $('param2-name'),
  };
  const DIAL_DEFS = [
    { key: 'speed', el: els.dialSpeed, val: $('dial-speed-val'), fmt: (v) => v.toFixed(2) + '×' },
    { key: 'hue', el: els.dialHue, val: $('dial-hue-val'), fmt: (v) => Math.round(v) + '°' },
    { key: 'zoom', el: els.dialZoom, val: $('dial-zoom-val'), fmt: (v) => v.toFixed(2) + '×' },
    { key: 'react', el: els.dialReact, val: $('dial-react-val'), fmt: (v) => v.toFixed(2) },
    { key: 'chaos', el: els.dialChaos, val: $('dial-chaos-val'), fmt: (v) => Math.round(v) + '%' },
  ];

  const LS_USERS = 'holmv.userShaders.v1';
  const LS_OVERRIDES = 'holmv.overrides.v1';
  const LS_PARAMS = 'holmv.params.v2';
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };

  /* ---------------- library ---------------- */
  function loadLibrary() {
    const overrides = lsGet(LS_OVERRIDES, {});
    const lib = window.HoloShaders.BUILTIN.map((s) => {
      const o = overrides[s.id];
      return o ? { ...s, name: o.name ?? s.name, code: o.code ?? s.code, energy: o.energy ?? s.energy } : { ...s };
    });
    for (const u of lsGet(LS_USERS, [])) lib.push({ ...u, builtin: false });
    return lib;
  }
  function persistShader(sh) {
    if (sh.builtin) {
      const ov = lsGet(LS_OVERRIDES, {});
      ov[sh.id] = { name: sh.name, code: sh.code, energy: sh.energy };
      lsSet(LS_OVERRIDES, ov);
    } else {
      const users = lsGet(LS_USERS, []).filter((u) => u.id !== sh.id);
      users.push({ id: sh.id, name: sh.name, code: sh.code, energy: sh.energy, energyMin: sh.energyMin, energyMax: sh.energyMax, p1Label: sh.p1Label, p2Label: sh.p2Label });
      lsSet(LS_USERS, users);
    }
  }
  function unpersistShader(sh) {
    if (sh.builtin) {
      const ov = lsGet(LS_OVERRIDES, {}); delete ov[sh.id]; lsSet(LS_OVERRIDES, ov);
    } else {
      lsSet(LS_USERS, lsGet(LS_USERS, []).filter((u) => u.id !== sh.id));
    }
  }

  /* ---------------- state ---------------- */
  const S = {
    library: loadLibrary(),
    renderer: null,
    automator: null,
    exporter: null,
    track: null,          // {name, buffer, bpm, rawBpm, confidence, beatOffsetSec, sections, frameRms, frameHopSec, peaks, duration}
    audioCtx: null,
    streamDest: null,
    freeTime: 0, lastNow: 0,
    effTime: 0,           // shader clock: wall dt * SPEED * transform speed
    dispRms: 0, dispEnergy: 0.35,
    fireLog: [],          // {shaderId, section, source, text, at}
    lastExportBlob: null, lastExportName: '',
    editingId: null,
    aspect: '9:16',
    // BUILD 2 look state
    seed: 1, seedPrev: 1, seedMix: 1,       // seed crossfade (transformations)
    combo: window.HoloTransforms.neutral(), // active transform combo
    comboFrom: window.HoloTransforms.neutral(),
    lookMix: 1, lookAnimSec: 0,            // combo crossfade progress + 1-bar duration
    dials: { speed: 1, hue: 0, zoom: 1, react: 1, chaos: 50 }, // chaos in %
    params: lsGet(LS_PARAMS, {}),          // shaderId -> {p1, p2}
    autoDial: true,
    transformEvery: 8,
    pendingDiceAt: null,                   // audio position of the queued beat for dice
  };
  const shaderById = (id) => S.library.find((s) => s.id === id);
  const fmtTime = (s) => {
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60), ss = s - m * 60;
    return m + ':' + (ss < 10 ? '0' : '') + ss.toFixed(1);
  };
  const status = (t) => { els.status.textContent = t; };
  const chaos01 = () => S.dials.chaos / 100;
  const freshSeed = () => 1 + Math.floor(Math.random() * 9998);
  const barDurSec = () => (S.track && S.track.bpm > 0 ? (4 * 60) / S.track.bpm : 1.875);

  /* ---------------- per-shader params ---------------- */
  function paramsFor(id) {
    if (!S.params[id]) S.params[id] = { p1: 0.5, p2: 0.5 };
    return S.params[id];
  }
  function saveParams() { lsSet(LS_PARAMS, S.params); }
  function syncParamUI() {
    const cur = S.renderer && S.renderer.current ? S.renderer.current.shader : null;
    if (!cur) return;
    const pr = paramsFor(cur.id);
    els.p1Name.textContent = (cur.p1Label || 'PARAM 1').toUpperCase();
    els.p2Name.textContent = (cur.p2Label || 'PARAM 2').toUpperCase();
    setParamSlider('p1', pr.p1);
    setParamSlider('p2', pr.p2);
  }
  function setParamSlider(which, v) {
    const el = which === 'p1' ? els.dialP1 : els.dialP2;
    const val = $(which === 'p1' ? 'dial-p1-val' : 'dial-p2-val');
    el.value = v;
    val.textContent = (+v).toFixed(2);
  }
  /* The UI setter for PARAM dials — slider events and code both land here. */
  function setParam(which, v, shaderId) {
    const id = shaderId || (S.renderer.current && S.renderer.current.shader.id);
    if (!id) return;
    paramsFor(id)[which] = Math.min(1, Math.max(0, +v || 0));
    saveParams();
    if (S.renderer.current && S.renderer.current.shader.id === id) setParamSlider(which, paramsFor(id)[which]);
  }
  function maybeAutoDial(shaderId) {
    if (!S.autoDial || !shaderId) return;
    setParam('p1', Math.random(), shaderId);
    setParam('p2', Math.random(), shaderId);
  }

  /* ---------------- global dials ---------------- */
  function setDial(key, v) {
    const def = DIAL_DEFS.find((d) => d.key === key);
    if (!def) return;
    S.dials[key] = +v;
    if (+def.el.value !== +v) def.el.value = v;
    def.val.textContent = def.fmt(+v);
  }
  function wireDials() {
    for (const def of DIAL_DEFS) {
      def.el.addEventListener('input', () => setDial(def.key, def.el.value));
      setDial(def.key, def.el.value);
    }
    els.dialP1.addEventListener('input', () => setParam('p1', els.dialP1.value));
    els.dialP2.addEventListener('input', () => setParam('p2', els.dialP2.value));
  }

  /* ---------------- look / transformations ---------------- */
  /* Start a crossfade to a new look: fresh seed + combo, over ~1 bar. */
  function applyLook(combo, newSeed) {
    // if a previous look fade is mid-flight, snap its target as the source
    S.comboFrom = S.combo;
    S.combo = combo;
    S.lookMix = 0;
    S.lookAnimSec = Math.max(0.2, barDurSec());
    S.seedPrev = S.seed;
    S.seed = newSeed != null ? newSeed : freshSeed();
    S.seedMix = 0;
  }
  /* Instant look (init / track load): no fade. */
  function setLookNow(combo, seed) {
    S.combo = combo; S.comboFrom = combo; S.lookMix = 1;
    S.seed = seed != null ? seed : freshSeed();
    S.seedPrev = S.seed; S.seedMix = 1;
  }
  function applyTransformation(source, sectionIdx) {
    const combo = window.HoloTransforms.makeTransform(Math.random, chaos01());
    applyLook(combo, freshSeed());
    logEvent({
      source: 'transform',
      text: '⟳ TRANSFORM · seed ' + S.seed + ' · ' + window.HoloTransforms.describe(combo),
      section: sectionIdx,
    });
    els.nowTag.textContent = 'TRANSFORM';
  }

  /* ---------------- audio graph ---------------- */
  function ensureAudioGraph() {
    if (S.audioCtx) return S.audioCtx;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    S.audioCtx = ctx;
    try {
      const src = ctx.createMediaElementSource(els.audio);
      const gain = ctx.createGain(); gain.gain.value = 1;
      src.connect(gain); gain.connect(ctx.destination);
      S.streamDest = ctx.createMediaStreamDestination();
      gain.connect(S.streamDest);
    } catch (err) {
      console.warn('media-element graph unavailable', err);
      S.streamDest = null;
    }
    S.exporter = new window.Exporter.Exporter({
      audio: els.audio, canvas: els.gl,
      audioStream: S.streamDest ? S.streamDest.stream : null,
      onDone: (blob, name) => {
        S.lastExportBlob = blob; S.lastExportName = name;
        const url = URL.createObjectURL(blob);
        els.exportLine.innerHTML = '';
        const a = document.createElement('a');
        a.href = url; a.download = name; a.id = 'export-download';
        a.textContent = '⬇ ' + name + ' (' + (blob.size / 1024).toFixed(0) + ' KB)';
        els.exportLine.appendChild(a);
        a.click();
        els.export.textContent = '● REC EXPORT';
        els.export.classList.remove('recording');
        els.recBadge.classList.add('hidden');
        status('export done — ' + (blob.size / 1024).toFixed(0) + ' KB webm');
      },
      onError: (msg) => { els.exportLine.textContent = 'REC error: ' + msg; },
    });
    return ctx;
  }

  /* ---------------- analysis ---------------- */
  function precomputeFrames(buffer) {
    const hop = 2048, sr = buffer.sampleRate;
    const n = Math.max(1, Math.floor(buffer.length / hop));
    const rms = new Float32Array(n);
    const ch0 = buffer.getChannelData(0);
    const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
    for (let f = 0; f < n; f++) {
      let sum = 0; const s0 = f * hop;
      for (let i = 0; i < hop; i += 2) {
        const x = ch1 ? (ch0[s0 + i] + ch1[s0 + i]) * 0.5 : ch0[s0 + i];
        sum += x * x;
      }
      rms[f] = Math.sqrt(sum / (hop / 2));
    }
    // waveform peaks: 720 columns min/max on ch0
    const cols = 720, peaks = new Float32Array(cols * 2);
    const per = Math.floor(buffer.length / cols);
    for (let c = 0; c < cols; c++) {
      let mn = 0, mx = 0; const s0 = c * per;
      for (let i = 0; i < per; i += 16) { const x = ch0[s0 + i]; if (x < mn) mn = x; if (x > mx) mx = x; }
      peaks[c * 2] = mn; peaks[c * 2 + 1] = mx;
    }
    return { frameRms: rms, frameHopSec: hop / sr, peaks };
  }

  function analyze(buffer, name) {
    const tempo = window.TempoDetect.detect(buffer);
    let bpm = tempo.bpm, offset = tempo.beatOffsetSec;
    if (!bpm) { bpm = 120; offset = 0; }
    const rms = window.RmsAnalyze.analyzeSections(buffer, bpm, offset);
    const frames = precomputeFrames(buffer);
    S.track = {
      name, buffer, bpm, rawBpm: tempo.rawBpm, confidence: tempo.confidence,
      beatOffsetSec: offset, sections: rms.sections, duration: buffer.duration,
      ...frames,
    };
    S.automator.setTrack(rms.sections, bpm, offset);
    S.automator.setLibrary(S.library);
    S.automator.resetUsed(null);
    S.pendingDiceAt = null;
    setLookNow(window.HoloTransforms.neutral(), freshSeed());
    els.bpmInput.value = bpm;
    els.bpmConf.textContent = tempo.bpm ? ('conf ' + Math.round(tempo.confidence * 100) + '% · offset ' + offset.toFixed(2) + 's') : 'no tempo found — set BPM manually';
    els.analysis.textContent = rms.sections.length + ' sections';
    els.timeDur.textContent = fmtTime(buffer.duration);
    els.trackName.textContent = '· ' + name;
    els.play.disabled = false;
    els.export.disabled = !(S.exporter && S.exporter.supported());
    renderSectionList();
    drawWave();
    // open on the shader that matches section 1 — no fire, just a set
    if (rms.sections.length) {
      const first = S.automator.pickFor(0);
      if (first) fireShader(first, 'init', true);
    }
    status(name + ' · ' + bpm + ' BPM · ' + rms.sections.length + ' sections');
    return S.track;
  }

  async function loadFile(file) {
    status('decoding ' + file.name + ' …');
    const ctx = ensureAudioGraph();
    const ab = await file.arrayBuffer();
    const buffer = await ctx.decodeAudioData(ab);
    if (els.audio.src) URL.revokeObjectURL(els.audio.src);
    els.audio.src = URL.createObjectURL(file);
    analyze(buffer, file.name);
  }

  async function loadDemo() {
    status('synthesizing demo track …');
    ensureAudioGraph();
    const buffer = await window.HoloDemo.render();
    const blob = window.HoloDemo.bufferToWavBlob(buffer);
    if (els.audio.src) URL.revokeObjectURL(els.audio.src);
    els.audio.src = URL.createObjectURL(blob);
    analyze(buffer, 'demo-128');
    return S.track;
  }

  /* ---------------- shaders / firing ---------------- */
  function renderGrid() {
    els.grid.innerHTML = '';
    for (const sh of S.library) {
      const b = document.createElement('button');
      b.className = 'shader-chip'; b.dataset.id = sh.id;
      b.innerHTML = '<span class="nm"></span><span class="en"></span>';
      b.querySelector('.nm').textContent = sh.name;
      b.querySelector('.en').textContent = 'energy ' + sh.energy.toFixed(2) + (sh.builtin ? '' : ' · yours');
      const code = document.createElement('span');
      code.className = 'code-btn'; code.textContent = '</>';
      code.addEventListener('click', (e) => { e.stopPropagation(); openEditor(sh.id); });
      b.appendChild(code);
      b.addEventListener('click', () => fireShader(sh.id, 'manual'));
      els.grid.appendChild(b);
    }
    markActiveChip();
  }
  function markActiveChip() {
    const cur = S.renderer && S.renderer.current ? S.renderer.current.shader.id : null;
    const cued = S.automator ? S.automator.cuedId : null;
    els.grid.querySelectorAll('.shader-chip').forEach((c) => {
      c.classList.toggle('active', c.dataset.id === cur);
      c.classList.toggle('cued', c.dataset.id === cued && c.dataset.id !== cur);
    });
    if (S.renderer && S.renderer.current) {
      els.nowName.textContent = S.renderer.current.shader.name;
    }
    syncParamUI();
  }
  function logEvent(ev) {
    S.fireLog.push({ shaderId: ev.shaderId || null, section: ev.section != null ? ev.section : -1, source: ev.source, text: ev.text || null, at: performance.now() });
    if (S.fireLog.length > 40) S.fireLog.shift();
    els.fireLog.textContent = S.fireLog.slice(-3).map((f) => {
      if (f.text) return f.text;
      return (f.source === 'auto' ? 'AUTO→ ' : f.source === 'dice' ? '🎲→ ' : 'TAP→ ') +
        (shaderById(f.shaderId) || {}).name + ' @ section ' + (f.section + 1);
    }).join(' · ');
  }
  function logFire(id, section, source) {
    logEvent({ shaderId: id, section, source });
  }
  /* Fire a shader NOW (manual/auto/init/dice). Every fire gets a fresh
   * seed; boundary + dice fires also re-roll dials when AUTO-DIAL is on. */
  function fireShader(id, source, silent) {
    const sh = shaderById(id);
    if (!sh) return { ok: false };
    const r = S.renderer.setCurrent(sh);
    if (!r.ok) { status('shader error: ' + r.error); return r; }
    // complete any in-flight look fade instantly — the fire is the new look
    S.comboFrom = S.combo; S.lookMix = 1;
    S.seedPrev = S.seed;
    S.seed = freshSeed();
    S.seedMix = 1;
    S.automator.setCurrent(id, source === 'manual');
    maybeAutoDial(id);
    els.nowTag.textContent = source === 'auto' ? 'AUTO' : (source === 'init' ? 'READY' : source === 'dice' ? 'DICE' : 'MANUAL');
    if (!silent) logFire(id, S.automator.sectionIndex, source);
    markActiveChip();
    return { ok: true };
  }

  /* ---------------- dice ---------------- */
  function doDice() {
    const pool = S.library.filter((s) => !S.renderer.current || s.id !== S.renderer.current.shader.id);
    if (!pool.length) return;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    // fire through the same path as a manual tap (fresh seed + auto-dial
    // re-roll included), then crossfade the look into the random combo
    const combo = window.HoloTransforms.makeTransform(Math.random, chaos01());
    setDial('speed', 0.5 + Math.random() * 1.5);
    setDial('hue', Math.round(Math.random() * 240 - 120));
    setDial('zoom', +(0.75 + Math.random() * 0.65).toFixed(2));
    const r = fireShader(pick.id, 'dice');
    if (r.ok) {
      applyLook(combo, freshSeed());
      status('🎲 ' + pick.name + ' · ' + window.HoloTransforms.describe(combo));
    }
  }
  /* Dice entry point: beat-quantized to the next beat while a track is
   * playing, immediate when paused / no track. */
  function requestDice() {
    const playing = S.track && !els.audio.paused && !els.audio.ended;
    if (playing && S.track.bpm > 0) {
      const beatDur = 60 / S.track.bpm;
      const pos = els.audio.currentTime;
      const bf = (pos - S.track.beatOffsetSec) / beatDur;
      S.pendingDiceAt = S.track.beatOffsetSec + (Math.floor(bf) + 1) * beatDur;
      status('🎲 queued for the next beat…');
    } else {
      doDice();
    }
  }

  /* ---------------- sections UI ---------------- */
  function renderSectionList() {
    els.sections.innerHTML = '';
    if (!S.track) return;
    S.track.sections.forEach((s, i) => {
      const li = document.createElement('li');
      li.dataset.idx = i;
      li.style.borderLeftColor = 'hsl(0,0%,' + Math.round(25 + s.energy * 65) + '%)';
      li.innerHTML = '<span>SECTION ' + (i + 1) + '</span><span>' + s.lengthBars + ' bars · ' +
        fmtTime(s.startSec) + '</span><span class="e">energy ' + s.energy.toFixed(2) + ' · ' + s.meanDb.toFixed(1) + ' dB</span>';
      li.addEventListener('click', () => { if (S.track) els.audio.currentTime = s.startSec + 0.01; });
      els.sections.appendChild(li);
    });
  }
  function drawWave() {
    const cv = els.wave, g = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    g.fillStyle = '#1c1c1c'; g.fillRect(0, 0, W, H);
    if (!S.track) {
      g.fillStyle = '#555'; g.font = '22px sans-serif'; g.textAlign = 'center';
      g.fillText('NO TRACK', W / 2, H / 2 + 7); return;
    }
    const dur = S.track.duration;
    // section shading
    for (const s of S.track.sections) {
      const bd = (4 * 60) / S.track.bpm;
      const x0 = (s.startSec / dur) * W;
      const x1 = ((s.startSec + s.lengthBars * bd) / dur) * W;
      g.fillStyle = 'rgba(255,255,255,' + (0.04 + s.energy * 0.13).toFixed(3) + ')';
      g.fillRect(x0, 0, Math.max(1, x1 - x0), H);
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(x0, 0, 1, H);
    }
    // peaks
    g.fillStyle = '#c9c9c9';
    const peaks = S.track.peaks, cols = peaks.length / 2;
    const mid = H / 2;
    for (let c = 0; c < cols; c++) {
      const x = (c / cols) * W;
      const mn = peaks[c * 2], mx = peaks[c * 2 + 1];
      g.fillRect(x, mid - mx * mid * 0.92, Math.max(1, W / cols), Math.max(1, (mx - mn) * mid * 0.92));
    }
    // playhead
    const px = (els.audio.currentTime / dur) * W;
    g.fillStyle = '#fff'; g.fillRect(px, 0, 2, H);
  }

  /* ---------------- editor ---------------- */
  function openEditor(id) {
    S.editingId = id;
    els.edSelect.innerHTML = '';
    for (const sh of S.library) {
      const o = document.createElement('option');
      o.value = sh.id; o.textContent = sh.name;
      els.edSelect.appendChild(o);
    }
    els.edSelect.value = id;
    fillEditor();
    els.editor.classList.remove('hidden');
  }
  function fillEditor() {
    const sh = shaderById(S.editingId);
    if (!sh) return;
    els.edName.value = sh.name;
    els.edEnergy.value = sh.energy;
    els.edEnergyVal.textContent = (+sh.energy).toFixed(2);
    els.edCode.value = sh.code;
    els.edError.textContent = ''; els.edError.classList.remove('ok');
    els.edDelete.style.visibility = sh.builtin ? 'hidden' : 'visible';
  }
  function applyEditor() {
    const sh = shaderById(S.editingId);
    if (!sh) return;
    const candidate = { ...sh, name: els.edName.value.trim() || sh.name, code: els.edCode.value, energy: parseFloat(els.edEnergy.value) };
    const test = S.renderer.compile({ id: sh.id, code: candidate.code });
    if (!test.ok) {
      els.edError.textContent = '⚠ ' + test.error + '\n(old shader still running)';
      els.edError.classList.remove('ok');
      return;
    }
    Object.assign(sh, candidate);
    persistShader(sh);
    S.automator.setLibrary(S.library);
    if (S.renderer.current && S.renderer.current.shader.id === sh.id) S.renderer.setCurrent(sh);
    if (S.automator.cuedId === sh.id) S.renderer.cueIncoming(sh);
    renderGrid();
    els.edError.textContent = '✓ applied + saved';
    els.edError.classList.add('ok');
    status('shader saved: ' + sh.name);
  }

  /* ---------------- main loop ---------------- */
  function tick(now) {
    requestAnimationFrame(tick);
    const dt = Math.min(0.1, (now - S.lastNow) / 1000 || 0);
    S.lastNow = now;
    const hasTrack = !!S.track;
    const playing = hasTrack && !els.audio.paused && !els.audio.ended;
    const pos = hasTrack ? els.audio.currentTime : (S.freeTime += dt);

    // shader clock: advances while playing (or free-running with no track),
    // scaled by SPEED dial x transformation speed (lerped across the fade)
    const lookSpeed = S.comboFrom.speed + (S.combo.speed - S.comboFrom.speed) * S.lookMix;
    if (playing || !hasTrack) S.effTime += dt * S.dials.speed * lookSpeed;

    // look crossfades (~1 bar each, wall-clock driven so they also finish
    // while paused — a dice hit while paused lands immediately visible)
    if (S.lookMix < 1) {
      S.lookMix = Math.min(1, S.lookMix + dt / S.lookAnimSec);
      S.seedMix = S.lookMix;
    }

    // beat-quantized dice lands here
    if (S.pendingDiceAt !== null && playing && pos >= S.pendingDiceAt) {
      S.pendingDiceAt = null;
      doDice();
    }

    let beat = 0, bars = 0, targetEnergy = 0.35, loc = null;
    if (hasTrack && S.track.bpm > 0) {
      const beatDur = 60 / S.track.bpm;
      const bf = (pos - S.track.beatOffsetSec) / beatDur;
      beat = bf >= 0 ? bf - Math.floor(bf) : 0;
      bars = Math.max(0, bf / 4);
      const fi = Math.min(S.track.frameRms.length - 1, Math.max(0, Math.floor(pos / S.track.frameHopSec)));
      const targetRms = S.track.frameRms[fi] || 0;
      S.dispRms += (targetRms - S.dispRms) * 0.35;
    } else {
      beat = (pos * 2) % 1; bars = pos / 2;
      S.dispRms += ((0.25 + 0.2 * Math.sin(now * 0.001)) - S.dispRms) * 0.05;
    }

    if (hasTrack) {
      const out = S.automator.update(pos, playing, now);
      loc = out.loc;
      if (loc && S.track.sections[loc.index]) targetEnergy = S.track.sections[loc.index].energy;
      // crossfade rides the ramp
      if (S.automator.enabled && out.cuedId && out.rampProgress > 0) {
        if (!S.renderer.incoming || S.renderer.incoming.shader.id !== out.cuedId) {
          const sh = shaderById(out.cuedId);
          if (sh) S.renderer.cueIncoming(sh);
        }
        S.renderer.setMix(out.rampProgress);
        els.xfade.classList.remove('hidden');
        els.xfadeName.textContent = (shaderById(out.cuedId) || {}).name || '';
      } else {
        if (S.renderer.incoming && !(S.exporter && S.exporter.active)) { S.renderer.incoming = null; S.renderer.setMix(0); }
        els.xfade.classList.add('hidden');
      }
      if (out.fired) markActiveChip();
    }
    S.dispEnergy += (targetEnergy - S.dispEnergy) * 0.06;

    const react = S.dials.react;
    const curId = S.renderer.current ? S.renderer.current.shader.id : null;
    const curParams = curId ? paramsFor(curId) : { p1: 0.5, p2: 0.5 };
    const incId = S.renderer.incoming ? S.renderer.incoming.shader.id : null;
    const incParams = incId ? paramsFor(incId) : curParams;
    S.renderer.render({
      time: S.effTime, beat, bars,
      energy: Math.min(1.6, S.dispEnergy * (react <= 1 ? (0.35 + 0.65 * react) : react)),
      rms: Math.min(1.2, S.dispRms * 1.6 * react),
      seed: S.seed, seedPrev: S.seedPrev, seedMix: S.seedMix,
      p1: curParams.p1, p2: curParams.p2,
      p1Next: incParams.p1, p2Next: incParams.p2,
      lookFrom: S.comboFrom, lookTo: S.combo, lookMix: S.lookMix,
      dialHue: S.dials.hue * Math.PI / 180, dialZoom: S.dials.zoom,
    });

    // readouts (cheap DOM writes only when changed by frame)
    if (hasTrack) {
      els.timeCur.textContent = fmtTime(pos);
      if (loc && S.track.sections[loc.index]) {
        const s = S.track.sections[loc.index];
        els.readout.textContent = 'SECTION ' + (loc.index + 1) + '/' + S.track.sections.length +
          ' · bar ' + (Math.floor(loc.barInSection) + 1) + '/' + s.lengthBars +
          ' · energy ' + s.energy.toFixed(2) + (S.automator.enabled ? ' · AUTO ' + S.automator.mode.toUpperCase() : ' · AUTO OFF');
        els.sections.querySelectorAll('li').forEach((li) => li.classList.toggle('active', +li.dataset.idx === loc.index));
      }
      drawWave();
      if (S.exporter && S.exporter.active) {
        els.recTime.textContent = fmtTime(S.exporter.elapsedSec());
        els.export.textContent = '■ STOP · ' + fmtTime(S.exporter.elapsedSec()) + ' / ' + fmtTime(S.track.duration);
      }
    } else {
      els.readout.textContent = 'NO TRACK — demo or load a file';
    }
    els.play.textContent = playing ? '❚❚' : '▶';
    els.play.classList.toggle('playing', playing);
  }

  /* ---------------- wiring ---------------- */
  function setAspect(a) {
    S.aspect = a;
    const sizes = { '9:16': [720, 1280], '1:1': [960, 960], '16:9': [1280, 720] };
    const [w, h] = sizes[a];
    els.gl.width = w; els.gl.height = h;
    els.stageWrap.classList.toggle('ratio-1:1', a === '1:1');
    els.stageWrap.classList.toggle('ratio-16:9', a === '16:9');
    document.querySelectorAll('.aspect-btn').forEach((b) => b.classList.toggle('on', b.dataset.aspect === a));
    if (S.renderer) S.renderer.resize();
  }

  function init() {
    S.renderer = new window.Renderer(els.gl);
    S.automator = new window.Automator({
      enabled: true, mode: 'energy', transformEvery: S.transformEvery,
      onCue: () => markActiveChip(),
      onTransform: ({ sectionIndex }) => applyTransformation('auto', sectionIndex),
      onFire: (id, sectionIdx) => {
        // boundary hit: fresh seed + dial re-roll for the incoming shader,
        // then commit the cued crossfade (or hard-set if not cued).
        maybeAutoDial(id);
        S.seedPrev = S.seed;
        S.seed = freshSeed();
        S.seedMix = 1;
        S.comboFrom = S.combo; S.lookMix = 1; // boundary wins: finish any look fade
        if (S.renderer.incoming && S.renderer.incoming.shader.id === id) S.renderer.commitIncoming();
        else { const sh = shaderById(id); if (sh) S.renderer.setCurrent(sh); }
        els.nowTag.textContent = 'AUTO';
        logFire(id, sectionIdx, 'auto');
        markActiveChip();
      },
    });
    S.automator.setLibrary(S.library);
    const first = shaderById('nebula') || S.library[0];
    if (first) { S.renderer.setCurrent(first); S.automator.setCurrent(first.id, false); }
    wireDials();
    renderGrid();
    syncParamUI();
    drawWave();

    els.load.addEventListener('click', () => els.file.click());
    els.file.addEventListener('change', () => { if (els.file.files[0]) loadFile(els.file.files[0]).catch((e) => status('load failed: ' + e.message)); });
    els.demo.addEventListener('click', () => loadDemo().catch((e) => status('demo failed: ' + e.message)));
    els.dice.addEventListener('click', () => requestDice());
    els.play.addEventListener('click', () => {
      ensureAudioGraph();
      if (S.audioCtx.state === 'suspended') S.audioCtx.resume();
      if (els.audio.paused) els.audio.play(); else els.audio.pause();
    });
    els.wave.addEventListener('pointerdown', (e) => {
      if (!S.track) return;
      const r = els.wave.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      els.audio.currentTime = ratio * S.track.duration;
    });
    els.bpmInput.addEventListener('change', () => {
      if (!S.track) return;
      const bpm = parseFloat(els.bpmInput.value);
      if (!bpm || bpm < 20 || bpm > 300) return;
      const rms = window.RmsAnalyze.analyzeSections(S.track.buffer, bpm, S.track.beatOffsetSec);
      S.track.bpm = bpm; S.track.sections = rms.sections;
      S.automator.setTrack(rms.sections, bpm, S.track.beatOffsetSec);
      els.analysis.textContent = rms.sections.length + ' sections (manual BPM)';
      renderSectionList();
    });
    els.auto.addEventListener('click', () => {
      S.automator.enabled = !S.automator.enabled;
      els.auto.textContent = S.automator.enabled ? 'AUTOMATOR ON' : 'AUTOMATOR OFF';
      els.auto.classList.toggle('on', S.automator.enabled);
      if (!S.automator.enabled) { S.renderer.incoming = null; S.renderer.setMix(0); }
    });
    els.mode.addEventListener('click', () => {
      S.automator.mode = S.automator.mode === 'energy' ? 'next' : 'energy';
      els.mode.textContent = 'MODE: ' + S.automator.mode.toUpperCase();
    });
    els.autodial.addEventListener('click', () => {
      S.autoDial = !S.autoDial;
      els.autodial.textContent = S.autoDial ? 'AUTO-DIAL ON' : 'AUTO-DIAL OFF';
      els.autodial.classList.toggle('on', S.autoDial);
    });
    document.querySelectorAll('.seg-btn[data-transform-every]').forEach((b) =>
      b.addEventListener('click', () => {
        S.transformEvery = +b.dataset.transformEvery;
        S.automator.setTransformEvery(S.transformEvery);
        document.querySelectorAll('.seg-btn[data-transform-every]').forEach((x) =>
          x.classList.toggle('on', x === b));
        status('transformations every ' + (S.transformEvery ? S.transformEvery + ' bars' : '— OFF'));
      }));
    document.querySelectorAll('.aspect-btn').forEach((b) =>
      b.addEventListener('click', () => setAspect(b.dataset.aspect)));
    els.add.addEventListener('click', () => {
      const sh = {
        id: 'user-' + Date.now().toString(36), name: 'My Shader',
        code: window.HoloShaders.TEMPLATE, energy: 0.5, energyMin: 0, energyMax: 1, builtin: false,
      };
      S.library.push(sh); persistShader(sh);
      S.automator.setLibrary(S.library);
      renderGrid(); openEditor(sh.id);
    });
    els.export.addEventListener('click', () => {
      ensureAudioGraph();
      if (S.audioCtx.state === 'suspended') S.audioCtx.resume();
      if (!S.exporter) { els.exportLine.textContent = 'Export unavailable: audio graph failed.'; return; }
      if (S.exporter.active) { S.exporter.stop(); return; }
      if (!S.track) { els.exportLine.textContent = 'Load a track first.'; return; }
      if (!S.automator.enabled) els.auto.click(); // export always runs the automator
      const r = S.exporter.start(S.track.name);
      if (!r.ok) { els.exportLine.textContent = 'Export failed: ' + r.error; return; }
      els.export.classList.add('recording');
      els.recBadge.classList.remove('hidden');
      els.exportLine.textContent = 'Recording full track with automator… tap STOP to finish early.';
    });
    els.audio.addEventListener('ended', () => {
      if (S.exporter && S.exporter.active) S.exporter.stop();
    });
    // editor wiring
    $('editor-close').addEventListener('click', () => els.editor.classList.add('hidden'));
    els.edSelect.addEventListener('change', () => { S.editingId = els.edSelect.value; fillEditor(); });
    els.edEnergy.addEventListener('input', () => { els.edEnergyVal.textContent = (+els.edEnergy.value).toFixed(2); });
    $('editor-apply').addEventListener('click', applyEditor);
    $('editor-reset').addEventListener('click', () => {
      const sh = shaderById(S.editingId);
      if (!sh) return;
      if (sh.builtin) {
        const orig = window.HoloShaders.BUILTIN.find((b) => b.id === sh.id);
        if (orig) { Object.assign(sh, { name: orig.name, code: orig.code, energy: orig.energy }); unpersistShader(sh); }
      }
      fillEditor(); renderGrid();
      if (S.renderer.current && S.renderer.current.shader.id === sh.id) S.renderer.setCurrent(sh);
    });
    $('editor-delete').addEventListener('click', () => {
      const sh = shaderById(S.editingId);
      if (!sh || sh.builtin) return;
      S.library = S.library.filter((s) => s.id !== sh.id);
      unpersistShader(sh);
      S.automator.setLibrary(S.library);
      renderGrid();
      els.editor.classList.add('hidden');
      if (S.renderer.current && S.renderer.current.shader.id === sh.id && S.library[0]) fireShader(S.library[0].id, 'init', true);
    });

    ensureAudioGraph();
    els.export.disabled = true; // until a track loads (analyze() enables when supported)
    requestAnimationFrame(tick);
    status('ready — demo or load a track');
  }

  window.__HOLOMV__ = {
    BUILD, S, els,
    loadDemo, loadFile, fireShader, setAspect, requestDice, setDial, setParam,
    get state() {
      return {
        build: BUILD,
        track: S.track ? { name: S.track.name, bpm: S.track.bpm, confidence: S.track.confidence, sections: S.track.sections, duration: S.track.duration } : null,
        currentShader: S.renderer.current ? S.renderer.current.shader.id : null,
        incomingShader: S.renderer.incoming ? S.renderer.incoming.shader.id : null,
        mix: S.renderer.mix,
        glErrors: S.renderer.glErrorCount,
        fireLog: S.fireLog.slice(),
        exporting: S.exporter ? S.exporter.active : false,
        lastExport: S.lastExportBlob ? { size: S.lastExportBlob.size, name: S.lastExportName, type: S.lastExportBlob.type } : null,
        automator: { enabled: S.automator.enabled, mode: S.automator.mode, sectionIndex: S.automator.sectionIndex, rampProgress: S.automator.rampProgress, transformEvery: S.automator.transformEvery },
        // BUILD 2 look state
        seed: S.seed, seedPrev: S.seedPrev, seedMix: S.seedMix,
        combo: { ...S.combo }, comboFrom: { ...S.comboFrom }, lookMix: S.lookMix,
        dials: { ...S.dials },
        autoDial: S.autoDial,
        effTime: S.effTime,
        currentParams: S.renderer.current ? { ...paramsFor(S.renderer.current.shader.id) } : null,
        pendingDice: S.pendingDiceAt !== null,
      };
    },
    compileAll() {
      return S.library.map((sh) => ({ id: sh.id, ...S.renderer.compile(sh) }));
    },
    applyCode(id, code) {
      openEditor(id);
      els.edCode.value = code;
      applyEditor();
      return els.edError.textContent;
    },
  };

  document.addEventListener('DOMContentLoaded', init);
})();
