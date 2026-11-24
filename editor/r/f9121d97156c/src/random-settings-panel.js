import { RandomPreferences, RandomGroups, RandomFrequencies, RandomFrequency } from "./random-preferences.js";

export class RandomSettingsPanel {
  constructor({ entry, container, controls, resetEffects, preferences, onChange }) {
    Object.assign(this, { entry, container, controls, resetEffects, preferences, onChange });
    this.open = false;
    this.visible = false;
    this.enabled = false;
    this.expanded = null;
    this.rows = new Map();
    this.reset = container.querySelector("#reset-random-settings");
    this.back = container.querySelector("#close-random-settings");
    this.status = container.querySelector("[role=status]");
    const list = container.querySelector(".random-settings-list");
    for (const group of RandomGroups) {
      const item = document.createElement("div");
      item.className = "random-settings-item";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "random-group-toggle";
      button.id = `random-group-${group.key}`;
      const name = document.createElement("span");
      name.textContent = group.title;
      const value = document.createElement("span");
      value.className = "random-group-frequency";
      button.append(name, value);
      const options = document.createElement("div");
      options.className = "random-frequency-options";
      options.id = `random-options-${group.key}`;
      options.setAttribute("role", "group");
      options.setAttribute("aria-label", `${group.title} frequency`);
      button.setAttribute("aria-controls", options.id);
      button.addEventListener("click", () => {
        this.expanded = this.expanded === group.key ? null : group.key;
        this.render();
      });
      for (const frequency of RandomFrequencies) {
        const choice = document.createElement("button");
        choice.type = "button";
        choice.className = "random-frequency-choice";
        choice.dataset.frequency = frequency.key;
        choice.textContent = frequency.title;
        choice.addEventListener("click", () => {
          this.onChange(this.preferences.withFrequency(group.key, frequency.key));
          this.status.textContent = `${group.title}: ${frequency.title}`;
        });
        options.append(choice);
      }
      item.append(button, options);
      list.append(item);
      this.rows.set(group.key, { button, value, options });
    }
    entry.addEventListener("click", () => {
      this.open = true;
      this.render();
      this.back.focus();
    });
    this.back.addEventListener("click", () => {
      this.open = false;
      this.render();
      this.entry.focus();
    });
    this.reset.addEventListener("click", () => {
      this.onChange(new RandomPreferences());
      this.status.textContent = "All Random settings restored to Normal.";
    });
    this.render();
  }

  update(preferences, { visible, enabled }) {
    if (this.preferences === preferences && this.visible === visible && this.enabled === enabled) return;
    this.preferences = preferences;
    this.visible = visible;
    this.enabled = enabled;
    if (!visible) this.open = false;
    this.render();
  }

  render() {
    this.entry.hidden = !this.visible || this.open;
    this.entry.disabled = !this.enabled;
    this.entry.setAttribute("aria-expanded", String(this.open));
    this.container.hidden = !this.visible || !this.open;
    this.controls.hidden = this.open;
    this.resetEffects.hidden = this.open;
    this.reset.disabled = !this.enabled || this.preferences.isDefault;
    for (const group of RandomGroups) {
      const { button, value, options } = this.rows.get(group.key);
      const frequency = this.preferences.get(group.key);
      value.textContent = RandomFrequencies.find(item => item.key === frequency).title;
      value.classList.toggle("changed", frequency !== RandomFrequency.NORMAL);
      button.disabled = !this.enabled;
      button.setAttribute("aria-expanded", String(this.expanded === group.key));
      options.hidden = this.expanded !== group.key;
      for (const choice of options.children) {
        choice.disabled = !this.enabled;
        choice.setAttribute("aria-pressed", String(choice.dataset.frequency === frequency));
      }
    }
  }
}
