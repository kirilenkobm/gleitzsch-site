// Keep this small classic script independent of the editor's module graph.
// Its HTML fallback is already visible while scripts and engine files load.
(function () {
  "use strict";
  var State = Object.freeze({ LOADING: "loading", READY: "ready", FAILED: "failed" });
  var state = State.LOADING;
  var failureHandler = null;
  var panel = document.getElementById("startup");
  var workspace = document.getElementById("workspace");
  var title = document.getElementById("startup-title");
  var message = document.getElementById("startup-message");
  var detail = document.getElementById("startup-detail");
  var retry = document.getElementById("startup-retry");
  var slowTimer;
  var timeout;

  function clearTimers() {
    clearTimeout(slowTimer); clearTimeout(timeout);
    window.removeEventListener("error", moduleFailed);
    window.removeEventListener("unhandledrejection", moduleFailed);
  }

  function fail(issue) {
    if (state !== State.LOADING) return false;
    state = State.FAILED;
    clearTimers();
    panel.setAttribute("aria-busy", "false");
    panel.setAttribute("data-state", State.FAILED);
    title.textContent = issue.title || "The editor couldn’t start";
    message.textContent = issue.message || "Reload the page to try again. If it keeps happening, try another up-to-date browser.";
    detail.textContent = issue.detail || "";
    document.getElementById("startup-details").hidden = !issue.detail;
    retry.hidden = false;
    if (failureHandler) failureHandler();
    return true;
  }

  window.GleitzschStartup = Object.freeze({
    pending: function () { return state === State.LOADING; },
    describe: function (text) { if (state === State.LOADING) message.textContent = text; },
    onFailure: function (callback) { failureHandler = callback; if (state === State.FAILED) callback(); },
    fail: fail,
    ready: function () {
      if (state !== State.LOADING) return false;
      state = State.READY;
      clearTimers();
      panel.setAttribute("aria-busy", "false");
      panel.hidden = true;
      workspace.hidden = false;
      document.removeEventListener("dragover", waitForStartup);
      document.removeEventListener("drop", waitForStartup);
      document.getElementById("about-button").disabled = false;
      return true;
    }
  });

  function waitForStartup(event) {
    event.preventDefault();
    if (state === State.LOADING && event.type === "drop") message.textContent = "The editor is still loading. Open your photo when it’s ready.";
  }
  document.addEventListener("dragover", waitForStartup);
  document.addEventListener("drop", waitForStartup);

  retry.addEventListener("click", function () { window.location.reload(); });
  // Module download, parse and evaluation failures can happen before app.js
  // installs any handlers. Never leave the loading screen spinning forever.
  function moduleFailed(event) {
    fail({ title: "The editor couldn’t load",
      message: "Check your connection and reload the page. If it still won’t open, try another up-to-date browser.",
      detail: event.message || (event.reason && event.reason.message) || "An editor script could not be loaded or started." });
  }
  window.addEventListener("error", moduleFailed);
  window.addEventListener("unhandledrejection", moduleFailed);
  slowTimer = setTimeout(function () {
    if (state === State.LOADING) message.textContent = "Still preparing the editor. The first visit can take a little longer.";
  }, 12000);
  timeout = setTimeout(function () {
    fail({ title: "The editor is taking too long",
      message: "Loading didn’t finish. Check your connection and reload. If it keeps happening, try another up-to-date browser." });
  }, 120000);
  var script = document.createElement("script");
  if (!("noModule" in script)) {
    fail({ title: "This browser can’t run the editor here", message: "Update your browser or open the editor in a current Chrome, Edge, Firefox or Safari." });
    return;
  }
  script.type = "module";
  script.src = new URL("app.js", document.currentScript.src).href;
  script.onerror = moduleFailed;
  document.head.appendChild(script);
}());
