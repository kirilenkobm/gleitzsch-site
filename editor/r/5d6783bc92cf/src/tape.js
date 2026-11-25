export const TapePolicy = Object.freeze({ FONT_SIZE: 0.045, MIN_SIZE: 0.015, MAX_SIZE: 0.15,
  TRACKING: 0.18, WIDTH_PADDING: 1.15, HEIGHT: 1.65, MAX_WIDTH: 0.94, INSET: 0.03, MAX_LABELS: 12 });
export const cleanTapeText = (text) => Array.from(String(text).replace(/[\r\n]/g, " ").toUpperCase()).slice(0, 100).join("");
export const TextStyle = Object.freeze({ TAPE: "tape", PLAIN: "plain" });
const characters = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export function cleanPlainText(text) {
  let result = "", count = 0;
  for (const { segment } of characters.segment(String(text).replace(/[\r\n]/g, " "))) {
    if (count++ >= 100) break;
    result += segment;
  }
  return result;
}
export const cleanLabelText = (label) => label.style === TextStyle.PLAIN ? cleanPlainText(label.text) : cleanTapeText(label.text);
export const textColor = (color) => /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : "#ffffff";
export const clampTapePosition = (value) => Math.max(TapePolicy.INSET, Math.min(1 - TapePolicy.INSET, Number.isFinite(value) ? value : 0.5));
export const newTapeLabel = () => ({ id: crypto.randomUUID(), text: "", x: 0.5, y: 0.5, size: TapePolicy.FONT_SIZE, angle: 0, style: TextStyle.TAPE, color: "#ffffff" });

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
    if (label.style === TextStyle.PLAIN) {
      this.context.font = `400 ${font}px system-ui`;
      const text = cleanLabelText(label);
      const metrics = this.context.measureText(text);
      const ascent = metrics.actualBoundingBoxAscent || font * 0.8;
      const descent = metrics.actualBoundingBoxDescent || font * 0.2;
      return { width: Math.max(metrics.width, metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight) + font * 0.3,
        height: ascent + descent + font * 0.2, textWidth: metrics.width, font, text, ascent, descent };
    }
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
    if (label.style === TextStyle.PLAIN) {
      // Re-measure system/emoji fonts at the fitted size rather than assuming linear metrics.
      for (let attempt = 0; attempt < 8; attempt++) {
        const fittedWidth = this.dimensions({ ...label, size }, width, height).width;
        if (fittedWidth <= width * TapePolicy.MAX_WIDTH) break;
        size *= width * TapePolicy.MAX_WIDTH / fittedWidth * 0.999;
      }
    }
    return { ...label, text: cleanLabelText(label), size, x: clampTapePosition(label.x), y: clampTapePosition(label.y) };
  }

  raster(labels, width, height) {
    this.canvas.width = width; this.canvas.height = height;
    const ctx = this.context;
    for (const raw of labels) {
      const label = this.fitted(raw, width, height); if (!label.text.trim()) continue;
      const box = this.dimensions(label, width, height);
      ctx.save(); ctx.translate(width * label.x, height * label.y); ctx.rotate(label.angle);
      if (label.style === TextStyle.PLAIN) {
        ctx.fillStyle = textColor(label.color);
        ctx.fillText(box.text, -box.textWidth / 2, (box.ascent - box.descent) / 2);
        ctx.restore();
        continue;
      }
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
