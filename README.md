# Brick-Motion

Brick-Motion is a local-first desktop stop-motion capture app. Shoot frames from your camera, scrub through a timeline, and export image sequences — all stored in a project folder on disk. No accounts, no cloud.

Built with **Electron**, **TypeScript**, and **Bootstrap**.

**Website:** [jonan.space](https://jonan.space) · **Source:** [github.com/JSAirways/brick-motion](https://github.com/JSAirways/brick-motion)

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
├── public/            # Static assets (icons, splash screens)
└── scripts/           # Build helpers
```

## Building for Windows

```bash
npm run rebuild:native
npm run build
npm run dist:win
```

The installer is written to `release/`. Pre-built Windows installers are published on [GitHub Releases](https://github.com/JSAirways/brick-motion/releases) when available.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports and feature requests: [open an issue](https://github.com/JSAirways/brick-motion/issues).

## License

MIT — see [LICENSE](LICENSE).

## Author

**Jonan Steiner** — [jonan.space](https://jonan.space) · [jonan.steiner@gmail.com](mailto:jonan.steiner@gmail.com)
