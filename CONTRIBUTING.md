# Contributing

Helpful changes are welcome. This is a personal open-source / hobby project — keep changes focused.

## Setup

See the root [README.md](README.md) quick start and [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for scripts, native builds, and packaging notes.

```bash
npm install
npm run dev
```

Camera capture on Windows also needs the native module — see [native/camera-mf/README.md](native/camera-mf/README.md).

## Checks

```bash
npm run build
```

There is no mandatory automated test suite yet; a clean `npm run build` is the baseline before opening a PR.

## Documentation

If a change affects behaviour, setup, schema, or conventions, update the matching doc in the same commit when you can. See [Keeping docs in sync](docs/DEVELOPMENT.md#keeping-docs-in-sync).

Useful entry points: [AGENTS.md](AGENTS.md), [docs/README.md](docs/README.md).

## Pull requests

- Keep changes focused; follow the patterns in [docs/CONVENTIONS.md](docs/CONVENTIONS.md).
- Don’t commit secrets, build artifacts (`dist-*`, `release/`, `native/camera-mf/build/`), or personal paths.
- Clear commit messages that explain *why* help a lot.
- Link related issues when you have them (`Fixes #123`).

## Security

For vulnerabilities, see [SECURITY.md](SECURITY.md) — private reporting is preferred over public issues.

## Repo settings

After Dependabot config is on `main`, double-check Dependabot alerts/security updates, secret scanning, push protection, and private vulnerability reporting in the repository settings (checklist in SECURITY.md).
