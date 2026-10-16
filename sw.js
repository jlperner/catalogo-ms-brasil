// App e índice: rede primeiro (pega o catálogo atualizado); sem internet, usa o que está salvo.
// Imagens das páginas: mostra na hora a cópia salva e atualiza em segundo plano.
const CACHE = 'catalogo-v21';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

const isImage = (url) => /\.(jpe?g|png)$/i.test(new URL(url).pathname);

function fromNetwork(req) {
  return fetch(req, { cache: 'no-cache' }).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return res;
  });
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith('http')) return;
  if (isImage(e.request.url)) {
    e.respondWith(caches.match(e.request).then((hit) => {
      const net = fromNetwork(e.request).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  e.respondWith(fromNetwork(e.request).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
