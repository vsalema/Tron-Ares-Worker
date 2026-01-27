// sw.js - Tron Ares IPTV Player
const CACHE_NAME = 'tron-ares-cache-v1';

// Fichiers à mettre en cache au premier chargement
const ASSETS = [
  './',
  './index.html',
  './tron-ares.css',
  './tron-ares.js',
  // bannière
  'https://vsalema.github.io/tvpt4/css/ChatGPT Image 6 déc. 2025, 19_05_13.png',
];

// INSTALL : on pré-cache l’interface
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS).catch((err) => {
        console.warn('[SW] Erreur au precache :', err);
      });
    })
  );
  self.skipWaiting();
});

// ACTIVATE : on nettoie les anciens caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// FETCH : cache-first pour l’interface, réseau direct pour les flux vidéo/audio
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // On laisse les flux audio/vidéo / playlists passer directement au réseau
  const dest = req.destination;
  if (dest === 'video' || dest === 'audio') {
    return; // pas d’interception, comportement normal
  }

  // Navigation + scripts + styles + images → cache-first
  if (
    dest === 'document' ||
    dest === 'script' ||
    dest === 'style' ||
    dest === 'image' ||
    dest === 'font' ||
    req.mode === 'navigate'
  ) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req)
          .then((res) => {
            // On met en cache la réponse pour la prochaine fois
            const resClone = res.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(req, resClone);
            });
            return res;
          })
          .catch(() => cached || res); // au cas où
      })
    );
  }
  // Pour le reste → comportement normal
});
