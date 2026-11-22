import { PixelatePolicy } from "./model.js";
import { StartupCode, StartupError, loadAsset } from "./startup-support.js";

const PASSES = Object.freeze({
  color: [0, 1, 10, 11], geometry: [1, 2, 3, 11], ridge: [2, 4, 11],
  cell: [1, 3, 4, 5, 11], percentile: [5, 6, 11], candidate: [5, 7, 11],
  support: [7, 8, 11], finish: [5, 6, 8, 9, 10, 11], expand: [9, 11, 12],
});

export class PixelateGpu {
  static async create(device) {
    const [code, tables] = await Promise.all([
      loadAsset(new URL("../shaders/pixelate.wgsl", import.meta.url), "text"),
      loadAsset(new URL("../assets/PixelateD.bin", import.meta.url), "arrayBuffer"),
    ]);
    if (tables.byteLength !== 2_770_960 || new TextDecoder().decode(new Uint8Array(tables, 0, 8)) !== "PXLD0002") {
      throw new StartupError(StartupCode.DOWNLOAD, "The Pixelate color tables did not load correctly. Reload the editor.");
    }
    const module = device.createShaderModule({ label: "Pixelate D", code });
    const errors = (await module.getCompilationInfo()).messages.filter((m) => m.type === "error");
    if (errors.length) throw new Error(errors.map((m) => `pixelate.wgsl ${m.lineNum}:${m.linePos} ${m.message}`).join("\n"));
    const instance = new PixelateGpu(device);
    instance.pipelines = Object.fromEntries(await Promise.all(Object.keys(PASSES).map(async (entryPoint) => [entryPoint,
      await device.createComputePipelineAsync({ label: "Pixelate/" + entryPoint, layout: "auto", compute: { module, entryPoint } }),
    ])));
    instance.tables = instance.buffer(tables.byteLength);
    device.queue.writeBuffer(instance.tables, 0, tables);
    instance.uniform = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    return instance;
  }

  constructor(device) { this.device = device; this.buffers = []; this.width = 0; this.height = 0; }
  buffer(size) { return this.device.createBuffer({ size: Math.max(4, size), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }); }

  resize(width, height) {
    if (this.width === width && this.height === height) return;
    this.buffers.forEach((buffer) => buffer.destroy());
    this.output?.destroy();
    this.width = width; this.height = height;
    const pixels = width * height;
    const cells = Math.ceil(width / PixelatePolicy.MIN) * Math.ceil(height / PixelatePolicy.MIN);
    this.buffers = [this.buffer(pixels * 16), this.buffer(pixels * 4), this.buffer(pixels * 8), this.buffer(pixels * 8),
      this.buffer(cells * 64), this.buffer(4), this.buffer(cells * 4), this.buffer(cells * 4), this.buffer(cells * 4)];
    this.output = this.device.createTexture({ size: [width, height], format: "rgba8unorm",
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
  }

  process(input, cellSize) {
    if (!Number.isInteger(cellSize) || cellSize < PixelatePolicy.MIN || cellSize > PixelatePolicy.MAX || cellSize % PixelatePolicy.STEP) throw new Error("Pixel size must be an even value from 4 to 48.");
    const width = input.width; const height = input.height;
    this.resize(width, height);
    const columns = Math.ceil(width / cellSize); const rows = Math.ceil(height / cellSize);
    this.device.queue.writeBuffer(this.uniform, 0, new Uint32Array([width, height, cellSize, columns]));
    const resources = { 0: input.createView(), 10: { buffer: this.tables }, 11: { buffer: this.uniform }, 12: this.output.createView() };
    this.buffers.forEach((buffer, i) => { resources[i + 1] = { buffer }; });
    const encoder = this.device.createCommandEncoder({ label: "Pixelate D nine passes" });
    for (const [name, bindings] of Object.entries(PASSES)) {
      const pipeline = this.pipelines[name];
      const pass = encoder.beginComputePass({ label: "Pixelate/" + name });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0),
        entries: bindings.map((binding) => ({ binding, resource: resources[binding] })) }));
      if (name === "cell") pass.dispatchWorkgroups(columns, rows);
      else if (name === "percentile") pass.dispatchWorkgroups(1);
      else if (["candidate", "support", "finish"].includes(name)) pass.dispatchWorkgroups(Math.ceil(columns / 16), Math.ceil(rows / 16));
      else pass.dispatchWorkgroups(Math.ceil(width / 16), Math.ceil(height / 16));
      pass.end();
    }
    this.device.queue.submit([encoder.finish()]);
    return this.output;
  }
}
