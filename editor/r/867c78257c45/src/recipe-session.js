import { RecipeFlow, projectRecipe } from "./flow.js";

export const RecipeMode = Object.freeze({ PRESET: "preset", RANDOM: "random", CUSTOM: "custom" });

export class RecipeSession {
  constructor(controls, supportedKeys) {
    this.controls = controls;
    this.supportedKeys = supportedKeys;
    this.mode = RecipeMode.PRESET;
    this.flow = null;
    this.elapsed = 0;
    this.seed = null;
  }

  get running() { return this.flow !== null; }

  start(settings, seed) {
    this.mode = RecipeMode.RANDOM;
    this.seed = String(seed);
    this.elapsed = 0;
    this.flow = new RecipeFlow(settings, seed, this.controls);
  }

  select(mode) { this.mode = mode; this.hold(); }

  // A pause retains Random mode, but Continue starts a fresh journey from the
  // held frame, just as the phone editor does. The old target is discarded.
  hold() { this.flow = null; }

  seekPresented(frame) {
    if (this.running && frame.recipe?.mode === RecipeMode.RANDOM) this.elapsed = frame.recipe.elapsed;
  }

  advance(delta, rate = 1) {
    if (this.flow) this.elapsed += Math.min(0.1, Math.max(0, Number.isFinite(delta) ? delta : 0)) * RecipeFlow.DEFAULT_SPEED * rate;
  }

  sample(settings, delta = 0) {
    if (!this.flow) return { settings: { ...settings }, recipe: { mode: this.mode } };
    this.advance(delta);
    const frame = this.flow.sample(this.elapsed);
    return { settings: projectRecipe(frame.settings, this.supportedKeys), recipe: {
      mode: this.mode, seed: this.seed, elapsed: this.elapsed, cycle: frame.cycle,
      progress: frame.progress, holding: frame.holding,
      transitionSeconds: frame.transitionSeconds, holdSeconds: frame.holdSeconds,
    } };
  }
}
