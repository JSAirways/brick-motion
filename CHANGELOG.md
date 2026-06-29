# Changelog

All notable releases follow [Semantic Versioning](https://semver.org/). Version numbers in `package.json` track shippable builds (installers, support).

## [1.0.1] - 2026-06-29

Performance and compatibility release for live camera preview.

- MJPEG live preview pass-through: send native camera JPEG bytes directly instead of WIC decode/resize/re-encode
- Main-process preview IPC coalescing: only send frames when the native generation counter advances
- Renderer latest-frame sink: avoid decode backlog on slower machines
- Camera open resolution fallback: retry lower scored modes when the highest mode fails (built-in webcams)

## [1.0.0] - 2026-06-02

First stable release.

- Local-first stop-motion capture and timeline editing
- Media Foundation USB camera (MJPEG live + capture)
- Project folders with `project.json`, sequences, and export
- Windows NSIS installer (`npm run dist:win` → `release/Brick-Motion-Setup-1.0.0.exe`)
