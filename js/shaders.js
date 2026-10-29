'use strict';
/* HoloMV built-in shader library. Each shader is Shadertoy-style mainImage
 * code. Available uniforms (declared by the renderer wrapper):
 *   u_time (sec, follows the track), u_resolution, u_beat (0..1 beat phase),
 *   u_energy (0..1 section energy), u_rms (live RMS), u_bars (bars elapsed),
 *   u_seed (pattern re-roll — changes on every fire/transformation/dice),
 *   u_p1 / u_p2 (per-shader dials 0..1, labels in p1Label/p2Label),
 *   u_sub / u_bass / u_mid / u_high (live band levels, BUILD 3),
 *   u_kick (kick envelope), u_beatEnv (beat envelope),
 *   plus Shadertoy aliases iTime / iResolution / iMouse.
 * Each shader is tagged with an energy centre + range for the automator's
 * ENERGY fire mode, and (BUILD 3) a JOURNEY stage: REALITY / FRACTALITY /
 * ABSTRACTION / VISUALIZATION. `heavy: true` marks the raymarched looks
 * the quality governor renders at reduced internal scale. */
window.HoloShaders = (() => {
  const BUILTIN = [
    {
      id: 'nebula', name: 'Nebula Drift', energy: 0.15, stage: 'VISUALIZATION', energyMin: 0.0, energyMax: 0.32, builtin: true,
      p1Label: 'Scale', p2Label: 'Glow',
      code: `// Nebula Drift — slow fbm clouds, calm sections
// Dials: P1 Scale (cloud size), P2 Glow (highlight bloom)
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
  float sd = fract(u_seed*0.317);
  vec2 soff = vec2(sd*23.7, fract(u_seed*0.731)*19.3);
  float t = u_time*0.05;
  float sc = mix(1.5, 3.6, u_p1);
  float n = fbm(uv*sc + soff + vec2(t, t*0.6));
  float m = fbm(uv*sc*1.5 - vec2(t*0.7, t) + n*1.6 + soff*0.7);
  vec3 deep = vec3(0.03,0.02,0.10);
  vec3 mid  = vec3(0.16,0.08,0.38);
  vec3 hi   = vec3(0.35,0.55,0.85);
  vec3 col = mix(deep, mid, smoothstep(0.25,0.65,m));
  float hif = smoothstep(0.6,0.95,n) * (0.35 + 0.65*u_energy) * mix(0.25, 1.5, u_p2);
  col = mix(col, hi, clamp(hif, 0.0, 1.0));
  // star specks
  vec2 g = floor(uv*90.0 + sd*40.0);
  float s = step(0.997, hash(g)) * (0.4 + 0.6*sin(u_time*1.5 + hash(g+1.0)*40.0));
  col += vec3(s) * 0.5;
  col *= 0.85 + 0.5*u_rms + 0.25*pow(1.0-u_beat, 3.0)*u_energy;
  col *= 1.0 + u_sub*0.22 + u_kick*0.30; // BUILD 3: sub weight + kick punch
  fragColor = vec4(col, 1.0);
}`,
    },
    {
      id: 'orbital', name: 'Orbital Rings', energy: 0.25, stage: 'VISUALIZATION', energyMin: 0.1, energyMax: 0.4, builtin: true,
      p1Label: 'Rings', p2Label: 'Glow',
      code: `// Orbital Rings — planets riding tilted rings around a soft core
// Dials: P1 Rings (ring count), P2 Glow (core + planet bloom)
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = (fragCoord - 0.5*u_resolution) / u_resolution.y;
  float sd = fract(u_seed*0.417);
  float ca = cos(0.9 + sd*0.8), sa = sin(0.9 + sd*0.8);
  vec2 p = mat2(ca,-sa,sa,ca) * uv;
  p.y /= 0.42; // tilt the orbital plane
  float r = length(p);
  float a = atan(p.y, p.x);
  float rings = 3.0 + floor(u_p1*5.0); // 3..7
  vec3 col = vec3(0.02,0.02,0.06);
  // ring bands
  float band = sin(r*rings*6.2831 - u_time*0.6);
  col += vec3(0.10,0.16,0.30) * smoothstep(0.75, 1.0, band) * smoothstep(1.15, 0.35, r);
  // core
  float core = exp(-length(uv)*(4.5 - 2.0*u_p2)) ;
  col += vec3(0.55,0.65,0.95) * core * (0.35 + 0.85*u_p2) * (0.7 + 0.5*u_rms);
  // orbiting planets, one per ring
  for(int i=0;i<7;i++){
    if(float(i) < rings){
    float fi = float(i);
    float rr = 0.22 + fi*0.13;
    float sp = (0.55 - fi*0.06) * (1.0 + sd);
    float ang = u_time*sp + fi*2.39 + sd*6.28;
    vec2 c = vec2(cos(ang), sin(ang)) * rr;
    float d = length(p - c);
    float pl = exp(-d*(38.0 - 18.0*u_p2));
    vec3 pc = 0.5 + 0.5*cos(fi*2.1 + sd*6.28 + vec3(0.0,1.7,3.4));
    col += pc * pl * (0.5 + 0.9*u_p2);
    }
  }
  col *= 0.85 + 0.4*u_rms + 0.2*pow(1.0-u_beat, 2.0)*u_energy;
  col *= 1.0 + u_sub*0.22 + u_kick*0.30; // BUILD 3: sub weight + kick punch
  fragColor = vec4(col, 1.0);
}`,
    },
    {
      id: 'flowfield', name: 'Flow Field', energy: 0.32, stage: 'ABSTRACTION', energyMin: 0.16, energyMax: 0.48, builtin: true,
      p1Label: 'Warp', p2Label: 'Bands',
      code: `// Flow Field — domain-warped flowing bands
// Dials: P1 Warp (domain distortion), P2 Bands (band frequency)
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x),
             mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = (fragCoord - 0.5*u_resolution) / u_resolution.y;
  float sd = fract(u_seed*0.271);
  float t = u_time*0.22;
  vec2 p = uv*3.0 + sd*11.0;
  float warp = mix(0.4, 3.2, u_p1);
  float w1 = noise(p + vec2(t, -t*0.4));
  float w2 = noise(p*1.7 - vec2(t*0.6, t) + w1*2.2*warp);
  float bands = sin((p.y + w2*2.4*warp + w1) * mix(3.0, 11.0, u_p2) + u_bars*1.57 + sd*6.28);
  float v = smoothstep(-0.9, 0.9, bands);
  vec3 a = vec3(0.02,0.10,0.14);
  vec3 b = vec3(0.10,0.65,0.60);
  vec3 c = vec3(0.65,0.95,0.75);
  vec3 col = mix(a, b, v);
  col = mix(col, c, pow(v, 6.0) * (0.4 + 0.6*u_energy));
  col *= 0.8 + 0.7*u_rms + 0.35*pow(1.0-u_beat, 2.0);
  col *= 1.0 + u_sub*0.22 + u_kick*0.30; // BUILD 3: sub weight + kick punch
  fragColor = vec4(col, 1.0);
}`,
    },
    {
      id: 'fractal', name: 'Fractal Bloom', energy: 0.4, stage: 'FRACTALITY', energyMin: 0.26, energyMax: 0.56, builtin: true,
      p1Label: 'Petals', p2Label: 'Glow',
      code: `// Fractal Bloom — folded kali-style fractal flower
// Dials: P1 Petals (fold symmetry), P2 Glow (edge bloom)
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = (fragCoord - 0.5*u_resolution) / u_resolution.y;
  float sd = fract(u_seed*0.531);
  vec2 p = uv * (1.35 + 0.3*sin(u_time*0.13 + sd*6.28));
  float rot = u_time*0.07 + sd*3.14;
  float ca = cos(rot), sa = sin(rot);
  p = mat2(ca,-sa,sa,ca) * p;
  float petals = 3.0 + floor(u_p1*5.0); // 3..7 folds
  float acc = 0.0;
  float scale = 1.0;
  for(int i=0;i<6;i++){
    float a = atan(p.y, p.x);
    float seg = 6.28318/petals;
    a = mod(a, seg); a = abs(a - seg*0.5);
    float r = length(p);
    p = vec2(cos(a), sin(a)) * r;
    p = abs(p) - vec2(0.38, 0.24);
    p *= 1.55;
    scale *= 1.55;
    acc += exp(-length(p)*3.5) / scale;
  }
  vec3 base = 0.5 + 0.5*cos(sd*6.28 + acc*2.4 + vec3(0.0, 1.9, 3.9));
  vec3 col = base * acc * mix(0.5, 1.9, u_p2) * (0.55 + 0.6*u_energy);
  col += vec3(0.9,0.7,1.0) * pow(acc, 3.0) * u_p2 * pow(1.0-u_beat, 2.0);
  col *= 0.8 + 0.55*u_rms;
  col *= 1.0 + u_sub*0.22 + u_kick*0.30; // BUILD 3: sub weight + kick punch
  fragColor = vec4(col, 1.0);
}`,
    },
    {
      id: 'plasma', name: 'Plasma Pulse', energy: 0.5, stage: 'ABSTRACTION', energyMin: 0.36, energyMax: 0.64, builtin: true,
      p1Label: 'Zoom', p2Label: 'Speed',
      code: `// Plasma Pulse — classic plasma, breathes on the beat
// Dials: P1 Zoom (pattern scale), P2 Speed (flow rate)
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = (fragCoord - 0.5*u_resolution) / u_resolution.y;
  float sd = fract(u_seed*0.613);
  float beatPulse = pow(1.0 - u_beat, 2.0);
  float zoom = mix(5.0, 1.8, u_p1) - 0.5*beatPulse*u_energy;
  vec2 p = uv * zoom + sd*9.0;
  float t = u_time*0.7*mix(0.25, 1.8, u_p2) + sd*20.0;
  float v = sin(p.x*3.0 + t)
          + sin(p.y*4.0 - t*1.3)
          + sin((p.x+p.y)*2.4 + t*0.7)
          + sin(length(p)*5.0 - t*1.8 - beatPulse*2.0);
  v *= 0.25;
  vec3 col = 0.5 + 0.5*cos(3.14159*v + vec3(0.0, 1.4, 2.6) + u_energy*1.5 + sd*3.14);
  col *= 0.75 + 0.6*u_rms + 0.45*beatPulse;
  col *= 1.0 + u_sub*0.22 + u_kick*0.30; // BUILD 3: sub weight + kick punch
  fragColor = vec4(col, 1.0);
}`,
    },
    {
      id: 'chrome', name: 'Liquid Chrome', energy: 0.58, stage: 'ABSTRACTION', energyMin: 0.44, energyMax: 0.72, builtin: true,
      p1Label: 'Warp', p2Label: 'Shine',
      code: `// Liquid Chrome — warped metallic flow with sharp specular bands
// Dials: P1 Warp (liquid distortion), P2 Shine (specular hardness)
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x),
             mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for(int i=0;i<4;i++){ v += a*noise(p); p = p*2.1 + vec2(13.7, 7.9); a *= 0.55; }
  return v;
}
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = (fragCoord - 0.5*u_resolution) / u_resolution.y;
  float sd = fract(u_seed*0.389);
  float t = u_time*0.16;
  vec2 p = uv*2.6 + sd*7.0;
  float warp = mix(0.5, 3.4, u_p1);
  float n1 = fbm(p + vec2(t, -t*0.7));
  float n2 = fbm(p*1.6 - vec2(t*0.8, t) + n1*warp);
  float field = n2*1.6 + uv.y*0.7 + sin(u_bars*1.57)*0.05;
  float bands = fract(field*3.0 + sd);
  vec3 metal = mix(vec3(0.05,0.06,0.09), vec3(0.75,0.80,0.90), smoothstep(0.0, 0.55, bands));
  metal = mix(metal, vec3(0.25,0.30,0.45), smoothstep(0.55, 0.8, bands)*(0.4+0.6*u_energy));
  float spec = pow(smoothstep(0.46, 0.5, bands) * smoothstep(0.54, 0.5, bands), mix(1.0, 6.0, u_p2));
  vec3 col = metal + vec3(1.0,0.98,0.95) * spec * (0.35 + 1.3*u_p2);
  col += vec3(0.9,0.6,0.3) * pow(1.0-u_beat, 3.0) * exp(-length(uv)*3.0) * u_energy * 0.5;
  col *= 0.8 + 0.55*u_rms;
  col *= 1.0 + u_sub*0.22 + u_kick*0.30; // BUILD 3: sub weight + kick punch
  fragColor = vec4(col, 1.0);
}`,
    },
    {
      id: 'tunnel', name: 'Tunnel', energy: 0.66, stage: 'ABSTRACTION', energyMin: 0.5, energyMax: 0.8, builtin: true,
      p1Label: 'Twist', p2Label: 'Glow',
      code: `// Tunnel — polar rings flying with the bars
// Dials: P1 Twist (spiral amount), P2 Glow (core light)
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = (fragCoord - 0.5*u_resolution) / u_resolution.y;
  float sd = fract(u_seed*0.733);
  float r = length(uv) + 1e-4;
  float a = atan(uv.y, uv.x) + sd*6.28 + (1.0/r)*mix(-0.6, 1.6, u_p1)*0.35;
  float speed = u_bars*2.0;
  float rings = sin((1.0/r)*7.0 - speed*6.2831 + sin(a*6.0 + u_time*0.8)*0.7);
  float spokes = 0.5 + 0.5*sin(a*12.0 + u_time*0.5);
  float v = smoothstep(0.0, 1.0, rings*0.5+0.5) * (0.55 + 0.45*spokes);
  vec3 near = vec3(0.95,0.45,0.15);
  vec3 far  = vec3(0.08,0.05,0.30);
  vec3 col = mix(far, near, v * smoothstep(0.0, 0.55, r + 0.25));
  col += vec3(1.0,0.8,0.5) * pow(1.0-u_beat, 3.0) * smoothstep(0.35,0.0,r) * (0.4+0.6*u_energy) * mix(0.2, 1.8, u_p2);
  col *= (0.8 + 0.6*u_rms) * smoothstep(0.0, 0.12, r);
  col *= 1.0 + u_sub*0.22 + u_kick*0.30; // BUILD 3: sub weight + kick punch
  fragColor = vec4(col, 1.0);
}`,
    },
    {
      id: 'gridrunner', name: 'Grid Runner', energy: 0.75, stage: 'VISUALIZATION', energyMin: 0.6, energyMax: 0.9, builtin: true,
      p1Label: 'Grid Scale', p2Label: 'Glow',
      code: `// Grid Runner — perspective floor grid racing with the bars
// Dials: P1 Grid Scale (cell density), P2 Glow (line + horizon bloom)
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = (fragCoord - 0.5*u_resolution) / u_resolution.y;
  float sd = fract(u_seed*0.457);
  vec3 col = vec3(0.015,0.01,0.05);
  // sky glow toward the horizon
  col += vec3(0.30,0.08,0.38) * exp(-abs(uv.y + 0.02)*4.5) * (0.5 + 0.7*u_energy);
  col += vec3(0.95,0.45,0.9) * exp(-abs(uv.y + 0.02)*22.0) * mix(0.3, 1.6, u_p2) * (0.6 + 0.6*u_rms);
  if (uv.y < -0.02) {
    float persp = 0.28 / max(0.015, -(uv.y + 0.02));
    vec2 gp = vec2(uv.x * persp + sd*4.0, persp + u_bars*2.0 + sd*3.0);
    float dens = mix(0.6, 1.8, u_p1);
    vec2 gv = abs(fract(gp*dens) - 0.5);
    float line = smoothstep(0.46, 0.5, max(gv.x, gv.y));
    float fade = exp(-persp*0.16) * smoothstep(-0.55, -0.05, uv.y);
    vec3 gridCol = mix(vec3(0.05,0.75,0.95), vec3(0.95,0.3,0.85), clamp(persp*0.05 + sd*0.4, 0.0, 1.0));
    col += gridCol * line * fade * mix(0.5, 2.0, u_p2);
    col += gridCol * 0.10 * fade;
    // beat pulse travelling out from the horizon
    float wave = exp(-abs(fract(persp*0.14 - u_bars*0.5) - 0.5)*9.0);
    col += vec3(1.0) * wave * pow(1.0-u_beat, 2.0) * fade * 0.35 * u_p2;
  }
  col *= 0.85 + 0.45*u_rms;
  col *= 1.0 + u_sub*0.22 + u_kick*0.30; // BUILD 3: sub weight + kick punch
  fragColor = vec4(col, 1.0);
}`,
    },
    {
      id: 'kaleido', name: 'Kaleido Burst', energy: 0.85, stage: 'ABSTRACTION', energyMin: 0.68, energyMax: 0.96, builtin: true,
      p1Label: 'Segments', p2Label: 'Rings',
      code: `// Kaleido Burst — mirrored segments, snaps on the beat
// Dials: P1 Segments (mirror count), P2 Rings (ring frequency)
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x),
             mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = (fragCoord - 0.5*u_resolution) / u_resolution.y;
  float sd = fract(u_seed*0.191);
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float segs = 4.0 + floor(u_p1*8.0); // 4..11
  float seg = 6.28318/segs;
  a = mod(a + u_time*0.25 + floor(u_bars)*0.13 + sd*3.0, seg);
  a = abs(a - seg*0.5);
  vec2 k = vec2(cos(a), sin(a)) * r;
  float n = noise(k*7.0 + u_time*0.4 + sd*13.0) * noise(k*3.0 - u_time*0.3);
  float rings = sin(r*mix(10.0, 34.0, u_p2) - u_time*3.0 - u_beat*6.2831)*0.5+0.5;
  vec3 col = 0.5 + 0.5*cos(vec3(0.0,2.1,4.2) + n*9.0 + u_energy*2.0 + sd*4.0);
  col *= 0.35 + 0.85*rings*(0.5+n);
  col += vec3(1.0) * pow(1.0-u_beat, 4.0) * smoothstep(0.5,0.0,r) * u_energy;
  col *= 0.8 + 0.7*u_rms;
  col *= 1.0 + u_sub*0.22 + u_kick*0.30; // BUILD 3: sub weight + kick punch
  fragColor = vec4(col, 1.0);
}`,
    },
    {
      id: 'starforge', name: 'Starforge', energy: 0.96, stage: 'VISUALIZATION', energyMin: 0.8, energyMax: 1.0, builtin: true,
      p1Label: 'Rays', p2Label: 'Core',
      code: `// Starforge — white-hot core + rotating rays, peak sections only
// Dials: P1 Rays (ray count), P2 Core (core size/heat)
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x),
             mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = (fragCoord - 0.5*u_resolution) / u_resolution.y;
  float sd = fract(u_seed*0.853);
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float beatPulse = pow(1.0-u_beat, 2.5);
  float rays = pow(0.5 + 0.5*sin(a*mix(6.0, 16.0, u_p1) + u_time*1.2 + sin(r*8.0 - u_time*2.0) + sd*6.28), 3.0);
  float flare = rays * exp(-r*3.2) * (0.7 + 0.9*beatPulse);
  float core = exp(-r*(7.5 - 4.5*u_p2 - 2.2*beatPulse*u_energy));
  float turb = noise(uv*6.0 + vec2(u_time*0.7, -u_time*0.5) + sd*15.0);
  vec3 col = vec3(0.05,0.02,0.10);
  col += vec3(0.95,0.35,0.10) * exp(-r*2.4) * (0.5 + 0.7*turb) * (0.6+0.6*u_rms);
  col += vec3(1.0,0.55,0.20) * flare;
  col += vec3(1.0,0.9,0.75) * core * (0.8 + 0.8*beatPulse) * (0.5 + u_p2);
  // sparks
  vec2 g = floor(uv*46.0 + sd*30.0);
  float sp = step(0.992, hash(g + floor(u_time*3.0))) * exp(-r*1.6);
  col += vec3(1.0,0.8,0.5) * sp * (0.4 + u_energy);
  col *= 1.0 + u_sub*0.22 + u_kick*0.30; // BUILD 3: sub weight + kick punch
  fragColor = vec4(col, 1.0);
}`,
    },
    {
      id: 'highlands', name: 'Fractal Highlands', energy: 0.35, energyMin: 0.15, energyMax: 0.55, builtin: true, stage: 'REALITY', heavy: true,
      p1Label: 'Rugged', p2Label: 'Haze',
      code: `// Fractal Highlands — raymarched fractal terrain flyover (REALITY)
// Dials: P1 Rugged (ridge sharpness), P2 Haze (fog density)
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x),
             mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}
float terrain(vec2 p, float rugged){
  float v = 0.0, a = 0.55;
  for(int i=0;i<5;i++){
    float n = noise(p);
    n = mix(n, 1.0-abs(n*2.0-1.0), rugged*0.7);
    v += a*n; p = p*2.13 + vec2(19.7, 7.3); a *= 0.55;
  }
  return v;
}
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = (fragCoord - 0.5*u_resolution) / u_resolution.y;
  float sd = fract(u_seed*0.317);
  float rugged = mix(0.15, 1.0, u_p1);
  float haze = mix(0.4, 1.6, u_p2);
  float fly = u_time*(0.85 + u_sub*0.7) + sd*40.0;
  vec3 ro = vec3(sd*30.0, 2.35 + u_sub*0.35, fly);
  vec3 rd = normalize(vec3(uv.x*0.85, uv.y*0.55 - 0.10 - u_kick*0.02, 1.0));
  vec3 skyA = vec3(0.10, 0.16, 0.30);
  vec3 skyB = vec3(0.85, 0.55, 0.32);
  vec3 col = mix(skyB, skyA, smoothstep(-0.05, 0.6, uv.y));
  col += vec3(1.0, 0.75, 0.45) * pow(max(0.0, dot(rd, normalize(vec3(0.25, 0.28, 1.0)))), 24.0) * 0.8;
  float t = 0.0, hit = 0.0;
  vec3 p = ro;
  for(int i=0;i<44;i++){
    if (hit < 0.5) {
      p = ro + rd * t;
      if (p.y < terrain(p.xz*0.16, rugged) * 2.6) hit = 1.0;
      t += 0.16 + t*0.045;
    }
  }
  if (hit > 0.5) {
    float e = 0.06;
    float hC = terrain(p.xz*0.16, rugged) * 2.6;
    float hX = terrain((p.xz+vec2(e,0.0))*0.16, rugged) * 2.6;
    float hZ = terrain((p.xz+vec2(0.0,e))*0.16, rugged) * 2.6;
    vec3 n = normalize(vec3(hC-hX, e, hC-hZ));
    vec3 sun = normalize(vec3(0.25, 0.28, 1.0));
    float diff = max(0.0, dot(n, sun));
    vec3 terr = mix(vec3(0.10,0.22,0.09), vec3(0.16,0.13,0.12), smoothstep(0.92, 0.55, n.y));
    terr = mix(terr, vec3(0.85,0.88,0.95), smoothstep(1.55, 2.2, hC));
    vec3 lit = terr * (0.22 + 0.95*diff) + vec3(1.0,0.7,0.45)*pow(diff, 3.0)*0.15;
    float fog = 1.0 - exp(-t * 0.028 * haze);
    col = mix(lit, mix(skyB, skyA, 0.35), fog);
    col *= 0.9 + u_sub*0.25 + u_kick*0.35;
  }
  col *= 0.85 + 0.35*u_rms;
  fragColor = vec4(col, 1.0);
}`,
    },
    {
      id: 'planetfall', name: 'Planetfall', energy: 0.28, energyMin: 0.08, energyMax: 0.45, builtin: true, stage: 'REALITY', heavy: true,
      p1Label: 'Atmosphere', p2Label: 'Detail',
      code: `// Planetfall — raymarched planet, atmosphere glow + starfield (REALITY)
// Dials: P1 Atmosphere (rim glow), P2 Detail (surface displacement)
float hash(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7)))*43758.5453); }
float noise(vec3 p){
  vec3 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  float n000=hash(i), n100=hash(i+vec3(1,0,0)), n010=hash(i+vec3(0,1,0)), n110=hash(i+vec3(1,1,0));
  float n001=hash(i+vec3(0,0,1)), n101=hash(i+vec3(1,0,1)), n011=hash(i+vec3(0,1,1)), n111=hash(i+vec3(1,1,1));
  return mix(mix(mix(n000,n100,f.x),mix(n010,n110,f.x),f.y),
             mix(mix(n001,n101,f.x),mix(n011,n111,f.x),f.y), f.z);
}
float fbm(vec3 p){ float v=0.0,a=0.5; for(int i=0;i<4;i++){ v+=a*noise(p); p=p*2.2+vec3(7.7); a*=0.55; } return v; }
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = (fragCoord - 0.5*u_resolution) / u_resolution.y;
  float sd = fract(u_seed*0.439);
  vec3 ro = vec3(0.0, 0.35, -3.1);
  vec3 rd = normalize(vec3(uv.x, uv.y, 1.15));
  // starfield
  vec3 col = vec3(0.012, 0.016, 0.045);
  float st = step(0.9985, hash(floor(rd*170.0 + sd*90.0)));
  col += vec3(0.9, 0.95, 1.0) * st * (0.35 + 0.4*sin(u_time*2.0 + hash(floor(rd*170.0))*40.0));
  float ang = u_time*0.03 + sd*6.28;
  float ca = cos(ang), sa = sin(ang);
  float t = 0.0, hit = 0.0, dmin = 10.0;
  vec3 p = ro;
  for(int i=0;i<42;i++){
    if (hit < 0.5 && t < 8.0) {
      p = ro + rd * t;
      float d = length(p) - 1.18 + (fbm(p*2.6 + sd*7.0) - 0.5) * u_p2 * 0.20;
      dmin = min(dmin, d);
      if (d < 0.004) hit = 1.0;
      t += max(d*0.75, 0.012);
    }
  }
  vec3 sun = normalize(vec3(0.55, 0.35, -0.45));
  if (hit > 0.5) {
    vec3 n = normalize(p);
    vec2 q2 = mat2(ca,-sa,sa,ca) * p.xz;
    vec3 qp = vec3(q2.x, p.y, q2.y);
    float m = fbm(qp*3.0 + sd*3.0);
    float land = smoothstep(0.52, 0.565, m);
    vec3 surf = mix(vec3(0.02,0.10,0.28), vec3(0.10,0.30,0.12), land);
    surf = mix(surf, vec3(0.55,0.42,0.22), land * smoothstep(0.3, 0.75, abs(p.y)) * 0.6);
    float clouds = smoothstep(0.55, 0.78, fbm(qp*4.5 + vec3(u_time*0.02, 0.0, sd*5.0)));
    surf = mix(surf, vec3(0.95), clouds*0.55);
    float diff = clamp(dot(n, sun)*0.5+0.5, 0.0, 1.0);
    diff = pow(diff, 1.6);
    vec3 lit = surf * (0.03 + 1.05*diff);
    float fres = pow(1.0 - max(0.0, dot(n, -rd)), 3.0);
    lit += vec3(0.30,0.55,1.0) * fres * (0.25 + 1.25*u_p1) * (0.35 + 0.85*diff) * (0.7 + u_sub*0.6);
    col = lit;
  } else {
    float glow = exp(-max(0.0, dmin) * 4.0) * (0.15 + 0.85*u_p1);
    col += vec3(0.30,0.55,1.0) * glow * (0.6 + u_sub*0.5);
  }
  col *= 0.9 + 0.3*u_rms + u_kick*0.22 + u_sub*0.12;
  fragColor = vec4(col, 1.0);
}`,
    },
    {
      id: 'mandelbulb', name: 'Mandelbulb', energy: 0.55, energyMin: 0.38, energyMax: 0.72, builtin: true, stage: 'FRACTALITY', heavy: true,
      p1Label: 'Power', p2Label: 'Zoom',
      code: `// Mandelbulb — raymarched power-8 fractal (FRACTALITY)
// Dials: P1 Power (bulb exponent), P2 Zoom (camera distance)
float bulbDE(vec3 pos, float power, out float trap){
  vec3 z = pos; float dr = 1.0, r = 0.0; trap = 10.0;
  for(int i=0;i<9;i++){
    r = length(z);
    if (r <= 2.0 && r > 1e-5) {
      float theta = acos(clamp(z.z/r, -1.0, 1.0)) * power;
      float phi = atan(z.y, z.x) * power;
      dr = pow(r, power-1.0) * power * dr + 1.0;
      float zr = pow(r, power);
      z = zr * vec3(sin(theta)*cos(phi), sin(phi)*sin(theta), cos(theta)) + pos;
      trap = min(trap, length(z.xz));
    }
  }
  r = max(r, 1e-4);
  return 0.5 * log(r) * r / dr;
}
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = (fragCoord - 0.5*u_resolution) / u_resolution.y;
  float sd = fract(u_seed*0.577);
  float ang = u_time*0.07 + sd*3.0;
  float ca = cos(ang), sa = sin(ang);
  float cd = mix(2.9, 1.8, u_p2) - u_sub*0.14;
  vec3 ro = vec3(0.0, 0.55, -cd);
  ro.xz = mat2(ca,-sa,sa,ca) * ro.xz;
  vec3 fwd = normalize(-ro);
  vec3 right = normalize(cross(vec3(0.0,1.0,0.0), fwd));
  vec3 up = cross(fwd, right);
  vec3 rd = normalize(fwd*1.2 + right*uv.x + up*uv.y);
  float power = mix(6.5, 10.5, u_p1) + sin(u_bars*0.35)*0.35 + u_sub*0.7;
  vec3 col = mix(vec3(0.02,0.01,0.05), vec3(0.05,0.03,0.10), uv.y*0.5+0.5);
  float t = 0.0, hit = 0.0, trap = 10.0, steps = 0.0;
  vec3 p = ro;
  for(int i=0;i<46;i++){
    if (hit < 0.5 && t < 7.0) {
      p = ro + rd * t;
      float tr2 = 10.0;
      float d = bulbDE(p, power, tr2);
      trap = tr2; steps = float(i);
      if (d < 0.0018) hit = 1.0;
      t += d * 0.55;
    }
  }
  if (hit > 0.5) {
    vec3 base = 0.5 + 0.5*cos(trap*3.2 + sd*6.28 + vec3(0.0, 1.9, 3.9));
    float ao = 1.0 - steps/46.0 * 0.55;
    col = base * (0.30 + 0.85*ao) * exp(-t*0.28) * 2.4;
    col += vec3(1.0, 0.75, 0.5) * pow(1.0-u_beat, 2.0) * exp(-t*0.9) * 0.35 * u_energy;
  } else {
    col += vec3(0.35,0.2,0.6) * exp(-length(uv)*2.6) * (0.25 + u_sub*0.4);
  }
  col *= 0.85 + 0.4*u_rms + u_kick*0.25;
  fragColor = vec4(col, 1.0);
}`,
    },
    {
      id: 'cathedral', name: 'Fractal Cathedral', energy: 0.7, energyMin: 0.52, energyMax: 0.86, builtin: true, stage: 'FRACTALITY', heavy: true,
      p1Label: 'Scale', p2Label: 'Glow',
      code: `// Fractal Cathedral — box-fold fractal architecture fly-through (FRACTALITY)
// Dials: P1 Scale (fold scale), P2 Glow (window light)
float mapC(vec3 p, float fscale){
  vec3 q = p;
  q.x = mod(q.x, 6.0) - 3.0;
  q.z = mod(q.z, 6.0) - 3.0;
  float s = 1.0;
  for(int i=0;i<5;i++){
    q = abs(q) - vec3(0.85, 0.55, 0.85);
    float c = cos(0.42), sn = sin(0.42);
    q.xz = mat2(c,-sn,sn,c) * q.xz;
    q.xy = mat2(c,-sn,sn,c) * q.xy;
    q *= fscale; s *= fscale;
  }
  return (length(q) - 1.05) / s;
}
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = (fragCoord - 0.5*u_resolution) / u_resolution.y;
  float sd = fract(u_seed*0.691);
  float fscale = mix(1.38, 1.58, u_p1);
  float fly = u_time*(0.7 + u_sub*0.55) + sd*60.0;
  vec3 ro = vec3(sin(fly*0.11)*1.4, 0.4 + sin(fly*0.07)*0.5 + u_sub*0.2, fly);
  vec3 rd = normalize(vec3(uv.x*0.8, uv.y*0.6, 1.0));
  vec3 col = vec3(0.015, 0.012, 0.03);
  float t = 0.0, hit = 0.0, steps = 0.0;
  vec3 p = ro;
  for(int i=0;i<52;i++){
    if (hit < 0.5 && t < 26.0) {
      p = ro + rd * t;
      float d = mapC(p, fscale);
      if (d < 0.01) hit = 1.0;
      t += max(d*0.6, 0.02);
      steps = float(i);
    }
  }
  if (hit > 0.5) {
    float ao = 1.0 - steps/52.0 * 0.6;
    vec3 stone = mix(vec3(0.10,0.09,0.13), vec3(0.35,0.28,0.22), clamp(p.y*0.14+0.5, 0.0, 1.0));
    float win = pow(0.5 + 0.5*sin(p.y*9.0 + sin(p.x*3.0 + p.z*3.0)*2.0), 6.0);
    vec3 lit = stone * (0.25 + 0.9*ao) * exp(-t*0.10);
    lit += vec3(1.0, 0.72, 0.38) * win * mix(0.15, 1.5, u_p2) * exp(-t*0.16) * (0.6 + u_energy*0.7);
    lit += vec3(0.45, 0.55, 1.0) * exp(-t*0.3) * pow(1.0-u_beat, 2.0) * 0.4;
    col = lit;
  } else {
    col += vec3(0.30,0.36,0.65) * exp(-t*0.05) * 0.12;
  }
  col *= 0.85 + 0.4*u_rms + u_kick*0.22 + u_sub*0.15;
  fragColor = vec4(col, 1.0);
}`,
    },
    {
      id: 'sonicrings', name: 'Sonic Rings', energy: 0.8, energyMin: 0.6, energyMax: 0.95, builtin: true, stage: 'VISUALIZATION',
      p1Label: 'Rings', p2Label: 'Punch',
      code: `// Sonic Rings — band-driven concentric rings (VISUALIZATION)
// Inner rings ride the SUB, outer rings ride the HIGHS.
// Dials: P1 Rings (ring count), P2 Punch (band radius push)
float hash(float n){ return fract(sin(n)*43758.5453); }
float specAt(float f){
  float v = u_sub*pow(1.0-f, 2.0)
          + u_bass*(1.0-abs(f-0.32))*0.85
          + u_mid*(1.0-abs(f-0.62))
          + u_high*f*f;
  return clamp(v, 0.0, 1.2);
}
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = (fragCoord - 0.5*u_resolution) / u_resolution.y;
  float sd = fract(u_seed*0.233);
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  vec3 col = vec3(0.015, 0.015, 0.035);
  float rings = 6.0 + floor(u_p1*8.0); // 6..13
  for(int i=0;i<14;i++){
    if (float(i) < rings) {
      float fi = float(i);
      float f = fi / max(1.0, rings-1.0);
      float sp = specAt(f);
      float rr = 0.07 + fi*0.068 + sp * 0.055 * mix(0.3, 2.2, u_p2);
      float d = abs(r - rr);
      float ring = exp(-d*(90.0 - sp*30.0));
      vec3 rc = 0.5 + 0.5*cos(fi*0.85 + sd*6.28 + vec3(0.0, 1.9, 3.9));
      col += rc * ring * (0.25 + sp*1.15);
      // segmented dashes riding the mids/highs
      float dash = step(0.5, fract(a*4.775 + fi*1.7 + u_time*(0.2+f*0.5)));
      col += rc * exp(-d*160.0) * dash * u_mid * 0.5;
    }
  }
  // core: kicks pump the centre disc
  float core = exp(-r*(9.0 - u_kick*3.5 - u_sub*1.5));
  col += vec3(1.0, 0.85, 0.6) * core * (0.35 + u_kick*0.9 + u_sub*0.3);
  // high sparkle around the rim
  float seg = floor((a+3.14159)*7.639);
  float spark = step(0.965, hash(seg*3.7 + floor(u_time*5.0)*13.1 + sd*40.0)) * u_high;
  col += vec3(0.9, 0.95, 1.0) * spark * exp(-abs(r-0.62)*7.0) * 1.4;
  col *= 0.85 + 0.35*u_rms;
  fragColor = vec4(col, 1.0);
}`,
    },
    {
      id: 'specterrain', name: 'Spectrum Terrain', energy: 0.62, energyMin: 0.45, energyMax: 0.8, builtin: true, stage: 'VISUALIZATION',
      p1Label: 'Height', p2Label: 'Glow',
      code: `// Spectrum Terrain — band-driven ridge landscape (VISUALIZATION)
// Front ridges ride the SUB, back ridges ride the HIGHS.
// Dials: P1 Height (ridge amplitude), P2 Glow (line bloom)
float ridgeH(float x, float row, float t){
  float f = row/9.0;
  float amp = u_sub*(1.0-f)*(1.0-f)*1.15
            + u_bass*0.7*(1.0-abs(f-0.3))
            + u_mid*0.65*(1.0-abs(f-0.6))
            + u_high*0.55*f;
  float n = sin(x*3.1 + row*7.7 + t)*0.5
          + sin(x*7.3 - row*3.1 - t*1.7)*0.3
          + sin(x*15.0 + row*13.0 + t*2.3)*0.2;
  return n * (0.045 + amp * mix(0.05, 0.30, u_p1)) + amp*0.05;
}
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = (fragCoord - 0.5*u_resolution) / u_resolution.y;
  float sd = fract(u_seed*0.811);
  vec3 col = mix(vec3(0.02,0.01,0.06), vec3(0.05,0.10,0.20), smoothstep(-0.4, 0.6, uv.y));
  col += vec3(0.9,0.5,0.25) * exp(-abs(uv.y-0.03)*9.0) * 0.16 * (0.6+u_energy*0.6);
  float t = u_time*0.35 + u_bars*0.8 + sd*20.0;
  for(int i=0;i<10;i++){
    float fi = float(i);
    float baseY = 0.03 - fi*0.088;
    float y = baseY + ridgeH(uv.x*2.2 + sd*9.0, fi, t + fi*0.6);
    float line = exp(-abs(uv.y - y) * (150.0 - fi*7.0));
    vec3 rc = mix(vec3(0.05,0.80,0.90), vec3(0.95,0.35,0.90), fi/9.0);
    col += rc * line * mix(0.2, 1.5, u_p2) * (0.45 + fi*0.08) * (0.7 + 0.5*u_rms);
    col += rc * 0.055 * smoothstep(y, y-0.25, uv.y) * step(uv.y, y);
  }
  col *= 0.9 + u_kick*0.25 + u_sub*0.1;
  fragColor = vec4(col, 1.0);
}`,
    },
  ];

  const TEMPLATE = `// New shader — Shadertoy style. Uniforms: u_time, u_resolution,
// u_beat (0..1), u_energy, u_rms, u_bars, u_seed, u_p1, u_p2,
// u_sub, u_bass, u_mid, u_high, u_kick, u_beatEnv.
// Aliases: iTime, iResolution. Declare u_p1/u_p2 usage to get the
// PARAM 1 / PARAM 2 dials on this shader.
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = fragCoord / u_resolution;
  vec3 col = 0.5 + 0.5*cos(u_time + uv.xyx*6.2831 + u_beat*3.1415 + u_seed);
  col *= 0.7 + 0.6*u_rms + u_p1*0.3;
  col *= 1.0 + u_sub*0.22 + u_kick*0.30; // BUILD 3: sub weight + kick punch
  fragColor = vec4(col, 1.0);
}`;

  return { BUILTIN, TEMPLATE };
})();
