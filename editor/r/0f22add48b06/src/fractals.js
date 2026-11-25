import { loadAsset } from "./startup-support.js";

export const FractalPolicy = Object.freeze({ MIN: 1, MAX: 2.5, STEP: 0.05, DEFAULT: 1.75, MAP_DIVISOR: 2, RANDOM_CHANCE: 20 });

// Serialized with the renderer's command queue. No image history or readback;
// every call rebuilds from current pixels even when texture identity is reused.
export class FractalGpu {
  static async create(device) {
    const module = device.createShaderModule({ label: "Self-similarity", code:
      await loadAsset(new URL("../shaders/fractals.wgsl", import.meta.url), "text") });
    const errors = (await module.getCompilationInfo()).messages.filter(m => m.type === "error");
    if (errors.length) throw Error(errors.map(m => `Fractals WGSL ${m.lineNum}:${m.linePos} ${m.message}`).join("\n"));
    const result = new FractalGpu(device);
    result.pipelines = Object.fromEntries(await Promise.all([
      ["mipmap", "rgba8unorm"], ["grow", "rgba16float"], ["composite", "rgba8unorm"],
    ].map(async ([entryPoint, format]) => [entryPoint, await device.createRenderPipelineAsync({
      label: "Fractals/" + entryPoint, layout: "auto", vertex: { module, entryPoint: "fullscreen" },
      fragment: { module, entryPoint, targets: [{ format }] }, primitive: { topology: "triangle-list" },
    })])));
    return result;
  }
  constructor(device) {
    this.device = device;
    this.sampling = device.createSampler({ addressModeU: "mirror-repeat", addressModeV: "mirror-repeat",
      minFilter: "linear", magFilter: "linear", mipmapFilter: "linear" });
    this.fieldSampling = device.createSampler({ minFilter: "linear", magFilter: "linear" });
    this.uniforms = Object.fromEntries(["grow", "composite"].map(name => [name,
      device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })]));
    this.images = [];
  }
  reset() { this.images.forEach(t => t.destroy()); this.images = []; this.source = null; }
  texture(width, height, format, mipLevelCount = 1) {
    const texture = this.device.createTexture({ size: [width, height], format, mipLevelCount,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST });
    this.images.push(texture); return texture;
  }
  pass(encoder, name, target, source, parameters = null, extra = []) {
    const pipeline = this.pipelines[name];
    const entries = [{ binding: 0, resource: source }, { binding: 1, resource: this.sampling }];
    if (parameters) {
      this.device.queue.writeBuffer(this.uniforms[name], 0, parameters);
      entries.push({ binding: 2, resource: { buffer: this.uniforms[name] } });
    }
    entries.push(...extra);
    const pass = encoder.beginRenderPass({ label: "Fractals/" + name,
      colorAttachments: [{ view: target, loadOp: "clear", storeOp: "store" }] });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries }));
    pass.draw(3); pass.end();
  }
  encode(encoder, input, settings) {
    const amount = Number.isFinite(settings.selfsimilarity) ? Math.max(0, Math.min(1, settings.selfsimilarity)) : 0;
    if (amount === 0) return input;
    const detail = Number.isFinite(settings.fractalDetail)
      ? Math.max(FractalPolicy.MIN, Math.min(FractalPolicy.MAX, settings.fractalDetail)) : FractalPolicy.DEFAULT;
    const { width, height } = input;
    if (!this.source || this.source.width !== width || this.source.height !== height) {
      this.reset();
      this.levels = Math.floor(Math.log2(Math.max(width, height))) + 1;
      this.source = this.texture(width, height, "rgba8unorm", this.levels);
      this.field = this.texture(Math.ceil(width / FractalPolicy.MAP_DIVISOR), Math.ceil(height / FractalPolicy.MAP_DIVISOR), "rgba16float");
      this.output = this.texture(width, height, "rgba8unorm");
    }
    encoder.copyTextureToTexture({ texture: input }, { texture: this.source }, [width, height]);
    for (let level = 1; level < this.levels; level++) {
      this.pass(encoder, "mipmap", this.source.createView({ baseMipLevel: level, mipLevelCount: 1 }),
        this.source.createView({ baseMipLevel: level - 1, mipLevelCount: 1 }));
    }
    this.pass(encoder, "grow", this.field.createView(), this.source.createView(),
      new Float32Array([width, height, this.field.width, this.field.height, amount, detail, 0, 0]));
    this.pass(encoder, "composite", this.output.createView(), this.source.createView(),
      new Float32Array([width, height, width, height, amount, detail, 0, 0]),
      [{ binding: 3, resource: this.field.createView() }, { binding: 4, resource: this.fieldSampling }]);
    return this.output;
  }
}
