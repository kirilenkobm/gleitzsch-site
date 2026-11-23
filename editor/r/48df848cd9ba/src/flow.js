// Port of production RecipeFlow/GlitchSettings.randomize. The full generator is
// reference-tested before the renderer projects it to its supported controls.
const f = Math.fround;
const add = (a, b) => f(f(a) + f(b));
const sub = (a, b) => f(f(a) - f(b));
const mul = (a, b) => f(f(a) * f(b));
const div = (a, b) => f(f(a) / f(b));
const roundAway = (v) => v < 0 ? -Math.round(-v) : Math.round(v);
const clamp = (v, low, high) => Math.max(low, Math.min(high, v));

export const RewindPolicy = Object.freeze({ STATES: 3, TRANSITION_SECONDS: 2, HOLD_SECONDS: 0.4 });
export const RewindPhase = Object.freeze({ MOVING: "moving", ARRIVED: "arrived", EXHAUSTED: "exhausted" });

export class RecipeRewindPlan {
  constructor(entry, stops) { this.entry = entry; this.stops = stops; }
  position(elapsed) {
    if (!this.stops.length) return { time: this.entry, step: 0, count: 0, progress: 1, phase: RewindPhase.EXHAUSTED };
    const time = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
    const period = RewindPolicy.TRANSITION_SECONDS + RewindPolicy.HOLD_SECONDS;
    const index = Math.min(this.stops.length - 1, Math.floor(time / period));
    const progress = clamp((time - index * period) / RewindPolicy.TRANSITION_SECONDS, 0, 1);
    const from = index === 0 ? this.entry : this.stops[index - 1];
    const phase = time >= this.stops.length * period ? RewindPhase.EXHAUSTED : progress === 1 ? RewindPhase.ARRIVED : RewindPhase.MOVING;
    return { time: from + (this.stops[index] - from) * progress, step: index + 1, count: this.stops.length, progress, phase };
  }
}

export class RecipeRandom {
  constructor(seed) { this.state = BigInt.asUintN(64, BigInt(seed)); }

  next() {
    this.state = BigInt.asUintN(64, this.state + 0x9e3779b97f4a7c15n);
    let z = this.state;
    z = BigInt.asUintN(64, (z ^ z >> 30n) * 0xbf58476d1ce4e5b9n);
    z = BigInt.asUintN(64, (z ^ z >> 27n) * 0x94d049bb133111ebn);
    return z ^ z >> 31n;
  }

  integer(lower, upper) {
    const bound = BigInt(upper - lower + 1);
    const threshold = ((1n << 64n) - bound) % bound;
    for (;;) {
      const product = this.next() * bound;
      if (BigInt.asUintN(64, product) >= threshold) return lower + Number(product >> 64n);
    }
  }

  float(lower, upper) {
    const bound = 16777217n;
    const threshold = ((1n << 32n) - bound) % bound;
    for (;;) {
      const product = (this.next() & 0xffffffffn) * bound;
      if ((product & 0xffffffffn) < threshold) continue;
      const bits = Number(product >> 32n);
      return bits === 16777216 ? f(upper) : add(mul(sub(upper, lower), div(bits, 16777216)), lower);
    }
  }

  shuffled(values) {
    const result = [...values];
    for (let i = 0; i < result.length - 1; i++) {
      const j = this.integer(i, result.length - 1);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
}

const Ingredient = Object.freeze({
  DISPLACEMENT: "displacement", GAIN: "spectralGain", COMB: "comb", SCATTER: "scatter",
  RADIAL: "radialRGB", DISPERSION: "dispersion", RAINBOW: "rainbow",
});
const { DISPLACEMENT, GAIN, COMB, SCATTER, RADIAL, DISPERSION, RAINBOW } = Ingredient;
const ingredients = Object.values(Ingredient);
const ranges = Object.freeze({
  [DISPLACEMENT]: [[8, 20], [16, 40], [40, 65]],
  [GAIN]: [[18, 40], [35, 70], [65, 95]],
  [COMB]: [[8, 22], [18, 40], [40, 65]],
  [SCATTER]: [[3, 10], [10, 26], [26, 46]],
  [RADIAL]: [[4, 14], [14, 35], [35, 65]],
  [DISPERSION]: [[10, 25], [20, 50], [45, 80]],
  [RAINBOW]: [[16, 35], [35, 65], [65, 90]],
});
const partners = Object.freeze({
  [DISPLACEMENT]: [RADIAL, SCATTER, GAIN, DISPERSION],
  [GAIN]: [COMB, RADIAL, SCATTER, RAINBOW],
  [COMB]: [DISPERSION, SCATTER, RADIAL, GAIN],
  [SCATTER]: [RAINBOW, DISPERSION, RADIAL, DISPLACEMENT],
  [RADIAL]: [RAINBOW, SCATTER, COMB, GAIN],
  [DISPERSION]: [RAINBOW, SCATTER, COMB, GAIN],
  [RAINBOW]: [RADIAL, SCATTER, GAIN, DISPLACEMENT],
});

const hasSpectral = (s) => ["displacement", "spectralGain", "comb", "echoTrain", "scatter", "rgbSplit", "dispersion"]
  .some((key) => s[key] !== 0) || s.codecQuality < 1;
const strengths = (s) => [s.displacement, s.spectralGain, s.comb, s.scatter, s.radialRGB, s.dispersion,
  s.rainbow, s.noise, s.interlace, s.stripes];
export const hasFlowLead = (s) => s.stripes >= f(0.12) || s.echoTrain >= f(0.25)
  || s.displacement >= f(0.12) || Math.abs(s.spectralGain) >= f(0.4) || s.comb >= f(0.18)
  || s.scatter >= f(0.1) || s.radialRGB >= f(0.14) || s.dispersion >= f(0.2) || s.interlace >= f(0.3);

function ease(value) {
  const t = clamp(f(value), 0, 1);
  return clamp(mul(mul(mul(t, t), t), add(mul(t, sub(mul(t, 6), 15)), 10)), 0, 1);
}

export class RecipeFlow {
  static DEFAULT_SPEED = 3.5;

  constructor(settings, seed, controls) {
    this.controls = controls;
    this.neutral = { rgbSplit: 0, pixelSize: 0, noise: 0, interlace: 0, interlaceSpacing: 0, interlaceJitter: 0,
      wander: 0, wanderSpeed: 0, exposure: 0, saturation: 0,
      ...Object.fromEntries(controls.map((c) => [c.key, f(c.default)])) };
    this.initial = { ...this.neutral, ...Object.fromEntries(Object.entries(settings).map(([k, v]) => [k, f(v)])),
      pixelSize: 0, wander: 0, wanderSpeed: 0, interlaceSpacing: Math.min(f(0.25), settings.interlaceSpacing ?? 0) };
    this.seed = BigInt(seed);
    this.signalControls = controls.filter((c) => c.namespace !== "mix");
    this.leadControls = this.signalControls.filter((c) => c.requires.length === 0);
    this.axes = [...new Set([...Object.keys(this.neutral), ...controls.map((c) => c.key)])];
    this.effectAxes = new Set(["echoTrain", "displacement", "spectralGain", "comb", "scatter", "rgbSplit",
      "radialRGB", "rainbow", "noise", "interlace", "dispersion", "stripes", "melt", ...this.leadControls.map((c) => c.key)]);
    this.reset();
  }

  reset() {
    this.checkpoints = [];
    this.random = new RecipeRandom(this.seed);
    this.from = this.initial;
    this.to = this.initial;
    this.start = 0;
    this.cycle = 0;
    this.chooseNext();
  }

  enabled(control, settings) {
    return control.requires.every((alternatives) => alternatives.some((key) => settings[key] !== this.neutral[key]));
  }

  randomized() {
    const s = { ...this.neutral };
    const roll = () => this.random.integer(0, 99);
    const sample = (range) => div(this.random.integer(...range), 100);
    const mood = roll();
    const tier = mood < 25 ? 0 : mood < 85 ? 1 : 2;
    const primary = ingredients[this.random.integer(0, ingredients.length - 1)];
    const leaders = roll() < 20 ? 2 : 1;
    const count = roll();
    const companions = Math.max(leaders - 1, count < 25 ? 0 : count < 70 ? 1 : count < 95 ? 2 : 3);
    const selected = [primary, ...this.random.shuffled(partners[primary]).slice(0, companions)];
    selected.forEach((key, index) => {
      const amount = sample(ranges[key][tier]);
      const strength = index < leaders ? amount : Math.max(f(0.01), div(roundAway(mul(mul(amount, sample([30, 60])), 100)), 100));
      s[key] = key === GAIN && roll() < 50 ? -strength : strength;
    });
    if (hasSpectral(s)) {
      const scale = roll();
      s.frequency = sample(scale < 40 ? [0, 20] : scale < 80 ? [20, 55] : [55, 90]);
      s.bandwidth = sample(tier === 2 ? [30, 85] : [8, 60]);
      if (roll() < 50) s.originalBlend = sample(tier === 2 ? [15, 35] : [5, 25]);
    }
    if (s.comb !== 0 || s.echoTrain !== 0) s.combSpacing = sample([0, 100]);
    if (s.scatter !== 0) s.scatterDetail = sample([0, 100]);
    if (s.displacement !== 0 && roll() < 70) s.bendShape = sample([5, 95]);
    if (s.rainbow !== 0) { s.rainbowRadius = sample([5, 95]); s.rainbowSpread = sample([4, 80]); }
    return s;
  }

  chooseNext() {
    let candidate;
    for (let attempt = 0; attempt < 32; attempt++) {
      candidate = this.randomized();
      candidate.exposure = this.initial.exposure;
      candidate.saturation = this.initial.saturation;
      if (mul(this.from.spectralGain, candidate.spectralGain) < 0) candidate.spectralGain *= -1;
      if (hasSpectral(candidate)) candidate.bandwidth = Math.max(f(0.18), candidate.bandwidth);
      const previous = strengths(this.from);
      const difference = strengths(candidate).reduce((total, value, i) => add(total, Math.abs(sub(previous[i], value))), 0);
      if (hasFlowLead(candidate) && difference >= f(0.35)) break;
    }
    if (!hasFlowLead(candidate)) candidate.radialRGB = Math.max(f(0.2), candidate.radialRGB);
    if (this.random.integer(0, 99) < 20) {
      candidate.echoTrain = this.random.float(0.25, 0.85);
      candidate.combSpacing = this.random.float(0.15, 0.95);
    }
    if (this.random.integer(0, 99) < 20) candidate.codecQuality = this.random.float(0.25, 0.85);
    for (const key of ["noise", "interlace", "interlaceSpacing", "interlaceJitter", "exposure", "saturation"]) candidate[key] = 0;
    for (const c of this.random.shuffled(this.leadControls).slice(0, this.random.integer(1, 4))) {
      candidate[c.key] = this.random.float(c.min, c.max);
    }
    for (const c of this.signalControls.filter((c) => c.requires.length > 0)) {
      if (this.enabled(c, candidate)) candidate[c.key] = this.random.float(c.min, c.max);
    }
    if (this.random.integer(0, 99) < 24) {
      const mood = this.random.integer(0, 99);
      candidate.stripes = this.random.float(...(mood < 25 ? [0.12, 0.35] : mood < 85 ? [0.35, 0.75] : [0.85, 1]));
      candidate.stripeDensity = this.random.float(0, 1);
      if (candidate.stripes >= f(0.65)) {
        for (const [key, limit] of Object.entries({ displacement: 0.25, scatter: 0.12, comb: 0.25, echoTrain: 0.3,
          radialRGB: 0.2, interference: 0.2, signalNoise: 0.12, tracking: 0.25, tear: 0.25 })) {
          candidate[key] = Math.min(candidate[key], f(limit));
        }
      }
    }
    const meltRandom = new RecipeRandom(BigInt.asUintN(64, this.seed ^
      BigInt.asUintN(64, BigInt(this.cycle) * 0x9e3779b97f4a7c15n) ^ 0x4d454c54n));
    const meltRoll = meltRandom.next();
    candidate.melt = meltRoll % 5n === 0n ? div(20 + Number((meltRoll >> 8n) % 81n), 100) : 0;
    this.to = candidate;
    this.transition = [4, 6, 8][this.random.integer(0, 2)] * 0.75;
    this.hold = [2, 3, 4][this.random.integer(0, 2)] * 0.125;
  }

  morph(a, b, progress) {
    if (progress <= 0) return { ...a };
    if (progress >= 1) return { ...b };
    const t = f(progress);
    const weight = ease(t);
    const result = { ...a };
    for (const key of this.axes) {
      let value = add(a[key], mul(sub(b[key], a[key]), weight));
      if (this.effectAxes.has(key)) {
        if (a[key] === 0) value = mul(b[key], ease(div(t, 0.65)));
        else if (b[key] === 0) value = mul(a[key], sub(1, ease(div(sub(t, 0.35), 0.65))));
      }
      result[key] = value;
    }
    const shape = (key, oldActive, newActive) => {
      if (!oldActive && newActive) result[key] = b[key];
      else if (oldActive && !newActive) result[key] = a[key];
    };
    for (const key of ["frequency", "bandwidth", "originalBlend"]) shape(key, hasSpectral(a), hasSpectral(b));
    shape("combSpacing", a.comb !== 0 || a.echoTrain !== 0, b.comb !== 0 || b.echoTrain !== 0);
    shape("scatterDetail", a.scatter !== 0, b.scatter !== 0);
    shape("bendShape", a.displacement !== 0, b.displacement !== 0);
    for (const key of ["rainbowRadius", "rainbowSpread"]) shape(key, a.rainbow !== 0, b.rainbow !== 0);
    for (const key of ["interlaceSpacing", "interlaceJitter"]) shape(key, a.interlace !== 0, b.interlace !== 0);
    shape("stripeDensity", a.stripes > 0, b.stripes > 0);
    for (const c of this.signalControls.filter((c) => c.requires.length > 0)) shape(c.key, this.enabled(c, a), this.enabled(c, b));
    return result;
  }

  rememberCycle() {
    if (this.checkpoints.some((entry) => entry.cycle === this.cycle)) return;
    this.checkpoints.push({ from: this.from, to: this.to, start: this.start, cycle: this.cycle,
      transition: this.transition, hold: this.hold, randomState: this.random.state });
    this.checkpoints.sort((a, b) => a.cycle - b.cycle);
    this.checkpoints = this.checkpoints.slice(-8);
  }

  rewindPlan(elapsed) {
    const entry = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
    this.sample(entry);
    const stops = [...new Set([...this.checkpoints.map((c) => c.start), this.start])]
      .filter((time) => time < entry - 0.000001).sort((a, b) => b - a).slice(0, RewindPolicy.STATES);
    return new RecipeRewindPlan(entry, stops);
  }

  sample(elapsed) {
    const time = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
    if (time < this.start) {
      const checkpoint = [...this.checkpoints].reverse().find((entry) => entry.start <= time);
      if (checkpoint) {
        const { randomState, ...cycle } = checkpoint;
        Object.assign(this, cycle);
        this.random.state = randomState;
      } else this.reset();
    }
    while (time >= this.start + this.transition + this.hold) {
      this.rememberCycle();
      this.start += this.transition + this.hold;
      this.cycle++;
      this.from = this.to;
      this.chooseNext();
    }
    const progress = clamp((time - this.start) / this.transition, 0, 1);
    return { settings: this.morph(this.from, this.to, progress), cycle: this.cycle,
      holding: time >= this.start + this.transition, progress, transitionSeconds: this.transition, holdSeconds: this.hold };
  }

  snapped(settings) {
    const result = { ...settings };
    for (const key of this.axes) {
      const scale = key === "exposure" ? 20 : 100;
      result[key] = f(roundAway(div(settings[key], 1 / scale)) / scale);
    }
    if (result.comb === 0 && result.echoTrain === 0) result.combSpacing = 0;
    if (result.scatter === 0) result.scatterDetail = 0;
    if (result.rainbow === 0) { result.rainbowRadius = f(0.4); result.rainbowSpread = f(0.4); }
    if (result.interlace === 0) { result.interlaceSpacing = 0; result.interlaceJitter = 0; }
    if (result.stripes === 0) result.stripeDensity = this.neutral.stripeDensity;
    if (result.displacement === 0) result.bendShape = 0;
    if (!hasSpectral(result)) { result.frequency = f(0.5); result.bandwidth = 0; result.originalBlend = 0; }
    for (const c of this.signalControls) if (!this.enabled(c, result)) result[c.key] = 0;
    return result;
  }
}

export function projectRecipe(settings, supportedKeys) {
  return Object.fromEntries(supportedKeys.map((key) => [key, settings[key]]));
}
