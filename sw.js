// Tokyo 2026 PWA - Service Worker v4
// 3 separate caches: app shell, map tiles, API responses

const APP_CACHE = 'tokyo-app-v4';
const TILE_CACHE = 'tokyo-tiles-v1';
const API_CACHE = 'tokyo-api-v1';
const TILE_LIMIT = 200;

const APP_SHELL = [
  '/tokyo-pwa/',
  '/tokyo-pwa/index.html'
];

// Install: cache app shell
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(APP_CACHE)
      .then(function(c) { return c.addAll(APP_SHELL); })
      .then(function() { return self.skipWaiting(); })
  );
});

// Activate: clean old caches, claim clients
self.addEventListener('activate', function(e) {
  var keep = [APP_CACHE, TILE_CACHE, API_CACHE];
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return keep.indexOf(k) === -1; })
            .map(function(k) { return caches.delete(k); })
      );
    }).then(function() { return self.clients.claim(); })
  );
});

// Trim tile cache to TILE_LIMIT (LRU by insertion order)
function trimTileCache() {
  caches.open(TILE_CACHE).then(function(cache) {
    cache.keys().then(function(keys) {
      if (keys.length > TILE_LIMIT) {
        // Delete oldest entries (first in cache)
        var toDelete = keys.length - TILE_LIMIT;
        for (var i = 0; i < toDelete; i++) {
          cache.delete(keys[i]);
        }
      }
    });
  });
}

self.addEventListener('fetch', function(e) {
  if (e.request.method !== 'GET') return;

  var url = new URL(e.request.url);

  // === App shell: cache-first ===
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(e.request).then(function(cached) {
        if (cached) return cached;
        return fetch(e.request).then(function(res) {
          var clone = res.clone();
          caches.open(APP_CACHE).then(function(c) { c.put(e.request, clone); });
          return res;
        });
      }).catch(function() {
        return caches.match('/tokyo-pwa/index.html');
      })
    );
    return;
  }

  // === Google Maps JS (maps.googleapis.com): stale-while-revalidate ===
  if (url.hostname === 'maps.googleapis.com' && url.pathname.indexOf('/maps/api/js') === 0) {
    e.respondWith(
      caches.open(APP_CACHE).then(function(cache) {
        return cache.match(e.request).then(function(cached) {
          var fetchPromise = fetch(e.request).then(function(res) {
            if (res.ok) cache.put(e.request, res.clone());
            return res;
          }).catch(function() { return cached; });

          return cached || fetchPromise;
        });
      })
    );
    return;
  }

  // === Map tiles (maps.gstatic.com, khms*.google.com, etc.): cache-first with limit ===
  if (url.hostname.indexOf('gstatic.com') !== -1 ||
      url.hostname.indexOf('googleapis.com') !== -1 && url.pathname.indexOf('/maps/') !== -1 &&
      url.pathname.indexOf('/maps/api/') === -1) {
    e.respondWith(
      caches.open(TILE_CACHE).then(function(cache) {
        return cache.match(e.request).then(function(cached) {
          if (cached) return cached;
          return fetch(e.request).then(function(res) {
            if (res.ok) {
              cache.put(e.request, res.clone());
              trimTileCache();
            }
            return res;
          });
        });
      }).catch(function() { return caches.match(e.request); })
    );
    return;
  }

  // === Exchange rate API: network-first with cache ===
  if (url.hostname === 'open.er-api.com') {
    e.respondWith(
      fetch(e.request).then(function(res) {
        var clone = res.clone();
        caches.open(API_CACHE).then(function(c) { c.put(e.request, clone); });
        return res;
      }).catch(function() {
        return caches.match(e.request);
      })
    );
    return;
  }

  // === Other Google APIs (weather, AQI, places): network-first with cache ===
  if (url.hostname.indexOf('googleapis.com') !== -1) {
    e.respondWith(
      fetch(e.request).then(function(res) {
        if (res.ok) {
          var clone = res.clone();
          caches.open(API_CACHE).then(function(c) { c.put(e.request, clone); });
        }
        return res;
      }).catch(function() {
        return caches.match(e.request);
      })
    );
    return;
  }
});
