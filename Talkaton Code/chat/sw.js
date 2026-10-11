const CACHE_NAME = "talkaton-t1791677714200";
const ASSET_VERSION = "20260827-code-agent2";
const versioned = path => `${path}?v=${ASSET_VERSION}`;

const PRECACHE_URLS = [
  "/chat",
  versioned("/style.css"),
  versioned("/chat/app.js"),
  "/favicon-t-20260728.svg",
  "/og.png",
  "/about",
  "/chat/productivity.css?v=20260802-enterprise1",
  "/chat/productivity.js?v=20260826-studio2",
  versioned("/modules/storage.js"),
  versioned("/modules/private-browser.js"),
  versioned("/modules/keyboard.js"),
  versioned("/modules/markdown.js"),
  versioned("/modules/uploads.js"),
  "/modules/agent-store.js",
  "/modules/agent-schema.js",
  "/modules/artifacts.js",
  "/modules/python-sandbox.js",
  "/modules/record-store.js",
  "/modules/transcript-export.js"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (url.origin !== location.origin) return;

  const isNavigation = request.mode === "navigate";
  const extension = url.pathname.split(".").pop();
  const isHtml = isNavigation || extension === "html" || !extension || extension === url.pathname.split("/").pop();

  if (isHtml || isNavigation) {
    event.respondWith(
      fetch(request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request).then(cached => cached || caches.match("/chat")))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (!response.ok) return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        return response;
      });
    })
  );
});
