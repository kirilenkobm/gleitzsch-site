import createDsp from "../wasm/dsp.mjs";
import { GpuRenderer } from "./gpu.js";
import { Axis, SpectralKeys, SpatialKeys, GradeKeys, TransmissionKeys, hasTransmission, signalDimensions } from "./model.js";
import { StartupCode, StartupError, checkWorkerCanvas } from "./startup-support.js";
import { normalizedMeltHeight } from "./melt-line.js";

let gpu;
let dsp;
let currentSource = null;
let generation = -1;
let staticKey = null;
let latestGeneration = -1;
let busy = false;
let pending = null;
let queuedSource = null;
let frozen = null;
let pixelSize = 0;
let meltAmount = null;
let meltHeight = null;
let preprocessedPixels = null;

function check(result) {
  if (!result) throw new Error(dsp.UTF8ToString(dsp._web_error()));
}

function parameters(settings) {
  const values = [...SpectralKeys.map((key) => settings[key]), ...TransmissionKeys.map((key) => settings[key])];
  dsp.HEAPF32.set(values, dsp._web_parameters() / 4);
}

function output() {
  const pointer = dsp._web_output();
  return dsp.HEAPU8.subarray(pointer, pointer + currentSource.width * currentSource.height * 4);
}

async function replaceSource(message) {
  const { width, height, pixels, sourceId } = message;
  check(dsp._web_create(width, height, Math.min(width, height)));
  dsp.HEAPU8.set(new Uint8Array(pixels), dsp._web_input());
  if (message.overlay) dsp.HEAPU8.set(new Uint8Array(message.overlay), dsp._web_overlay());
  check(dsp._web_compose(message.exposure ?? 0, message.overlay ? 1 : 0));
  const composed = Uint8Array.from(dsp.HEAPU8.subarray(dsp._web_input(), dsp._web_input() + width * height * 4));
  const resized = !currentSource || currentSource.width !== width || currentSource.height !== height;
  if (resized) await gpu.resize(width, height);
  else { gpu.resetHistory(); gpu.frames = []; gpu.frameCursor = 0; }
  gpu.upload(gpu.original, new Uint8Array(pixels));
  gpu.upload(gpu.composedSource, composed);
  if (resized) gpu.present(gpu.composedSource);
  await gpu.device.queue.onSubmittedWorkDone();
  currentSource = { width, height, sourceId, pixels: composed, exposure: message.exposure ?? 0, textLabels: message.textLabels ?? 0 };
  pixelSize = 0;
  meltAmount = null;
  meltHeight = null;
  preprocessedPixels = composed;
  staticKey = null;
  generation = -1;
  frozen = null;
  postMessage({ kind: "source-ready", sourceId, width, height });
}

async function render(request) {
  if (!currentSource || request.sourceId !== currentSource.sourceId) return;
  const started = performance.now();
  const { settings, axis } = request;
  const artisticPhase = Number.isFinite(request.artisticPhase) ? request.artisticPhase : 0;
  let pixelateMs = 0;
  const amount = settings.melt ?? 0;
  const height = normalizedMeltHeight(request.meltLineHeight);
  if (meltAmount !== amount || meltHeight !== height) {
    if (meltHeight !== height) check(dsp._web_melt_line(height ?? -1));
    check(dsp._web_melt(amount));
    const size = currentSource.width * currentSource.height * 4;
    preprocessedPixels = Uint8Array.from(dsp.HEAPU8.subarray(dsp._web_input(), dsp._web_input() + size));
    gpu.upload(gpu.composedSource, preprocessedPixels);
    meltAmount = amount;
    meltHeight = height;
    pixelSize = -1;
    staticKey = null;
  }
  if (pixelSize !== settings.pixelSize) {
    const pixelateStarted = performance.now();
    const pixels = settings.pixelSize > 0 ? await gpu.read(gpu.pixelate.process(gpu.composedSource, settings.pixelSize)) : preprocessedPixels;
    dsp.HEAPU8.set(pixels, dsp._web_input());
    check(dsp._web_commit_source());
    pixelSize = settings.pixelSize;
    staticKey = null;
    pixelateMs = performance.now() - pixelateStarted;
  }
  if (generation !== request.generation) {
    gpu.resetHistory();
    generation = request.generation;
  }
  parameters(settings);
  const transmission = hasTransmission(settings);
  const size = transmission ? signalDimensions(currentSource.width, currentSource.height, settings) : currentSource;
  const key = JSON.stringify([axis, artisticPhase, [...SpectralKeys, ...SpatialKeys, ...GradeKeys].map((name) => settings[name]),
    transmission, size.width, size.height]);
  let staticMs = 0;
  if (key !== staticKey) {
    const staticStarted = performance.now();
    // Wrangling supplies the native camera's quiet-SIGNAL FFT motion. Zero
    // Wrangling and legacy fixture requests retain the frozen phase=0 path.
    check(dsp._web_spectral(axis === Axis.VERTICAL ? 1 : 0, artisticPhase));
    const spatial = await gpu.prepareSpatial(output(), settings, size, { axis });
    if (transmission) {
      check(dsp._web_prepare_signal(size.width, size.height));
      dsp.HEAPU8.set(spatial, dsp._web_signal_input());
      check(dsp._web_commit_signal());
    }
    staticKey = key;
    staticMs = performance.now() - staticStarted;
  }
  const signalStarted = performance.now();
  if (transmission) check(dsp._web_signal(request.time, 1337));
  const signalMs = performance.now() - signalStarted;
  // A new import/settings generation can arrive while the spatial readback awaits.
  if (request.generation !== latestGeneration || queuedSource) return;
  frozen = null;
  const frame = gpu.render(transmission ? output() : null, settings, request);
  await gpu.device.queue.onSubmittedWorkDone();
  if (request.generation !== latestGeneration || queuedSource) return;
  postMessage({ kind: "presented", sourceId: frame.sourceId, frameId: frame.frameId,
    generation: frame.generation, time: frame.time, settings: frame.settings,
    recipe: frame.recipe,
    wanderTime: frame.wanderTime, playbackSpeed: frame.playbackSpeed, pixelateMs,
    artisticPhase,
    composition: { exposure: currentSource.exposure, textLabels: currentSource.textLabels, meltLineHeight: height },
    totalMs: performance.now() - started, signalMs, staticMs,
    memoryBytes: dsp.HEAPU8.byteLength });
}

async function drain() {
  if (busy || !gpu || !dsp) return;
  busy = true;
  let activeMessage = null;
  try {
    if (queuedSource) {
      const source = queuedSource;
      activeMessage = source;
      queuedSource = null;
      await replaceSource(source);
    } else if (pending) {
      const message = pending;
      activeMessage = message;
      pending = null;
      if (message.kind === "render") await render(message);
      else if (message.kind === "original") {
        gpu.present(gpu.original);
        await gpu.device.queue.onSubmittedWorkDone();
        postMessage({ kind: "original", commandId: message.commandId });
      } else if (message.kind === "freeze" || message.kind === "save") {
        frozen = gpu.freeze(message.frameId);
        await gpu.device.queue.onSubmittedWorkDone();
        postMessage({ kind: "frozen", frameId: frozen.frameId, commandId: message.commandId,
          time: frozen.time, settings: frozen.settings, recipe: frozen.recipe, artisticPhase: frozen.artisticPhase ?? 0 });
        if (message.kind === "save") {
          const pixels = await gpu.read(frozen.texture);
          const canvas = new OffscreenCanvas(currentSource.width, currentSource.height);
          canvas.getContext("2d").putImageData(new ImageData(
            new Uint8ClampedArray(pixels.buffer), currentSource.width, currentSource.height), 0, 0);
          const blob = await canvas.convertToBlob({ type: "image/png" });
          const digest = await crypto.subtle.digest("SHA-256", pixels);
          const pixelHash = [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, "0")).join("");
          postMessage({ kind: "saved", commandId: message.commandId, blob, frameId: frozen.frameId,
            width: currentSource.width, height: currentSource.height, pixelHash });
        }
      }
    }
  } catch (error) {
    pending = null;
    postMessage({ kind: "error", message: error.message ?? String(error), fatal: !!gpu?.lost,
      sourceId: activeMessage?.sourceId ?? currentSource?.sourceId, generation: activeMessage?.generation });
  } finally {
    busy = false;
    postMessage({ kind: "idle" });
    if (queuedSource || pending) void drain();
  }
}

self.onmessage = async ({ data: message }) => {
  try {
    if (message.kind === "init") {
      await checkWorkerCanvas();
      [gpu, dsp] = await Promise.all([GpuRenderer.create(message.canvas), createDsp()]);
      if (gpu.lost) throw new StartupError(StartupCode.GRAPHICS, gpu.lost);
      gpu.device.lost.then((info) => postMessage({ kind: "error", fatal: true,
        message: info.message || "The graphics device became unavailable. Reload the editor to restart." }));
      postMessage({ kind: "ready", adapter: gpu.adapter });
      void drain();
    } else if (message.kind === "source") {
      latestGeneration = message.generation;
      pending = null;
      queuedSource = message;
      void drain();
    } else if (message.kind === "invalidate") {
      latestGeneration = message.generation;
      pending = null;
    } else if (message.kind === "render") {
      latestGeneration = message.generation;
      pending = message;
      void drain();
    } else if (["freeze", "save", "original"].includes(message.kind)) {
      latestGeneration = message.generation;
      pending = message;
      void drain();
    }
  } catch (error) {
    postMessage({ kind: "error", message: error.message ?? String(error), code: error.code ?? StartupCode.ENGINE,
      generation: message.generation, sourceId: message.sourceId });
  }
};
