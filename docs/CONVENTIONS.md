# Conventions

Project-specific habits for Brick-Motion. Prefer the repo tree and code for file lists; use this doc for gotchas. Product behaviour: [Technical brief](TECHNICAL_BRIEF.md). System model: [Architecture](ARCHITECTURE.md).

## Change scope

- Solve the task at hand — avoid drive-by refactors in the same change.
- Match surrounding naming, imports, and comment density.
- Prefer existing helpers (`escapeHtml`, `parseAndValidateProject`, `resolveSafePathInsideProject`) over duplicating logic.

## TypeScript and shared code

- Shared types/validation live in `src/shared/` and are used by main (and types by the renderer).
- Validate untrusted input at boundaries (IPC payloads, JSON from disk).
- New `ProjectFile` fields need updates in `validateProject.ts`, preload/renderer typings if needed, and [SCHEMA_NOTES.md](SCHEMA_NOTES.md).

## Electron main and preload

- Filesystem and dialogs stay in main — never assume Node APIs in the renderer.
- Resolve renderer-supplied paths with `resolveSafePathInsideProject` before FS ops.
- Throw clear `Error` messages from IPC so the UI can surface them.
- Atomic writes for user-visible files (temp → rename).
- Preload: small named `window.brickMotion` API only; prefer typed subscribe helpers for menu/UI commands.

## Renderer

- `src/renderer/templates/` returns markup strings only — no IPC, no imports from `App.ts`.
- Route runtime lives under `src/renderer/app/<route>/` (e.g. `capture-workspace/`).
- Escape user/device content in HTML (`escapeHtml` or safe DOM APIs).
- User-visible failures go through `reportError` / `reportInfo` after the workspace notifier is wired.
- Avoid unhandled promise rejections on fire-and-forget chains.

## Markup and styling

Stack: Bootstrap 5 utilities + Bootstrap Icons + thin `bm-*` SCSS in `src/renderer/styles/main.scss`.

- Prefer utilities and existing button/typography classes before new CSS.
- Add SCSS for repeating shells, non-trivial motion/geometry, or shared tokens — prefix with `bm-`.
- Keep one brand asset under `public/assets/` (favicon / window icon / splash).
- Renderer CSP is strict (`script-src 'self'`) — no inline startup scripts; use files like `public/boot-splash.js`.
- Pair icon-only controls with visible text or `aria-label` / `title`.

## Secrets and docs

- Don’t commit secrets, credentials, or personal machine paths.
- When behaviour, setup, or conventions change, update the matching doc when you can — see [Keeping docs in sync](DEVELOPMENT.md#keeping-docs-in-sync).

## Related docs

- [Technical brief](TECHNICAL_BRIEF.md)
- [Architecture](ARCHITECTURE.md)
- [Development](DEVELOPMENT.md)
- [Schema notes](SCHEMA_NOTES.md)
