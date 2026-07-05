// キャッシュ名は更新のたびに必ず変える運用を推奨（変え忘れてもfetch戦略により自動更新は機能します）
const CACHE_NAME = 'poisute-map-v4';
const APP_SHELL = [
  './index.html',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = req.url;

  // ページ本体の読み込み（ルートパス "/" で開いた場合も含む）は必ずナビゲーションリクエストとして
  // 判定する。これを見落とすと、URL末尾が index.html でない通常のアクセス
  // （例: https://example.com/）でネットワーク優先処理が効かず、
  // 更新したはずのHTMLが反映されない不具合につながる。
  const isNavigation = req.mode === 'navigate';
  const isAppShellAsset = APP_SHELL.some((path) => url.endsWith(path.replace('./', '')));

  if (isNavigation || isAppShellAsset) {
    // ネットワーク優先＋HTTPキャッシュを完全にバイパス（cache:'no-store'）
    // これで「SW的にはネットワーク優先のつもりが、実はブラウザ手元キャッシュを掴んでいた」を防ぐ
    event.respondWith(
      fetch(req, { cache: 'no-store' })
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          return response;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
    );
    return;
  }
  // それ以外（タイル画像・Firestore通信等）はブラウザの通常挙動に任せる
});
