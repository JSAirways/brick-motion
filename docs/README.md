# Brick-Motion documentation

Developer notes for the Brick-Motion stop-motion desktop app.

| Document | Description |
|----------|-------------|
| [Technical brief](TECHNICAL_BRIEF.md) | Purpose, feature map, non-goals |
| [Architecture](ARCHITECTURE.md) | Electron processes, IPC, camera pipeline, menus |
| [Development](DEVELOPMENT.md) | Setup, scripts, native builds, doc-update map |
| [Schema notes](SCHEMA_NOTES.md) | `project.json`, disk layout, versioning |
| [Conventions](CONVENTIONS.md) | Project-specific coding rules and gotchas |

Native camera deep-dives (optional):

| Document | Description |
|----------|-------------|
| [Camera capture](native/camera-mf/CAMERA_CAPTURE.md) | MJPEG capture architecture |
| [Gate A](native/camera-mf/GATE_A.md) / [B](native/camera-mf/GATE_B.md) / [C](native/camera-mf/GATE_C.md) | Hardware validation checklists |

Start with the **technical brief** for product context, then **architecture** for how the pieces fit. Use **development** for day-to-day setup and **conventions** when implementing features.

Also useful: [AGENTS.md](../AGENTS.md), [CONTRIBUTING.md](../CONTRIBUTING.md).

When behaviour, setup, or conventions change, update the matching doc if you can — see [Keeping docs in sync](DEVELOPMENT.md#keeping-docs-in-sync).
