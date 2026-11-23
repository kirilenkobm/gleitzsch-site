// One press owns one release, including pointer cancellation and lost focus.
// The release callback also runs when the button becomes disabled mid-hold.
export function bindHold(button, begin, end, { window: surface = globalThis.window } = {}) {
  let active = false;
  let pointer = null;
  let key = null;
  function release() {
    if (!active) return;
    active = false;
    pointer = null;
    key = null;
    end();
  }
  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || active || button.disabled) return;
    event.preventDefault();
    if (begin() === false) return;
    active = true;
    pointer = event.pointerId;
    button.setPointerCapture(pointer);
  });
  const pointerEnd = (event) => { if (event.pointerId === pointer) release(); };
  button.addEventListener("pointerup", pointerEnd);
  button.addEventListener("pointercancel", pointerEnd);
  button.addEventListener("lostpointercapture", pointerEnd);
  surface.addEventListener("pointerup", pointerEnd);
  surface.addEventListener("pointercancel", pointerEnd);
  button.addEventListener("keydown", (event) => {
    if (!["Space", "Enter"].includes(event.code)) return;
    event.preventDefault();
    if (event.repeat || active || button.disabled || begin() === false) return;
    active = true;
    key = event.code;
  });
  const keyEnd = (event) => {
    if (event.code === key) { event.preventDefault(); release(); }
  };
  button.addEventListener("keyup", keyEnd);
  surface.addEventListener("keyup", keyEnd);
  button.addEventListener("click", (event) => event.preventDefault());
  button.addEventListener("contextmenu", (event) => event.preventDefault());
  button.addEventListener("blur", release);
  surface.addEventListener("blur", release);
  return release;
}
