'use strict';
/* HoloMV built-in shader library. Each shader is Shadertoy-style mainImage
 * code. Available uniforms (declared by the renderer wrapper):
 *   u_time (sec, follows the track), u_resolution, u_beat (0..1 beat phase),
 *   u_energy (0..1 section energy), u_rms (live RMS), u_bars (bars elapsed),
 *   u_seed (pattern re-roll — changes on every fire/transformation/dice),
 *   u_p1 / u_p2 (per-shader dials 0..1, labels in p1Label/p2Label),
 *   plus Shadertoy aliases iTime / iResolution / iMouse.
 * Each shader is tagged with an energy centre + range for the automator's
 * ENERGY fire mode. */
window.HoloShaders = (() => {
  const BUILTIN = [
    {
      id: 'nebula', name: 'Nebula Drift', energy: 0.15, energyMin: 0.0, energyMax: 0.32, builtin: true,
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
  fragColor = vec4(col, 1.0);
}`,
    },
    {
      id: 'orbital', name: 'Orbital Rings', energy: 0.25, energyMin: 0.1, energyMax: 0.4, builtin: true,
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
  fragColor = vec4(col, 1.0);
}`,
    },
    {
      id: 'flowfield', name: 'Flow Field', energy: 0.32, energyMin: 0.16, energyMax: 0.48, builtin: true,
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
  fragColor = vec4(col, 1.0);
}`,
    },
    {
      id: 'fractal', name: 'Fractal Bloom', energy: 0.4, energyMin: 0.26, energyMax: 0.56, builtin: true,
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
  fragColor = vec4(col, 1.0);
}`,
    },
    {
      id: 'plasma', name: 'Plasma Pulse', energy: 0.5, energyMin: 0.36, energyMax: 0.64, builtin: true,
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
  fragColor = vec4(col, 1.0);
}`,
    },
    {
      id: 'chrome', name: 'Liquid Chrome', energy: 0.58, energyMin: 0.44, energyMax: 0.72, builtin: true,
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
  fragColor = vec4(col, 1.0);
}`,
    },
    {
      id: 'tunnel', name: 'Tunnel', energy: 0.66, energyMin: 0.5, energyMax: 0.8, builtin: true,
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
  fragColor = vec4(col, 1.0);
}`,
    },
    {
      id: 'gridrunner', name: 'Grid Runner', energy: 0.75, energyMin: 0.6, energyMax: 0.9, builtin: true,
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
  fragColor = vec4(col, 1.0);
}`,
    },
    {
      id: 'kaleido', name: 'Kaleido Burst', energy: 0.85, energyMin: 0.68, energyMax: 0.96, builtin: true,
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
  fragColor = vec4(col, 1.0);
}`,
    },
    {
      id: 'starforge', name: 'Starforge', energy: 0.96, energyMin: 0.8, energyMax: 1.0, builtin: true,
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
  fragColor = vec4(col, 1.0);
}`,
    },
  ];

  const TEMPLATE = `// New shader — Shadertoy style. Uniforms: u_time, u_resolution,
// u_beat (0..1), u_energy, u_rms, u_bars, u_seed, u_p1, u_p2.
// Aliases: iTime, iResolution. Declare u_p1/u_p2 usage to get the
// PARAM 1 / PARAM 2 dials on this shader.
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = fragCoord / u_resolution;
  vec3 col = 0.5 + 0.5*cos(u_time + uv.xyx*6.2831 + u_beat*3.1415 + u_seed);
  col *= 0.7 + 0.6*u_rms + u_p1*0.3;
  fragColor = vec4(col, 1.0);
}`;

  return { BUILTIN, TEMPLATE };
})();
