
const CACHE='vault-cache-v2-7-3';
const ASSETS=['./','./index.html?v=2730','./styles.css?v=2730','./app.js?v=2730','./manifest.webmanifest?v=2730'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))))});
self.addEventListener('fetch',e=>{e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)))});
