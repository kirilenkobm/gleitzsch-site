import { Axis, Mode, PixelatePolicy, PlaybackPolicy, SupportedKeys, defaults, isAnimated, normalizedSettings, pixelIndex, pixelSizeFromIndex, playbackRate, presetSettings, testCard } from "./model.js";
import { openPhoto, rotatePhoto } from "./import.js";
import { RecipeMode, RecipeSession } from "./recipe-session.js";
import { ParameterWander } from "./wander.js";
import { TapePainter } from "./tape.js";
import { TextEditor } from "./text-editor.js";

const $ = (id) => document.getElementById(id);
const state = {
  mode: Mode.EMPTY, ready: false, loading: false, importing: false, compositionPending: false, saving: false, busy: false,
  photo: null, sourceId: null, generation: 0, frameId: 0, frame: null,
  settings: {}, axis: Axis.VERTICAL, time: 0, wanderTime: 0, speed: PlaybackPolicy.DEFAULT, dirty: false, preset: null,
  command: null, clockAt: null, requestAt: 0, raf: null, importId: 0,
  presentedAt: [], frames: 0, adapter: null, lastSaved: null, errors: [],
  exposure: 0, holdAfterComposition: false,
};
const [catalog, factory, build] = await Promise.all([
  fetch("./assets/controls.json").then((r) => r.json()),
  fetch("./assets/presets.json").then((r) => r.json()),
  fetch("./build.json").then((r) => r.json()),
]);
const controls = [...catalog.controls.filter((control) => SupportedKeys.includes(control.key)),
  { key: "pixelSize", title: "Pixel size", min: 0, max: PixelatePolicy.MAX, step: PixelatePolicy.STEP, uiMax: PixelatePolicy.MAX_INDEX, uiStep: 1, default: 0, hint: "Off, then even pixel sizes from 4 to 48." },
  { key: "wander", title: "Wrangling", min: 0, max: 0.1, step: 0.01, default: 0, hint: "Smooth drift around the base values. Zero ingredients stay off." },
];
const journey = new RecipeSession(catalog.controls, SupportedKeys);
const wander = new ParameterWander(catalog.controls);
const looks = [...factory.presets, { id: "pixelate", name: "Pixelate", settings: { pixelSize: PixelatePolicy.DEFAULT }, signal: {}, wander: 0 }];
state.settings = defaults(controls);
let worker = null;
let tapePainter = null;
let textEditor = null;
let compositionTimer = null;
try {
  if (!window.isSecureContext) throw new Error("Open the editor over HTTPS or localhost.");
  if (!window.Worker || !window.OffscreenCanvas || !$("preview").transferControlToOffscreen) {
    throw new Error("This browser cannot run the photo editor. Use a browser with WebGPU, WebAssembly SIMD and OffscreenCanvas support.");
  }
  tapePainter = await TapePainter.create();
  worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  const canvas = $("preview").transferControlToOffscreen();
  worker.postMessage({ kind: "init", canvas }, [canvas]);
} catch (error) {
  worker?.terminate();
  worker = null;
  state.mode = Mode.ERROR;
  state.errors.push(error.message);
  notice(error.message, true);
}

function notice(message = "", error = false) {
  $("notice").textContent = message;
  $("notice").classList.toggle("error", error);
}

function diagnostics() {
  return {
    productVersion: build.version, buildId: build.buildId, sourceRevision: build.revision,
    dirty: build.dirty, browser: navigator.userAgent, adapter: state.adapter,
    photo: state.photo ? { width: state.photo.width, height: state.photo.height } : null,
    settings: state.settings, recipeMode: journey.mode, randomRunning: journey.running, axis: state.axis, frame: state.frame,
    framesPresented: state.frames, playbackSpeed: state.speed, lastSaved: state.lastSaved, errors: state.errors,
    composition: { exposure: state.exposure, textLabels: textEditor?.snapshot().length ?? 0 },
    processing: "browser-local; no image upload API",
  };
}

function refresh() {
  document.body.classList.toggle("has-photo", !!state.photo);
  const pendingComposition = state.compositionPending || !!textEditor?.dragging;
  const editable = state.ready && !!state.photo && !state.loading && !state.saving && !pendingComposition && state.mode !== Mode.ERROR;
  const compositionEditable = state.ready && !!state.photo && !state.importing && !state.saving && !state.command && state.mode !== Mode.ERROR && state.mode !== Mode.ORIGINAL;
  textEditor?.setEnabled(compositionEditable);
  $("text-toggle").disabled = !compositionEditable;
  $("text-toggle").setAttribute("aria-pressed", String(!!textEditor?.editing));
  $("photo-exposure").disabled = !compositionEditable;
  $("photo-exposure").value = String(state.exposure);
  $("exposure-value").textContent = `${state.exposure > 0 ? "+" : ""}${state.exposure.toFixed(1)} EV`;
  const paused = state.mode === Mode.PAUSED;
  $("pause").disabled = !editable || !state.frame || !!state.command || state.mode === Mode.ORIGINAL;
  $("pause-label").textContent = paused ? "Continue" : "Pause";
  $("pause-icon").textContent = paused ? "▷" : "Ⅱ";
  $("original").disabled = !editable || !state.frame || !!state.command;
  $("original").setAttribute("aria-pressed", String(state.mode === Mode.ORIGINAL));
  $("axis").disabled = !editable || !!state.command;
  $("axis").textContent = state.axis === Axis.VERTICAL ? "Vertical" : "Horizontal";
  $("rotate").disabled = !editable || !!state.command;
  $("reset").disabled = !editable || !!state.command;
  $("playback-speed").disabled = !editable || !!state.command;
  $("playback-speed").value = String(state.speed);
  $("speed-value").textContent = `${state.speed}%`;
  $("random").disabled = !state.ready || state.loading || state.saving || pendingComposition || !!state.command;
  $("custom").disabled = $("random").disabled || state.mode === Mode.ORIGINAL;
  $("random").setAttribute("aria-pressed", String(journey.mode === RecipeMode.RANDOM));
  $("custom").setAttribute("aria-pressed", String(journey.mode === RecipeMode.CUSTOM));
  $("save").disabled = !editable || !state.frame || !!state.command || state.mode === Mode.ORIGINAL
    || (!paused && state.frame.generation !== state.generation);
  $("save").firstChild.textContent = state.saving ? "Saving… " : "Save frame ";
  $("preview").hidden = !state.photo;
  $("empty-state").hidden = !!state.photo;
  $("loading").hidden = !state.loading;
  $("view-mode").textContent = state.mode === Mode.EMPTY ? "READY WHEN YOU ARE"
    : state.mode === Mode.ORIGINAL ? "ORIGINAL" : paused ? "PAUSED"
    : journey.running ? "RANDOM" : "LIVE SIGNAL";
  $("engine-state").textContent = state.mode === Mode.ERROR ? "Editor needs a reload"
    : !state.ready ? "Starting the editor…" : state.mode === Mode.EMPTY ? "On-device processing"
    : state.mode === Mode.ORIGINAL ? "Original photo" : paused ? "Frame held"
    : journey.running ? "Random exploring" : isAnimated(state.settings) ? "Signal running" : "Static mix";
  for (const control of controls) {
    const input = $("effect-" + control.key);
    const value = state.settings[control.key];
    input.value = String(control.key === "pixelSize" ? pixelIndex(value) : value);
    input.disabled = !editable || !!state.command;
    $("value-" + control.key).textContent = control.key === "pixelSize" ? value > 0 ? `${value} px` : "Off"
      : control.key === "wander" ? `${(value * 100).toFixed(0)}%` : Number(value).toFixed(2);
  }
  document.querySelectorAll(".preset").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.preset === state.preset));
    button.disabled = !state.ready || state.loading || state.saving || pendingComposition || !!state.command;
  });
  document.querySelectorAll(".open-photo").forEach((button) => { button.disabled = !state.ready || state.saving; });
  $("test-card").disabled = !state.ready || state.loading || state.saving;
  $("version").textContent = `GLEITZSCH ${build.version}`;
  $("diagnostics").textContent = JSON.stringify(diagnostics(), null, 2);
}

function schedule() {
  if (state.raf === null && state.ready && state.photo && !state.loading && !state.saving
    && !state.compositionPending && !textEditor?.dragging && state.mode === Mode.LIVE && !document.hidden) state.raf = requestAnimationFrame(tick);
}

function tick(now) {
  state.raf = null;
  if (!state.ready || !state.photo || state.loading || state.saving || state.compositionPending || textEditor?.dragging || state.mode !== Mode.LIVE || document.hidden) return;
  const animated = journey.running || state.settings.wander > 0 || isAnimated(state.settings);
  const delta = state.clockAt !== null && animated ? Math.min(0.1, Math.max(0, (now - state.clockAt) / 1000)) : 0;
  const rate = playbackRate(state.speed);
  state.time += delta * rate;
  state.wanderTime += delta * rate;
  journey.advance(delta, rate);
  state.clockAt = now;
  // Keep the effect/recipe clocks ticking while the worker is occupied. A slow
  // FFT must skip preview frames rather than turn Random into a frame counter.
  if (state.busy) { schedule(); return; }
  if (!state.dirty && !animated) return;
  if (!state.dirty && now - state.requestAt < 1000 / 30) { schedule(); return; }
  state.requestAt = now;
  state.busy = true;
  state.dirty = false;
  const recipe = journey.sample(state.settings);
  if (!journey.running) recipe.settings = wander.applying(state.settings, state.wanderTime);
  worker.postMessage({ kind: "render", sourceId: state.sourceId, generation: state.generation,
    frameId: ++state.frameId, time: state.time, wanderTime: state.wanderTime, playbackSpeed: state.speed, ...recipe, axis: state.axis });
}

function changeSettings(values, preset = null) {
  journey.select(preset ? RecipeMode.PRESET : RecipeMode.CUSTOM);
  state.settings = normalizedSettings(values, controls);
  state.wanderTime = 0;
  state.preset = preset;
  state.generation++;
  state.command = null;
  state.mode = state.photo ? Mode.LIVE : Mode.EMPTY;
  state.clockAt = null;
  state.dirty = true;
  notice();
  refresh();
  schedule();
}

function randomSeed() {
  const words = crypto.getRandomValues(new Uint32Array(2));
  return (BigInt(words[0]) << 32n) | BigInt(words[1]);
}

function startRandom() {
  if (!state.ready || state.loading || state.saving || state.command) return;
  const settings = state.frame?.settings ?? state.settings;
  state.settings = { ...settings, pixelSize: 0, wander: 0 };
  state.time = state.frame?.time ?? state.time;
  state.preset = null;
  journey.start(settings, randomSeed());
  restartRendering();
}

function enterCustom() {
  if (state.loading || state.saving || state.command || state.mode === Mode.ORIGINAL) return;
  journey.select(RecipeMode.CUSTOM);
  state.preset = null;
  if (state.frame) {
    state.settings = { ...state.frame.settings, wander: 0 };
    pause();
  } else refresh();
}

function restartRendering() {
  state.wanderTime = 0;
  if (journey.mode === RecipeMode.RANDOM && !journey.running) journey.start(state.settings, randomSeed());
  state.generation++;
  state.command = null;
  state.mode = state.photo ? Mode.LIVE : Mode.EMPTY;
  state.clockAt = null;
  state.dirty = true;
  notice();
  refresh();
  schedule();
}

function scheduleComposition() {
  clearTimeout(compositionTimer);
  state.compositionPending = true;
  state.clockAt = null;
  refresh();
  compositionTimer = setTimeout(() => {
    if (!state.photo || state.importing || state.saving) return;
    sendSource(state.photo, $("photo-name").textContent, { preserveTime: true, keepText: true, keepPause: true });
  }, 120);
}

function sendSource(photo, name, { preserveTime = false, keepText = false, keepPause = false } = {}) {
  clearTimeout(compositionTimer);
  state.compositionPending = false;
  state.holdAfterComposition = keepPause && (state.mode === Mode.PAUSED || state.holdAfterComposition);
  if (!keepText) { textEditor?.clear(); state.exposure = 0; }
  state.photo = photo;
  textEditor?.setImage(photo);
  state.sourceId = crypto.randomUUID();
  state.generation++;
  state.frame = null;
  state.command = null;
  state.mode = Mode.LIVE;
  state.time = preserveTime ? state.time : 0;
  state.wanderTime = 0;
  if (journey.mode === RecipeMode.RANDOM && !state.holdAfterComposition && (!preserveTime || !journey.running)) journey.start(state.settings, randomSeed());
  state.clockAt = null;
  state.loading = true;
  $("loading").textContent = keepText ? "Updating image…" : "Opening photo…";
  state.busy = true;
  state.presentedAt = [];
  $("photo-name").textContent = name;
  $("dimensions").textContent = `${photo.width} × ${photo.height} · PNG EXPORT`;
  const pixels = photo.pixels.slice().buffer;
  const labels = textEditor?.snapshot() ?? [];
  const overlay = labels.length ? tapePainter.raster(labels, photo.width, photo.height).buffer : null;
  worker.postMessage({ kind: "source", sourceId: state.sourceId, generation: state.generation,
    width: photo.width, height: photo.height, pixels, overlay, exposure: state.exposure, textLabels: labels.length }, overlay ? [pixels, overlay] : [pixels]);
  refresh();
}

async function choosePhoto(file) {
  if (!file || state.saving) return;
  if (!state.ready) { notice("The editor is not ready. Check the status below and try again.", true); return; }
  const importId = ++state.importId;
  const reconcileComposition = state.compositionPending;
  clearTimeout(compositionTimer);
  state.compositionPending = false;
  state.importing = true;
  $("loading").textContent = "Opening photo…";
  state.loading = true;
  state.generation++;
  state.command = null;
  notice();
  refresh();
  try {
    const photo = await openPhoto(file, () => importId === state.importId);
    if (!photo || importId !== state.importId) return;
    state.importing = false;
    state.axis = photo.width > photo.height ? Axis.HORIZONTAL : Axis.VERTICAL;
    sendSource(photo, file.name);
  } catch (error) {
    if (importId !== state.importId) return;
    state.importing = false;
    state.loading = false;
    state.dirty = true;
    notice(error.message, true);
    if (reconcileComposition && state.photo) scheduleComposition();
    refresh();
    schedule();
  }
}

function pause(save = false) {
  if (!state.frame || state.loading || state.compositionPending || textEditor?.dragging || state.saving || state.command || state.mode === Mode.ORIGINAL) return;
  state.mode = Mode.PAUSED;
  if (journey.mode === RecipeMode.RANDOM) state.settings = { ...state.frame.settings };
  journey.hold();
  state.time = state.frame.time;
  state.wanderTime = state.frame.wanderTime ?? state.wanderTime;
  state.clockAt = null;
  state.generation++;
  state.saving = save;
  state.command = crypto.randomUUID();
  worker.postMessage({ kind: save ? "save" : "freeze", generation: state.generation,
    frameId: state.frame.frameId, commandId: state.command });
  refresh();
}

function resume({ resetWander = true } = {}) {
  if (journey.mode === RecipeMode.RANDOM && !journey.running) { startRandom(); return; }
  state.mode = Mode.LIVE;
  if (resetWander) state.wanderTime = 0;
  state.generation++;
  state.clockAt = null;
  state.dirty = true;
  notice();
  refresh();
  schedule();
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

if (worker) worker.onmessage = ({ data: message }) => {
  if (message.kind === "ready") {
    state.ready = true;
    state.adapter = message.adapter;
    refresh();
  } else if (message.kind === "source-ready" && message.sourceId === state.sourceId && !state.importing) {
    state.loading = false;
    state.dirty = true;
    refresh();
  } else if (message.kind === "idle") {
    state.busy = false;
    schedule();
  } else if (message.kind === "presented" && message.generation === state.generation
    && message.sourceId === state.sourceId) {
    state.frame = message;
    if (journey.running) state.settings = { ...message.settings };
    state.frames++;
    if (state.holdAfterComposition && !state.compositionPending) {
      state.holdAfterComposition = false;
      pause();
    }
    const now = performance.now();
    state.presentedAt.push(now);
    state.presentedAt = state.presentedAt.filter((time) => now - time < 2000);
    const first = state.presentedAt[0];
    $("fps").textContent = (journey.running || state.settings.wander > 0 || isAnimated(state.settings)) && state.presentedAt.length > 2
      ? `${((state.presentedAt.length - 1) * 1000 / (now - first)).toFixed(1)} FPS` : "— FPS";
    refresh();
  } else if (message.kind === "frozen" && message.commandId === state.command) {
    state.frame = { ...state.frame, settings: message.settings, recipe: message.recipe, time: message.time, generation: state.generation };
    state.time = message.time;
    if (!state.saving) state.command = null;
    refresh();
  } else if (message.kind === "original" && message.commandId === state.command) {
    state.command = null;
    refresh();
  } else if (message.kind === "saved" && message.commandId === state.command) {
    state.lastSaved = { frameId: message.frameId, width: message.width, height: message.height, pixelHash: message.pixelHash };
    download(message.blob, `gleitzsch-${new Date().toISOString().replace(/[:.]/g, "-")}.png`);
    state.saving = false;
    state.command = null;
    notice("PNG saved. Continue when you’re ready.");
    refresh();
  } else if (message.kind === "error") {
    if (!message.fatal && ((message.generation !== undefined && message.generation !== state.generation)
      || (message.sourceId && message.sourceId !== state.sourceId))) return;
    if (message.fatal) {
      clearTimeout(compositionTimer);
      state.compositionPending = false;
      state.ready = false;
    }
    state.errors.push(message.message);
    state.mode = !message.fatal && state.photo && state.frame ? Mode.PAUSED : Mode.ERROR;
    state.loading = false;
    state.saving = false;
    state.busy = false;
    state.command = null;
    notice(message.message, true);
    refresh();
  }
};
if (worker) worker.onerror = (event) => {
  state.errors.push(event.message);
  state.mode = Mode.ERROR;
  state.loading = false;
  state.busy = false;
  notice(event.message || "The editor could not start. Reload this page to retry.", true);
  refresh();
};

const descriptions = { VHS: "Tape drift and afterglow.", "Echo Chamber": "Repeating spectral echoes.",
  Iridescence: "Color fringes and shifting signal.", "Old TV": "Rolling lines and fading phosphors.", "Broken Air": "Color damage and tearing." };
descriptions.Pixelate = "Palette colors and structured pixels.";
for (const preset of [{ id: "original", name: "No effects" }, ...looks]) {
  const button = document.createElement("button");
  button.className = "preset";
  button.dataset.preset = preset.id;
  button.setAttribute("aria-pressed", "false");
  const name = document.createElement("span");
  name.textContent = preset.name;
  const description = document.createElement("small");
  description.textContent = descriptions[preset.name] ?? "Keep exposure and text.";
  button.append(name, description);
  button.addEventListener("click", () => {
    const values = preset.id === "original" ? defaults(controls) : presetSettings(preset, controls);
    if (preset.id === "pixelate") values.pixelSize = state.settings.pixelSize > 0 ? state.settings.pixelSize : PixelatePolicy.DEFAULT;
    changeSettings(values, preset.id);
  });
  $("presets").append(button);
}

const groups = [
  { title: "Pixels & variation", open: true, keys: ["pixelSize", "wander"] },
  { title: "Tape & transmission", open: true, keys: ["tracking", "syncLoss", "headSwitch", "chromaSmear", "chromaLoss", "crossColor", "interference", "interferenceFrequency", "interferenceAngle", "signalNoise"] },
  { title: "Screen & memory", open: true, keys: ["crtBeam", "crtMask", "crtGlow", "persistence", "barrel", "signalSoftness"] },
  { title: "Color damage", open: false, keys: ["colorDrive", "phaseWarp", "colorPhase", "colorLeak", "lineJitter", "colorStreaks", "blackPoint", "signalContrast"] },
  { title: "Tearing", open: false, keys: ["tear", "tearRainbow", "tearPosition", "tearSpread", "tearDrift"] },
  { title: "Bending & echo", open: false, keys: ["displacement", "bendShape", "comb", "combSpacing", "echoTrain", "scatter", "scatterDetail"] },
  { title: "Color & spectrum", open: false, keys: ["radialRGB", "rainbow", "rainbowRadius", "rainbowSpread", "dispersion", "spectralGain", "frequency", "bandwidth", "codecQuality", "originalBlend"] },
  { title: "Stripes", open: false, keys: ["stripes", "stripeDensity"] },
];
for (const group of groups) {
  const section = document.createElement("details");
  section.className = "control-group";
  section.open = group.open;
  const summary = document.createElement("summary");
  summary.textContent = group.title;
  section.append(summary);
  for (const key of group.keys) {
    const control = controls.find((item) => item.key === key);
    if (!control) continue;
    const row = document.createElement("div");
    row.className = "control";
    const label = document.createElement("label");
    label.htmlFor = "effect-" + key;
    label.title = control.hint;
    label.append(document.createTextNode(control.title));
    const value = document.createElement("output");
    value.id = "value-" + key;
    value.htmlFor = "effect-" + key;
    label.append(value);
    const input = document.createElement("input");
    Object.assign(input, { type: "range", id: "effect-" + key, min: control.min, max: control.uiMax ?? control.max, step: control.uiStep ?? control.step, disabled: true });
    input.title = control.hint;
    input.addEventListener("pointerdown", () => {
      if (journey.running) changeSettings(state.settings);
    });
    input.addEventListener("input", () => {
      const value = Number(input.value);
      changeSettings({ ...state.settings, [key]: key === "pixelSize" ? pixelSizeFromIndex(value) : value });
    });
    row.append(label, input);
    section.append(row);
  }
  $("controls").append(section);
}

document.querySelectorAll(".open-photo").forEach((button) => button.addEventListener("click", () => $("photo-input").click()));
$("photo-input").addEventListener("change", () => {
  const file = $("photo-input").files[0];
  $("photo-input").value = "";
  void choosePhoto(file);
});
$("test-card").addEventListener("click", () => {
  state.importId++;
  state.importing = false;
  state.axis = Axis.VERTICAL;
  if (journey.mode !== RecipeMode.RANDOM && (!state.preset || state.preset === "original")) {
    const preset = looks.find((item) => item.name === "VHS");
    state.settings = presetSettings(preset, controls);
    state.preset = preset.id;
    journey.select(RecipeMode.PRESET);
  }
  sendSource(testCard(), "Test card");
});
$("random").addEventListener("click", startRandom);
$("custom").addEventListener("click", enterCustom);
$("pause").addEventListener("click", () => state.mode === Mode.PAUSED ? resume() : pause());
$("save").addEventListener("click", () => pause(true));
$("playback-speed").addEventListener("input", () => {
  state.speed = Number($("playback-speed").value);
  state.clockAt = null;
  refresh();
  schedule();
});
textEditor = new TextEditor({ painter: tapePainter, stage: $("drop-zone"), panel: $("tape-panel"), overlay: $("tape-overlay"),
  onChange: scheduleComposition, onState: refresh });
$("text-toggle").addEventListener("click", () => textEditor.toggle());
$("photo-exposure").addEventListener("input", () => {
  state.exposure = Number($("photo-exposure").value);
  scheduleComposition();
});
$("photo-exposure").addEventListener("dblclick", () => {
  state.exposure = 0;
  scheduleComposition();
});
$("reset").addEventListener("click", () => changeSettings(defaults(controls), "original"));
$("axis").addEventListener("click", () => {
  state.axis = state.axis === Axis.VERTICAL ? Axis.HORIZONTAL : Axis.VERTICAL;
  restartRendering();
});
$("rotate").addEventListener("click", () => {
  state.importId++;
  const photo = rotatePhoto(state.photo);
  state.axis = photo.width > photo.height ? Axis.HORIZONTAL : Axis.VERTICAL;
  sendSource(photo, $("photo-name").textContent, { preserveTime: true, keepText: true, keepPause: true });
});
let comparisonWasPaused = false;
$("original").addEventListener("click", () => {
  if (state.mode === Mode.ORIGINAL) {
    if (comparisonWasPaused) { state.mode = Mode.PAUSED; pause(); }
    else resume({ resetWander: false });
  } else {
    comparisonWasPaused = state.mode === Mode.PAUSED;
    state.mode = Mode.ORIGINAL;
    state.time = state.frame.time;
    state.wanderTime = state.frame.wanderTime ?? state.wanderTime;
    journey.seekPresented(state.frame);
    state.generation++;
    state.clockAt = null;
    state.command = crypto.randomUUID();
    worker.postMessage({ kind: "original", generation: state.generation, commandId: state.command });
    refresh();
  }
});
$("about-button").addEventListener("click", () => { refresh(); $("about").showModal(); });
document.querySelectorAll(".about-processing").forEach((button) => button.addEventListener("click", () => {
  refresh(); $("about").showModal();
}));
$("close-about").addEventListener("click", () => $("about").close());
$("download-report").addEventListener("click", () => download(
  new Blob([JSON.stringify(diagnostics(), null, 2)], { type: "application/json" }), "gleitzsch-local-diagnostics.json"));
document.addEventListener("visibilitychange", () => { state.clockAt = null; schedule(); });
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "o" && !state.saving) {
    event.preventDefault(); $("photo-input").click();
  }
  if (event.code === "Space" && !["INPUT", "TEXTAREA", "SELECT", "BUTTON", "SUMMARY"].includes(document.activeElement.tagName)
    && !$("about").open && !$("pause").disabled) {
    event.preventDefault(); $("pause").click();
  }
});
let dragDepth = 0;
document.addEventListener("dragenter", (event) => {
  if (!event.dataTransfer.types.includes("Files")) return;
  event.preventDefault(); dragDepth++; $("drop-hint").hidden = false;
});
document.addEventListener("dragover", (event) => { event.preventDefault(); });
document.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; $("drop-hint").hidden = true; } });
document.addEventListener("drop", (event) => {
  event.preventDefault(); dragDepth = 0; $("drop-hint").hidden = true;
  void choosePhoto(event.dataTransfer.files[0]);
});

const initial = looks.find((preset) => preset.name === "VHS");
state.settings = presetSettings(initial, controls);
state.preset = initial.id;
refresh();
