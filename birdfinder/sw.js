/* Backyard Birding offline helper: keeps the app and the bird listener on the phone so they work with no signal. */
const SHELL = 'bb-shell-v9';
const PHOTOS = 'bb-photos-v1';
const MODEL = 'bb-birdnet-v1';   // the big listener files; only change this name if the model files change
const SHELL_FILES = ['./', 'index.html', 'manifest.json', 'apple-touch-icon.png', 'favicon.png', 'icon-192.png', 'icon-512.png', 'denoise.js', 'photoid/photoid.js', 'photoid/texas.json'];
const MODEL_FILES = ['birdnet/worker.js', 'birdnet/tf.min.js', 'birdnet/model.json', 'birdnet/labels/en_us.txt',
  'birdnet/area-model/model.json', 'birdnet/area-model/group1-shard1of2.bin', 'birdnet/area-model/group1-shard2of2.bin',
  ...Array.from({ length: 13 }, (_, i) => `birdnet/group1-shard${i + 1}of13.bin`),
  'photoid/tf-tflite.min.js', 'photoid/birds.tflite', 'photoid/labels.txt', 'photoid/wasm/tflite_web_api_cc.js', 'photoid/wasm/tflite_web_api_cc.wasm', 'photoid/wasm/tflite_web_api_cc_simd.js', 'photoid/wasm/tflite_web_api_cc_simd.wasm'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== MODEL && k !== PHOTOS).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// The page asks for this after the first successful Listen (or from the "Save for the field" button)
self.addEventListener('message', e => {
  if (e.data === 'refresh-app') {
    e.waitUntil(caches.open(SHELL).then(async c => {
      for (const f of ['./', 'index.html', 'sw.js', 'denoise.js', 'photoid/photoid.js']) {
        try { const r = await fetch(f, { cache: 'reload' }); if (r.ok) await c.put(f, r); } catch (_) {}
      }
      (await self.clients.matchAll()).forEach(cl => cl.postMessage({ refreshed: true }));
    }));
    return;
  }
  if (e.data === 'save-listener') {
    e.waitUntil(caches.open(MODEL).then(async c => {
      for (const f of MODEL_FILES) { if (!(await c.match(f))) { try { await c.add(f); } catch (_) {} } }
      const have = (await c.keys()).length;
      const all = await self.clients.matchAll();
      all.forEach(cl => cl.postMessage({ saved: have >= MODEL_FILES.length, have, need: MODEL_FILES.length }));
    }));
  }
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // bird pictures from Wikipedia: keep a copy so the guide shows them with no signal
  if (url.hostname === 'upload.wikimedia.org' && url.pathname.includes('/thumb/')) {
    e.respondWith(caches.open(PHOTOS).then(c => c.match(e.request.url).then(hit => hit || fetch(e.request.url, { mode: 'no-cors' }).then(r => { c.put(e.request.url, r.clone()); return r; }))));
    return;
  }
  if (url.origin !== location.origin) return; // bird songs, fonts: straight to the internet
  const path = url.pathname;
  if (path.includes('/birdnet/') || path.includes('/photoid/') && !path.endsWith('.json') && !path.endsWith('photoid.js')) {
    // listener files never change: use the saved copy, otherwise download and save it
    e.respondWith(caches.open(MODEL).then(c => c.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(r => {
      if (r.ok) { const copy = r.clone(); c.put(e.request, copy); } return r;
    }))));
    return;
  }
  // the app itself: get the newest when there is signal, fall back to the saved copy when there isn't
  // weak signal: if the internet takes more than 5 seconds, open the saved copy instead of waiting
  const saved = () => caches.match(e.request, { ignoreSearch: true }).then(hit => hit || caches.match('index.html'));
  let saving = Promise.resolve();
  const net = fetch(e.request, { cache: 'no-cache' }).then(r => {  // always check GitHub for the newest page
    if (r.ok) { const copy = r.clone(); saving = caches.open(SHELL).then(c => c.put(e.request, copy)); }
    return r;
  });
  // keep this helper awake until the new copy is fully saved (iPhone otherwise stops it early,
  // and the phone would stay stuck on the old version)
  e.waitUntil(net.then(() => saving).catch(() => {}));
  e.respondWith(new Promise(resolve => {
    let done = false;
    const t = setTimeout(() => saved().then(h => { if (!done && h) { done = true; resolve(h); } }), 5000);
    net.then(r => { if (!done) { done = true; clearTimeout(t); resolve(r); } })
       .catch(() => saved().then(h => { if (!done) { done = true; clearTimeout(t); resolve(h || Response.error()); } }));
  }));
});
