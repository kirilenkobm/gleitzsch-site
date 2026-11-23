import { TapePolicy, TextStyle, clampTapePosition, cleanLabelText, newTapeLabel, textColor } from "./tape.js";

export class TextEditor {
  constructor({ painter, stage, panel, overlay, onChange, onState }) {
    Object.assign(this, { painter, stage, panel, overlay, onChange, onState });
    this.labels = []; this.selected = null; this.editing = false; this.enabled = false; this.photo = null; this.drag = null; this.nodes = new Map();
    this.fields = Object.fromEntries(["select", "text", "style", "color", "color-control", "size", "angle", "add", "delete", "done"].map((key) => [key, document.getElementById("tape-" + key)]));
    this.fields.add.addEventListener("click", () => this.add());
    this.fields.done.addEventListener("click", () => this.toggle(false));
    this.fields.delete.addEventListener("click", () => {
      this.labels = this.labels.filter((l) => l.id !== this.selected); this.selected = this.labels.at(-1)?.id ?? null; this.changed();
    });
    this.fields.select.addEventListener("change", () => { this.selected = this.fields.select.value; this.render(); });
    this.fields.text.addEventListener("input", (event) => { if (!event.isComposing) this.update({ text: this.fields.text.value }); });
    this.fields.text.addEventListener("compositionend", () => this.update({ text: this.fields.text.value }));
    this.fields.style.addEventListener("change", () => this.update({ style: this.fields.style.value }));
    this.fields.color.addEventListener("input", () => this.update({ color: textColor(this.fields.color.value) }));
    this.fields.text.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); this.toggle(false); }
    });
    this.fields.size.addEventListener("input", () => this.update({ size: Number(this.fields.size.value) }));
    this.fields.angle.addEventListener("input", () => this.update({ angle: Number(this.fields.angle.value) * Math.PI / 180 }));
    new ResizeObserver(() => this.layout()).observe(stage);
    this.render();
  }

  get dragging() { return this.drag !== null; }
  setImage(photo) { this.photo = photo; this.render(); }
  setEnabled(enabled) { if (this.enabled !== enabled) { this.enabled = enabled; this.render(); } }
  clear() { this.labels = []; this.selected = null; this.editing = false; this.drag = null; this.render(); }
  snapshot() { return this.labels.filter((l) => cleanLabelText(l).trim()).map((l) => Object.freeze({ ...l, text: cleanLabelText(l), color: textColor(l.color) })); }

  toggle(value = !this.editing) {
    if (!this.enabled) return;
    this.editing = value;
    if (value && !this.labels.length) this.add();
    this.render(); this.onState();
  }

  add() {
    if (!this.enabled) return;
    let label = this.labels.find((l) => !cleanLabelText(l).trim());
    if (!label) {
      if (this.labels.length >= TapePolicy.MAX_LABELS) return;
      label = newTapeLabel(); this.labels = [...this.labels, label];
    }
    this.selected = label.id; this.render(); this.fields.text.focus(); this.onState();
  }

  update(values) {
    if (!this.enabled || !this.selected) return;
    if (values.text !== undefined || values.style !== undefined) {
      values = { ...values, text: cleanLabelText({ ...this.labels.find((l) => l.id === this.selected), ...values }) };
      if (this.fields.text.value !== values.text) {
        const cursor = this.fields.text.selectionStart;
        this.fields.text.value = values.text;
        this.fields.text.setSelectionRange(Math.min(cursor, values.text.length), Math.min(cursor, values.text.length));
      }
    }
    this.labels = this.labels.map((l) => l.id === this.selected ? { ...l, ...values } : l);
    this.changed();
  }
  changed() { this.render(); this.onChange(); }

  imageBox() {
    if (!this.photo) return { left: 0, top: 0, width: 0, height: 0, scale: 0 };
    const scale = Math.min(this.stage.clientWidth / this.photo.width, this.stage.clientHeight / this.photo.height);
    const width = this.photo.width * scale; const height = this.photo.height * scale;
    return { left: (this.stage.clientWidth - width) / 2, top: (this.stage.clientHeight - height) / 2, width, height, scale };
  }

  createHandle(id) {
    const node = document.createElement("button"); node.className = "tape-handle"; node.type = "button";
    node.addEventListener("click", () => { this.selected = id; this.render(); });
    node.addEventListener("dblclick", () => { this.selected = id; this.render(); this.fields.text.focus(); });
    node.addEventListener("pointerdown", (event) => {
      if (!this.enabled) return;
      event.preventDefault(); this.selected = id;
      const label = this.labels.find((l) => l.id === id);
      this.drag = { id, clientX: event.clientX, clientY: event.clientY, x: label.x, y: label.y };
      node.setPointerCapture(event.pointerId); this.render(); this.onState();
    });
    node.addEventListener("pointermove", (event) => {
      if (this.drag?.id !== id) return;
      const box = this.imageBox(); if (!box.width || !box.height) return;
      const x = clampTapePosition(this.drag.x + (event.clientX - this.drag.clientX) / box.width);
      const y = clampTapePosition(this.drag.y + (event.clientY - this.drag.clientY) / box.height);
      this.labels = this.labels.map((l) => l.id === id ? { ...l, x, y } : l); this.layout();
    });
    const finish = () => { if (this.drag?.id === id) { this.drag = null; this.changed(); this.onState(); } };
    node.addEventListener("pointerup", finish); node.addEventListener("pointercancel", finish);
    node.addEventListener("keydown", (event) => {
      const movement = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (!movement || !this.enabled) return;
      event.preventDefault(); this.selected = id;
      const label = this.labels.find((l) => l.id === id); const step = event.shiftKey ? 0.05 : 0.01;
      this.update({ x: clampTapePosition(label.x + movement[0] * step), y: clampTapePosition(label.y + movement[1] * step) });
    });
    this.overlay.append(node); this.nodes.set(id, node); return node;
  }

  layout() {
    if (!this.photo || !this.painter) return;
    const box = this.imageBox();
    for (const raw of this.labels) {
      const node = this.nodes.get(raw.id); if (!node) continue;
      const label = this.painter.fitted(raw, this.photo.width, this.photo.height);
      const size = this.painter.dimensions(label, this.photo.width, this.photo.height);
      Object.assign(node.style, { left: `${box.left + label.x * box.width}px`, top: `${box.top + label.y * box.height}px`,
        width: `${size.width * box.scale}px`, height: `${size.height * box.scale}px`, transform: `translate(-50%, -50%) rotate(${label.angle}rad)` });
      node.setAttribute("aria-label", "Move text: " + (label.text || "new text"));
      node.setAttribute("aria-pressed", String(label.id === this.selected)); node.disabled = !this.enabled;
    }
  }

  render() {
    this.panel.hidden = !this.editing; this.overlay.hidden = !this.editing || !this.enabled;
    const selected = this.labels.find((l) => l.id === this.selected);
    const options = this.labels.map((l, i) => { const option = document.createElement("option"); option.value = l.id; option.textContent = cleanLabelText(l) || `Text ${i + 1}`; return option; });
    this.fields.select.replaceChildren(...options); this.fields.select.value = this.selected ?? "";
    for (const key of ["text", "style", "color", "size", "angle", "delete"]) this.fields[key].disabled = !this.enabled || !selected;
    this.fields.select.disabled = !this.enabled || !this.labels.length;
    this.fields.add.disabled = !this.enabled || this.labels.length >= TapePolicy.MAX_LABELS;
    this.fields.done.disabled = !this.enabled;
    if (document.activeElement !== this.fields.text) this.fields.text.value = selected?.text ?? "";
    this.fields.size.value = String(selected?.size ?? TapePolicy.FONT_SIZE);
    this.fields.style.value = selected?.style ?? TextStyle.TAPE;
    this.fields.color.value = textColor(selected?.color);
    this.fields["color-control"].hidden = selected?.style !== TextStyle.PLAIN;
    this.fields.angle.value = String((selected?.angle ?? 0) * 180 / Math.PI);
    for (const [id, node] of this.nodes) if (!this.labels.some((l) => l.id === id)) { node.remove(); this.nodes.delete(id); }
    if (this.editing) for (const label of this.labels) if (!this.nodes.has(label.id)) this.createHandle(label.id);
    this.layout();
  }
}
