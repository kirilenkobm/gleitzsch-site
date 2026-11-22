// Effect clocks follow display ticks while rendering runs independently in a
// worker. A busy renderer skips requests; it must not suspend the next tick.
export class FrameLoop {
  constructor({ active, tick, requestFrame = (callback) => requestAnimationFrame(callback) }) {
    Object.assign(this, { active, tick, requestFrame });
    this.pending = null;
  }

  request() {
    if (this.pending !== null || !this.active()) return;
    this.pending = this.requestFrame((now) => {
      this.pending = null;
      if (!this.active()) return;
      this.tick(now);
      this.request();
    });
  }
}
