/**
 * sw.js — يخزّن هيكل التطبيق (الصفحات، التنسيقات، الأكواد، الأيقونات)
 * في الكاش المحلي ليعمل التطبيق بالكامل بدون إنترنت بعد أول فتح له.
 * ملاحظة: التسجيلات الصوتية نفسها لا تُخزَّن هنا، بل في IndexedDB (db.js).
 */

const CACHE_NAME = "quran-review-cache-v16";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/app.js",
  "./js/db.js",
  "./js/surahs.js",
  "./js/juz.js",
  "./js/pages.js",
  "./js/ahzab.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// استراتيجية: الكاش أولًا، مع تحديث في الخلفية إذا توفّر اتصال
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);

      return cached || network;
    })
  );
});
