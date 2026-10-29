'use strict';
/* HoloMV REC EXPORT — plays the track from the top with the automator
 * running, captures canvas.captureStream(60) + the track audio (routed
 * through a MediaStreamDestination in app.js) into ONE MediaRecorder webm,
 * and downloads holomv-<trackname>.webm when the track ends or the user
 * taps STOP. */
window.Exporter = (() => {
  const MIME_CANDIDATES = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];

  class Exporter {
    constructor(deps) {
      this.audio = deps.audio;           // HTMLAudioElement
      this.canvas = deps.canvas;
      this.audioStream = deps.audioStream; // MediaStream from MediaStreamDestination
      this.onDone = deps.onDone || (() => {});
      this.onError = deps.onError || (() => {});
      this.recorder = null;
      this.chunks = [];
      this.active = false;
      this.startedAt = 0;
      this.trackName = 'track';
      this.mimeType = '';
    }

    supported() {
      return typeof MediaRecorder !== 'undefined'
        && typeof this.canvas.captureStream === 'function'
        && !!this.audioStream;
    }

    pickMime() {
      if (typeof MediaRecorder === 'undefined') return '';
      for (const m of MIME_CANDIDATES) if (MediaRecorder.isTypeSupported(m)) return m;
      return '';
    }

    start(trackName) {
      if (this.active) return { ok: false, error: 'Export already running.' };
      if (!this.supported()) return { ok: false, error: 'MediaRecorder / canvas capture not supported in this browser.' };
      const mime = this.pickMime();
      if (!mime) return { ok: false, error: 'No supported webm mime type for MediaRecorder.' };
      this.trackName = (trackName || 'track').replace(/\.[a-z0-9]+$/i, '').replace(/[^\w\- ]+/g, '').trim() || 'track';
      this.chunks = [];
      this.mimeType = mime;
      try {
        const videoStream = this.canvas.captureStream(60);
        const tracks = [...videoStream.getVideoTracks(), ...this.audioStream.getAudioTracks()];
        const combined = new MediaStream(tracks);
        this.recorder = new MediaRecorder(combined, { mimeType: mime, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 192_000 });
      } catch (err) {
        return { ok: false, error: 'Recorder setup failed: ' + (err && err.message || err) };
      }
      this.recorder.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
      this.recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.mimeType.split(';')[0] });
        this.active = false;
        this.onDone(blob, `holomv-${this.trackName}.webm`);
      };
      this.recorder.onerror = (e) => { this.onError(String((e && e.error && e.error.message) || 'recorder error')); };
      this.audio.currentTime = 0;
      const p = this.audio.play();
      if (p && p.catch) p.catch(() => {});
      // start slightly after play so frame 0 carries audio
      this.recorder.start(250);
      this.active = true;
      this.startedAt = performance.now();
      return { ok: true, mimeType: mime };
    }

    stop() {
      if (!this.active) return;
      try { this.audio.pause(); } catch (_) {}
      if (this.recorder && this.recorder.state !== 'inactive') {
        try { this.recorder.stop(); } catch (_) { this.active = false; }
      } else this.active = false;
    }

    elapsedSec() { return this.active ? (performance.now() - this.startedAt) / 1000 : 0; }
  }

  return { Exporter, MIME_CANDIDATES };
})();
