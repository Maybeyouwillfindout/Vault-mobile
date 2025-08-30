
const CACHE='vault-cache-v2-6-4';
const ASSETS=['./','./index.html?v=2640','./styles.css?v=2640','./app.js?v=2640','./manifest.webmanifest?v=2640'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))))});
self.addEventListener('fetch',e=>{e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)))});
