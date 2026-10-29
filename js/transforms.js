'use strict';
/* HoloMV transformation combos — a "new look" for a shader without changing
 * the shader: a fresh u_seed re-rolls its pattern, and a transform combo is
 * applied on the renderer's composite stage (so it works on EVERY shader,
 * including user-pasted ones). CHAOS (0..1) scales how wild a combo gets:
 *   chaos = 0     -> NEUTRAL combo, only the seed changes;
 *   mirror/kaleido probabilities scale with chaos;
 *   hue / zoom / rotation / speed magnitudes scale with chaos;
 *   invert is gated to chaos > 0.7.
 * Pure logic: no DOM, no GL. Randomness is injectable for tests. */
(function (global) {
  const NEUTRAL = Object.freeze({
    mirrorX: false, mirrorY: false, kaleido: 0,
    hueDeg: 0, zoom: 1, rotDeg: 0, speed: 1, invert: false,
  });
  const KALEIDO_CHOICES = [3, 4, 6];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  function neutral() { return { ...NEUTRAL }; }

  /* Build a random combo. rand() -> 0..1 (defaults to Math.random). */
  function makeTransform(rand, chaos) {
    const r = typeof rand === 'function' ? rand : Math.random;
    const c = clamp(+chaos || 0, 0, 1);
    if (c <= 0.001) return neutral();
    const t = neutral();
    if (r() < 0.7 * c) t.mirrorX = true;
    if (r() < 0.45 * c) t.mirrorY = true;
    if (r() < 0.6 * c) {
      // higher chaos unlocks the 6-segment fold
      const pool = c > 0.4 ? KALEIDO_CHOICES : [3, 4];
      t.kaleido = pool[Math.min(pool.length - 1, Math.floor(r() * pool.length))];
    }
    t.hueDeg = Math.round((r() * 2 - 1) * 180 * c);
    t.zoom = +clamp(1 + (r() * 2 - 1) * 0.45 * c, 0.8, 1.45).toFixed(3);
    t.rotDeg = Math.round((r() * 2 - 1) * 30 * c);
    t.speed = +clamp(1 + (r() * 2 - 1) * c, 0.5, 2).toFixed(3);
    if (c > 0.7 && r() < 0.4) t.invert = true;
    return t;
  }

  function isNeutral(t) {
    return !!t && !t.mirrorX && !t.mirrorY && !t.kaleido && !t.invert
      && t.hueDeg === 0 && t.zoom === 1 && t.rotDeg === 0 && t.speed === 1;
  }

  /* Short human description for the fire log. Seed is logged by the caller. */
  function describe(t) {
    if (!t || isNeutral(t)) return 'seed only';
    const parts = [];
    if (t.kaleido) parts.push('kaleido ' + t.kaleido);
    if (t.mirrorX) parts.push('mirror X');
    if (t.mirrorY) parts.push('mirror Y');
    if (t.hueDeg) parts.push('hue ' + (t.hueDeg > 0 ? '+' : '') + t.hueDeg + '°');
    if (t.zoom !== 1) parts.push('zoom ' + t.zoom.toFixed(2));
    if (t.rotDeg) parts.push('rot ' + (t.rotDeg > 0 ? '+' : '') + t.rotDeg + '°');
    if (t.speed !== 1) parts.push('speed ' + t.speed.toFixed(2) + '×');
    if (t.invert) parts.push('INVERT');
    return parts.join(' · ') || 'seed only';
  }

  const api = { NEUTRAL, neutral, makeTransform, isNeutral, describe };
  global.HoloTransforms = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
