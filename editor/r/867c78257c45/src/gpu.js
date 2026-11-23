import { hasDamage, hasGrade } from "./model.js";
import { PixelateGpu } from "./pixelate.js";
import { StartupCode, StartupError, loadAsset } from "./startup-support.js";

const PASS_BINDINGS = Object.freeze({
  spatial: [0, 4, 6],
  resize: [0, 4],
  soften: [0, 4, 6],
  raster: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  reduce: [0, 12],
  blur: [0, 6, 11, 12],
  finish: [0, 1, 4, 6, 8],
  curve: [0, 4, 6],
});

const alignedRow = (width) => Math.ceil((width * 4) / 256) * 256;

export function geometryTables(width, height) {
  const scale = Math.min(width, height) / 720;
  const beamPeriod = Math.max(1, 2.4 * scale);
  const beam = new Float32Array(height * 17);
  const normalizer = Math.sqrt(2 * Math.PI);
  for (let y = 0; y < height; y++) {
    for (let level = 0; level <= 16; level++) {
      const sigma = 0.12 + 0.16 * Math.sqrt(level / 16);
      let total = 0;
      for (let sample = 0; sample < 8; sample++) {
        const phase = (y + (sample + 0.5) / 8) / beamPeriod;
        const point = phase - Math.floor(phase) - 0.5;
        for (let line = -2; line <= 2; line++) {
          const distance = (point + line) / sigma;
          total += Math.exp(-0.5 * distance * distance) / (normalizer * sigma);
        }
      }
      beam[y * 17 + level] = total / 8;
    }
  }
  const period = Math.max(1, 3.6 * scale);
  const mask = new Float32Array(width * 3);
  for (let x = 0; x < width; x++) {
    for (let channel = 0; channel < 3; channel++) {
      const center = (2 - channel + 0.5) / 3;
      let total = 0;
      const sigma = 0.105;
      for (let sample = 0; sample < 8; sample++) {
        const phase = (x + (sample + 0.5) / 8) / period;
        const point = phase - Math.floor(phase) - center;
        for (let triad = -1; triad <= 1; triad++) {
          const distance = (point + triad) / sigma;
          total += Math.exp(-0.5 * distance * distance) / (normalizer * sigma);
        }
      }
      mask[x * 3 + channel] = 0.35 + (0.65 * total) / 8;
    }
  }
  for (let channel = 0; channel < 3; channel++) {
    let sum = 0;
    for (let x = 0; x < width; x++) sum += mask[x * 3 + channel];
    const correction = width / sum;
    for (let x = 0; x < width; x++) mask[x * 3 + channel] *= correction;
  }
  return { beam, mask };
}

function gaussian(width, height, amount) {
  const scale = Math.min(width, height) / 720;
  const sigma = Math.max(0.65, (0.8 + 1.4 * amount) * scale);
  const radius = Math.min(8, Math.max(2, Math.ceil(sigma * 3)));
  const weights = new Float32Array(radius * 2 + 1);
  let sum = 0;
  for (let k = -radius; k <= radius; k++) {
    const value = Math.exp(-(k * k) / (2 * sigma * sigma));
    weights[k + radius] = value;
    sum += value;
  }
  for (let i = 0; i < weights.length; i++) weights[i] /= sum;
  return { radius, weights };
}

export class GpuRenderer {
  static async create(canvas) {
    if (!navigator.gpu) throw new StartupError(StartupCode.WEBGPU, "WebGPU is unavailable in this browser’s processing worker.");
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new StartupError(StartupCode.ADAPTER, "No compatible WebGPU adapter is available.");
    const device = await adapter.requestDevice();
    device.pushErrorScope("validation");
    try {
      const renderer = await GpuRenderer.prepare(device, canvas);
      await device.queue.onSubmittedWorkDone();
      const validation = await device.popErrorScope();
      if (validation || renderer.lost) throw new StartupError(StartupCode.GRAPHICS, validation?.message || renderer.lost);
      renderer.adapter = { ...adapter.info, vendor: adapter.info?.vendor ?? "", architecture: adapter.info?.architecture ?? "" };
      return renderer;
    } catch (error) {
      device.destroy();
      throw error;
    }
  }

  static async prepare(device, canvas) {
    const renderer = new GpuRenderer(device, canvas);
    const [shader, transfer, encoded] = await Promise.all([
      loadAsset(new URL("../shaders/effects.wgsl", import.meta.url), "text"),
      loadAsset(new URL("../assets/crt-linear.f32", import.meta.url), "arrayBuffer"),
      loadAsset(new URL("../assets/crt-encoded.u8", import.meta.url), "arrayBuffer"),
    ]);
    if (transfer.byteLength !== 1024 || encoded.byteLength !== 65536) {
      throw new StartupError(StartupCode.DOWNLOAD, "The CRT color tables did not load correctly.");
    }
    const module = device.createShaderModule({ label: "Gleitzsch effects", code: shader });
    const compilation = await module.getCompilationInfo();
    const errors = compilation.messages.filter((m) => m.type === "error");
    if (errors.length) throw new Error(errors.map((m) => `WGSL ${m.lineNum}:${m.linePos} ${m.message}`).join("\n"));
    await Promise.all(Object.keys(PASS_BINDINGS).map(async (entryPoint) => {
      renderer.pipelines[entryPoint] = await device.createComputePipelineAsync({
        label: entryPoint, layout: "auto", compute: { module, entryPoint },
      });
    }));
    renderer.presentation = await device.createRenderPipelineAsync({
      label: "Present completed frame", layout: "auto",
      vertex: { module, entryPoint: "fullscreen" },
      fragment: { module, entryPoint: "present", targets: [{ format: renderer.format }] },
      primitive: { topology: "triangle-list" },
    });
    renderer.linear = renderer.buffer(new Uint8Array(transfer));
    renderer.encoded = renderer.buffer(new Uint8Array(encoded));
    await Promise.all([
      renderer.createFamily("spatial", "spatial.wgsl", ["highlights", "halo", "compose", "luma", "stripes"]),
      renderer.createFamily("signal", "signal.wgsl", ["grade", "damage"]),
      PixelateGpu.create(device).then((pixelate) => { renderer.pixelate = pixelate; }),
    ]);
    return renderer;
  }

  constructor(device, canvas) {
    this.device = device;
    this.canvas = canvas;
    this.context = canvas.getContext("webgpu");
    if (!this.context) throw new StartupError(StartupCode.WEBGPU, "This browser cannot display WebGPU from its processing worker.");
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device, format: this.format, alphaMode: "opaque", colorSpace: "srgb" });
    this.pipelines = {};
    this.uniforms = new Map();
    this.families = {};
    this.images = [];
    this.frames = [];
    this.history = [];
    this.lost = null;
    device.lost.then((info) => { this.lost = info.message || "GPU device lost"; });
    device.addEventListener("uncapturederror", (event) => { this.lost = event.error.message; });
  }

  async createFamily(name, filename, entries) {
    const code = await loadAsset(new URL("../shaders/" + filename, import.meta.url), "text");
    const module = this.device.createShaderModule({ label: name, code });
    const errors = (await module.getCompilationInfo()).messages.filter((m) => m.type === "error");
    if (errors.length) throw new Error(errors.map((m) => `${filename} ${m.lineNum}:${m.linePos} ${m.message}`).join("\n"));
    this.families[name] = Object.fromEntries(await Promise.all(entries.map(async (entryPoint) => [entryPoint,
      await this.device.createComputePipelineAsync({ label: name + "/" + entryPoint, layout: "auto", compute: { module, entryPoint } }),
    ])));
  }

  advancedPass(encoder, family, name, textures, uniform, target, slot = name) {
    const pipeline = this.families[family][name];
    const entries = Object.entries(textures).map(([binding, texture]) => ({ binding: Number(binding), resource: texture.createView() }));
    if (uniform) {
      const key = family + "/" + slot;
      if (!this.uniforms.has(key)) this.uniforms.set(key, this.device.createBuffer({ size: uniform.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
      const buffer = this.uniforms.get(key);
      this.device.queue.writeBuffer(buffer, 0, uniform);
      entries.push({ binding: family === "signal" ? 2 : 4, resource: { buffer } });
    }
    const pass = encoder.beginComputePass({ label: family + "/" + name });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries }));
    pass.dispatchWorkgroups(Math.ceil(target.width / 8), Math.ceil(target.height / 8));
    pass.end();
  }

  spatialParameters(settings, { axis = "vertical", step = [0, 0], stripes = false } = {}) {
    const bytes = new ArrayBuffer(64);
    new Float32Array(bytes).set([
      ...(stripes ? [settings.stripes ?? 0, settings.stripeDensity ?? 0.5, 0, 0]
        : [settings.radialRGB ?? 0, settings.rainbow ?? 0, settings.noise ?? 0, settings.interlace ?? 0]),
      settings.rainbowRadius ?? 0.4, 0.4, settings.rainbowSpread ?? 0.4, settings.interlaceSpacing ?? 0,
      ...step, settings.interlaceJitter ?? 0, 0,
    ]);
    new Uint32Array(bytes, 48, 4).set([0, 0, axis === "horizontal" ? 1 : 0, 0]);
    return bytes;
  }

  damageParameters(settings, time = 0) {
    const bytes = new ArrayBuffer(80);
    new Float32Array(bytes).set([
      settings.colorDrive ?? 0, settings.phaseWarp ?? 0, settings.colorPhase ?? 0, settings.colorLeak ?? 0,
      settings.lineJitter ?? 0, settings.colorStreaks ?? 0, settings.tear ?? 0, settings.tearPosition ?? 0.65,
      Math.max(Math.fround(0.002), Math.fround(Math.fround(settings.tearSpread ?? 0.12) * Math.fround(0.1))),
      settings.tearDrift ?? 0, settings.blackPoint ?? 0, 1 + (settings.signalContrast ?? 0) * 2,
      settings.signalSoftness ?? 0, time, settings.tearRainbow ?? 0, 0,
    ]);
    new Uint32Array(bytes, 64, 4).set([this.width, this.height, 1337, 0]);
    return bytes;
  }

  buffer(data) {
    const buffer = this.device.createBuffer({
      size: Math.max(4, Math.ceil(data.byteLength / 4) * 4),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(buffer, 0, data);
    return buffer;
  }

  texture(width, height, format = "rgba8unorm") {
    const texture = this.device.createTexture({
      size: [width, height], format,
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
        | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
    });
    this.images.push(texture);
    return texture;
  }

  async resize(width, height) {
    await this.device.queue.onSubmittedWorkDone();
    this.images.forEach((texture) => texture.destroy());
    this.images = [];
    this.frames = [];
    this.history = [];
    this.frameCursor = 0;
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    this.original = this.texture(width, height);
    this.composedSource = this.texture(width, height);
    this.spectral = this.texture(width, height);
    this.spatial = this.texture(width, height);
    this.stripeLuma = this.texture(width, height, "rgba16float");
    this.striped = this.texture(width, height);
    this.graded = this.texture(width, height);
    this.damaged = this.texture(width, height);
    this.haloMask = this.texture(Math.ceil(width / 4), Math.ceil(height / 4), "rgba16float");
    this.haloHorizontal = this.texture(this.haloMask.width, this.haloMask.height, "rgba16float");
    this.halo = this.texture(this.haloMask.width, this.haloMask.height, "rgba16float");
    this.decoded = this.texture(width, height);
    this.softened = this.texture(width, height);
    this.raster = this.texture(width, height);
    this.curved = this.texture(width, height);
    this.light = this.texture(width, height, "rgba16float");
    this.small = this.texture(Math.ceil(width / 4), Math.ceil(height / 4), "rgba16float");
    this.horizontal = this.texture(this.small.width, this.small.height, "rgba16float");
    this.glow = this.texture(this.small.width, this.small.height, "rgba16float");
    this.historyPool = Array.from({ length: 3 }, () => this.texture(width, height));
    this.framePool = Array.from({ length: 4 }, () => this.texture(width, height));
    const tables = geometryTables(width, height);
    this.beam?.destroy();
    this.mask?.destroy();
    this.beam = this.buffer(tables.beam);
    this.mask = this.buffer(tables.mask);
    this.lastGlow = null;
    this.signalSmall = null;
  }

  resetHistory() { this.history = []; }

  upload(texture, pixels) {
    this.device.queue.writeTexture({ texture }, pixels, { bytesPerRow: texture.width * 4 },
      [texture.width, texture.height]);
  }

  pass(encoder, name, resources, settings = {}, slot = name) {
    if (this.lost) throw new Error(this.lost);
    const pipeline = this.pipelines[name];
    const bindings = PASS_BINDINGS[name];
    if (bindings.includes(6)) {
      if (!this.uniforms.has(slot)) this.uniforms.set(slot, this.device.createBuffer({
        label: `Parameters ${slot}`, size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }));
      const bytes = new ArrayBuffer(64);
      const floats = new Float32Array(bytes);
      floats.set([settings.crtBeam ?? 0, settings.crtMask ?? 0, settings.crtGlow ?? 0, settings.persistence ?? 0]);
      new Uint32Array(bytes, 16, 4).set([this.history.length, this.blurRadius ?? 2, settings.horizontal ? 1 : 0, 0]);
      floats.set([settings.radialRGB ?? 0, settings.signalSoftness ?? 0, (settings.barrel ?? 0) * 0.18, 0], 8);
      this.device.queue.writeBuffer(this.uniforms.get(slot), 0, bytes);
      resources[6] = this.uniforms.get(slot);
    }
    const buffers = { 7: this.linear, 8: this.encoded, 9: this.beam, 10: this.mask, 11: this.weights };
    const entries = bindings.map((binding) => ({ binding,
      resource: binding >= 6 && binding <= 11
        ? { buffer: resources[binding] ?? buffers[binding] }
        : resources[binding].createView(),
    }));
    const group = this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries });
    const compute = encoder.beginComputePass({ label: name });
    compute.setPipeline(pipeline);
    compute.setBindGroup(0, group);
    const target = resources[4] ?? resources[12];
    compute.dispatchWorkgroups(Math.ceil(target.width / 8), Math.ceil(target.height / 8));
    compute.end();
  }

  async prepareSpatial(pixels, settings, signalSize, { axis = "vertical", grade = true } = {}) {
    this.upload(this.spectral, pixels);
    const encoder = this.device.createCommandEncoder();
    const parameters = this.spatialParameters(settings, { axis });
    if (settings.rainbow > 0) {
      this.advancedPass(encoder, "spatial", "highlights", { 0: this.spectral, 3: this.haloMask }, parameters, this.haloMask);
      const radius = (4 + 44 * settings.rainbowRadius) * Math.min(this.width, this.height) / 720;
      this.advancedPass(encoder, "spatial", "halo", { 0: this.haloMask, 3: this.haloHorizontal },
        this.spatialParameters(settings, { step: [radius / (4 * this.width), 0] }), this.haloHorizontal, "halo-horizontal");
      this.advancedPass(encoder, "spatial", "halo", { 0: this.haloHorizontal, 3: this.halo },
        this.spatialParameters(settings, { step: [0, radius / (4 * this.height)] }), this.halo, "halo-vertical");
    }
    this.advancedPass(encoder, "spatial", "compose", { 0: this.spectral, 1: this.halo, 2: this.spatial }, parameters, this.spatial);
    let result = this.spatial;
    if (settings.stripes > 0) {
      this.advancedPass(encoder, "spatial", "luma", { 0: result, 3: this.stripeLuma }, null, this.stripeLuma);
      this.advancedPass(encoder, "spatial", "stripes", { 0: result, 1: this.stripeLuma, 2: this.striped },
        this.spatialParameters(settings, { axis, stripes: true }), this.striped);
      result = this.striped;
    }
    if (signalSize.width !== this.width || signalSize.height !== this.height) {
      if (!this.signalSmall || this.signalSmall.width !== signalSize.width || this.signalSmall.height !== signalSize.height) {
        this.signalSmall?.destroy();
        this.signalSmall = this.texture(signalSize.width, signalSize.height);
      }
      this.pass(encoder, "resize", { 0: result, 4: this.signalSmall });
      result = this.signalSmall;
    }
    if (grade && hasGrade(settings)) {
      this.advancedPass(encoder, "signal", "grade", { 0: result, 1: this.graded }, this.damageParameters(settings), this.graded);
      result = this.graded;
    }
    this.prepared = result;
    this.device.queue.submit([encoder.finish()]);
    return this.read(result);
  }

  render(pixels, settings, frame, { gradeInput = false } = {}) {
    if (pixels) this.upload(this.decoded, pixels);
    const encoder = this.device.createCommandEncoder();
    let image = pixels ? this.decoded : this.prepared;
    if (gradeInput && hasGrade(settings)) {
      this.advancedPass(encoder, "signal", "grade", { 0: image, 1: this.graded }, this.damageParameters(settings), this.graded);
      image = this.graded;
    }
    if (hasDamage(settings)) {
      this.advancedPass(encoder, "signal", "damage", { 0: image, 1: this.damaged }, this.damageParameters(settings, frame.time ?? 0), this.damaged);
      image = this.damaged;
    }
    if (settings.signalSoftness > 0) {
      this.pass(encoder, "soften", { 0: image, 4: this.softened }, settings);
      image = this.softened;
    }
    const hasRaster = [settings.crtBeam, settings.crtMask, settings.crtGlow, settings.persistence].some((v) => v > 0);
    let output = image;
    if (hasRaster) {
      if (!(settings.persistence > 0)) this.resetHistory();
      if (this.lastGlow !== settings.crtGlow) {
        const kernel = gaussian(this.width, this.height, settings.crtGlow ?? 0);
        this.blurRadius = kernel.radius;
        this.weights?.destroy();
        this.weights = this.buffer(kernel.weights);
        this.lastGlow = settings.crtGlow;
      }
      this.pass(encoder, "raster", {
        0: image, 1: this.history[0] ?? image, 2: this.history[1] ?? image,
        3: this.history[2] ?? image, 4: this.raster, 5: this.light,
      }, settings);
      output = this.raster;
      if (settings.crtGlow > 0) {
        this.pass(encoder, "reduce", { 0: this.light, 12: this.small });
        this.pass(encoder, "blur", { 0: this.small, 12: this.horizontal }, { ...settings, horizontal: true }, "blur-horizontal");
        this.pass(encoder, "blur", { 0: this.horizontal, 12: this.glow }, settings, "blur-vertical");
        this.pass(encoder, "finish", { 0: this.light, 1: this.glow, 4: this.raster }, settings);
      }
      if (settings.persistence > 0) {
        const next = this.history.length === 3 ? this.history.pop()
          : this.historyPool.find((texture) => !this.history.includes(texture));
        encoder.copyTextureToTexture({ texture: image }, { texture: next }, [this.width, this.height]);
        this.history.unshift(next);
      }
    } else this.resetHistory();
    if (settings.barrel > 0 && this.width > 2 && this.height > 2) {
      this.pass(encoder, "curve", { 0: output, 4: this.curved }, settings);
      output = this.curved;
    }
    const texture = this.framePool[this.frameCursor++ % this.framePool.length];
    encoder.copyTextureToTexture({ texture: output }, { texture }, [this.width, this.height]);
    this.present(texture, encoder);
    this.device.queue.submit([encoder.finish()]);
    const completed = { ...frame, texture };
    this.frames = this.frames.filter((entry) => entry.texture !== texture);
    this.frames.push(completed);
    return completed;
  }

  present(texture, encoder = null) {
    const ownEncoder = encoder === null;
    encoder ??= this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: this.context.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store" }],
    });
    pass.setPipeline(this.presentation);
    pass.setBindGroup(0, this.device.createBindGroup({
      layout: this.presentation.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: texture.createView() }],
    }));
    pass.draw(3);
    pass.end();
    if (ownEncoder) this.device.queue.submit([encoder.finish()]);
  }

  freeze(frameId) {
    const frame = this.frames.find((entry) => entry.frameId === frameId);
    if (!frame) throw new Error("The displayed frame is no longer available. Pause and try again.");
    this.present(frame.texture);
    return frame;
  }

  async read(texture) {
    const bytesPerRow = alignedRow(texture.width);
    const buffer = this.device.createBuffer({
      size: bytesPerRow * texture.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = this.device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [texture.width, texture.height]);
    this.device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const mapped = new Uint8Array(buffer.getMappedRange());
    const pixels = new Uint8Array(texture.width * texture.height * 4);
    for (let y = 0; y < texture.height; y++) {
      pixels.set(mapped.subarray(y * bytesPerRow, y * bytesPerRow + texture.width * 4), y * texture.width * 4);
    }
    buffer.unmap();
    buffer.destroy();
    return pixels;
  }
}
