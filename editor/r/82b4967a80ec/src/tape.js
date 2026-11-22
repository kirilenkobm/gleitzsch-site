export const TapePolicy = Object.freeze({ FONT_SIZE: 0.045, MIN_SIZE: 0.015, MAX_SIZE: 0.15,
  TRACKING: 0.18, WIDTH_PADDING: 1.15, HEIGHT: 1.65, MAX_WIDTH: 0.94, INSET: 0.03, MAX_LABELS: 12 });
export const cleanTapeText = (text) => Array.from(String(text).replace(/[\r\n]/g, " ").toUpperCase()).slice(0, 100).join("");
export const clampTapePosition = (value) => Math.max(TapePolicy.INSET, Math.min(1 - TapePolicy.INSET, Number.isFinite(value) ? value : 0.5));
export const newTapeLabel = () => ({ id: crypto.randomUUID(), text: "", x: 0.5, y: 0.5, size: TapePolicy.FONT_SIZE, angle: 0 });

export class TapePainter {
  static async create() {
    const font = new FontFace("GleitzschTape", `url("${new URL("../assets/IBMPlexMono-Medium.ttf", import.meta.url)}")`, { weight: "500" });
    await font.load(); document.fonts.add(font);
    return new TapePainter();
  }

  constructor() {
    this.canvas = new OffscreenCanvas(1, 1);
    this.context = this.canvas.getContext("2d", { colorSpace: "srgb", willReadFrequently: true });
  }

  dimensions(label, width, height) {
    const font = Math.min(width, height) * label.size;
    this.context.font = `500 ${font}px GleitzschTape`;
    const glyphs = Array.from(cleanTapeText(label.text));
    const advances = glyphs.map((glyph) => this.context.measureText(glyph).width);
    const textWidth = advances.reduce((a, b) => a + b, 0) + Math.max(0, glyphs.length - 1) * font * TapePolicy.TRACKING;
    return { width: textWidth + font * TapePolicy.WIDTH_PADDING, height: font * TapePolicy.HEIGHT, textWidth, font, glyphs, advances };
  }

  fitted(label, width, height) {
    let size = Math.min(TapePolicy.MAX_SIZE, Math.max(TapePolicy.MIN_SIZE, label.size));
    const measured = this.dimensions({ ...label, size }, width, height);
    if (measured.width > width * TapePolicy.MAX_WIDTH) size *= width * TapePolicy.MAX_WIDTH / measured.width;
    return { ...label, text: cleanTapeText(label.text), size, x: clampTapePosition(label.x), y: clampTapePosition(label.y) };
  }

  raster(labels, width, height) {
    this.canvas.width = width; this.canvas.height = height;
    const ctx = this.context;
    for (const raw of labels) {
      const label = this.fitted(raw, width, height); if (!label.text.trim()) continue;
      const box = this.dimensions(label, width, height);
      ctx.save(); ctx.translate(width * label.x, height * label.y); ctx.rotate(label.angle);
      ctx.fillStyle = "#060606"; ctx.fillRect(-box.width / 2, -box.height / 2, box.width, box.height);
      ctx.fillStyle = "#262626"; ctx.fillRect(-box.width / 2, -box.height / 2, box.width, Math.max(1, box.font * 0.035));
      const metrics = ctx.measureText("Mg");
      const ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent ?? box.font * 0.8;
      const descent = metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent ?? box.font * 0.2;
      const baseline = (ascent - descent) / 2;
      let x = -box.textWidth / 2;
      box.glyphs.forEach((glyph, index) => {
        ctx.fillStyle = "#404040"; ctx.fillText(glyph, x + box.font * 0.035, baseline + box.font * 0.045);
        ctx.fillStyle = "#ededed"; ctx.fillText(glyph, x, baseline);
        x += box.advances[index] + box.font * TapePolicy.TRACKING;
      });
      ctx.restore();
    }
    return ctx.getImageData(0, 0, width, height).data;
  }
}
