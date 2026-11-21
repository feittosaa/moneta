const prefix = 'moneta-web:'+self.registration.scope+':';
const cacheName = prefix+'BUILD_VERSION';
const assets = BUILD_ASSETS.map(path => new URL(path,self.registration.scope).href);
const index = new URL('index.html',self.registration.scope).href;

self.addEventListener('install',event => {
  event.waitUntil(caches.open(cacheName).then(cache =>
    cache.addAll(assets.map(url => new Request(url,{cache:'reload'})))));
});

self.addEventListener('activate',event => {
  event.waitUntil((async () => {
    const obsolete = (await caches.keys()).filter(name => name.startsWith(prefix) && name !== cacheName);
    await Promise.all(obsolete.map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch',event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const entry = event.request.mode === 'navigate' &&
    (url.pathname === new URL(self.registration.scope).pathname || url.pathname === new URL(index).pathname);
  if (!entry && !assets.includes(url.href)) return;
  event.respondWith(caches.open(cacheName).then(async cache =>
    await cache.match(entry ? index : url.href) || fetch(event.request)));
});
