# Schema notes

On-disk project format for developers. Prefer `src/shared/types/project.ts` and `src/shared/validateProject.ts` as the source of truth.

## Two version numbers

Don’t mix these up in UI or code.

| Kind | Source | Role |
|------|--------|------|
| **Release** (show users) | `package.json` `"version"` (semver) | Installers, About, splash, window title — e.g. **Version 1.0.1** |
| **Project format** | `project.json` → `appVersion` (integer) | Schema migrations / reject older incompatible files |

Bump release semver for shippable builds, update [CHANGELOG.md](../CHANGELOG.md), then publish a GitHub Release with the Windows installer (see [Development — Packaging](DEVELOPMENT.md#packaging-and-github-releases)). Bump `appVersion` only with migration code in `validateProject.ts`. Sync splash JSON via `npm run sync:app-version` (also `predev` / `prebuild`).

Canonical helpers: `src/shared/appInfo.ts`, Electron About panel options in `electron/main.ts`.

## `project.json` (shape)

```json
{
  "appVersion": 1,
  "projectTitle": "Sample",
  "captureMode": "jpeg_only",
  "fps": 12,
  "sourcePath": "C:/Projects/Sample",
  "frameIdOrder": [],
  "sequenceOrder": ["sequence_1"],
  "sequencesById": {
    "sequence_1": {
      "id": "sequence_1",
      "title": "Sequence 1",
      "frameIdOrder": [],
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  },
  "activeSequenceId": "sequence_1",
  "framesById": {},
  "cameraProfile": {
    "backend": "usb_webcam",
    "deviceId": null,
    "zoomSliderMax": null,
    "supportedControls": {},
    "values": {}
  },
  "uiState": {
    "onionEnabled": false,
    "onionOpacity": 0.45,
    "loopEnabled": false,
    "timelinePosition": "live",
    "playbackTimingMode": "hold_after_decode",
    "showPlaybackFpsOverlay": false
  },
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

Notes:

- `sourcePath` is the current project root; relocating a project moves the folder and rewrites this field.
- Legacy single-sequence files (without the sequences model) are not supported.
- Each frame needs preview, source, and `timelineThumbPath` on disk; open-path reconciliation can recreate missing thumbs from the preview JPEG.

### Frame / sequence fields (high level)

- Frames: `previewPath`, `sourcePath`, `timelineThumbPath`, `createdAt`, timeline order via sequence `frameIdOrder`.
- Sequences: stable `id`, `title`, `frameIdOrder`, timestamps.
- `cameraProfile`: selected device, zoom cap, capability snapshot, persisted control values.

## Project directory layout

```text
project-root/
  project.json
  frames/
    preview-jpeg/
    timeline-thumb/
    source-jpeg/
    source-png/
  exports/
  cache/thumbs/
```

Capture filenames look like `frame_<six-digit>_<frameId>.<ext>`. Export copies use `<prefix><six-digit>.<ext>` (default prefix `frame_`).

## Integrity habits

- Atomic writes: temp file → rename (frames and `project.json`).
- Autosave is immediate after capture/delete/settings/camera changes (no debounce on save itself; camera sliders debounce ~450 ms before save).
- Path operations from the renderer must stay inside the project root (`resolveSafePathInsideProject`).

## Related docs

- [Technical brief](TECHNICAL_BRIEF.md)
- [Architecture](ARCHITECTURE.md)
- [Development](DEVELOPMENT.md)
- [Conventions](CONVENTIONS.md)
