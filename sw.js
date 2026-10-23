const PREFIX = `escard:${self.registration.scope}:`;
const CACHE = `${PREFIX}3`;
const ASSETS = ['./','./index.html','./style.css','./escard.css','./app.mjs','./core.mjs','./media.mjs','./data.mjs','./icon.svg','./manifest.webmanifest'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith(PREFIX)&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
  const relative=url.pathname.slice(new URL(self.registration.scope).pathname.length);
  if(!['','index.html','style.css','escard.css','app.mjs','core.mjs','media.mjs','data.mjs','icon.svg','manifest.webmanifest'].includes(relative))return;
  // Aynı sürümün modülleri birlikte kullanılır; sonraki sürüm yeni önbellekle kurulur.
  event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match(event.request,{ignoreSearch:true}))||fetch(event.request)));
});
