const CACHE_NAME = "talkaton-desktop-t1791677714200";
const SHELL = [
  "/talkatondesktop",
  "/talkatondesktop/style.css?v=20260809-native1",
  "/talkatondesktop/app.js?v=20260809-native1",
  "/talkatondesktop/manifest.webmanifest",
  "/talkatondesktop/icon-192.png",
  "/talkatondesktop/icon-512.png",
  "/favicon-t-20260728.svg"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("talkaton-desktop-") && key !== CACHE_NAME).map(key => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin || !url.pathname.startsWith("/talkatondesktop")) return;
  event.respondWith(fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request).then(hit => hit || caches.match("/talkatondesktop"))));
});
