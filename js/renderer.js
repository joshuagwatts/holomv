'use strict';
/* HoloMV WebGL renderer. Compiles Shadertoy-style mainImage code (wrapped
 * with HoloMapper-style uniforms) or plain full-fragment code (void main
 * with gl_FragColor — header uniforms are prepended). Crossfades between
 * the outgoing and incoming shader through two FBOs + a composite pass,
 * driven by u_mix (the automator ramp progress). */
window.Renderer = (() => {
  const HEADER = `
precision highp float;
uniform float u_time;
uniform vec2 u_resolution;
uniform float u_beat;
uniform float u_energy;
uniform float u_rms;
uniform float u_bars;
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
void main(){
  vec4 a = texture2D(u_texA, v_uv);
  vec4 b = texture2D(u_texB, v_uv);
  gl_FragColor = mix(a, b, clamp(u_mix, 0.0, 1.0));
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
      this.compEntry = this._link(COMPOSITE);
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

    _link(fragSrc) {
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
      for (const n of ['u_time', 'u_resolution', 'u_beat', 'u_energy', 'u_rms', 'u_bars',
        'iResolution', 'iTime', 'iMouse', 'u_texA', 'u_texB', 'u_mix']) {
        locs[n] = gl.getUniformLocation(prog, n);
      }
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

    _drawPass(entry, state, target) {
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
      if (L.iResolution) gl.uniform3f(L.iResolution, w, h, 1);
      if (L.iTime) gl.uniform1f(L.iTime, state.time);
      if (L.iMouse) gl.uniform4f(L.iMouse, 0, 0, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const e = gl.getError();
      if (e !== gl.NO_ERROR) this.glErrorCount++;
    }

    render(state) {
      const gl = this.gl;
      if (!this.current) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.clearColor(0.08, 0.08, 0.08, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        return;
      }
      if (this.incoming && this.mix > 0.001 && this.mix < 0.999) {
        this._drawPass(this.current.entry, state, this.tA);
        this._drawPass(this.incoming.entry, state, this.tB);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.useProgram(this.compEntry.prog);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.tA.tex);
        gl.uniform1i(this.compEntry.locs.u_texA, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.tB.tex);
        gl.uniform1i(this.compEntry.locs.u_texB, 1);
        gl.uniform1f(this.compEntry.locs.u_mix, this.mix);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.activeTexture(gl.TEXTURE0);
      } else if (this.incoming && this.mix >= 0.999) {
        this._drawPass(this.incoming.entry, state, null);
      } else {
        this._drawPass(this.current.entry, state, null);
      }
    }
  }

  function _hash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return h;
  }

  return Renderer;
})();
