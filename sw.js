// App e índice: rede primeiro (pega o catálogo atualizado); sem internet, usa o que está salvo.
// Imagens das páginas: mostra na hora a cópia salva e atualiza em segundo plano.
// Na instalação o app já guarda a tela, a lista de catálogos e os índices de busca, para abrir sem
// internet mesmo que a pessoa só tenha aberto uma vez. As páginas ficam a cargo de "Usar sem internet"
// (caches off-*, ver local.js).
const CACHE = 'catalogo-v28';
const APP = ['./', 'index.html', 'app.js', 'local.js', 'styles.css', 'manifest.json', 'icon.svg', 'catalogos.json'];

async function precache() {
  const cache = await caches.open(CACHE);
  await cache.addAll(APP.map((u) => new Request(u, { cache: 'no-cache' })));
  try {
    const lista = await (await fetch('catalogos.json', { cache: 'no-cache' })).json();
    await cache.addAll(lista.map((b) => new Request(`catalogos/${b.id}/indice.json`, { cache: 'no-cache' })));
  } catch {}
}

self.addEventListener('install', (e) => e.waitUntil(precache().then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  // apaga os caches de versões antigas do app (os off-* são os downloads escolhidos pela pessoa)
  for (const k of await caches.keys()) if (k.startsWith('catalogo-v') && k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

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
  e.respondWith(fromNetwork(e.request).catch(async () =>
    (await caches.match(e.request, { ignoreSearch: true })) ||
    (e.request.mode === 'navigate' ? caches.match('./') : Response.error())));
});
