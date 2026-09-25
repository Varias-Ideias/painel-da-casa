// Service worker: guarda a casca do app para abrir sem rede. A API nunca vem do cache: o estado
// offline vem do último estado salvo no aparelho, e as mudanças esperam na fila (app.js).
// Só é registrado em contexto seguro (HTTPS ou localhost); no Wi-Fi por http o navegador não deixa.
const CACHE = 'painel-v3';
const CASCA = ['/', '/index.html', '/base.css', '/app.css', '/app.js', '/entradas.js', '/manifest.webmanifest', '/icone-192.png',
  '/dominio/acoes.js', '/dominio/exemplos.js', '/dominio/datas.js', '/dominio/habitos.js', '/dominio/mercado.js', '/dominio/parser.js'];

self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CASCA)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // rede primeiro (o app atualiza sozinho); sem rede, cache
  e.respondWith(fetch(e.request).then((r) => {
    const copia = r.clone();
    caches.open(CACHE).then((c) => c.put(url.pathname === '/' ? '/' : e.request, copia));
    return r;
  }).catch(() => caches.match(url.pathname === '/' ? '/' : e.request, { ignoreSearch: true })));
});
