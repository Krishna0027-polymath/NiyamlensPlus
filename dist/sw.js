const CACHE = "niyamlens-shell-v16",
  SHELL = [
    "./",
    "./index.html",
    "./styles.css",
    "./app.js?v=label-format-2",
    "./label-parser.js?v=label-format-1",
    "./health-assessment.js?v=label-format-1",
    "./manifest.webmanifest",
    "./icons/app-icon.svg",
  ];
self.addEventListener("install", (e) =>
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  ),
);
self.addEventListener("activate", (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("niyamlens-shell-") && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener("fetch", (e) => {
  const requestUrl = new URL(e.request.url);
  if (
    e.request.method !== "GET" ||
    requestUrl.origin !== location.origin ||
    requestUrl.pathname.startsWith("/api/")
  )
    return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok) caches.open(CACHE).then((c) => c.put(e.request, r.clone()));
        return r;
      })
      .catch(async () => {
        const cached = await caches.match(e.request);
        if (cached) return cached;
        if (e.request.mode === "navigate") return caches.match("./index.html");
        return Response.error();
      }),
  );
});
