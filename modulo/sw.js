const CACHE = 'estadisticas-mister-v1'
const SHELL = new URL('./', self.location.href).href
const BASE = [SHELL, new URL('manifest.webmanifest', SHELL).href, new URL('icono-1024.png', SHELL).href]
const FOTOS = new URL('fotos/', SHELL).pathname

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(BASE)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin) return

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put(SHELL, copy))
          return response
        })
        .catch(() => caches.match(SHELL)),
    )
    return
  }

  // Las caras, guardadas para siempre: una foto no cambia y GitHub Pages solo
  // les da diez minutos de caché, así que sin esto se rebajan una y otra vez.
  // La ruta se calcula desde el propio worker y no se escribe a mano: el sitio
  // cuelga de /mister/, y un `/fotos/` literal no casaba con nada.
  if (url.pathname.startsWith(FOTOS)) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
        const copy = response.clone()
        caches.open(CACHE).then((cache) => cache.put(event.request, copy))
        return response
      })),
    )
  }
})
