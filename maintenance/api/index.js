const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Under maintenance · Talkaton</title><style>*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:28px;background:#0b0d13;color:#f1f3f9;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{width:100%;max-width:560px;padding:48px 36px;border:1px solid #293044;border-radius:24px;background:#121722;box-shadow:0 24px 100px #0005}.brand{font-size:18px;font-weight:700;letter-spacing:.02em;margin:0 0 48px}.status{display:inline-flex;align-items:center;gap:9px;color:#c4b5fd;font-size:13px;border:1px solid #51416e;border-radius:100px;padding:7px 12px}.dot{width:7px;height:7px;border-radius:50%;background:#c4b5fd}h1{font-size:clamp(32px,7vw,44px);line-height:1.1;letter-spacing:-.035em;margin:22px 0}p{color:#b1bbce;line-height:1.7;font-size:16px}.foot{margin-top:32px;font-size:14px;color:#8e99af}@media(max-width:420px){main{padding:32px 24px}}</style></head><body><main><div class="brand">Talkaton</div><div class="status"><span class="dot"></span>Temporarily unavailable</div><h1>Under maintenance</h1><p>We’re updating Talkaton and making improvements behind the scenes. All pages and services are temporarily unavailable while we work.</p><p>Please check back soon. Thank you for your patience.</p><p class="foot">No action is needed from you.</p></main></body></html>`;
const worker = `self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys()){if(/talkaton|codeaton/i.test(key))await caches.delete(key)}await self.clients.claim();for(const client of await self.clients.matchAll({type:'window'})){await client.navigate(client.url)}})()));self.addEventListener('fetch',event=>{if(new URL(event.request.url).origin===self.location.origin)event.respondWith(fetch(event.request))});`;
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const pathname = new URL(req.url, 'https://talkaton.org').pathname;
  if (req.headers['sec-fetch-dest'] === 'serviceworker' || /\/(?:sw|service-worker)\.js$/.test(pathname)) {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Service-Worker-Allowed', '/');
    res.statusCode = 200;
    return res.end(req.method === 'HEAD' ? '' : worker);
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Retry-After', '3600');
  res.statusCode = 503;
  res.end(req.method === 'HEAD' ? '' : page);
};
