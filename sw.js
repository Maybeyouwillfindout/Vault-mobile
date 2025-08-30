
const CACHE='vault-cache-v2-6-5';
const ASSETS=['./','./index.html?v=2650','./styles.css?v=2650','./app.js?v=2650','./manifest.webmanifest?v=2650'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))))});
self.addEventListener('fetch',e=>{e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)))});
