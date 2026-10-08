# 🚀 Browser Tunnel

A **backendless web development IDE** and deployment-tunnel platform that runs entirely in the browser.
No build step, no npm, no server — just three static files.

## How it works

1. **Author** — build a project in the IDE (single unified HTML file, or split HTML / CSS / JS panes).
2. **Pack** — the active project is composed into one document and compressed into the URL with `lz-string`.
3. **Tunnel** — a link to `preview.html?c=…&exp=…&id=…` is minted with a 15-minute expiry.
4. **Serve** — `sw.js` (a Service Worker) intercepts that navigation, decompresses the payload and answers with a real `text/html` **Response**.

Because the Service Worker answers the navigation directly, the result is a **native top-level document**.
There is no `<iframe>`, no `srcdoc` and no `sandbox` attribute anywhere in the pipeline, so **WebRTC, PeerJS,
`getUserMedia`, geolocation, clipboard and every other hardware/permission API** behave exactly as they do on an
ordinary origin.

## Files

| File | Role |
| --- | --- |
| `index.html` | The IDE — React 18 + Tailwind + Lucide via pinned CDNs, all state in `localStorage` |
| `preview.html` | The routing target. Normally answered by the Service Worker; contains a `document.write()` fallback for the very first navigation (a Service Worker never controls the load that registers it) |
| `sw.js` | Decodes the tunnel payload, enforces expiry + revocation, returns error pages for corrupt/expired/revoked links |

## Features

- Dashboard with search, sort, project cards, rename / download / delete
- Two-step new-project wizard (structure → metadata, with local file import)
- Syntax-highlighted editors with line gutters, tab handling and auto-indent
- Live sandboxed preview, full-screen pop-out, new-tab export
- `Clear` pane, `Remove Template` (blank canvas), instant rename, `.html` / `.zip` export
- **🚀 Spin Up Tunnel Server** — pulsing action, countdown ring, copy-live-link, revoke
- Error pages for expired (410), revoked (410), corrupt (422) and missing (400) payloads
- Resilient storage: quota and private-mode failures surface as toasts, never data loss

## Deploy anywhere

Drop the three files at the root of any static host (GitHub Pages, Netlify, Cloudflare Pages, S3).
All paths are relative, so the app works from a sub-path such as `https://user.github.io/repo/`.

## License

MIT
