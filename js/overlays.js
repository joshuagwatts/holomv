'use strict';
/* HoloMV BUILD 3 — cooperative overlay library. Overlays are cheap,
 * mostly-black looks the composite blends OVER the main look (so black =
 * no effect for screen/add; the dust overlay is mid-grey based because it
 * pairs in soft-light). They ride the same uniforms as main shaders
 * (u_time, u_sub, u_kick, bands, u_seed...) and are chosen by the
 * COOPERATIVE PAIRING TABLE in app.js — never detail-on-detail: each main
 * JOURNEY stage allows only the overlays listed for it, at capped opacity
 * that backs off when the main look's section energy is high. */
window.HoloOverlays = (() => {
  const LIST = [
    {
      id: 'starfield', name: 'Starfield Drift',
      code: `// Starfield Drift — slow parallax stars (black-based, screen/add)
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = fragCoord / u_resolution;
  vec3 col = vec3(0.0);
  for(int i=0;i<3;i++){
    float fi = float(i);
    float scale = 26.0 + fi*22.0;
    vec2 g = uv*scale + vec2(u_time*(0.014+fi*0.011), u_time*0.006) + fi*37.0;
    vec2 cell = floor(g);
    float h = hash(cell);
    vec2 pos = fract(g) - vec2(hash(cell+7.0), hash(cell+13.0))*0.7 - 0.15;
    float star = smoothstep(0.10, 0.0, length(pos)) * step(0.93, h);
    float tw = 0.55 + 0.45*sin(u_time*(1.5+h*3.0) + h*40.0);
    col += vec3(0.85, 0.9, 1.0) * star * tw * (0.5 - fi*0.12);
  }
  col *= 0.8 + u_high*0.7 + u_kick*0.15;
  fragColor = vec4(col, 1.0);
}`,
    },
    {
      id: 'dust', name: 'Dust Particles',
      code: `// Dust Particles — soft drifting motes around a mid-grey base (soft-light)
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x),
             mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = fragCoord / u_resolution;
  vec2 p = uv*vec2(3.0, 5.0) + vec2(u_time*0.03, -u_time*0.05);
  float n = noise(p) * noise(p*2.7 - vec2(u_time*0.05, 0.0));
  float motes = smoothstep(0.28, 0.75, n);
  float lift = 0.10 + u_sub*0.10 + u_kick*0.05;
  vec3 col = vec3(0.5) + vec3(1.0, 0.95, 0.85) * motes * lift;
  col += vec3(1.0) * smoothstep(0.55, 0.95, n) * 0.05;
  fragColor = vec4(col, 1.0);
}`,
    },
    {
      id: 'geometry', name: 'Sacred Geometry',
      code: `// Sacred Geometry — SDF mandala rings + rotating polygons (black-based)
float sdRing(vec2 p, float r){ return abs(length(p) - r); }
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = (fragCoord - 0.5*u_resolution) / u_resolution.y;
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  vec3 col = vec3(0.0);
  float rot = u_time*0.05;
  for(int i=0;i<4;i++){
    float fi = float(i);
    float rr = 0.16 + fi*0.115 + u_sub*0.02*sin(u_time*0.7 + fi);
    float ring = smoothstep(0.006, 0.0, sdRing(uv, rr));
    float sides = 3.0 + fi;
    float poly = 0.5 + 0.5*cos(a*sides + rot*(fi+1.0));
    ring *= 0.45 + 0.55*poly;
    col += vec3(1.0, 0.9, 0.7) * ring * (0.35 - fi*0.05);
  }
  float spokes = pow(0.5 + 0.5*cos(a*12.0 - rot*2.0), 8.0) * smoothstep(0.62, 0.2, r);
  col += vec3(0.9, 0.85, 1.0) * spokes * 0.16;
  col *= 0.75 + u_mid*0.5 + u_kick*0.2;
  fragColor = vec4(col, 1.0);
}`,
    },
    {
      id: 'leaks', name: 'Light Leaks',
      code: `// Light Leaks — warm drifting light blobs (black-based, screen)
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x),
             mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = fragCoord / u_resolution;
  vec3 col = vec3(0.0);
  vec2 c1 = vec2(0.5 + 0.55*sin(u_time*0.11), 0.85 + 0.2*sin(u_time*0.07));
  vec2 c2 = vec2(0.5 + 0.6*cos(u_time*0.09 + 2.0), 0.10 + 0.18*cos(u_time*0.13));
  float d1 = length((uv - c1)*vec2(1.0, 1.9));
  float d2 = length((uv - c2)*vec2(1.0, 1.9));
  float n = 0.7 + 0.5*noise(uv*4.0 + u_time*0.05);
  col += vec3(1.0, 0.45, 0.15) * exp(-d1*3.4) * 0.55 * n;
  col += vec3(0.95, 0.25, 0.45) * exp(-d2*3.8) * 0.45 * n;
  col *= 0.75 + u_bass*0.5 + u_kick*0.2;
  fragColor = vec4(col, 1.0);
}`,
    },
    {
      id: 'halo', name: 'Spectrum Halo',
      code: `// Spectrum Halo — thin band-segmented ring (black-based, add)
float bandAt(float f){
  return clamp(u_sub*pow(1.0-f, 2.0) + u_bass*(1.0-abs(f-0.32))*0.85
             + u_mid*(1.0-abs(f-0.62)) + u_high*f*f, 0.0, 1.2);
}
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = (fragCoord - 0.5*u_resolution) / u_resolution.y;
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float f = (a + 3.14159) / 6.28318;
  float seg = floor(f*48.0) / 48.0;
  float b = bandAt(seg);
  float rr = 0.66 + b*0.05 + u_kick*0.012;
  float ring = exp(-abs(r - rr) * 90.0);
  vec3 colr = 0.5 + 0.5*cos(seg*6.28318*2.0 + vec3(0.0, 1.9, 3.9));
  vec3 col = colr * ring * (0.18 + b*0.95);
  col += colr * exp(-abs(r - rr) * 22.0) * 0.10 * b;
  fragColor = vec4(col, 1.0);
}`,
    },
  ];
  /* Blend modes (composite): 0 screen, 1 add, 2 soft. */
  const MODES = { screen: 0, add: 1, soft: 2 };
  return { LIST, MODES };
})();
