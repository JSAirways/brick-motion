# Brick-Motion

Brick-Motion is a local-first desktop stop-motion app. Shoot frames from your camera, scrub through a timeline, and export image sequences — all stored in a project folder on disk. No accounts, no cloud.

Built with **Electron**, **TypeScript**, and **Bootstrap**.

**Website:** [jonan.space](https://jonan.space) · **Source:** [github.com/JSAirways/brick-motion](https://github.com/JSAirways/brick-motion)

## Download

Windows installer (always the latest GitHub Release):

**[Download Brick-Motion](https://github.com/JSAirways/brick-motion/releases/latest/download/Brick-Motion-Setup.exe)**

All releases: [github.com/JSAirways/brick-motion/releases](https://github.com/JSAirways/brick-motion/releases). How to publish a new build: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#packaging-and-github-releases).

## Documentation

Full product and developer docs live in [`docs/`](docs/README.md):

- [Technical brief](docs/TECHNICAL_BRIEF.md) — purpose, feature map, non-goals
- [Architecture](docs/ARCHITECTURE.md) — Electron processes, IPC, camera
- [Development](docs/DEVELOPMENT.md) — setup, scripts, native builds
- [Schema notes](docs/SCHEMA_NOTES.md) — `project.json`, disk layout, versioning
- [Conventions](docs/CONVENTIONS.md) — project coding rules

For AI agents: [AGENTS.md](AGENTS.md). For contributors: [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).

When behaviour or setup changes, it’s helpful to keep docs in sync — see [Keeping docs in sync](docs/DEVELOPMENT.md#keeping-docs-in-sync).

## Features

- Live camera preview and frame capture
- Scrubbable timeline with thumbnails and playback
- Onion skinning for alignment between frames
- Project-based workflow with sequences and export
- Windows USB camera support via a native Media Foundation module

## Requirements

- [Node.js](https://nodejs.org/) (LTS recommended)
- **Windows** for camera capture and building the Windows installer
- Visual Studio Build Tools (for compiling the native camera module)

## Getting started

```bash
npm install
npm run dev
```

This starts the Vite dev server and launches Electron. The renderer hot-reloads on save.

For camera capture on Windows:

```bash
npm run rebuild:native
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) and [native/camera-mf/README.md](native/camera-mf/README.md) for build requirements.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Run the app in development mode |
| `npm run build` | Build renderer and Electron main process |
| `npm start` | Run the production build locally |
| `npm run build:native` | Build the native camera module |
| `npm run rebuild:native` | Rebuild the native module for Electron |
| `npm run dist:win` | Build a Windows NSIS installer (`release/`) |

## Project layout

```
brick-motion/
├── electron/          # Main process, IPC, camera backends
├── src/renderer/      # UI (TypeScript + SCSS)
├── src/shared/        # Types and validation shared across processes
├── native/camera-mf/  # Windows Media Foundation camera addon
├── docs/              # Developer documentation
├── public/            # Static assets (icons, splash screens)
└── scripts/           # Build helpers
```

## Building for Windows

```bash
npm run rebuild:native
npm run build
npm run dist:win
```

The installer is written to `release/`. Publish it as a GitHub Release (versioned file **plus** stable `Brick-Motion-Setup.exe`) so the [latest download link](https://github.com/JSAirways/brick-motion/releases/latest/download/Brick-Motion-Setup.exe) keeps working — see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#packaging-and-github-releases).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, tests, and a few practical notes. For vulnerabilities, see [SECURITY.md](SECURITY.md).

## Author

**Jonan Steiner**

- Email: [jonan.steiner@gmail.com](mailto:jonan.steiner@gmail.com)
- Website: [jonan.space](https://jonan.space)

## License

MIT — see [LICENSE](LICENSE).
