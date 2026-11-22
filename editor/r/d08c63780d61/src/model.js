export const SpectralKeys = Object.freeze([
  "displacement", "bendShape", "spectralGain", "comb", "combSpacing", "echoTrain",
  "scatter", "scatterDetail", "rgbSplit", "dispersion", "frequency", "bandwidth",
  "originalBlend", "codecQuality",
]);

export const TransmissionKeys = Object.freeze([
  "tracking", "syncLoss", "headSwitch", "chromaSmear", "chromaLoss", "crossColor",
  "interference", "interferenceFrequency", "interferenceAngle", "signalNoise",
]);

export const DamageKeys = Object.freeze(["colorDrive", "phaseWarp", "colorPhase", "colorLeak", "lineJitter", "colorStreaks", "tear"]);
export const SpatialKeys = Object.freeze(["radialRGB", "rainbow", "rainbowRadius", "rainbowSpread", "stripes", "stripeDensity"]);
export const GradeKeys = Object.freeze(["blackPoint", "signalContrast"]);
export const PixelatePolicy = Object.freeze({ DEFAULT: 8, MIN: 4, MAX: 48, STEP: 2, MAX_INDEX: 23 });
export const PlaybackPolicy = Object.freeze({ DEFAULT: 80, MIN: 1, MAX: 100 });
export const WranglingPolicy = Object.freeze({ MAX: 0.1, PHASE_SPEED: 3, MAX_GAP: 0.25 });
export const playbackRate = (percent) => Math.max(PlaybackPolicy.MIN, Math.min(PlaybackPolicy.MAX,
  Number.isFinite(percent) ? percent : PlaybackPolicy.DEFAULT)) / PlaybackPolicy.DEFAULT;

export const SupportedKeys = Object.freeze([
  ...SpectralKeys, ...TransmissionKeys, ...SpatialKeys, ...DamageKeys, ...GradeKeys,
  "tearRainbow", "tearPosition", "tearSpread", "tearDrift", "signalSoftness",
  "crtBeam", "crtMask", "crtGlow", "persistence", "barrel",
  "pixelSize", "wander", "melt",
]);

export const Mode = Object.freeze({ EMPTY: "empty", LIVE: "live", PAUSED: "paused", ORIGINAL: "original", ERROR: "error" });
export const Axis = Object.freeze({ HORIZONTAL: "horizontal", VERTICAL: "vertical" });

export function defaults(controls) {
  return { ...Object.fromEntries(SupportedKeys.map((key) => [key, 0])), frequency: 0.5, codecQuality: 1,
    ...Object.fromEntries(controls.filter((c) => SupportedKeys.includes(c.key)).map((c) => [c.key, c.default])) };
}

export function presetSettings(preset, controls) {
  const values = { ...defaults(controls), ...preset.settings, ...preset.signal, wander: preset.wander ?? 0 };
  return Object.fromEntries(SupportedKeys.map((key) => [key, values[key] ?? 0]));
}

export function hasTransmission(settings) {
  return TransmissionKeys.some((key) => key !== "interferenceFrequency" && key !== "interferenceAngle" && settings[key] !== 0);
}

export function isAnimated(settings) {
  return ["tracking", "syncLoss", "headSwitch", "chromaLoss", "crossColor", "interference", "signalNoise", "persistence", "phaseWarp", "lineJitter", "colorStreaks", "tear"]
    .some((key) => settings[key] !== 0);
}

export const hasDamage = (settings) => DamageKeys.some((key) => (settings[key] ?? 0) !== 0);
export const hasGrade = (settings) => GradeKeys.some((key) => (settings[key] ?? 0) !== 0);

// The native camera advances artistic FFT phase when no crawling SIGNAL stage
// is providing motion. Preserve the same zero controls and recipe values.
export function wranglingPhaseRate(settings) {
  if (!Number.isFinite(settings.wander) || settings.wander <= 0) return 0;
  if (["tracking", "syncLoss", "headSwitch", "interference", "crossColor"].some((key) => (settings[key] ?? 0) !== 0)
    || hasDamage(settings)) return 0;
  return Math.max(0, Math.min(1, Math.fround(Math.fround(settings.wander) / Math.fround(WranglingPolicy.MAX))));
}

export function signalDimensions(width, height, settings) {
  const ratio = settings.signalSoftness > 0 || hasDamage(settings) || hasGrade(settings) ? 1 : Math.min(1, 360 / Math.min(width, height));
  return { width: Math.max(2, Math.trunc(width * ratio)), height: Math.max(2, Math.trunc(height * ratio)) };
}

export function normalizedSettings(values, controls) {
  const result = defaults(controls);
  result.pixelSize = pixelSize(values.pixelSize);
  result.wander = Number.isFinite(values.wander) ? Math.max(0, Math.min(0.1, values.wander)) : 0;
  for (const control of controls) {
    if (!SupportedKeys.includes(control.key)) continue;
    const value = Number(values[control.key]);
    if (Number.isFinite(value)) result[control.key] = Math.max(control.min, Math.min(control.max, value));
  }
  result.pixelSize = pixelSize(result.pixelSize);
  return result;
}

export function pixelSize(value) {
  return !Number.isFinite(value) || value <= 0 ? 0 : Math.max(PixelatePolicy.MIN, Math.min(PixelatePolicy.MAX, Math.round(value / PixelatePolicy.STEP) * PixelatePolicy.STEP));
}
export const pixelIndex = (size) => size > 0 ? (size - PixelatePolicy.MIN) / PixelatePolicy.STEP + 1 : 0;
export const pixelSizeFromIndex = (index) => index > 0 ? PixelatePolicy.MIN + (index - 1) * PixelatePolicy.STEP : 0;

export function testCard(width = 720, height = 960) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#c4deab");
  gradient.addColorStop(0.42, "#b19dbe");
  gradient.addColorStop(1, "#253f57");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#edb36f";
  ctx.beginPath();
  ctx.arc(width * 0.68, height * 0.34, width * 0.19, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#162c2d";
  ctx.beginPath();
  ctx.moveTo(0, height * 0.67);
  ctx.bezierCurveTo(width * 0.35, height * 0.25, width * 0.48, height * 0.9, width, height * 0.48);
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.fill();
  ctx.fillStyle = "#668570";
  ctx.beginPath();
  ctx.moveTo(0, height * 0.88);
  ctx.bezierCurveTo(width * 0.35, height * 0.55, width * 0.52, height * 0.8, width, height * 0.66);
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.fill();
  ctx.strokeStyle = "#d2dac6";
  ctx.lineWidth = Math.max(1, width / 360);
  for (let x = 0; x < 15; x++) {
    ctx.beginPath();
    ctx.moveTo(width * (0.12 + x * 0.023), height * 0.15);
    ctx.lineTo(width * (0.12 + x * 0.023), height * 0.34);
    ctx.stroke();
  }
  ctx.fillStyle = "#101b1a";
  ctx.fillRect(width * 0.07, height * 0.74, width * 0.72, height * 0.075);
  ctx.font = `bold ${Math.round(width * 0.052)}px monospace`;
  ctx.fillStyle = "#e1eadb";
  ctx.fillText("SOMEWHERE ELSE", width * 0.10, height * 0.79);
  return { width, height, pixels: ctx.getImageData(0, 0, width, height).data };
}
