# Coding practices (Brick-Motion)

Conventions for changes in this repository. For architecture and product behavior, see [technical-brief.md](./technical-brief.md).

---

## Change scope

- **Solve the task at hand.** Avoid drive-by refactors, unrelated file edits, or scope creep in the same change.
- **Match the surrounding code:** naming, imports, formatting, and comment density should look like the rest of the file.
- **Prefer extending existing helpers** (e.g. `escapeHtml`, `parseAndValidateProject`, `resolveSafePathInsideProject`) over duplicating logic.

---

## TypeScript and shared code

- **`src/shared/`** holds types (`src/shared/types/project.ts`) and validation (`validateProject.ts`) consumed by **both** the Electron main bundle and the renderer (types only in the renderer where appropriate).
- Keep **`strict`** expectations: validate untrusted input at boundaries (IPC payloads, JSON from disk) before use.
- When adding fields to **`ProjectFile`**, update **`validateProject.ts`**, **`global.d.ts`** / preload typings if needed, and **[technical-brief.md](./technical-brief.md)** schema section.

---

## Electron main process

- **All filesystem and dialog operations** stay in main; never assume Node APIs in the renderer.
- **Resolve paths** that come from the renderer with **`resolveSafePathInsideProject`** (or equivalent checks) before `readFile`, `unlink`, or `copyFile`.
- **Throw meaningful `Error` messages** from IPC handlers so the renderer can show them via `reportError` / status UI.
- **Atomic writes** for user-visible files: write temp → rename (existing patterns in `main.ts`).

---

## Preload

- Expose a **small, named API** on `window.brickMotion` — no generic `invoke(channel, …)` from the renderer.
- Use **`import type`** from shared types so runtime output stays free of unused shared imports where possible.
- For one-way UI command channels (for example app menu -> renderer), prefer a **typed subscribe API** over ad hoc channel strings in renderer code.

---

## Renderer

- **Templates:** Any string interpolated into HTML that includes user content, file paths, or device metadata must use **`escapeHtml`** (or safe DOM APIs that do not interpret HTML).
- **User-visible failures:** Use **`reportError`** / **`reportInfo`** after **`setUserNotifier`** is wired in the workspace; avoid silent failures for IPC operations users trigger.
- **Separation:** **`src/renderer/templates/`** modules return markup strings only — they must not call IPC or import **`App.ts`**. Route-specific runtime code lives under **`src/renderer/app/<route>/`** (e.g. **`src/renderer/app/capture-workspace/`** for the capture workspace). **`App.ts`** owns top-level route state and composition, while helpers under **`src/renderer/app/`** (for example `menuDispatch.ts`, `routeRender.ts`, `projectImages.ts`) should hold reusable orchestration pieces as they grow.
- **Promises:** Avoid unhandled rejections; if an inner helper already reports an error, add `.catch(() => {})` on fire-and-forget chains where appropriate.

---

## Markup and styling

Stack: **Bootstrap 5** (Sass entry + utilities), **Bootstrap Icons** (`bi` classes), and a thin layer of **custom SCSS** in `src/renderer/styles/main.scss`.

### Prefer Bootstrap utilities in templates

- Build layout and spacing with **utility classes** in the HTML strings returned from feature modules and from `App.ts` / `cameraControls.ts`: e.g. `container-fluid`, `d-flex`, `gap-2`, `align-items-center`, `text-secondary`, `mb-0`, `rounded-2`, `position-relative`, `overflow-hidden`, tab/nav classes, form controls (`form-control`, `form-range`, `form-label`), and button variants (`btn`, `btn-primary`, `btn-outline-primary`, `btn-outline-secondary`).
- Use Bootstrap’s **grid** (`row`, `col-*`, `g-*`) for responsive structure instead of ad hoc flex CSS.
- Prefer **semantic elements** where they match the UI: `main`, `header`, `section`, `nav` (if needed), and always use **`type="button"`** on buttons that are not form submits to avoid accidental form submission.
- **Icons:** use **`bi bi-*`** with spacing utilities (`me-1`, `me-2`) for consistent alignment with text.

### Keep custom CSS minimal and purposeful

- **Default:** if something can be done with utilities or existing Bootstrap components, do it there first.
- **Add SCSS** when you need something utilities do not cover well:
  - **App-specific layout shells** that repeat across screens (e.g. full-height workspace columns, live preview region, timeline strip) — the project uses the **`bm-`** prefix for these (`bm-workspace`, `bm-main-area`, `bm-timeline`, …).
  - **Non-trivial motion** (transitions, overlay z-index stacking) or **geometry** that would clutter templates with dozens of utility classes.
  - **Theme tokens** that should stay centralized: the file sets Sass variables (`$body-bg`, `$primary`, …) **before** `@import "bootstrap/scss/bootstrap"` so Bootstrap’s generated CSS participates in one coherent theme.
- **Avoid** large bespoke component style sheets per feature unless the UI clearly diverges from Bootstrap; that keeps bundle and mental overhead small.
- **Scoped “one-off” visuals** can use a small **`bm-*`** block next to related rules rather than global tag selectors.

### Dynamic or exceptional styling

- Prefer **CSS custom properties** for values that are set once from TS (e.g. a background image URL on the start screen via `--bm-start-bg-image`) over long inline `style="..."` strings unless a single property is truly ephemeral.
- For generated strings (camera controls, timeline thumbs), keep **classes in templates**; use inline styles only when the value is numeric and dynamic in a way utilities don’t express cleanly.
- For **branding assets** (favicon/window icon/splash logo), keep a single source file under `public/assets/` and reference it from both Electron (`main.ts`) and renderer shell (`index.html`) instead of duplicating logos in multiple locations.
- The renderer HTML uses a strict CSP (`script-src 'self'`): put startup logic in external files (for example `public/boot-splash.js`) instead of inline `<script>` blocks.

### Icons and accessibility

- Pair icons with **visible text** or **`title` / `aria-label`** where the control would otherwise be icon-only, so behavior stays clear and screen readers have a name.
- Use the app’s custom **`bm-sidepanel`** drawer pattern for workspace right-side panels; keep open/close wiring via explicit `data-action` hooks and `aria-controls` / `aria-hidden` state.

### UI specification (enforced baseline)

- Treat `src/renderer/styles/main.scss` as the source of truth for UI tokens and global interaction behavior.
- Reuse the shared typography classes where applicable:
  - `bm-panel-title`, `bm-workspace-title`, `bm-section-title`, `bm-panel-subtitle`.
- Reuse `bm-search-group` for search-style input groups (start screen, sequence manager, future searchable panels) to keep size/focus/contrast consistent.
- Prefer existing button variants and control primitives before adding new custom classes:
  - `btn-primary`, `btn-outline-primary`, `btn-outline-secondary`, `bm-icon-control`.
- Keep responsive behavior aligned with existing breakpoints in `main.scss` (`1199.98px`, `991.98px`, `767.98px`, `575.98px`):
  - adjust shared primitives first (toolbar, timeline cell widths, panel widths) rather than introducing per-screen one-offs.

### Files to touch

- **Markup:** `src/renderer/templates/**/*.ts`, `src/renderer/app/App.ts`, `src/renderer/app/routeRender.ts`, `src/renderer/app/cameraControls.ts`.
- **Global styles:** `src/renderer/styles/main.scss` (import order: variables → `@import bootstrap` → app `bm-*` rules).

---

## Security mindset

- Treat **`project.json` and IPC payloads** as untrusted until validated.
- Do not weaken **`contextIsolation`**, **`nodeIntegration: false`**, or the preload boundary without a documented reason and security review.
- **`sandbox: true`** is preferred; if a future Electron upgrade breaks preload behavior, fix compatibility before turning sandbox off.

---

## Documentation

- Update **[technical-brief.md](./technical-brief.md)** when behavior, schema, or security posture changes in a user-visible way.
- Keep this file in sync when you add **new cross-cutting conventions** (e.g. testing, lint rules).

---

## Tests and tooling

- There is no mandatory test suite in the repo yet; **`npm run build`** is the baseline check before merging substantive changes. Add tests when you introduce non-trivial logic that is easy to unit-test in isolation.
