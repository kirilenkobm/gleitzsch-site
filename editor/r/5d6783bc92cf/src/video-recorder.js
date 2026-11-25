export const RecordingPhase = Object.freeze({ IDLE: "idle", STARTING: "starting", RECORDING: "recording", FINISHING: "finishing" });
export const RecordingStop = Object.freeze({ MANUAL: "manual", TIME: "time", SIZE: "size", HIDDEN: "hidden", ERROR: "error" });
export const RecordingPolicy = Object.freeze({ MAX_SECONDS: 600, FPS: 30, BITRATE: 3_000_000,
  STOP_BYTES: 240 * 1024 * 1024, MAX_BYTES: 256 * 1024 * 1024, CHUNK_MS: 250, TIMEOUT_MS: 5000 });
const formats = ["video/mp4;codecs=avc1.420028", "video/mp4;codecs=avc1"];

function browserEnvironment() {
  return { Recorder: globalThis.MediaRecorder, canCapture: typeof globalThis.HTMLCanvasElement?.prototype.captureStream === "function",
    createCanvas: () => document.createElement("canvas"),
    now: () => performance.now(), requestFrame: (callback) => requestAnimationFrame(callback), cancelFrame: (id) => cancelAnimationFrame(id),
    setTimer: (callback, delay) => setTimeout(callback, delay), clearTimer: (id) => clearTimeout(id) };
}

export function recordingExtension(mime) {
  if (mime.startsWith("video/mp4")) return "mp4";
  throw new Error("The browser returned an unsupported video format.");
}

export function recordingTime(seconds) {
  const value = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

// Copy the presented image into a fixed-size private capture surface. CSS,
// letterboxing and editing handles are outside this canvas and the video.
export class VideoRecorder {
  constructor({ onChange = () => {}, onComplete = () => {}, onError = () => {},
    environment = browserEnvironment(), limits = RecordingPolicy } = {}) {
    Object.assign(this, { onChange, onComplete, onError, environment, limits });
    this.phase = RecordingPhase.IDLE;
    this.session = null;
    this.serial = 0;
    this.formats = formats.filter((mime) => {
      try { return environment.Recorder?.isTypeSupported(mime); } catch { return false; }
    });
  }

  get supported() { return this.environment.canCapture && this.formats.length > 0; }
  get active() { return this.phase !== RecordingPhase.IDLE; }
  get status() {
    const s = this.session;
    return { phase: this.phase, id: s?.id, seconds: s?.startedAt === null || !s ? 0
      : Math.min(this.limits.MAX_SECONDS, Math.max(0, ((s.endedAt ?? this.environment.now()) - s.startedAt) / 1000)),
      bytes: s?.bytes ?? 0, mime: s?.recorder?.mimeType ?? "", reason: s?.reason ?? RecordingStop.MANUAL };
  }

  start({ source, width, height }) {
    if (this.active) return null;
    if (!this.supported) throw new Error("MP4 recording is not available in this browser. You can still save PNGs.");
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 || width > 2048 || height > 2048)
      throw new Error("The working image size cannot be recorded.");
    if (!source) throw new Error("Open a photo before recording.");
    const canvas = this.environment.createCanvas();
    // H.264 4:2:0 needs even dimensions. Extend an odd edge by one pixel.
    canvas.width = width + width % 2; canvas.height = height + height % 2;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("The browser could not prepare the video canvas.");
    const s = { id: ++this.serial, canvas, context, width, height, source: Object.freeze({ canvas: source, width, height }), recorder: null, stream: null,
      chunks: [], bytes: 0, startedAt: null, endedAt: null, reason: RecordingStop.MANUAL, error: null, discard: false,
      frameRequest: null, timer: null, lastPaint: 0, lastSecond: -1 };
    this.session = s;
    this.phase = RecordingPhase.STARTING;
    s.timer = this.environment.setTimer(() => {
      if (this.session === s) this.fail("The first video frame did not arrive. Try recording again.");
    }, this.limits.TIMEOUT_MS);
    s.frameRequest = this.environment.requestFrame(() => {
      if (this.session !== s || this.phase !== RecordingPhase.STARTING) return;
      try { this.paint(s); this.begin(s); }
      catch (error) { this.fail(error.message || "A video frame could not be recorded."); }
    });
    this.onChange(this.status);
    return s.id;
  }

  paint(s) {
    s.context.drawImage(s.source.canvas, 0, 0, s.width, s.height);
    if (s.canvas.width !== s.width) s.context.drawImage(s.canvas, s.width - 1, 0, 1, s.height, s.width, 0, 1, s.height);
    if (s.canvas.height !== s.height) s.context.drawImage(s.canvas, 0, s.height - 1, s.canvas.width, 1, 0, s.height, s.canvas.width, 1);
  }

  begin(s) {
    s.stream = s.canvas.captureStream(this.limits.FPS);
    if (s.stream.getVideoTracks().length !== 1 || s.stream.getAudioTracks().length !== 0)
      throw new Error("The browser could not create a silent video stream.");
    for (const mimeType of this.formats) {
      try { s.recorder = new this.environment.Recorder(s.stream, { mimeType, videoBitsPerSecond: this.limits.BITRATE }); break; }
      catch { /* A declared codec may still be unavailable for this image. */ }
    }
    if (!s.recorder) throw new Error("The browser could not start its video encoder.");
    recordingExtension(s.recorder.mimeType);
    s.recorder.ondataavailable = ({ data }) => {
      if (this.session !== s || s.error || !data.size) return;
      if (s.bytes + data.size > this.limits.MAX_BYTES) {
        this.fail("The video exceeded the memory limit. Try a shorter clip.");
        return;
      }
      s.chunks.push(data); s.bytes += data.size;
      if (s.bytes >= this.limits.STOP_BYTES) this.stop(RecordingStop.SIZE);
    };
    s.recorder.onerror = (event) => {
      if (this.session === s) this.fail(event.error?.message || "The browser could not finish the video. Try a shorter clip.");
    };
    s.recorder.onstop = () => { if (this.session === s) this.finish(s); };
    s.recorder.start(this.limits.CHUNK_MS);
    this.environment.clearTimer(s.timer);
    s.startedAt = this.environment.now();
    this.phase = RecordingPhase.RECORDING;
    s.timer = this.environment.setTimer(() => {
      if (this.session === s) this.stop(RecordingStop.TIME);
    }, this.limits.MAX_SECONDS * 1000);
    // The capture track needs a paint after it is created. Never begin with an
    // empty/black frame, including a paused or entirely static composition.
    this.paint(s);
    this.onChange(this.status);
    const tick = (now) => {
      if (this.session !== s || this.phase !== RecordingPhase.RECORDING) return;
      if (this.status.seconds >= this.limits.MAX_SECONDS) { this.stop(RecordingStop.TIME); return; }
      if (now - s.lastPaint >= 1000 / this.limits.FPS - .5) {
        // Repaint even a held/static preview so the clip retains wall time.
        try { this.paint(s); s.lastPaint = now; }
        catch (error) { this.fail(error.message || "The video canvas stopped working."); return; }
      }
      const second = Math.floor(this.status.seconds);
      if (second !== s.lastSecond) { s.lastSecond = second; this.onChange(this.status); }
      s.frameRequest = this.environment.requestFrame(tick);
    };
    s.frameRequest = this.environment.requestFrame(tick);
  }

  stop(reason = RecordingStop.MANUAL) {
    const s = this.session;
    if (!s || this.phase === RecordingPhase.FINISHING) return;
    s.reason = reason;
    s.endedAt = this.environment.now();
    this.phase = RecordingPhase.FINISHING;
    this.environment.clearTimer(s.timer);
    if (s.frameRequest !== null) this.environment.cancelFrame(s.frameRequest);
    this.onChange(this.status);
    if (!s.recorder) { this.finish(s); return; }
    s.timer = this.environment.setTimer(() => {
      if (this.session === s) { s.error ||= "The video encoder did not finish. Try a shorter clip."; this.finish(s); }
    }, this.limits.TIMEOUT_MS);
    try {
      if (s.recorder.state !== "inactive") s.recorder.stop();
      else if (s.error) this.finish(s);
    }
    catch (error) { s.error = error.message; this.finish(s); }
  }

  fail(message) {
    const s = this.session;
    if (!s) return;
    s.error = message;
    s.chunks = []; s.bytes = 0;
    this.stop(RecordingStop.ERROR);
  }

  finish(s) {
    if (this.session !== s) return;
    if (this.phase !== RecordingPhase.FINISHING) {
      s.endedAt = this.environment.now();
      this.phase = RecordingPhase.FINISHING;
      this.onChange(this.status);
    }
    this.environment.clearTimer(s.timer);
    if (s.frameRequest !== null) this.environment.cancelFrame(s.frameRequest);
    s.stream?.getTracks().forEach((track) => track.stop());
    const result = !s.error && !s.discard && s.bytes > 0 ? { blob: new Blob(s.chunks, { type: s.recorder.mimeType }),
      mime: s.recorder.mimeType, width: s.canvas.width, height: s.canvas.height, seconds: this.status.seconds, reason: s.reason } : null;
    const error = s.discard ? null : s.error || (s.recorder && !result ? "The browser did not produce a video. Try recording again." : null);
    s.chunks = []; s.canvas.width = 1; s.canvas.height = 1;
    this.session = null; this.phase = RecordingPhase.IDLE;
    this.onChange(this.status);
    if (error) this.onError(error);
    else if (result) this.onComplete(result);
  }

  dispose() {
    const s = this.session;
    if (!s) return;
    s.discard = true;
    this.stop(RecordingStop.ERROR);
    this.finish(s);
  }
}
