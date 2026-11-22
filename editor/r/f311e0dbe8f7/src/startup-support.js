export const StartupCode = Object.freeze({
  INSECURE: "insecure", BROWSER: "browser", SIMD: "simd", WEBGPU: "webgpu",
  ADAPTER: "adapter", GRAPHICS: "graphics", DOWNLOAD: "download", ENGINE: "engine",
});

export class StartupError extends Error {
  constructor(code, message) { super(message); this.name = "StartupError"; this.code = code; }
}

// A valid module returning v128.const. Validation tests the required instruction
// set without downloading or executing the full engine, or guessing from UA.
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0,
  10, 22, 1, 20, 0, 253, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 11,
]);

export function checkBrowserCapabilities(environment, canvas) {
  if (!environment.isSecureContext) throw new StartupError(StartupCode.INSECURE, "The editor needs a secure HTTPS connection or localhost.");
  if (!environment.Worker || !environment.OffscreenCanvas || !canvas?.transferControlToOffscreen
    || !environment.createImageBitmap || !environment.FontFace || !environment.document?.fonts
    || !environment.crypto?.randomUUID || !environment.crypto?.subtle) {
    throw new StartupError(StartupCode.BROWSER, "This browser is missing features needed to open, process or save photos.");
  }
  if (!environment.WebAssembly?.validate || !environment.WebAssembly.validate(SIMD_PROBE)) {
    throw new StartupError(StartupCode.SIMD, "This browser can’t run the image-processing engine’s WebAssembly SIMD instructions.");
  }
  if (!environment.navigator?.gpu) throw new StartupError(StartupCode.WEBGPU, "This browser hasn’t made WebGPU graphics available to the editor.");
}

export function startupIssue(error) {
  const detail = error?.message || String(error);
  switch (error?.code) {
    case StartupCode.INSECURE:
      return { title: "Open the editor over HTTPS", message: "Use the secure website address, or localhost when testing on your computer.", detail };
    case StartupCode.BROWSER:
    case StartupCode.SIMD:
    case StartupCode.WEBGPU:
      return { title: "This browser can’t run the editor here", message: "Update your browser or try a current Chrome, Edge, Firefox or Safari on a supported device. Check that graphics acceleration is enabled.", detail };
    case StartupCode.ADAPTER:
      return { title: "Graphics aren’t available", message: "The browser couldn’t access a compatible graphics device. Check graphics acceleration, or try another up-to-date browser on this device.", detail };
    case StartupCode.DOWNLOAD:
      return { title: "The editor couldn’t load its files", message: "Check your connection and reload the page to try again.", detail };
    default:
      return { title: "The editor couldn’t start", message: "Reload the page to try again. If it keeps happening, try another up-to-date browser on this device.", detail };
  }
}

export async function loadAsset(url, format, fetcher = fetch) {
  try {
    const response = await fetcher(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response[format]();
  } catch (error) {
    throw new StartupError(StartupCode.DOWNLOAD, `Could not load ${new URL(url, import.meta.url).pathname.split("/").pop()}: ${error.message}`);
  }
}

export async function checkWorkerCanvas(Canvas = OffscreenCanvas) {
  const canvas = new Canvas(1, 1);
  const context = canvas.getContext("2d");
  if (!context || typeof canvas.convertToBlob !== "function") {
    throw new StartupError(StartupCode.BROWSER, "This browser cannot prepare PNG saving in its processing worker.");
  }
  // Exercise the same encoder used for Save, before enabling photo controls.
  await canvas.convertToBlob({ type: "image/png" });
}
