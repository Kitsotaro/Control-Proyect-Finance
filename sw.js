// Es el "Service Worker" que guarda copia de los archivos para que la app
// funcione offline. Mientras haya servidor (tu Termux), SIEMPRE usa la
// versión más fresca de la red; la caché es solo un respaldo por si en
// algún momento no hay conexión al servidor. Con esto, ya no depende de
// que te acuerdes de subir un número de versión para ver tus cambios.
const CACHE_NAME = 'finanzas-pwa-v1';
const assets = [
  './index.html',
  './manifest.json',
  './css/base.css',
  './css/tema-oscuro.css',
  './css/tema-claro.css',
  './js/core.js',
  './js/sku.js',
  './js/tema.js',
  './js/registro.js',
  './js/stock.js',
  './js/dashboard.js',
  './js/graficos.js',
  './js/ventas.js',
  './js/analitica.js',
  './js/costos.js',
  './js/combustible.js'
];

self.addEventListener('install', (e) => {
  self.skipWaiting(); // activa la versión nueva de inmediato
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(assets))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((nombres) =>
      Promise.all(nombres.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim()) // toma control de las pestañas ya abiertas
  );
});

// RED PRIMERO, CACHÉ COMO RESPALDO (network-first)
self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request)
      .then((respuestaFresca) => {
        const copia = respuestaFresca.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(e.request, copia));
        return respuestaFresca;
      })
      .catch(() => caches.match(e.request)) // sin conexión al servidor: usa la última copia guardada
  );
});
