const CACHE_NAME = "codeaton-t1791678053719";
const SHELL = [
  "/codeaton",
  "/codeaton/style.css?v=20260809-codeaton3",
  "/codeaton/install.js?v=20260809-codeaton3",
  "/codeaton/app",
  "/codeaton/app/style.css?v=20260828-chat-history1",
  "/codeaton/app/app.js?v=20260828-chat-history1",
  "/codeaton/manifest.webmanifest",
  "/codeaton/icon.svg",
  "/codeaton/icon-192.png",
  "/codeaton/icon-512.png",
  "/favicon-t-20260728.svg"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("codeaton-") && key !== CACHE_NAME).map(key => caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin || !url.pathname.startsWith("/codeaton")) return;
  event.respondWith(fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request).then(hit => hit || caches.match("/codeaton/app"))));
});
