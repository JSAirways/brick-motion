# Contributing to Brick-Motion

Thank you for your interest in Brick-Motion. This is a personal open-source project; contributions are welcome via issues and pull requests.

## Before you start

- Search [existing issues](https://github.com/JSAirways/brick-motion/issues) to avoid duplicates.
- Brick-Motion targets **Windows** for camera capture and installer builds. Other platforms may not be fully supported.
- Keep changes focused — solve one problem per pull request.

## Development setup

```bash
git clone https://github.com/JSAirways/brick-motion.git
cd brick-motion
npm install
npm run dev
```

For the native camera module on Windows:

```bash
npm run build:native
```

See [native/camera-mf/README.md](native/camera-mf/README.md) for build requirements.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Make your changes and verify the app still builds:
   ```bash
   npm run build
   ```
3. Open a pull request with a clear description of what changed and why.
4. Link any related issue (`Fixes #123`).

## Reporting bugs

Use the [bug report template](https://github.com/JSAirways/brick-motion/issues/new?template=bug_report.md) and include:

- Brick-Motion version (Help → About)
- Windows version
- Steps to reproduce
- Expected vs actual behavior
- Relevant logs or screenshots

## Feature requests

Use the [feature request template](https://github.com/JSAirways/brick-motion/issues/new?template=feature_request.md). Describe the use case, not just the solution.

## Code style

- Match the surrounding TypeScript, SCSS, and C++ conventions.
- Validate untrusted input at IPC and filesystem boundaries.
- Keep filesystem and dialog operations in the Electron main process.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
