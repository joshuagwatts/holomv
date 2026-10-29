'use strict';
/* HoloMV demo track — synthesized in-code with OfflineAudioContext so the
 * whole pipeline (tempo detect -> RMS sections -> automator -> export) can
 * be proven with zero files. Known ground truth:
 *   BPM 128, sections 16 bars quiet -> 32 bars loud -> 16 bars quiet
 *   (64 bars = 120 s at 128 BPM). Quiet ~0.14 amp vs loud ~0.9 amp keeps a
 *   >10 dB RMS step at each boundary, which RmsAnalyze finds as-is. */
window.HoloDemo = (() => {
  const BPM = 128;
  const SECTION_BARS = [16, 32, 16];
  const SECTION_AMP = [0.14, 0.9, 0.14];

  async function render() {
    const sr = 22050; // half-rate render: same music, ~2x faster to synthesize
    const beatDur = 60 / BPM;
    const barDur = beatDur * 4;
    const totalBars = SECTION_BARS.reduce((a, b) => a + b, 0);
    const dur = totalBars * barDur;
    const ctx = new OfflineAudioContext(2, Math.ceil(sr * dur), sr);
    const master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);

    // shared noise buffer for hats
    const noiseBuf = ctx.createBuffer(1, sr * 0.5, sr);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    const ampAtBar = (bar) => {
      let acc = 0;
      for (let s = 0; s < SECTION_BARS.length; s++) {
        if (bar < acc + SECTION_BARS[s]) return SECTION_AMP[s];
        acc += SECTION_BARS[s];
      }
      return SECTION_AMP[SECTION_AMP.length - 1];
    };
    const roots = [55.0, 43.65, 65.41, 49.0]; // A1 F1 C2 G1 per bar

    function kick(t, amp) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.11);
      g.gain.setValueAtTime(amp, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + 0.26);
    }
    function hat(t, amp) {
      const src = ctx.createBufferSource(); src.buffer = noiseBuf;
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(amp, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      src.connect(f); f.connect(g); g.connect(master);
      src.start(t); src.stop(t + 0.06);
    }
    function bass(t, freq, len, amp) {
      const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.value = freq;
      f.type = 'lowpass'; f.frequency.value = 300;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp, t + 0.01);
      g.gain.setValueAtTime(amp, t + len * 0.7);
      g.gain.linearRampToValueAtTime(0, t + len);
      o.connect(f); f.connect(g); g.connect(master);
      o.start(t); o.stop(t + len + 0.02);
    }
    function pad(t, freq, len, amp) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle'; o.frequency.value = freq;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp, t + 0.4);
      g.gain.setValueAtTime(amp, t + len - 0.4);
      g.gain.linearRampToValueAtTime(0, t + len);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + len + 0.02);
    }

    for (let bar = 0; bar < totalBars; bar++) {
      const amp = ampAtBar(bar);
      const barT = bar * barDur;
      const root = roots[bar % 4];
      const loud = amp > 0.5;
      for (let beat = 0; beat < 4; beat++) {
        const t = barT + beat * beatDur;
        kick(t, amp);
        if (loud) { hat(t + beatDur * 0.5, 0.16); hat(t, 0.07); }
        else hat(t + beatDur * 0.5, 0.03);
        if (loud) { bass(t, root, beatDur * 0.9, 0.32); bass(t + beatDur * 0.5, root, beatDur * 0.4, 0.2); }
      }
      if (!loud) bass(barT, root, barDur, 0.10);
      // pad chord (root * 4 = two octaves up, + major third + fifth)
      const pa = loud ? 0.035 : 0.055;
      pad(barT, root * 4, barDur, pa);
      pad(barT, root * 4 * 1.26, barDur, pa * 0.8);
      pad(barT, root * 4 * 1.5, barDur, pa * 0.8);
    }
    return ctx.startRendering();
  }

  /* 16-bit PCM WAV encoder — turns the demo buffer (or any decoded buffer)
   * into a Blob the <audio> element can play / seek / export. */
  function bufferToWavBlob(buffer) {
    const nCh = Math.min(2, buffer.numberOfChannels);
    const sr = buffer.sampleRate;
    const len = buffer.length;
    const bytes = 44 + len * nCh * 2;
    const ab = new ArrayBuffer(bytes);
    const v = new DataView(ab);
    const wstr = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
    wstr(0, 'RIFF'); v.setUint32(4, bytes - 8, true); wstr(8, 'WAVE');
    wstr(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, nCh, true); v.setUint32(24, sr, true);
    v.setUint32(28, sr * nCh * 2, true); v.setUint16(32, nCh * 2, true); v.setUint16(34, 16, true);
    wstr(36, 'data'); v.setUint32(40, len * nCh * 2, true);
    const chans = [];
    for (let c = 0; c < nCh; c++) chans.push(buffer.getChannelData(c));
    let off = 44;
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < nCh; c++) {
        const x = Math.max(-1, Math.min(1, chans[c][i]));
        v.setInt16(off, x * (x < 0 ? 0x8000 : 0x7fff), true);
        off += 2;
      }
    }
    return new Blob([ab], { type: 'audio/wav' });
  }

  return { render, bufferToWavBlob, BPM, SECTION_BARS, SECTION_AMP };
})();
