/* ==========================================================================
   Browser Tunnel IDE — Service Worker (sw.js)
   --------------------------------------------------------------------------
   Intercepts top-level navigations to `preview.html?p=<lz-base64>&exp=<ts>` and
   returns the unpacked project as a NATIVE top-level HTML document.
   Zero iframes → full compatibility with PeerJS / WebRTC / device permissions.
   ========================================================================== */

const SW_VERSION = 'browser-tunnel-ide-v1';
const PREVIEW_PATH = 'preview.html';

/* Load the official lz-string library (CDN serves with CORS so importScripts works). */
try {
  importScripts('https://cdn.jsdelivr.net/npm/lz-string@1.5.0/libs/lz-string.min.js');
} catch (e) {
  console.error('SW failed to import lz-string:', e);
}

/* --------------------------------------------------------------------------
   Compose a top-level HTML document from project data.
   projectData = { type: "single"|"multi", html, css, js }
   -------------------------------------------------------------------------- */
function composeDocument(projectData) {
  if (!projectData) throw new Error("Empty project payload");
  if (projectData.type === "single") {
    return projectData.html || "<!doctype html><title>Empty</title>";
  }
  const html = projectData.html || "";
  const css = projectData.css || "";
  const js = projectData.js || "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Preview</title>
<style>${css}</style>
</head>
<body>
${html}
<script>
try {
${js}
} catch (e) {
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#7f1d1d;color:#fee2e2;padding:12px;font:13px ui-monospace,monospace;white-space:pre-wrap;z-index:999999';
  box.textContent = 'Runtime error: ' + (e && e.stack ? e.stack : String(e));
  document.body.appendChild(box);
}
<\/script>
</body>
</html>`;
}

/* --------------------------------------------------------------------------
   Build a clean error document for invalid / expired / corrupt tunnels.
   -------------------------------------------------------------------------- */
function errorDoc(message, hint) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Tunnel Error</title>
<style>
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:#020617; color:#e2e8f0; font-family: ui-sans-serif, system-ui, sans-serif; }
  .card { background:#0f172a; border:1px solid #1e293b; border-radius:14px; padding:32px 40px;
          max-width:520px; box-shadow:0 0 0 1px rgba(56,189,248,.05), 0 20px 60px rgba(0,0,0,.6); }
  h1 { margin:0 0 12px; font-size:18px; color:#f87171; letter-spacing:.04em; }
  p { margin:0 0 8px; color:#94a3b8; font-size:14px; line-height:1.55; }
  .hint { margin-top:14px; padding-top:14px; border-top:1px solid #1e293b; color:#64748b; font-size:13px; }
</style>
</head>
<body>
  <div class="card">
    <h1>TUNNEL UNAVAILABLE</h1>
    <p>${message}</p>
    ${hint ? `<div class="hint">${hint}</div>` : ""}
  </div>
</body>
</html>`;
}

/* --------------------------------------------------------------------------
   Decompression with fallback (in case importScripts failed).
   -------------------------------------------------------------------------- */
function decompress(input) {
  if (self.LZString && typeof self.LZString.decompressFromBase64 === 'function') {
    return self.LZString.decompressFromBase64(input);
  }
  return null;
}

/* --------------------------------------------------------------------------
   Install / activate handlers
   -------------------------------------------------------------------------- */
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await self.clients.claim();
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== SW_VERSION).map((k) => caches.delete(k)));
  })());
});

/* --------------------------------------------------------------------------
   Fetch handler: intercept preview.html navigations and rewrite the response.
   -------------------------------------------------------------------------- */
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.mode !== "navigate") return;
  const url = new URL(req.url);
  if (!url.pathname.endsWith("/" + PREVIEW_PATH)) return;

  const params = new URLSearchParams(url.search);
  const payload = params.get("p");
  if (!payload) return; // let it fall through to network

  event.respondWith((async () => {
    try {
      // Expiration check
      const expParam = params.get("exp");
      if (expParam) {
        const exp = Number(expParam);
        if (!Number.isFinite(exp)) {
          return new Response(errorDoc("Invalid expiration timestamp."), {
            status: 400, headers: { "Content-Type": "text/html; charset=utf-8" }
          });
        }
        if (Date.now() > exp) {
          return new Response(
            errorDoc("This tunnel has expired.", "Tunnels live for 15 minutes. Spin up a new one from the IDE."),
            { status: 410, headers: { "Content-Type": "text/html; charset=utf-8" } }
          );
        }
      }

      // Decompress
      let decompressed;
      try {
        decompressed = decompress(payload);
        if (!decompressed) throw new Error("decompressed to empty");
      } catch (e) {
        return new Response(
          errorDoc("Corrupted tunnel payload.", "The compressed query parameter could not be decoded."),
          { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } }
        );
      }

      // Parse
      let projectData;
      try {
        projectData = JSON.parse(decompressed);
      } catch (e) {
        return new Response(
          errorDoc("Malformed tunnel payload.", "Project JSON could not be parsed."),
          { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } }
        );
      }

      // Compose final document
      let finalDoc;
      try {
        finalDoc = composeDocument(projectData);
      } catch (e) {
        return new Response(
          errorDoc("Failed to compose document: " + (e.message || String(e))),
          { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } }
        );
      }

      return new Response(finalDoc, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "X-Browser-Tunnel": "active",
        },
      });
    } catch (e) {
      return new Response(
        errorDoc("Unexpected tunnel error: " + (e && e.message ? e.message : String(e))),
        { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
    }
  })());
});
