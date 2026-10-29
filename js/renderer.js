'use strict';
/* HoloMV WebGL renderer. Compiles Shadertoy-style mainImage code (wrapped
 * with HoloMapper-style uniforms) or plain full-fragment code (void main
 * with gl_FragColor — header uniforms are prepended).
 *
 * BUILD 2 pipeline (always through the composite stage):
 *   pass A: current shader (seed = state.seedPrev, its own u_p1/u_p2) -> FBO A
 *   pass B: incoming shader during a boundary crossfade, or the current
 *           shader again with state.seed during a transformation seed-fade
 *           -> FBO B
 *   composite: mix A/B (u_mix), then apply the TRANSFORMATION look —
 *     old combo and new combo are both evaluated and blended by
 *     u_tmix, so mirror/kaleido/hue/zoom/rotation/invert crossfade over
 *     ~1 bar instead of snapping. Global dial hue/zoom ride on top.
 * Shader uniforms now also include u_seed (pattern re-roll) and
 * u_p1/u_p2 (per-shader dials). */
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
uniform float u_mix;
/* transformation look: 0 = outgoing combo, 1 = incoming combo */
uniform float u_tmix;
uniform vec4 u_tA; /* hue(rad), zoom, rot(rad), invert */
uniform vec4 u_tB;
uniform vec3 u_kA; /* mirrorX, mirrorY, kaleido segments (0 = off) */
uniform vec3 u_kB;
uniform float u_dhue; /* global dial hue (rad), added to both */
uniform float u_dzoom; /* global dial zoom, multiplies both */

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
vec3 applyLook(sampler2D texA, sampler2D texB, vec4 t, vec3 k){
  vec2 uv = mwrap(lookUv(v_uv, t, k));
  vec3 col = mix(texture2D(texA, uv), texture2D(texB, uv), clamp(u_mix, 0.0, 1.0)).rgb;
  col = hueRot(col, t.x + u_dhue);
  if (t.w > 0.5) col = 1.0 - col;
  return col;
}
void main(){
  vec3 a = applyLook(u_texA, u_texB, u_tA, u_kA);
  vec3 b = a;
  if (u_tmix > 0.001) b = applyLook(u_texA, u_texB, u_tB, u_kB);
  gl_FragColor = vec4(mix(a, b, clamp(u_tmix, 0.0, 1.0)), 1.0);
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
  /* Convert an app transform combo {hueDeg, zoom, rotDeg, invert, mirrorX,
   * mirrorY, kaleido} to renderer look uniforms. */
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
        'u_seed', 'u_p1', 'u_p2', 'iResolution', 'iTime', 'iMouse'];
      if (composite) names.push('u_texA', 'u_texB', 'u_mix', 'u_tmix', 'u_tA', 'u_tB', 'u_kA', 'u_kB', 'u_dhue', 'u_dzoom');
      for (const n of names) locs[n] = gl.getUniformLocation(prog, n);
      return { prog, locs };
    }

    _makeTargets() {
      const gl = this.gl;
      const w = Math.max(2, this.canvas.width), h = Math.max(2, this.canvas.height);
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
      if (this.tA) { gl.deleteTexture(this.tA.tex); gl.deleteFramebuffer(this.tA.fbo); }
      if (this.tB) { gl.deleteTexture(this.tB.tex); gl.deleteFramebuffer(this.tB.fbo); }
      this.tA = mk(); this.tB = mk();
    }

    resize() { this._makeTargets(); }

    /* Compile (cached by id+code hash). Returns {ok} or {ok:false, error}. */
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

    _drawPass(entry, state, target, seed, p1, p2) {
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.useProgram(entry.prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      const L = entry.locs, w = this.canvas.width, h = this.canvas.height;
      if (L.u_time) gl.uniform1f(L.u_time, state.time);
      if (L.u_resolution) gl.uniform2f(L.u_resolution, w, h);
      if (L.u_beat) gl.uniform1f(L.u_beat, state.beat);
      if (L.u_energy) gl.uniform1f(L.u_energy, state.energy);
      if (L.u_rms) gl.uniform1f(L.u_rms, state.rms);
      if (L.u_bars) gl.uniform1f(L.u_bars, state.bars);
      if (L.u_seed) gl.uniform1f(L.u_seed, seed || 0);
      if (L.u_p1) gl.uniform1f(L.u_p1, p1 != null ? p1 : 0.5);
      if (L.u_p2) gl.uniform1f(L.u_p2, p2 != null ? p2 : 0.5);
      if (L.iResolution) gl.uniform3f(L.iResolution, w, h, 1);
      if (L.iTime) gl.uniform1f(L.iTime, state.time);
      if (L.iMouse) gl.uniform4f(L.iMouse, 0, 0, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const e = gl.getError();
      if (e !== gl.NO_ERROR) this.glErrorCount++;
    }

    /* state: {time, beat, energy, rms, bars,
     *         seed, seedPrev, seedMix (0..1 fade prev->seed),
     *         p1, p2 (current shader), p1Next, p2Next (incoming / seed-fade),
     *         lookFrom, lookTo (combos), lookMix (0..1),
     *         dialHue (rad), dialZoom} */
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
      // pass A: current shader at the previous seed
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
      // composite: A/B mix + transformation look crossfade + dial hue/zoom
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
      if (L.u_mix) gl.uniform1f(L.u_mix, mixVal);
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
  return Renderer;
})();
