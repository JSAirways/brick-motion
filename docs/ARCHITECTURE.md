# Architecture

## Process model

Brick-Motion is an Electron app with a strict split between UI and privileged work.

```text
Renderer (Vite + TypeScript)
  └─ window.brickMotion  ◄── preload (contextBridge)
                              └─ main process (Node)
                                   ├─ filesystem / dialogs
                                   ├─ project validation
                                   └─ camera (Media Foundation addon)
```

| Layer | Role |
|-------|------|
| Renderer | UI only — no Node, no direct FS. Talks through `window.brickMotion`. |
| Preload | Narrow named API via `contextBridge`. No generic `invoke(channel, …)`. |
| Main | Window lifecycle, IPC handlers, path safety, `project.json` I/O, camera service. |
| Native addon | `native/camera-mf` — device enum/open, MJPEG preview/capture (Windows). |

Key settings on `BrowserWindow`: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.

## Key paths

| Path | Role |
|------|------|
| `electron/main.ts` | Window + IPC composition |
| `electron/preload.ts` | `brickMotion` bridge |
| `electron/menuCommands.ts` | App menu → typed `menu:command` events |
| `electron/pathUtils.ts` | `resolveSafePathInsideProject` |
| `electron/camera/` | `CameraService`, Media Foundation backend |
| `src/shared/types/project.ts` | `ProjectFile` and related types |
| `src/shared/validateProject.ts` | Parse/validate on create, open, save |
| `src/renderer/app/App.ts` | Top-level routes and composition |
| `src/renderer/templates/` | Markup-only HTML string builders |
| `src/renderer/app/<route>/` | Route runtime (listeners, IPC) |
| `src/renderer/styles/main.scss` | Bootstrap theme + `bm-*` primitives |

`package.json` `"main"` points at `dist-electron/electron/main.js`.

## Security and IPC

- Treat `project.json` and IPC payloads as untrusted until validated in main.
- Confine relative paths with `resolveSafePathInsideProject` before read/write/delete/export.
- Escape user/device strings in templates (`escapeHtml`); report failures via `reportError` / `reportInfo`.
- Don’t weaken `contextIsolation` or turn on `nodeIntegration`. Prefer fixing preload compatibility over disabling `sandbox`.

## Camera pipeline

The renderer does **not** use `getUserMedia`. Main owns the camera; the UI calls `brickMotion.camera*`.

- Open binds the invoking window as the preview target.
- Prefer a single **largest MJPEG** mode for the session (live + capture share one stream). Details: [Camera capture](native/camera-mf/CAMERA_CAPTURE.md).
- Live preview and on-disk capture previews are JPEG-capped (~960 px long edge); source files keep stream resolution (JPEG or PNG depending on capture mode).
- Timeline thumbs live under `frames/timeline-thumb/` (`timelineThumbPath` on each frame).
- DSLR tether is a future `CameraBackend` seam — not implemented.

## Menus and shortcuts

- Menu template in `electron/menuCommands.ts`; workspace actions no-op when not on the workspace route.
- On Windows, the menu bar is hidden on the start screen and shown in the workspace.
- Capture shortcuts (arrows, J/K/L, Space, O, C, Delete, undo/redo, etc.) live in the capture-workspace controllers and are inactive while typing in inputs.

## Related docs

- [Technical brief](TECHNICAL_BRIEF.md)
- [Development](DEVELOPMENT.md)
- [Schema notes](SCHEMA_NOTES.md)
- [Conventions](CONVENTIONS.md)
