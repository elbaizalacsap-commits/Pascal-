/* ============================================================
   Service Worker — permet au mode "contre l'ordinateur" et
   "deux joueurs, un écran" de fonctionner hors connexion.
   Le mode "en ligne" nécessite toujours une connexion, ce qui
   est normal puisqu'il synchronise deux appareils différents.
   ============================================================ */

const CACHE_NOM = "echiquier-v1";
const FICHIERS_A_METTRE_EN_CACHE = [
  "./",
  "./index.html",
  "./style.css",
  "./script.js",
  "./moteur.js",
  "./supabase-config.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NOM).then(cache => cache.addAll(FICHIERS_A_METTRE_EN_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(noms =>
      Promise.all(noms.filter(n => n !== CACHE_NOM).map(n => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  // On ne met pas en cache les appels vers Supabase ou les CDN de librairies :
  // ils doivent toujours passer par le réseau quand il est disponible.
  if (event.request.url.includes("supabase.co") || event.request.url.includes("unpkg.com") || event.request.url.includes("cdnjs.cloudflare.com")) {
    return;
  }
  event.respondWith(
    caches.match(event.request).then(reponse => reponse || fetch(event.request))
  );
});
