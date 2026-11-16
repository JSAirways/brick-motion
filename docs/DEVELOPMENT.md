# Development

## Stack

- Electron + TypeScript
- Vite (renderer), Bootstrap 5 + Bootstrap Icons, custom `bm-*` SCSS
- Native camera addon: node-gyp / N-API Media Foundation (`native/camera-mf`) — Windows

## First-time setup

```bash
npm install
npm run dev
```

`npm run dev` starts Vite and Electron together. The renderer hot-reloads on save.

For camera capture on Windows, also build the native module:

```bash
npm run rebuild:native
# or, for a plain/local build:
npm run build:native
```

Needs **Python**, **Visual Studio Build Tools** (C++), and a **Windows SDK**. Without a built addon the app still runs but lists no cameras.

## Scripts

| Command | What it does |
|---------|----------------|
| `npm run dev` | Vite + Electron (syncs app version first via `predev`) |
| `npm run build` | Renderer + Electron main (`prebuild` syncs version) |
| `npm start` | Run Electron against a production build |
| `npm run build:native` | Clean + build MF addon (`scripts/native-build.cjs`) |
| `npm run build:native:incremental` | Compile without deleting `build/` first |
| `npm run rebuild:native` | Rebuild addon for Electron’s Node ABI |
| `npm run dist:win` | Rebuild native + build + NSIS installer under `release/` |

Release version lives in `package.json` `"version"`. `npm run sync:app-version` writes `public/app-version.json` for the boot splash (also run by `predev` / `prebuild`).

## Native build gotchas

- Prefer **node-gyp ^12** (pinned in the repo) so Visual Studio 2025+ (installer major 18) is recognized.
- `EPERM` while removing `native/camera-mf/build` usually means Electron/dev, OneDrive, or antivirus is locking files — quit the app and retry, or use `build:native:incremental`.
- Vite cache lives under `%TEMP%\brick-motion-vite` (`vite.config.mts`) to avoid `EPERM` under `node_modules/.vite`.

## Packaging and GitHub Releases

`npm run dist:win` uses electron-builder. Local unsigned builds set `CSC_IDENTITY_AUTO_DISCOVERY=false`. The MF `.node` binary is bundled as an extra resource under `resources/native/camera-mf/build/Release/`.

Installers belong in **GitHub Releases**, not in git (`release/` is gitignored).

### Publish a Windows release

1. Bump `package.json` `"version"` and update [CHANGELOG.md](../CHANGELOG.md).
2. Commit the release (and sync splash JSON via `prebuild` / `sync:app-version`).
3. Build the installer: `npm run dist:win` → `release/Brick-Motion-Setup-<version>.exe`.
4. Create a GitHub release tagged `v<version>` (point `--target` at the release commit):

```bash
# Copy a stable alias so website links need not change per version
copy release\Brick-Motion-Setup-<version>.exe release\Brick-Motion-Setup.exe

gh release create v<version> --target <release-commit-sha> --title "Brick-Motion <version>" --notes-file - ^
  release\Brick-Motion-Setup-<version>.exe ^
  release\Brick-Motion-Setup.exe
```

Upload **both** assets every time:

| Asset | Purpose |
|-------|---------|
| `Brick-Motion-Setup-<version>.exe` | Versioned installer |
| `Brick-Motion-Setup.exe` | Stable name for “always latest” links |

### Website download URL

Use this on [jonan.space](https://jonan.space) (or anywhere) so visitors always get the newest published installer:

https://github.com/JSAirways/brick-motion/releases/latest/download/Brick-Motion-Setup.exe

Release page: https://github.com/JSAirways/brick-motion/releases

## Tests

There is no mandatory automated suite yet. Baseline check before merging substantive changes:

```bash
npm run build
```

Add focused unit tests when you introduce logic that is easy to test in isolation.

## Keeping docs in sync

If a change affects behaviour, setup, or conventions, update the matching doc in the same commit when you can.

| You changed… | Update… |
|--------------|---------|
| Product behaviour, feature map, non-goals | [TECHNICAL_BRIEF.md](TECHNICAL_BRIEF.md) |
| Processes, IPC, camera pipeline, menus | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Setup, scripts, native build, release publish steps | [DEVELOPMENT.md](DEVELOPMENT.md) |
| `project.json` fields, disk layout, versioning | [SCHEMA_NOTES.md](SCHEMA_NOTES.md) |
| Coding patterns or project rules | [CONVENTIONS.md](CONVENTIONS.md) |
| High-level overview, download links, or quick start | Root [README.md](../README.md) |
| User-facing release notes | [CHANGELOG.md](../CHANGELOG.md) |
| Agent/contributor entrypoints | [AGENTS.md](../AGENTS.md), [CONTRIBUTING.md](../CONTRIBUTING.md) |
| New doc file or index entry | [docs/README.md](README.md) |

Skip doc updates for changes that don’t affect behaviour or setup. Don’t put secrets or personal machine paths in docs.

## Related docs

- [Technical brief](TECHNICAL_BRIEF.md)
- [Architecture](ARCHITECTURE.md)
- [Schema notes](SCHEMA_NOTES.md)
- [Conventions](CONVENTIONS.md)
- Root [README](../README.md)
