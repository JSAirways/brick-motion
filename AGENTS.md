# Agents

Brick-Motion is a local-first Electron stop-motion app: capture frames from a USB camera, scrub a timeline, and export image sequences from a project folder on disk.

## Read order

1. [docs/TECHNICAL_BRIEF.md](docs/TECHNICAL_BRIEF.md) — product model and non-goals
2. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — renderer / preload / main, IPC, camera
3. [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — setup, scripts, native build notes
4. [docs/SCHEMA_NOTES.md](docs/SCHEMA_NOTES.md) — `project.json`, disk layout, versioning
5. [docs/CONVENTIONS.md](docs/CONVENTIONS.md) — project-specific coding rules

Prefer the repository tree and source for file lists. Docs are for invariants and gotchas.

## Things not to break

- **Process split:** renderer has no Node FS; only the preload `brickMotion` API crosses the boundary.
- **Security defaults:** keep `contextIsolation`, `nodeIntegration: false`, and prefer `sandbox: true`.
- **Path confinement:** use `resolveSafePathInsideProject` before reading/writing/deleting under a project.
- **Validation:** parse/validate `project.json` and create payloads in main before trusting them.
- **Templates vs runtime:** markup-only under `src/renderer/templates/`; IPC/listeners under `src/renderer/app/`.
- **Two versions:** `package.json` semver for releases; `project.json` `appVersion` for schema only — see [Schema notes](docs/SCHEMA_NOTES.md).
- **GitHub Releases:** ship Windows installers via Releases (not git). Always upload both `Brick-Motion-Setup-<version>.exe` and stable `Brick-Motion-Setup.exe` so `/releases/latest/download/Brick-Motion-Setup.exe` keeps working — see [Development — Packaging](docs/DEVELOPMENT.md#packaging-and-github-releases).
- **Docs** — if behaviour or setup changes, update the matching doc when you can ([Keeping docs in sync](docs/DEVELOPMENT.md#keeping-docs-in-sync)).

## Security reports

Prefer private reporting over public issues for exploitable bugs. See [SECURITY.md](SECURITY.md).
