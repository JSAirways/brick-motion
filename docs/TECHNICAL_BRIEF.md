# Technical brief

## Purpose

Brick-Motion is a **local-first** stop-motion app for the desktop. Capture frames from a USB camera, scrub a timeline, organize sequences, and export image sequences. Everything lives in a project folder on disk — no accounts, no cloud, no network features.

Primary platform today: **Windows** (native Media Foundation camera module + NSIS installer).

## Feature map

```text
Start screen
  ├─ Create project → title, capture mode, FPS, folder
  └─ Open project / recent projects → Capture workspace

Capture workspace
  ├─ Live preview + capture
  ├─ Timeline (thumbs, scrub, playback, onion skin)
  ├─ Side panels: Sequences, Project Settings, Export, Camera, Help
  └─ App menu: Project / Sequence / Frame / Playback / View

Export
  └─ Active / selected / all sequences → Project Exports or custom folder
```

## Core capabilities (summary)

- **Projects** — `project.json` plus `frames/` and `exports/` under a chosen root folder.
- **Capture** — JPEG source + preview, or PNG source + JPEG preview; FPS 1–60.
- **Sequences** — multiple sequences per project; active sequence drives capture and export.
- **Timeline** — scrub, multi-select, duplicate, delete, undo/redo for frame actions.
- **Camera** — USB webcams via native MF addon; capability-driven controls persisted in `cameraProfile`.
- **Export** — source frames with configurable name prefix; replace or create-new-folder conflict handling.

## Non-goals / not live

- DSLR tethering / RAW ingest
- Per-frame drawing or compositing tools
- Cloud sync or multi-user editing
- Full camera support on macOS / Linux (app may run; native capture is Windows-focused)

## Related docs

- [Architecture](ARCHITECTURE.md) — processes, IPC, camera
- [Development](DEVELOPMENT.md) — setup and scripts
- [Schema notes](SCHEMA_NOTES.md) — project file and disk layout
- [Conventions](CONVENTIONS.md) — coding rules
