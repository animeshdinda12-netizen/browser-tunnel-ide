/* =============================================================================
   Browser Tunnel — Service Worker  (sw.js)
   -----------------------------------------------------------------------------
   PURPOSE
   Intercepts navigations to `preview.html?c=<lz-string>&exp=<ms>&id=<tunnelId>`,
   decompresses the packed project bundle held inside the query string, and
   answers the request with a full `text/html` Response.

   The result is a *native top-level document*: there is no <iframe>, no srcdoc,
   and no sandbox attribute anywhere in the pipeline, so WebRTC, PeerJS,
   getUserMedia, geolocation, clipboard and every other hardware/permission API
   behave exactly as they do on any ordinary origin.

   HARDENING
   - Versioned cache namespace for the revocation store.
   - Expired / corrupt / revoked / missing payloads return a styled error page.
   - If the lz-string CDN is unreachable the worker transparently PASSES THROUGH
     to the network, letting preview.html decode the payload client-side.
   - Revocation list is persisted in the Cache API so it survives SW restarts.
   ============================================================================= */

'use strict';

var SW_VERSION = 'bt-sw-v1.0.0';
var LZ_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/lz-string/1.5.0/lz-string.min.js';
var REVOKE_CACHE = 'bt-revoke-store-v1';
var REVOKE_KEY = 'https://bt.internal/revoked-tunnels';

/* ---------------------------------------------------------------------------
   1. Decoder bootstrap
   --------------------------------------------------------------------------- */
var decoderReady = false;
try {
  importScripts(LZ_CDN);
  decoderReady = (typeof LZString !== 'undefined' &&
    typeof LZString.decompressFromEncodedURIComponent === 'function');
} catch (err) {
  decoderReady = false;
}
if (!decoderReady) {
  console.warn('[BrowserTunnel] lz-string unavailable in SW — falling back to ' +
    'network passthrough (preview.html decodes client-side).');
}

/* ---------------------------------------------------------------------------
   2. Revocation store (persisted through the Cache API)
   --------------------------------------------------------------------------- */
var revokedSet = null;
var revokedLoading = null;

function loadRevoked() {
  if (revokedSet) return Promise.resolve(revokedSet);
  if (revokedLoading) return revokedLoading;
  revokedLoading = caches.open(REVOKE_CACHE)
    .then(function (cache) { return cache.match(REVOKE_KEY); })
    .then(function (res) { return res ? res.json() : []; })
    .then(function (list) {
      revokedSet = new Set(Array.isArray(list) ? list : []);
      return revokedSet;
    })
    .catch(function () {
      revokedSet = new Set();
      return revokedSet;
    });
  return revokedLoading;
}

function persistRevoked() {
  if (!revokedSet) return Promise.resolve();
  return caches.open(REVOKE_CACHE).then(function (cache) {
    return cache.put(REVOKE_KEY, new Response(JSON.stringify(Array.from(revokedSet)), {
      headers: { 'Content-Type': 'application/json' }
    }));
  }).catch(function () { /* storage pressure — revocation stays in-memory */ });
}

/* ---------------------------------------------------------------------------
   3. Query-string parsing
   NOTE: lz-string's encoded-URI alphabet is [A-Za-z0-9+\-$]. We deliberately
   avoid URLSearchParams because it decodes '+' as a space and would corrupt the
   payload. decodeURIComponent() leaves '+' untouched, which is what we want.
   --------------------------------------------------------------------------- */
function readParam(search, name) {
  var m = new RegExp('[?&]' + name + '=([^&]*)').exec(search || '');
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
}

function repairPayload(raw) {
  /* Defensive: some chat clients / proxies turn '+' into ' ' on copy. */
  if (!raw) return raw;
  return raw.indexOf(' ') === -1 ? raw : raw.replace(/ /g, '+');
}

/* ---------------------------------------------------------------------------
   4. Error page renderer
   --------------------------------------------------------------------------- */
function shell(title, accent, body, hint) {
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + title + ' · Browser Tunnel</title><style>' +
    ':root{color-scheme:dark}*{box-sizing:border-box}' +
    'body{margin:0;min-height:100vh;display:grid;place-items:center;background:#020617;' +
    'font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#e2e8f0;padding:24px}' +
    '.wrap{max-width:560px;width:100%;background:rgba(15,23,42,.82);border:1px solid rgba(30,41,59,.7);' +
    'border-radius:18px;padding:28px;backdrop-filter:blur(12px);box-shadow:0 24px 60px -20px rgba(0,0,0,.8)}' +
    '.tag{display:inline-flex;align-items:center;gap:8px;font:600 11px/1 ui-monospace,monospace;' +
    'letter-spacing:.14em;text-transform:uppercase;color:' + accent + ';border:1px solid ' + accent + '55;' +
    'background:' + accent + '14;padding:7px 11px;border-radius:999px}' +
    'h1{font-size:22px;margin:16px 0 8px;letter-spacing:-.02em}' +
    'p{margin:0 0 10px;color:#94a3b8;font-size:14px;line-height:1.6}' +
    'code{font-family:ui-monospace,monospace;font-size:12px;background:#0b1220;border:1px solid #1e293b;' +
    'padding:2px 6px;border-radius:6px;color:#cbd5e1}' +
    'a.btn{display:inline-flex;align-items:center;gap:8px;margin-top:14px;text-decoration:none;' +
    'background:#0ea5e9;color:#04121c;font-weight:700;font-size:13px;padding:10px 16px;border-radius:10px}' +
    'a.btn:hover{background:#38bdf8}' +
    '.hint{margin-top:14px;font-size:12px;color:#64748b}' +
    '</style></head><body><div class="wrap">' +
    '<span class="tag">' + title + '</span>' +
    body +
    (hint ? '<p class="hint">' + hint + '</p>' : '') +
    '<a class="btn" href="./">&#8592; Back to the Browser Tunnel IDE</a>' +
    '</div></body></html>';
}

function errorResponse(status, title, accent, heading, message, hint) {
  var html = shell(title, accent, '<h1>' + heading + '</h1><p>' + message + '</p>', hint);
  return new Response(html, {
    status: status,
    statusText: title,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Browser-Tunnel': 'error',
      'X-Browser-Tunnel-Status': String(status)
    }
  });
}

/* ---------------------------------------------------------------------------
   5. The tunnel handler
   --------------------------------------------------------------------------- */
function handleTunnel(url) {
  var search = url.search || '';
  var packed = readParam(search, 'c');
  var expRaw = readParam(search, 'exp');
  var tunnelId = readParam(search, 'id');

  if (!packed) {
    return Promise.resolve(errorResponse(400, 'NO PAYLOAD', '#f59e0b',
      'This tunnel URL carries no payload.',
      'The <code>c</code> parameter is missing. Open the tunnel again from the IDE — ' +
      'the packed bundle is written into the query string at spin-up time.'));
  }

  return loadRevoked().then(function (revoked) {
    if (tunnelId && revoked.has(tunnelId)) {
      return errorResponse(410, 'REVOKED', '#fb7185',
        'This tunnel was revoked.',
        'The machine that published it killed the server before its 15-minute window elapsed.',
        'Tunnel id <code>' + String(tunnelId).slice(0, 12) + '</code>');
    }

    var exp = expRaw ? parseInt(expRaw, 10) : NaN;
    if (!isNaN(exp) && Date.now() > exp) {
      var when = new Date(exp).toUTCString();
      return errorResponse(410, 'EXPIRED', '#f97316',
        'This tunnel has expired.',
        'Every Browser Tunnel link self-destructs 15 minutes after it is spun up. ' +
        'This one closed at <code>' + when + '</code>.',
        'Spin up a fresh tunnel from the IDE to get a new link.');
    }

    var html = null;
    try {
      html = LZString.decompressFromEncodedURIComponent(packed);
    } catch (e) {
      html = null;
    }
    if (!html) {
      try {
        html = LZString.decompressFromEncodedURIComponent(repairPayload(packed));
      } catch (e2) {
        html = null;
      }
    }
    if (!html || !html.length) {
      return errorResponse(422, 'CORRUPTED', '#ef4444',
        'The tunnel payload could not be decompressed.',
        'The link was truncated in transit — most often by a chat client or a proxy ' +
        'rewriting a very long URL. Copy the link straight from the IDE\'s clipboard utility.',
        'Payload length received: <code>' + String(packed.length) + '</code> chars');
    }

    return new Response(html, {
      status: 200,
      statusText: 'OK',
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Content-Security-Policy': "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'; " +
          'connect-src *; img-src * data: blob:; media-src * data: blob:; frame-ancestors *',
        'X-Browser-Tunnel': 'live',
        'X-Browser-Tunnel-Id': tunnelId ? String(tunnelId).slice(0, 12) : 'anonymous',
        'X-Browser-Tunnel-Expires': expRaw ? String(expRaw) : 'none'
      }
    });
  });
}

/* ---------------------------------------------------------------------------
   6. Lifecycle
   --------------------------------------------------------------------------- */
self.addEventListener('install', function (event) {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil((function () {
    /* Drop revocation stores from previous SW versions. */
    return caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k.indexOf('bt-revoke-store-') === 0 && k !== REVOKE_CACHE) return caches.delete(k);
        return null;
      }));
    }).then(function () {
      return self.clients.claim();
    });
  })());
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }

  /* Only tunnelled preview navigations are ours to answer. */
  if (!/\/preview\.html$/i.test(url.pathname)) return;
  if (!readParam(url.search, 'c')) return;

  /* Decoder missing (CDN blocked) -> let the network serve preview.html,
     which performs the exact same decompression in-page. */
  if (!decoderReady) return;

  event.respondWith(handleTunnel(url));
});

/* ---------------------------------------------------------------------------
   7. Revocation channel (index.html -> SW)
   --------------------------------------------------------------------------- */
self.addEventListener('message', function (event) {
  var data = event.data || {};
  if (data.type === 'BT_PING') {
    if (event.source && event.source.postMessage) {
      event.source.postMessage({ type: 'BT_PONG', version: SW_VERSION, decoder: decoderReady });
    }
    return;
  }
  if (data.type === 'BT_REVOKE' && data.id) {
    event.waitUntil(loadRevoked().then(function (set) {
      set.add(data.id);
      return persistRevoked();
    }).then(function () {
      if (event.source && event.source.postMessage) {
        event.source.postMessage({ type: 'BT_REVOKED', id: data.id, ok: true });
      }
    }));
    return;
  }
  if (data.type === 'BT_UNREVOKE' && data.id) {
    event.waitUntil(loadRevoked().then(function (set) {
      set.delete(data.id);
      return persistRevoked();
    }));
    return;
  }
  if (data.type === 'BT_LIST_REVOKED') {
    event.waitUntil(loadRevoked().then(function (set) {
      if (event.source && event.source.postMessage) {
        event.source.postMessage({ type: 'BT_REVOKED_LIST', ids: Array.from(set) });
      }
    }));
  }
});
