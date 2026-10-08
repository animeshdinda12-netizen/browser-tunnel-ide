# Browser Tunnel IDE

A premium, backendless web development IDE with ephemeral "Browser Tunnel" preview URLs. Built as a single, robust HTML architecture using React, Tailwind CSS, and Lucide via CDN — no Vite, no npm, no terminal installation.

## Files

| File | Role |
|------|------|
| `index.html` | The IDE: dashboard, modals, workspace, editor, tunnel feature |
| `preview.html` | Fallback renderer (only runs if SW hasn't taken control yet) |
| `sw.js` | Service Worker that intercepts `preview.html?p=…` and returns the unpacked project as a top-level HTML document (zero iframes) |

## Features

- **Dashboard** with grid cards for every saved project (Open / Rename / Download / Delete)
- **Two-step New Project modal**: choose structure (single HTML or split HTML/CSS/JS), then enter metadata + optional local file import
- **Workspace** with split or unified layouts, tabbed editors, line-numbered gutter, tab-key support
- **Utility actions**: Clear current pane, Remove template (blank canvas), inline Rename, Download project (`.html` or `.zip`)
- **🚀 Spin Up Tunnel**: compresses active code via `lz-string` base64, packs into `preview.html?p=…&exp=…` URL with 15-minute expiry
- **Service Worker routing**: intercepts the preview URL and returns the unpacked document as a NATIVE top-level window — full compatibility with PeerJS, WebRTC, and device permissions (no iframe sandbox)
- **LocalStorage persistence** with quota-exceeded error handling
- **Error Boundary** wraps the React app for graceful crash recovery
- **Glassmorphism dark cyberpunk theme** with pulse-glow CTAs and grid-bg dashboard

## Deploy (GitHub Pages)

This repository is GitHub Pages-ready. Push the three files to a branch named `main`, enable Pages for the root of `main`, and the IDE will be live at:

```
https://<your-username>.github.io/<repo-name>/
```

## Architecture notes

- All persistence is client-side only — projects never leave the browser.
- The Service Worker is the keystone: it transforms `preview.html` navigations into native top-level document responses. Without the SW, `preview.html` falls back to in-page `document.write()` rendering (which still works but lacks the SW's MIME control and Cache-Control headers).
- The 15-minute tunnel expiry is enforced both client-side (in the SW fetch handler) and in the fallback renderer.
