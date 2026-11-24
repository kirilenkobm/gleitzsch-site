// Checked against shared/random-policy.json and the accepted Swift generator.
export const RandomFrequency = Object.freeze({ OFF: "off", LESS: "lessOften", NORMAL: "normal", MORE: "moreOften" });
export const RandomFrequencies = Object.freeze([
  { key: RandomFrequency.OFF, title: "Off", tickets: 0 },
  { key: RandomFrequency.LESS, title: "Less often", tickets: 1 },
  { key: RandomFrequency.NORMAL, title: "Normal", tickets: 2 },
  { key: RandomFrequency.MORE, title: "More often", tickets: 4 },
].map(Object.freeze));
export const RandomGroups = Object.freeze([
  { key: "tape", title: "Tape", members: ["tracking", "syncLoss", "headSwitch", "lineJitter"] },
  { key: "tear", title: "Tear", members: ["tear", "tearRainbow", "tearPosition", "tearSpread", "tearDrift"] },
  { key: "color", title: "Color", members: ["chromaSmear", "chromaLoss", "crossColor", "colorDrive", "phaseWarp", "colorPhase", "colorLeak"] },
  { key: "noise", title: "Noise", members: ["interference", "interferenceFrequency", "interferenceAngle", "signalNoise", "colorStreaks"] },
  { key: "crt", title: "CRT", members: ["crtBeam", "crtMask", "crtGlow", "persistence", "barrel"] },
  { key: "tone", title: "Tone", members: ["blackPoint", "signalContrast", "signalSoftness"] },
  { key: "prism", title: "Prism", members: ["radialRGB", "rainbow", "rainbowRadius", "rainbowSpread", "dispersion"] },
  { key: "codec", title: "Codec", members: ["codecQuality"] },
  { key: "bend", title: "Bend", members: ["displacement", "bendShape", "scatter", "scatterDetail"] },
  { key: "echo", title: "Echo", members: ["comb", "combSpacing", "echoTrain"] },
  { key: "stripes", title: "Stripes", members: ["stripes", "stripeDensity"] },
  { key: "melt", title: "Melt", members: ["melt"] },
  { key: "detail", title: "Detail", members: ["spectralGain", "frequency", "bandwidth", "originalBlend"] },
  { key: "fractals", title: "Fractals", members: ["selfsimilarity", "fractalDetail"] },
].map(group => Object.freeze({ ...group, members: Object.freeze(group.members) })));
const groups = new Map(RandomGroups.flatMap(group => group.members.map(key => [key, group.key])));
const frequencies = new Map(RandomFrequencies.map(frequency => [frequency.key, frequency]));
export function randomGroup(key) {
  if (!groups.has(key)) throw new Error(`Unknown Random ingredient: ${key}`);
  return groups.get(key);
}

export class RandomPreferences {
  constructor(values = {}) {
    this.overrides = Object.freeze(Object.fromEntries(RandomGroups
      .filter(group => frequencies.has(values[group.key]) && values[group.key] !== RandomFrequency.NORMAL)
      .map(group => [group.key, values[group.key]])));
    Object.freeze(this);
  }
  get isDefault() { return Object.keys(this.overrides).length === 0; }
  get usesDefaultSelection() { return Object.keys(this.overrides).every(key => key === "fractals"); }
  get hasCoreEffects() { return ["bend", "detail", "echo", "prism"].some(group => this.get(group) !== RandomFrequency.OFF); }
  get(group) { return this.overrides[group] ?? RandomFrequency.NORMAL; }
  withFrequency(group, frequency) { return new RandomPreferences({ ...this.overrides, [group]: frequency }); }
  tickets(group) { return frequencies.get(this.get(group)).tickets; }
  selected(values, count, group, random) {
    const available = values.filter(value => this.get(group(value)) !== RandomFrequency.OFF);
    const result = [];
    const size = Math.min(Math.max(0, count), available.length);
    for (let n = 0; n < size; n++) {
      const total = available.reduce((sum, value) => sum + this.tickets(group(value)), 0);
      let ticket = random.integer(0, total - 1);
      const index = available.findIndex(value => (ticket -= this.tickets(group(value))) < 0);
      result.push(available.splice(index, 1)[0]);
    }
    return result;
  }
  includes(group, chance, random) {
    const frequency = this.get(group);
    if (frequency === RandomFrequency.NORMAL) return random.integer(0, 99) < chance;
    if (frequency === RandomFrequency.OFF) return false;
    const numerator = this.tickets(group) * chance;
    return random.integer(0, 2 * (100 - chance) + numerator - 1) < numerator;
  }
  includesMelt(roll) {
    if (this.get("melt") === RandomFrequency.NORMAL) return roll % 5n === 0n;
    const numerator = this.tickets("melt") * 20;
    return roll % BigInt(160 + numerator) < BigInt(numerator);
  }
  includesFractals(roll) {
    const numerator = this.tickets("fractals") * 20;
    return roll % BigInt(160 + numerator) < BigInt(numerator);
  }
  ensuringLead(settings) {
    const result = { ...settings };
    if (this.get("prism") !== RandomFrequency.OFF) result.radialRGB = Math.max(Math.fround(0.2), result.radialRGB);
    else if (this.get("bend") !== RandomFrequency.OFF) result.displacement = Math.max(Math.fround(0.2), result.displacement);
    else if (this.get("echo") !== RandomFrequency.OFF) result.comb = Math.max(Math.fround(0.2), result.comb);
    else if (this.get("detail") !== RandomFrequency.OFF) result.spectralGain = result.spectralGain < 0
      ? Math.min(Math.fround(-0.4), result.spectralGain) : Math.max(Math.fround(0.4), result.spectralGain);
    return result;
  }
}
