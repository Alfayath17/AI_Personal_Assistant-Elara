/**
 * One shared Web Audio graph for the whole app:
 *  - records the microphone (MediaRecorder) while exposing live levels
 *  - plays Jarvis's MP3 replies while exposing live levels
 * The reactor visual reads whichever analyser is active.
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.active = null; // analyser currently driving the visuals
    this.player = new Audio();
    this.playerSource = null;
    this.playAnalyser = null;
    this.micStream = null;
    this.micAnalyser = null;
    this.recorder = null;
    this.chunks = [];
    this.finishPlayback = null;
  }

  ensureContext() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  makeAnalyser() {
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.78;
    return analyser;
  }

  /** Fills `bins` with frequency data; returns false when nothing is active. */
  getFrequencies(bins) {
    if (!this.active) return false;
    this.active.getByteFrequencyData(bins);
    return true;
  }

  async startRecording() {
    const ctx = this.ensureContext();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    this.micStream = stream;
    this.micAnalyser = this.makeAnalyser();
    ctx.createMediaStreamSource(stream).connect(this.micAnalyser);
    this.active = this.micAnalyser;

    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find(
      (m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)
    );
    this.recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    this.chunks = [];
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.recorder.start();
    this.recordStartedAt = performance.now();
  }

  /** Resolves to { blob, durationMs } (or null if not recording). */
  stopRecording() {
    return new Promise((resolve) => {
      const recorder = this.recorder;
      if (!recorder) return resolve(null);
      this.recorder = null;
      recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' });
        this.releaseMic();
        resolve({ blob, durationMs: performance.now() - this.recordStartedAt });
      };
      recorder.stop();
    });
  }

  releaseMic() {
    if (this.micStream) this.micStream.getTracks().forEach((t) => t.stop());
    this.micStream = null;
    if (this.active === this.micAnalyser) this.active = null;
    this.micAnalyser = null;
  }

  /** Streams and plays an MP3 URL; resolves when finished or stopped. */
  play(url) {
    const ctx = this.ensureContext();
    if (!this.playerSource) {
      this.playerSource = ctx.createMediaElementSource(this.player);
      this.playAnalyser = this.makeAnalyser();
      this.playerSource.connect(this.playAnalyser);
      this.playAnalyser.connect(ctx.destination);
    }
    this.stop();
    this.player.src = url;
    this.active = this.playAnalyser;

    return new Promise((resolve) => {
      const done = () => {
        if (this.finishPlayback !== done) return;
        this.finishPlayback = null;
        this.player.onended = null;
        this.player.onerror = null;
        if (this.active === this.playAnalyser) this.active = null;
        resolve();
      };
      this.finishPlayback = done;
      this.player.onended = done;
      this.player.onerror = done;
      this.player.play().catch(done);
    });
  }

  stop() {
    if (this.finishPlayback) this.finishPlayback();
    this.player.pause();
  }
}
