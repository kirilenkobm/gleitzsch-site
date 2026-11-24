export const MeltLinePolicy = Object.freeze({ MIN: 0.4, MAX: 0.95, DEFAULT: 0.65 });

export function normalizedMeltHeight(value) {
  return Number.isFinite(value) ? Math.max(MeltLinePolicy.MIN, Math.min(MeltLinePolicy.MAX, value)) : null;
}

export function meltLineControl(onChange) {
  const element = document.createElement("div");
  element.className = "control melt-line";
  const label = document.createElement("label");
  label.htmlFor = "melt-line-height";
  label.append(document.createTextNode("Line height"));
  const value = document.createElement("output");
  value.htmlFor = label.htmlFor;
  value.id = "melt-line-value";
  label.append(value);
  const input = document.createElement("input");
  Object.assign(input, { type: "range", id: label.htmlFor, min: MeltLinePolicy.MIN * 100,
    max: MeltLinePolicy.MAX * 100, step: 1, value: MeltLinePolicy.DEFAULT * 100, disabled: true });
  input.addEventListener("input", () => onChange(normalizedMeltHeight(Number(input.value) / 100)));
  const automatic = document.createElement("button");
  Object.assign(automatic, { type: "button", className: "secondary", textContent: "Auto", id: "melt-line-auto" });
  automatic.addEventListener("click", () => onChange(null));
  const hint = document.createElement("small");
  hint.textContent = "Prefer a natural edge near this height.";
  element.append(label, input, automatic, hint);
  return { element, update(height, enabled) {
    value.textContent = height === null ? "Auto" : `${Math.round(height * 100)}% from top`;
    input.value = String((height ?? MeltLinePolicy.DEFAULT) * 100);
    input.disabled = !enabled;
    input.setAttribute("aria-valuetext", height === null ? "Automatic; adjust to choose a preferred height" : value.textContent);
    automatic.disabled = !enabled;
    automatic.setAttribute("aria-pressed", String(height === null));
  } };
}
