export const FullscreenPolicy = Object.freeze({ HIDE_DELAY_MS: 2500 });

// Presentation only: keep the existing canvas, worker and working resolution.
export class FullscreenPreview {
  constructor({ stage, enter, exit, onError }) {
    Object.assign(this, { stage, enterButton: enter, exitButton: exit, onError });
    this.document = stage.ownerDocument;
    this.enabled = false;
    this.pending = false;
    this.presented = false;
    this.restoreFocus = null;
    this.hideTimer = null;
    enter.addEventListener("click", () => { void this.toggle(); });
    exit.addEventListener("click", () => { void this.leave(); });
    this.document.addEventListener("fullscreenchange", () => this.sync());
    this.document.addEventListener("keydown", (event) => this.keydown(event));
    for (const type of ["pointermove", "pointerdown", "focusin", "focusout"]) {
      stage.addEventListener(type, () => this.showExit());
    }
    this.update(false);
  }

  get supported() {
    return this.document.fullscreenEnabled === true && typeof this.stage.requestFullscreen === "function"
      && typeof this.document.exitFullscreen === "function";
  }

  get active() {
    return this.document.fullscreenElement === this.stage;
  }

  update(enabled) {
    this.enabled = enabled;
    this.enterButton.hidden = !this.supported;
    this.enterButton.disabled = !enabled || this.pending;
    this.enterButton.setAttribute("aria-pressed", String(this.active));
  }

  async toggle() {
    if (this.active) { await this.leave(); return; }
    if (!this.supported || !this.enabled || this.pending || this.document.fullscreenElement) return;
    this.restoreFocus = this.document.activeElement;
    this.pending = true;
    this.update(this.enabled);
    try {
      await this.stage.requestFullscreen({ navigationUI: "hide" });
    } catch {
      this.restoreFocus = null;
      this.onError("Fullscreen could not open. Try the Fullscreen button again.");
    } finally {
      this.pending = false;
      this.sync();
    }
  }

  async leave() {
    if (!this.active || this.pending) return;
    this.pending = true;
    try {
      await this.document.exitFullscreen();
    } catch {
      this.showExit();
      this.onError("Fullscreen could not close. Press Esc or use your browser’s fullscreen exit.");
    } finally {
      this.pending = false;
      this.sync();
    }
  }

  sync() {
    const active = this.active;
    this.exitButton.hidden = !active;
    if (active && !this.presented) {
      this.stage.focus({ preventScroll: true });
      this.showExit();
    } else if (!active && this.presented) {
      clearTimeout(this.hideTimer);
      this.stage.classList.remove("fullscreen-idle");
      if (this.restoreFocus?.isConnected) this.restoreFocus.focus({ preventScroll: true });
      this.restoreFocus = null;
    }
    this.presented = active;
    this.update(this.enabled);
  }

  showExit() {
    if (!this.active) return;
    clearTimeout(this.hideTimer);
    this.stage.classList.remove("fullscreen-idle");
    this.hideTimer = setTimeout(() => {
      if (this.active && this.document.activeElement !== this.exitButton && !this.exitButton.matches(":hover")) {
        this.stage.classList.add("fullscreen-idle");
      }
    }, FullscreenPolicy.HIDE_DELAY_MS);
  }

  keydown(event) {
    if (event.defaultPrevented || event.isComposing || event.repeat) return;
    if (this.active && event.key === "Tab") {
      event.preventDefault();
      this.showExit();
      this.exitButton.focus({ preventScroll: true });
      return;
    }
    if ((event.code !== "KeyF" && event.key.toLowerCase() !== "f") || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = this.document.activeElement;
    if (!this.active && (this.document.querySelector("dialog[open]") || target?.isContentEditable
      || target?.closest("input, textarea, select, [role='textbox']"))) return;
    if (!this.active && (!this.supported || !this.enabled)) return;
    event.preventDefault();
    void this.toggle();
  }
}
