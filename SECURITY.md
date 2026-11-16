# Security

## Supported versions

Fixes land on the latest commit on `main`.

## Reporting a vulnerability

Please use **GitHub Private Vulnerability Reporting** for this repository (Security tab → Report a vulnerability).

Prefer not to open a public GitHub issue for exploitable bugs, and please don’t post proof-of-concept exploits publicly before a fix is available.

Reports are appreciated — I’ll follow up as soon as I’m able. Include enough detail to reproduce the issue (affected paths, OS/build, and expected vs actual behaviour).

## Scope

**In scope**

- Renderer isolation (`contextIsolation`, no Node in the renderer, preload boundary)
- Path confinement for project-relative file operations
- Validation of `project.json` and IPC payloads
- XSS risks from unsanitized project/device strings in the UI
- Accidental exposure of secrets or credentials in the repository

**Out of scope**

- Denial of service / resource exhaustion without a clear security boundary bypass
- Issues that require local filesystem access outside the app’s project APIs (the app is local-first by design)
- Feature requests or ordinary bugs (normal issues/PRs are fine for those)

## Repo settings checklist

Handy checklist for GitHub → Settings → Code security and analysis:

- [ ] Private vulnerability reporting enabled
- [ ] Secret scanning enabled
- [ ] Push protection for secrets enabled
- [ ] Dependabot alerts and Dependabot security updates enabled
