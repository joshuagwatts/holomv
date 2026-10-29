'use strict';
/* HoloMV WebGL renderer. Compiles Shadertoy-style mainImage code (wrapped
 * with HoloMapper-style uniforms) or plain full-fragment code (void main
 * with gl_FragColor — header uniforms are prepended).
 *
 * BUILD 3 pipeline (always through the composite stage):
 *   pass A: current shader -> FBO A; pass B: incoming shader (boundary
 *           crossfade) or current shader at the new seed (transformation
 *           seed-fade) -> FBO B. All look passes render at this.scale
 *           (the quality governor's internal render scale; raymarch looks
 *           start at 0.65).
 *   overlay passes: previous + current COOPERATIVE OVERLAY -> FBO O / O2.
 *   composite: A/B blended by a TRANSITION STYLE (u_transType:
 *           0 crossfade, 1 zoom-through, 2 dissolve, 3 spin blend,
 *           4 glitch cut; progress = the A/B mix), then the BUILD 2
 *           transformation look (old/new combos crossfaded by u_tmix),
 *           then the AUDIO FEEL (sub-driven zoom pulse + FOV breathing +
 *           kick brightness/contrast punch — global, every look incl.
 *           user pastes), then the overlay blended (screen/add/soft).
 * Shader uniforms include the BUILD 3 band set: u_sub, u_bass, u_mid,
 * u_high, u_kick, u_beatEnv — plus u_time, u_beat, u_energy, u_rms,
 * u_bars, u_seed, u_p1/u_p2 and Shadertoy aliases. */
window.Renderer = (() => {
  const HEADER = `
precision highp float;
uniform float u_time;
uniform vec2 u_resolution;
uniform float u_beat;
uniform float u_energy;
uniform float u_rms;
uniform float u_bars;
uniform float u_seed;
uniform float u_p1;
uniform float u_p2;
uniform float u_sub;
uniform float u_bass;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;
uniform float u_beatEnv;
uniform vec3 iResolution;
uniform float iTime;
uniform vec4 iMouse;
`;
  const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main(){ v_uv = a_pos*0.5+0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }
`;
  const COMPOSITE = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_texA;
uniform sampler2D u_texB;
uniform sampler2D u_texO;
uniform sampler2D u_texO2;
uniform float u_mix;
uniform float u_transType;
/* transformation look: 0 = outgoing combo, 1 = incoming combo */
uniform float u_tmix;
uniform vec4 u_tA; /* hue(rad), zoom, rot(rad), invert */
uniform vec4 u_tB;
uniform vec3 u_kA; /* mirrorX, mirrorY, kaleido segments (0 = off) */
uniform vec3 u_kB;
uniform float u_dhue; /* global dial hue (rad), added to both */
uniform float u_dzoom; /* global dial zoom, multiplies both */
uniform vec3 u_feel; /* sub zoom pulse, kick punch, beat-env breath */
uniform float u_ovMix;
uniform float u_ovOpacity;
uniform float u_ovMode; /* 0 screen, 1 add, 2 soft */
uniform float u_ovOn;

vec3 hueRot(vec3 col, float a){
  if (abs(a) < 0.0001) return col;
  const vec3 k = vec3(0.57735);
  float c = cos(a);
  return col * c + cross(k, col) * sin(a) + k * dot(k, col) * (1.0 - c);
}
vec2 lookUv(vec2 uv, vec4 t, vec3 k){
  vec2 p = uv - 0.5;
  float ca = cos(t.z), sa = sin(t.z);
  p = mat2(ca, -sa, sa, ca) * p;
  float zoom = max(0.05, t.y * u_dzoom);
  p /= zoom;
  if (k.z > 0.5) {
    float r = length(p);
    float a = atan(p.y, p.x);
    float seg = 6.2831853 / k.z;
    a = mod(a, seg);
    a = abs(a - seg * 0.5);
    p = vec2(cos(a), sin(a)) * r;
  }
  if (k.x > 0.5) p.x = abs(p.x);
  if (k.y > 0.5) p.y = abs(p.y);
  return p + 0.5;
}
vec2 mwrap(vec2 uv){ /* mirrored repeat in-shader: FBO textures are NPOT,
  so GL repeat wrapping would make them incomplete (black) in WebGL1 */
  vec2 m = mod(uv, 2.0);
  return mix(m, 2.0 - m, step(1.0, m));
}
float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), f.x),
             mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), f.x), f.y);
}
vec2 rotUv(vec2 uv, float a){
  vec2 p = uv - 0.5;
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c) * p + 0.5;
}
/* Transition-style aware A/B sampling at an already look-transformed uv. */
vec3 sampleMix(vec2 uv){
  vec3 A = texture2D(u_texA, mwrap(uv)).rgb;
  float pr = clamp(u_mix, 0.0, 1.0);
  if (pr <= 0.001) return A;
  vec3 B = texture2D(u_texB, mwrap(uv)).rgb;
  if (pr >= 0.999) return B;
  if (u_transType < 0.5) return mix(A, B, pr); /* CROSSFADE */
  if (u_transType < 1.5) { /* ZOOM THROUGH: rush into A, arrive in B */
    vec2 c = uv - 0.5;
    vec3 a2 = texture2D(u_texA, mwrap(0.5 + c / (1.0 + 1.7*pr))).rgb;
    vec3 b2 = texture2D(u_texB, mwrap(0.5 + c / (2.7 - 1.7*pr))).rgb;
    float w = smoothstep(0.32, 0.68, pr);
    return mix(a2, b2, w) * (0.82 + 0.18*sin(pr*3.14159));
  }
  if (u_transType < 2.5) { /* DISSOLVE: noise threshold melt + hot edge */
    float n = vnoise(uv * vec2(90.0, 160.0)) * 0.72 + hash12(floor(uv*vec2(180.0, 320.0))) * 0.28;
    float th = pr * 1.35 - 0.17;
    float sel = step(n, th);
    float edge = smoothstep(0.09, 0.0, th - n) * (1.0 - sel);
    vec3 col = mix(A, B, sel);
    return col + vec3(1.0, 0.72, 0.38) * edge * 0.55 * sin(pr*3.14159);
  }
  if (u_transType < 3.5) { /* SPIN BLEND: counter-rotating ease */
    vec3 a2 = texture2D(u_texA, mwrap(rotUv(uv, pr*1.15))).rgb;
    vec3 b2 = texture2D(u_texB, mwrap(rotUv(uv, -(1.0-pr)*1.15))).rgb;
    return mix(a2, b2, smoothstep(0.15, 0.85, pr));
  }
  /* GLITCH CUT: staggered slice switch with slice offsets + RGB split */
  float row = floor(uv.y * 28.0);
  float h = hash12(vec2(row, floor(pr*9.0) + 7.0));
  float amp = sin(pr*3.14159);
  vec2 off = vec2((h - 0.5) * 0.16 * amp, 0.0);
  float pick = step(h*0.55 + 0.22, pr);
  vec3 a2 = texture2D(u_texA, mwrap(uv + off)).rgb;
  a2.r = texture2D(u_texA, mwrap(uv + off + vec2(0.008*amp, 0.0))).r;
  a2.b = texture2D(u_texA, mwrap(uv + off - vec2(0.008*amp, 0.0))).b;
  vec3 b2 = texture2D(u_texB, mwrap(uv - off)).rgb;
  return mix(a2, b2, pick);
}
vec3 applyLook(vec2 baseUv, vec4 t, vec3 k){
  vec3 col = sampleMix(lookUv(baseUv, t, k));
  col = hueRot(col, t.x + u_dhue);
  if (t.w > 0.5) col = 1.0 - col;
  return col;
}
float soft1(float b, float s){
  if (s <= 0.5) return b - (1.0-2.0*s)*b*(1.0-b);
  float d = (b <= 0.25) ? ((16.0*b - 12.0)*b + 4.0)*b : sqrt(max(b, 0.0));
  return b + (2.0*s - 1.0)*(d - b);
}
void main(){
  /* FEEL: sub zoom pulse + beat breathing on the sample position */
  vec2 base = v_uv - 0.5;
  float fzoom = 1.0 + u_feel.x + u_feel.z * 0.022;
  base = base / max(0.6, fzoom) + 0.5;
  vec3 col;
  if (u_tmix <= 0.001) col = applyLook(base, u_tA, u_kA);
  else if (u_tmix >= 0.999) col = applyLook(base, u_tB, u_kB);
  else col = mix(applyLook(base, u_tA, u_kA), applyLook(base, u_tB, u_kB), clamp(u_tmix, 0.0, 1.0));
  /* FEEL: kick punch — brightness + contrast on the hit */
  float kp = clamp(u_feel.y, 0.0, 1.5);
  if (kp > 0.001) {
    col *= 1.0 + kp * 0.20;
    col = mix(vec3(0.5), col, 1.0 + kp * 0.13);
  }
  /* cooperative overlay, blended over the finished main look */
  if (u_ovOn > 0.5 && u_ovOpacity > 0.003) {
    vec3 ov = mix(texture2D(u_texO, v_uv).rgb, texture2D(u_texO2, v_uv).rgb, clamp(u_ovMix, 0.0, 1.0));
    vec3 blended;
    if (u_ovMode < 0.5) blended = 1.0 - (1.0 - col) * (1.0 - ov);
    else if (u_ovMode < 1.5) blended = col + ov;
    else blended = vec3(soft1(col.r, ov.r), soft1(col.g, ov.g), soft1(col.b, ov.b));
    col = mix(col, blended, clamp(u_ovOpacity, 0.0, 1.0));
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

  function wrapCode(code) {
    if (/void\s+mainImage\s*\(/.test(code)) {
      return HEADER + code + `
void main(){
  vec4 c = vec4(0.0);
  mainImage(c, gl_FragCoord.xy);
  gl_FragColor = c;
}
`;
    }
    if (/void\s+main\s*\(/.test(code)) return HEADER + code;
    throw new Error('Shader needs a mainImage(out vec4, in vec2) or a void main() — neither found.');
  }

  const NEUTRAL_LOOK = { hue: 0, zoom: 1, rot: 0, invert: 0, mirrorX: 0, mirrorY: 0, kaleido: 0 };
  function comboToLook(c) {
    if (!c) return { ...NEUTRAL_LOOK };
    return {
      hue: (c.hueDeg || 0) * Math.PI / 180,
      zoom: c.zoom || 1,
      rot: (c.rotDeg || 0) * Math.PI / 180,
      invert: c.invert ? 1 : 0,
      mirrorX: c.mirrorX ? 1 : 0,
      mirrorY: c.mirrorY ? 1 : 0,
      kaleido: c.kaleido || 0,
    };
  }

  const TRANSITIONS = ['CROSSFADE', 'ZOOM THROUGH', 'DISSOLVE', 'SPIN BLEND', 'GLITCH CUT'];
  const TRANS = { CROSSFADE: 0, ZOOM: 1, DISSOLVE: 2, SPIN: 3, GLITCH: 4 };

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, antialias: false })
        || canvas.getContext('experimental-webgl', { preserveDrawingBuffer: true });
      if (!gl) throw new Error('WebGL not available on this device.');
      this.gl = gl;
      this.programs = new Map(); // key -> {prog, locs} | {error}
      this.current = null;   // {shader, entry}
      this.incoming = null;  // {shader, entry}
      this.mix = 0;
      this.glErrorCount = 0;
      this.scale = 1;        // governor render scale (FBO size / canvas size)
      this.fboW = 2; this.fboH = 2;

      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      this.vbo = buf;
      this.vert = this._shader(gl.VERTEX_SHADER, VERT);
      this.compEntry = this._link(COMPOSITE, true);
      this._makeTargets();
    }

    _shader(type, src) {
      const gl = this.gl;
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(sh) || 'compile failed';
        gl.deleteShader(sh);
        throw new Error(log.trim());
      }
      return sh;
    }

    _link(fragSrc, composite) {
      const gl = this.gl;
      const fs = this._shader(gl.FRAGMENT_SHADER, fragSrc);
      const prog = gl.createProgram();
      gl.attachShader(prog, this.vert);
      gl.attachShader(prog, fs);
      gl.bindAttribLocation(prog, 0, 'a_pos');
      gl.linkProgram(prog);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error((gl.getProgramInfoLog(prog) || 'link failed').trim());
      }
      const locs = {};
      const names = ['u_time', 'u_resolution', 'u_beat', 'u_energy', 'u_rms', 'u_bars',
        'u_seed', 'u_p1', 'u_p2', 'iResolution', 'iTime', 'iMouse',
        'u_sub', 'u_bass', 'u_mid', 'u_high', 'u_kick', 'u_beatEnv'];
      if (composite) names.push('u_texA', 'u_texB', 'u_texO', 'u_texO2', 'u_mix', 'u_transType', 'u_tmix',
        'u_tA', 'u_tB', 'u_kA', 'u_kB', 'u_dhue', 'u_dzoom', 'u_feel', 'u_ovMix', 'u_ovOpacity', 'u_ovMode', 'u_ovOn');
      for (const n of names) locs[n] = gl.getUniformLocation(prog, n);
      return { prog, locs };
    }

    _makeTargets() {
      const gl = this.gl;
      const w = Math.max(2, Math.round(this.canvas.width * this.scale));
      const h = Math.max(2, Math.round(this.canvas.height * this.scale));
      this.fboW = w; this.fboH = h;
      const mk = () => {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return { tex, fbo };
      };
      for (const k of ['tA', 'tB', 'tO', 'tO2']) {
        if (this[k]) { gl.deleteTexture(this[k].tex); gl.deleteFramebuffer(this[k].fbo); }
        this[k] = mk();
      }
    }

    resize() { this._makeTargets(); }

    /* Governor render scale: FBOs are rebuilt at canvas*scale. */
    setScale(s) {
      s = Math.min(1, Math.max(0.3, +s || 1));
      if (Math.abs(s - this.scale) < 0.01) return;
      this.scale = s;
      this._makeTargets();
    }

    /* Compile (cached by kind+id+code hash). Returns {ok} or {ok:false, error}. */
    compile(shader) {
      const key = shader.id + ':' + shader.code.length + ':' + _hash(shader.code);
      if (this.programs.has(key)) {
        const e = this.programs.get(key);
        return e.error ? { ok: false, error: e.error } : { ok: true, entry: e };
      }
      try {
        const entry = this._link(wrapCode(shader.code));
        entry.key = key;
        this.programs.set(key, entry);
        return { ok: true, entry };
      } catch (err) {
        const msg = String(err && err.message || err).slice(0, 400);
        this.programs.set(key, { error: msg });
        return { ok: false, error: msg };
      }
    }

    setCurrent(shader) {
      const r = this.compile(shader);
      if (!r.ok) return r;
      this.current = { shader, entry: r.entry };
      this.incoming = null;
      this.mix = 0;
      return { ok: true };
    }

    cueIncoming(shader) {
      if (this.current && this.current.shader.id === shader.id) { this.incoming = null; this.mix = 0; return { ok: true }; }
      const r = this.compile(shader);
      if (!r.ok) return r;
      this.incoming = { shader, entry: r.entry };
      this.mix = 0;
      return { ok: true };
    }

    setMix(v) { this.mix = Math.min(1, Math.max(0, v)); }

    commitIncoming() {
      if (this.incoming) { this.current = this.incoming; this.incoming = null; }
      this.mix = 0;
    }

    _setBands(L, state) {
      const gl = this.gl, b = state.bands || {};
      if (L.u_sub) gl.uniform1f(L.u_sub, b.sub || 0);
      if (L.u_bass) gl.uniform1f(L.u_bass, b.bass || 0);
      if (L.u_mid) gl.uniform1f(L.u_mid, b.mid || 0);
      if (L.u_high) gl.uniform1f(L.u_high, b.high || 0);
      if (L.u_kick) gl.uniform1f(L.u_kick, b.kick || 0);
      if (L.u_beatEnv) gl.uniform1f(L.u_beatEnv, b.beatEnv || 0);
    }

    _drawPass(entry, state, target, seed, p1, p2) {
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
      gl.viewport(0, 0, target ? this.fboW : this.canvas.width, target ? this.fboH : this.canvas.height);
      gl.useProgram(entry.prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      const L = entry.locs, w = target ? this.fboW : this.canvas.width, h = target ? this.fboH : this.canvas.height;
      if (L.u_time) gl.uniform1f(L.u_time, state.time);
      if (L.u_resolution) gl.uniform2f(L.u_resolution, w, h);
      if (L.u_beat) gl.uniform1f(L.u_beat, state.beat);
      if (L.u_energy) gl.uniform1f(L.u_energy, state.energy);
      if (L.u_rms) gl.uniform1f(L.u_rms, state.rms);
      if (L.u_bars) gl.uniform1f(L.u_bars, state.bars);
      if (L.u_seed) gl.uniform1f(L.u_seed, seed || 0);
      if (L.u_p1) gl.uniform1f(L.u_p1, p1 != null ? p1 : 0.5);
      if (L.u_p2) gl.uniform1f(L.u_p2, p2 != null ? p2 : 0.5);
      this._setBands(L, state);
      if (L.iResolution) gl.uniform3f(L.iResolution, w, h, 1);
      if (L.iTime) gl.uniform1f(L.iTime, state.time);
      if (L.iMouse) gl.uniform4f(L.iMouse, 0, 0, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const e = gl.getError();
      if (e !== gl.NO_ERROR) this.glErrorCount++;
    }

    /* state: {time, beat, energy, rms, bars, bands:{sub,bass,mid,high,kick,beatEnv},
     *         react, subDial,
     *         seed, seedPrev, seedMix, p1, p2, p1Next, p2Next,
     *         transType (TRANS index) — applies to the A/B mix this frame,
     *         lookFrom, lookTo, lookMix, dialHue, dialZoom,
     *         overlay: {on, prevEntry, curEntry, mix, opacity, mode}} */
    render(state) {
      const gl = this.gl;
      if (!this.current) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.clearColor(0.08, 0.08, 0.08, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        return;
      }
      const seedMix = state.seedMix != null ? state.seedMix : 1;
      const shaderMixing = this.incoming && this.mix > 0.001 && this.mix < 0.999;
      const seedFading = !this.incoming && seedMix < 0.999;
      let mixVal = 0;
      this._drawPass(this.current.entry, state, this.tA,
        seedFading || shaderMixing ? state.seedPrev : state.seed, state.p1, state.p2);
      if (shaderMixing) {
        this._drawPass(this.incoming.entry, state, this.tB, state.seed, state.p1Next, state.p2Next);
        mixVal = this.mix;
      } else if (this.incoming && this.mix >= 0.999) {
        this._drawPass(this.incoming.entry, state, this.tA, state.seed, state.p1Next, state.p2Next);
      } else if (seedFading) {
        this._drawPass(this.current.entry, state, this.tB, state.seed, state.p1, state.p2);
        mixVal = seedMix;
      }
      // overlay passes (cheap shaders, same state so bands drive them);
      // each side renders only while the crossfade actually samples it
      const ov = state.overlay || {};
      const ovOn = ov.on && ov.curEntry;
      if (ovOn) {
        const ovMix = ov.mix != null ? ov.mix : 1;
        if (ovMix < 1) this._drawPass(ov.prevEntry || ov.curEntry, state, this.tO, 0, 0.5, 0.5);
        if (ovMix > 0 || !ov.prevEntry) this._drawPass(ov.curEntry, state, this.tO2, 0, 0.5, 0.5);
      }
      // composite
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.useProgram(this.compEntry.prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      const L = this.compEntry.locs;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tA.tex);
      if (L.u_texA) gl.uniform1i(L.u_texA, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, (shaderMixing || seedFading) ? this.tB.tex : this.tA.tex);
      if (L.u_texB) gl.uniform1i(L.u_texB, 1);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.tO.tex);
      if (L.u_texO) gl.uniform1i(L.u_texO, 2);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, this.tO2.tex);
      if (L.u_texO2) gl.uniform1i(L.u_texO2, 3);
      if (L.u_mix) gl.uniform1f(L.u_mix, mixVal);
      if (L.u_transType) gl.uniform1f(L.u_transType, state.transType || 0);
      const lookFrom = comboToLook(state.lookFrom);
      const lookTo = comboToLook(state.lookTo);
      const lookMix = state.lookMix != null ? state.lookMix : 1;
      if (L.u_tmix) gl.uniform1f(L.u_tmix, lookMix);
      if (L.u_tA) gl.uniform4f(L.u_tA, lookFrom.hue, lookFrom.zoom, lookFrom.rot, lookFrom.invert);
      if (L.u_tB) gl.uniform4f(L.u_tB, lookTo.hue, lookTo.zoom, lookTo.rot, lookTo.invert);
      if (L.u_kA) gl.uniform3f(L.u_kA, lookFrom.mirrorX, lookFrom.mirrorY, lookFrom.kaleido);
      if (L.u_kB) gl.uniform3f(L.u_kB, lookTo.mirrorX, lookTo.mirrorY, lookTo.kaleido);
      if (L.u_dhue) gl.uniform1f(L.u_dhue, state.dialHue || 0);
      if (L.u_dzoom) gl.uniform1f(L.u_dzoom, state.dialZoom || 1);
      const b = state.bands || {};
      const react = state.react != null ? state.react : 1;
      const subDial = state.subDial != null ? state.subDial : 1;
      if (L.u_feel) gl.uniform3f(L.u_feel,
        (b.sub || 0) * 0.055 * react * subDial,
        (b.kick || 0) * react,
        (b.beatEnv || 0) * react);
      if (L.u_ovOn) gl.uniform1f(L.u_ovOn, ovOn ? 1 : 0);
      if (L.u_ovMix) gl.uniform1f(L.u_ovMix, ov.mix != null ? ov.mix : 1);
      if (L.u_ovOpacity) gl.uniform1f(L.u_ovOpacity, ov.opacity || 0);
      if (L.u_ovMode) gl.uniform1f(L.u_ovMode, ov.mode || 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const e = gl.getError();
      if (e !== gl.NO_ERROR) this.glErrorCount++;
      gl.activeTexture(gl.TEXTURE0);
    }
  }

  function _hash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return h;
  }

  Renderer.comboToLook = comboToLook;
  Renderer.TRANSITIONS = TRANSITIONS;
  Renderer.TRANS = TRANS;
  return Renderer;
})();
