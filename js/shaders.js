'use strict';
/* HoloMV built-in shader library. Each shader is Shadertoy-style mainImage
 * code. Available uniforms (declared by the renderer wrapper):
 *   u_time (sec, follows the track), u_resolution, u_beat (0..1 beat phase),
 *   u_energy (0..1 section energy), u_rms (live RMS), u_bars (bars elapsed),
 *   plus Shadertoy aliases iTime / iResolution / iMouse.
 * Each shader is tagged with an energy centre + range for the automator's
 * ENERGY fire mode. */
window.HoloShaders = (() => {
  const BUILTIN = [
    {
      id: 'nebula', name: 'Nebula Drift', energy: 0.15, energyMin: 0.0, energyMax: 0.32, builtin: true,
      code: `// Nebula Drift — slow fbm clouds, calm sections
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x),
             mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for(int i=0;i<5;i++){ v += a*noise(p); p = p*2.03 + vec2(17.3, 9.1); a *= 0.55; }
  return v;
}
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = (fragCoord - 0.5*u_resolution) / u_resolution.y;
  float t = u_time*0.05;
  float n = fbm(uv*2.4 + vec2(t, t*0.6));
  float m = fbm(uv*3.6 - vec2(t*0.7, t) + n*1.6);
  vec3 deep = vec3(0.03,0.02,0.10);
  vec3 mid  = vec3(0.16,0.08,0.38);
  vec3 hi   = vec3(0.35,0.55,0.85);
  vec3 col = mix(deep, mid, smoothstep(0.25,0.65,m));
  col = mix(col, hi, smoothstep(0.6,0.95,n) * (0.35 + 0.65*u_energy));
  // star specks
  vec2 g = floor(uv*90.0);
  float s = step(0.997, hash(g)) * (0.4 + 0.6*sin(u_time*1.5 + hash(g+1.0)*40.0));
  col += vec3(s) * 0.5;
  col *= 0.85 + 0.5*u_rms + 0.25*pow(1.0-u_beat, 3.0)*u_energy;
  fragColor = vec4(col, 1.0);
}`,
    },
    {
      id: 'flowfield', name: 'Flow Field', energy: 0.32, energyMin: 0.16, energyMax: 0.48, builtin: true,
      code: `// Flow Field — domain-warped flowing bands
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x),
             mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = (fragCoord - 0.5*u_resolution) / u_resolution.y;
  float t = u_time*0.22;
  vec2 p = uv*3.0;
  float w1 = noise(p + vec2(t, -t*0.4));
  float w2 = noise(p*1.7 - vec2(t*0.6, t) + w1*2.2);
  float bands = sin((p.y + w2*2.4 + w1) * 6.0 + u_bars*1.57);
  float v = smoothstep(-0.9, 0.9, bands);
  vec3 a = vec3(0.02,0.10,0.14);
  vec3 b = vec3(0.10,0.65,0.60);
  vec3 c = vec3(0.65,0.95,0.75);
  vec3 col = mix(a, b, v);
  col = mix(col, c, pow(v, 6.0) * (0.4 + 0.6*u_energy));
  col *= 0.8 + 0.7*u_rms + 0.35*pow(1.0-u_beat, 2.0);
  fragColor = vec4(col, 1.0);
}`,
    },
    {
      id: 'plasma', name: 'Plasma Pulse', energy: 0.5, energyMin: 0.36, energyMax: 0.64, builtin: true,
      code: `// Plasma Pulse — classic plasma, breathes on the beat
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = (fragCoord - 0.5*u_resolution) / u_resolution.y;
  float beatPulse = pow(1.0 - u_beat, 2.0);
  float zoom = 3.2 - 0.5*beatPulse*u_energy;
  vec2 p = uv * zoom;
  float t = u_time*0.7;
  float v = sin(p.x*3.0 + t)
          + sin(p.y*4.0 - t*1.3)
          + sin((p.x+p.y)*2.4 + t*0.7)
          + sin(length(p)*5.0 - t*1.8 - beatPulse*2.0);
  v *= 0.25;
  vec3 col = 0.5 + 0.5*cos(3.14159*v + vec3(0.0, 1.4, 2.6) + u_energy*1.5);
  col *= 0.75 + 0.6*u_rms + 0.45*beatPulse;
  fragColor = vec4(col, 1.0);
}`,
    },
    {
      id: 'tunnel', name: 'Tunnel', energy: 0.66, energyMin: 0.5, energyMax: 0.8, builtin: true,
      code: `// Tunnel — polar rings flying with the bars
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = (fragCoord - 0.5*u_resolution) / u_resolution.y;
  float r = length(uv) + 1e-4;
  float a = atan(uv.y, uv.x);
  float speed = u_bars*2.0;
  float rings = sin((1.0/r)*7.0 - speed*6.2831 + sin(a*6.0 + u_time*0.8)*0.7);
  float spokes = 0.5 + 0.5*sin(a*12.0 + u_time*0.5);
  float v = smoothstep(0.0, 1.0, rings*0.5+0.5) * (0.55 + 0.45*spokes);
  vec3 near = vec3(0.95,0.45,0.15);
  vec3 far  = vec3(0.08,0.05,0.30);
  vec3 col = mix(far, near, v * smoothstep(0.0, 0.55, r + 0.25));
  col += vec3(1.0,0.8,0.5) * pow(1.0-u_beat, 3.0) * smoothstep(0.35,0.0,r) * (0.4+0.6*u_energy);
  col *= (0.8 + 0.6*u_rms) * smoothstep(0.0, 0.12, r);
  fragColor = vec4(col, 1.0);
}`,
    },
    {
      id: 'kaleido', name: 'Kaleido Burst', energy: 0.85, energyMin: 0.68, energyMax: 0.96, builtin: true,
      code: `// Kaleido Burst — mirrored segments, snaps on the beat
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x),
             mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = (fragCoord - 0.5*u_resolution) / u_resolution.y;
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float segs = 8.0;
  float seg = 6.28318/segs;
  a = mod(a + u_time*0.25 + floor(u_bars)*0.13, seg);
  a = abs(a - seg*0.5);
  vec2 k = vec2(cos(a), sin(a)) * r;
  float n = noise(k*7.0 + u_time*0.4) * noise(k*3.0 - u_time*0.3);
  float rings = sin(r*22.0 - u_time*3.0 - u_beat*6.2831)*0.5+0.5;
  vec3 col = 0.5 + 0.5*cos(vec3(0.0,2.1,4.2) + n*9.0 + u_energy*2.0);
  col *= 0.35 + 0.85*rings*(0.5+n);
  col += vec3(1.0) * pow(1.0-u_beat, 4.0) * smoothstep(0.5,0.0,r) * u_energy;
  col *= 0.8 + 0.7*u_rms;
  fragColor = vec4(col, 1.0);
}`,
    },
    {
      id: 'starforge', name: 'Starforge', energy: 0.96, energyMin: 0.8, energyMax: 1.0, builtin: true,
      code: `// Starforge — white-hot core + rotating rays, peak sections only
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x),
             mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = (fragCoord - 0.5*u_resolution) / u_resolution.y;
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float beatPulse = pow(1.0-u_beat, 2.5);
  float rays = pow(0.5 + 0.5*sin(a*10.0 + u_time*1.2 + sin(r*8.0 - u_time*2.0)), 3.0);
  float flare = rays * exp(-r*3.2) * (0.7 + 0.9*beatPulse);
  float core = exp(-r*(5.5 - 2.2*beatPulse*u_energy));
  float turb = noise(uv*6.0 + vec2(u_time*0.7, -u_time*0.5));
  vec3 col = vec3(0.05,0.02,0.10);
  col += vec3(0.95,0.35,0.10) * exp(-r*2.4) * (0.5 + 0.7*turb) * (0.6+0.6*u_rms);
  col += vec3(1.0,0.55,0.20) * flare;
  col += vec3(1.0,0.9,0.75) * core * (0.8 + 0.8*beatPulse);
  // sparks
  vec2 g = floor(uv*46.0);
  float sp = step(0.992, hash(g + floor(u_time*3.0))) * exp(-r*1.6);
  col += vec3(1.0,0.8,0.5) * sp * (0.4 + u_energy);
  fragColor = vec4(col, 1.0);
}`,
    },
  ];

  const TEMPLATE = `// New shader — Shadertoy style. Uniforms: u_time, u_resolution,
// u_beat (0..1), u_energy, u_rms, u_bars. Aliases: iTime, iResolution.
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = fragCoord / u_resolution;
  vec3 col = 0.5 + 0.5*cos(u_time + uv.xyx*6.2831 + u_beat*3.1415);
  col *= 0.7 + 0.6*u_rms;
  fragColor = vec4(col, 1.0);
}`;

  return { BUILTIN, TEMPLATE };
})();
