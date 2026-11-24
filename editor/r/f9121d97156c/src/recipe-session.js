import { RecipeFlow, RewindPhase, projectRecipe } from "./flow.js";
import { RandomPreferences } from "./random-preferences.js";
export { RewindPolicy } from "./flow.js";

export const RecipeMode = Object.freeze({ PRESET: "preset", RANDOM: "random", CUSTOM: "custom" });

export class RecipeSession {
  constructor(controls, supportedKeys) {
    this.controls = controls;
    this.supportedKeys = supportedKeys;
    this.mode = RecipeMode.PRESET;
    this.flow = null;
    this.elapsed = 0;
    this.seed = null;
    this.rewind = null;
    this.preferences = new RandomPreferences();
  }

  get running() { return this.flow !== null; }
  get rewinding() { return this.rewind !== null; }
  get canRewind() { return this.mode === RecipeMode.RANDOM && this.running && (this.rewinding
    ? this.rewindPosition.phase !== RewindPhase.EXHAUSTED : this.elapsed > 0.000001); }
  get rewindPosition() { return this.rewind?.plan.position(this.rewind.elapsed) ?? null; }

  start(settings, seed) {
    this.mode = RecipeMode.RANDOM;
    this.seed = String(seed);
    this.elapsed = 0;
    this.rewind = null;
    this.flow = new RecipeFlow(settings, seed, this.controls, this.preferences);
  }

  setPreferences(preferences, frame, seed) {
    if (JSON.stringify(preferences.overrides) === JSON.stringify(this.preferences.overrides)) return false;
    this.preferences = preferences;
    if (!this.running) return false;
    this.start(frame.settings, seed);
    return true;
  }

  select(mode) { this.mode = mode; this.hold(); }

  // A pause retains Random mode, but Continue starts a fresh journey from the
  // held frame, just as the phone editor does. The old target is discarded.
  hold() { this.flow = null; this.rewind = null; }

  seekPresented(frame) {
    if (this.running && frame.recipe?.mode === RecipeMode.RANDOM && frame.recipe.seed === this.seed) this.elapsed = frame.recipe.elapsed;
  }

  beginRewind(frame, rate = 1) {
    if (!this.canRewind || frame.recipe?.mode !== RecipeMode.RANDOM || frame.recipe.seed !== this.seed) return false;
    this.seekPresented(frame);
    if (!this.canRewind) return false;
    const plan = this.flow.rewindPlan(this.elapsed);
    if (!plan.stops.length) return false;
    this.rewind = { plan, elapsed: 0 };
    return true;
  }

  advance(delta, rate = 1) {
    if (!this.flow) return 0;
    const before = this.elapsed;
    const bounded = Math.min(0.1, Math.max(0, Number.isFinite(delta) ? delta : 0));
    if (this.rewind) {
      this.rewind.elapsed += bounded;
      this.elapsed = this.rewindPosition.time;
    } else this.elapsed += bounded * RecipeFlow.DEFAULT_SPEED * rate;
    return (this.elapsed - before) / RecipeFlow.DEFAULT_SPEED;
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
