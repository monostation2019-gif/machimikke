// ============================================================
// キャッシュ名を「自動で」決める仕組み。
//
// これまでは CACHE_NAME の数字（v6, v7...）を人が手で書き換える
// 必要があったが、それをなくす。
//
// index.html をサーバーから取得した時、サーバーは自動的に
// 「このファイルは最後にいつ更新されたか（Last-Modified）」
// という情報を付けて返してくる。これはアップロードのたびに
// サーバー側が勝手に付け替えてくれる情報で、人が用意する必要はない。
//
// この値をそのままキャッシュ名の一部として使うことで、
// 「index.htmlを新しくアップロードする」→「Last-Modifiedが自動的に変わる」
// →「キャッシュ名も自動的に変わる」→「古いキャッシュは自動的に消える」
// という流れが、一切の手作業なしで成立する。
// ============================================================
const CACHE_PREFIX = 'poisute-map';
const APP_SHELL = [
  './index.html',
  './manifest.json'
];

/**
 * index.html を取得し、サーバーが自動で付与する更新情報（Last-Modified優先、
 * なければETag）を読み取って、それを元にキャッシュ名を組み立てる。
 * どちらの情報もサーバーから得られない場合のみ、install実行時刻を使う
 * （その場合でも動作上の問題はなく、単に自動クリーンアップの精度が下がるだけ）。
 */
async function resolveCacheName(){
  try {
    // ヘッダー（Last-Modified / ETag）が分かればよく、本文（HTML全体）は
    // 不要なため、GETではなくHEADで取得する。これによりindex.html本体を
    // 丸ごとダウンロードする無駄がなくなり、install/activate、および
    // Service Worker再起動直後の最初のfetch処理が速くなる。
    const res = await fetch('./index.html', { method: 'HEAD', cache: 'no-store' });
    const tag = res.headers.get('last-modified') || res.headers.get('etag');
    if (tag){
      const safeTag = tag.replace(/[^a-zA-Z0-9]/g, '').slice(0, 40);
      if (safeTag) return `${CACHE_PREFIX}-${safeTag}`;
    }
  } catch (err){
    console.warn('[sw] バージョン自動判定に失敗、フォールバックを使用:', err);
  }
  return `${CACHE_PREFIX}-fallback-${Date.now()}`;
}

// installとfetchの両方で同じキャッシュ名を使い回すため、一度だけ計算して使い回す
const cacheNamePromise = resolveCacheName();

self.addEventListener('install', (event) => {
  event.waitUntil(
    cacheNamePromise.then((cacheName) =>
      caches.open(cacheName).then((cache) => {
        // addAll は1件でも取得失敗すると install 全体が失敗し、
        // 新しいSWが永遠にインストールされない（＝自動更新が完全に止まる）
        // 原因になるため、1件ずつ個別に試して失敗しても他に影響しないようにする。
        // ここでの事前キャッシュはオフライン時のフォールバック用に過ぎず、
        // 通常時のページ表示はfetchハンドラのネットワーク優先取得が担うので、
        // 多少キャッシュに失敗しても実害はない。
        return Promise.all(
          APP_SHELL.map((path) =>
            cache.add(path).catch((err) => {
              console.warn('[sw] 事前キャッシュ失敗（無視して続行）:', path, err);
            })
          )
        );
      })
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    cacheNamePromise.then((cacheName) =>
      caches.keys().then((names) =>
        Promise.all(
          names
            .filter((n) => n.startsWith(CACHE_PREFIX) && n !== cacheName)
            .map((n) => caches.delete(n))
        )
      )
    )
  );
  self.clients.claim();
});

// index.html側から送られる SKIP_WAITING メッセージを受け取り、
// 待機中のSWをすぐ有効化する。install時にskipWaiting()を呼んでいるため
// 通常はreg.waitingが発生しないはずだが、念のための保険として実装しておく。
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
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
          cacheNamePromise.then((cacheName) =>
            caches.open(cacheName).then((cache) => cache.put(req, clone))
          );
          return response;
        })
        .catch(() =>
          cacheNamePromise
            .then((cacheName) => caches.open(cacheName))
            .then((cache) => cache.match(req).then((cached) => cached || cache.match('./index.html')))
        )
    );
    return;
  }
  // それ以外（タイル画像・Firestore通信等）はブラウザの通常挙動に任せる
});
