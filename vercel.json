/* ============================================================
   海ゴミ探究ノート - Service Worker (umigomi-v4)
   ============================================================ */
const CACHE = 'umigomi-v4';
const TILE_CACHE = 'umigomi-tiles-v3';

const PRECACHE = [
  '/',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// インストール時：必須ファイルをキャッシュ
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE))
  );
});

// アクティベート時：古いキャッシュ削除
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE && k !== TILE_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// メッセージ受信（SKIP_WAITING）
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// フェッチ：Network First（地図タイルだけCache First）
self.addEventListener('fetch', e => {
  const url = e.request.url;

  // 地図タイル（OpenStreetMap）はCache First
  if (url.includes('tile.openstreetmap.org')) {
    e.respondWith(
      caches.open(TILE_CACHE).then(async c => {
        const cached = await c.match(e.request);
        if (cached) return cached;
        const res = await fetch(e.request);
        if (res && res.status === 200) c.put(e.request, res.clone());
        return res;
      }).catch(() => new Response('', { status: 503 }))
    );
    return;
  }

  // Firebase / 外部APIはキャッシュしない
  if (
    url.includes('firebaseapp.com') ||
    url.includes('googleapis.com') ||
    url.includes('open-meteo.com') ||
    url.includes('gstatic.com')
  ) {
    e.respondWith(fetch(e.request));
    return;
  }

  // それ以外：Network First、失敗時にキャッシュフォールバック
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res && res.status === 200 && e.request.method === 'GET') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
