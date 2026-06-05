# Brick-Motion versioning

Brick-Motion uses **two separate version numbers**. They must not be mixed up in UI, support tickets, or code.

## 1. Release version (primary — show users this)

| Source | `package.json` → `"version"` (semver) |
| Why | Tracks **shippable builds**: installers, bug reports, “which build do you have?” |
| Display | **Version 1.0.0** (prefix `Version` + full semver) |
| When to bump | [Semantic Versioning 2.0.0](https://semver.org/): |
| | **MAJOR** — breaking project format or breaking user workflow |
| | **MINOR** — new features, backward-compatible |
| | **PATCH** — bug fixes only |
| Current | **1.0.0** — first stable release |
| Examples | `0.1.0` → pre-stable beta; `1.0.0` → first stable release |

This is what Dragonframe-style tools put in **Help → About** and the window title (`Application 18.6.4`). It is the number users should quote in support.

## 2. Project file format version (data migration only)

| Source | `project.json` → `"appVersion"` (integer) |
| Why | Lets the app **read older projects** and migrate or reject safely |
| Display | Optional line in Help → About for power users |
| When to bump | When `project.json` schema changes incompatibly; implement migration in `validateProject.ts` |

Unrelated to release semver.

---

## Where each number appears in the app

| Surface | Release semver | Project file format |
|---------|----------------|---------------------|
| Boot splash | Yes (`Version x.y.z`) | No |
| Start screen footer | Yes | No |
| Window title | Yes (`Brick-Motion x.y.z`) | No |
| Help → About | Yes (primary) | Yes (secondary) |
| macOS **Brick-Motion → About** | Yes (Electron panel) | No |
| Dev / support logs | Yes | When validating projects |

---

## Maintenance checklist

1. Bump **`package.json` `version`** for every release users install.
2. Run **`npm run sync:app-version`** (or any script that runs it: `predev`, `prebuild`) so `public/app-version.json` matches for the boot splash.
3. Bump **`project.json` `appVersion`** only with schema migration code.

Canonical code: `src/shared/appInfo.ts`, `electron/main.ts` (`app:get-info`, `setAboutPanelOptions`).
