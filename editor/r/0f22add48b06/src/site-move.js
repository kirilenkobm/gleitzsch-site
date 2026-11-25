(() => {
  const prefix = "/gleitzsch-site";
  if (location.hostname !== "kirilenkobm.github.io"
    || (location.pathname !== prefix && !location.pathname.startsWith(prefix + "/"))) return;

  const target = new URL("https://gleitzsch.com/");
  target.pathname = location.pathname.slice(prefix.length) || "/";
  target.search = location.search;
  target.hash = location.hash;
  const notice = document.createElement("aside");
  notice.className = "site-move";
  notice.setAttribute("aria-label", "New website address");
  const link = document.createElement("a");
  link.href = target.href;
  link.textContent = "gleitzsch.com";
  notice.append("Gleitzsch is now at ", link, ". This address still works.");
  document.body.prepend(notice);

  const resize = () => document.documentElement.style.setProperty("--site-move-height", `${notice.getBoundingClientRect().height}px`);
  resize();
  if (typeof ResizeObserver === "function") new ResizeObserver(resize).observe(notice);
  else addEventListener("resize", resize);
})();
