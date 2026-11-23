// Production ParameterWander: immutable authored base, independent effect clock.
import { WranglingPolicy, wranglingPhaseRate } from "./model.js";

const wrap = (v) => BigInt.asUintN(64, v);
const smooth = (t) => t * t * (3 - 2 * t);
const sensitivity = (key) => key === "frequency" ? 0.20 : key === "bandwidth" ? 0.25
  : ["bendShape", "combSpacing", "scatterDetail", "rainbowRadius", "rainbowSpread", "interferenceFrequency", "interferenceAngle", "stripeDensity"].includes(key) ? 0.5 : 1;

export class ParameterWander {
  constructor(controls, seed = 0x474c4549545a5343n) { this.controls = controls; this.seed = seed; }

  sample(index, channel) {
    let value = wrap(this.seed + BigInt(index) * 0x9e3779b97f4a7c15n + BigInt(channel) * 0xd1b54a32d192ed03n);
    value = wrap((value ^ value >> 30n) * 0xbf58476d1ce4e5b9n);
    value = wrap((value ^ value >> 27n) * 0x94d049bb133111ebn); value ^= value >> 31n;
    return Number(value >> 11n) / 2 ** 53 * 2 - 1;
  }

  gaussian(index, channel) {
    for (let attempt = 0; ; attempt++) {
      const key = BigInt(index) * 131n + BigInt(attempt) * 2n;
      const u = Math.max(1e-12, (this.sample(key, channel) + 1) / 2);
      const v = (this.sample(key + 1n, channel) + 1) / 2;
      const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      if (Math.abs(z) <= 3) return z / 3;
    }
  }

  noise(time, channel) {
    const position = Math.min(time, 1e12) * 5 / (12 + channel * 0.23);
    const index = Math.floor(position); const blend = smooth(position - index);
    const a = this.gaussian(index, channel); const b = this.gaussian(index + 1, channel);
    return a + (b - a) * blend;
  }

  applying(base, elapsed) {
    if (!Number.isFinite(base.wander) || base.wander <= 0 || !Number.isFinite(elapsed) || elapsed <= 0) return { ...base };
    const radius = Math.fround(Math.min(Math.fround(base.wander), Math.fround(WranglingPolicy.MAX)));
    const fade = smooth(Math.min(elapsed / 2, 1)); const result = { ...base };
    this.controls.forEach((control, index) => {
      const center = Math.fround(base[control.key]);
      const enabled = control.requires.every((group) => group.some((key) => Math.fround(base[key]) !== Math.fround(this.controls.find((c) => c.key === key).default)));
      if (!enabled || !Number.isFinite(center) || (control.key === "codecQuality" ? center === 1 : center === 0)) return;
      let lower = Math.fround(control.min); let upper = Math.fround(control.max);
      if (lower < 0) { if (center > 0) lower = 0; else upper = 0; }
      let value = center + this.noise(elapsed, index) * radius * sensitivity(control.key) * fade;
      if (value < lower) value = lower + (lower - value);
      if (value > upper) value = upper - (value - upper);
      result[control.key] = Math.fround(Math.min(upper, Math.max(lower, value)));
    });
    return result;
  }
}

export class WranglingPhase {
  constructor() { this.reset(); }

  reset() { this.phase = 0; this.previousRate = 0; return this.phase; }

  anchor(phase, settings) {
    this.previousRate = wranglingPhaseRate(settings);
    this.phase = Number.isFinite(settings.wander) && settings.wander > 0 && Number.isFinite(phase) ? Math.max(0, phase) : 0;
    return this.phase;
  }

  advance(delta, settings) {
    // Off restores the imported-photo baseline. Crawling SIGNAL instead stops
    // this clock at its accumulated phase, as in the native camera.
    if (!Number.isFinite(settings.wander) || settings.wander <= 0) return this.reset();
    const rate = wranglingPhaseRate(settings);
    if (!Number.isFinite(delta) || delta < 0) return this.phase;
    if (delta <= WranglingPolicy.MAX_GAP) {
      this.phase += delta * (this.previousRate + rate) * 0.5 * WranglingPolicy.PHASE_SPEED;
    }
    this.previousRate = rate;
    return this.phase;
  }
}
