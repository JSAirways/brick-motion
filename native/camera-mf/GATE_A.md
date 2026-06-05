# Gate A — Media Foundation camera validation

Validate the **sole USB capture stack** (`native/camera-mf`) on real hardware before frame-pipeline work, renderer polish, or other plan phases.

DirectShow has been removed; there is no alternate backend to fall back to in dev.

## Setup

```powershell
npm run build:native
```

Quit Brick Motion completely (unlocks `camera_mf.node` on Windows), then:

```powershell
npm run dev
```

Confirm:

- Terminal: `[camera] active backend: media-foundation`
- UI errors mention `[media-foundation]` (not `[directshow]`)

## Checklist


| #   | Test                                                                                                                                                                                   | Pass? |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| 1   | **List** — Camera appears in the device dropdown (plugged in before open). Use **Refresh cameras** if the project was saved with an old device id.                                     | yes   |
| 2   | **Open** — `camera:open` completes within ~18s (renderer timeout). No `Camera start timed out after 18000 ms`.                                                                         | yes   |
| 3   | **Preview start** — Live preview image within ~8s (`previewStartWatchdogMs`). Terminal shows `format ok: stream=0x0 …` and `Open: ready`; no repeated `getPreviewJpegAsync timed out`. | yes   |
| 4   | **Preview steady** — Live JPEG updates smoothly for 2+ minutes.                                                                                                                        | yes   |
| 5   | **Grab** — Capture one frame; `frames/preview-jpeg`, source (`source-jpeg` or `source-png`), and `frames/timeline-thumb` written.                                                      | yes   |
| 6   | **Controls** — Camera controls panel loads; sliders apply without error (unsupported keys may be ignored on some drivers).                                                             | yes   |
| 7   | **Close** — Leave workspace / close project; no hang.                                                                                                                                  | yes   |
| 8   | **Open/close loop** — Repeat open → preview → close 10× without hang or “device busy”.                                                                                                 | yes   |
| 9   | **Quit release** — Normal app quit; webcam available in another app within a few seconds.                                                                                              | yes   |
| 10  | **Hotplug** — Unplug while live → disconnected message; replug → auto-reconnect (Refresh still works as fallback).                                                                     | yes   |


## Gate result

**Passed** on primary webcam (Logitech C920-class, USB). All rows 1–10 verified.

## Success signals (stderr)

After a healthy open you should see lines like:

```text
[camera_mf] Open: creating device source…
[camera_mf] Open: creating source reader…
[camera_mf] Open: negotiating format…
[camera_mf] format ok: stream=0x0 <width>x<height> subtype=…
[camera_mf] Open: ready (preview via pump)
```

`Open: already active` on a retry is OK. Repeated `getPreviewJpegAsync timed out` or `stopCaptureAsync timed out` means preview/stop is still wedging the camera thread — treat as fail for rows 3–4.

## On failure

- Read the full UI message after `[media-foundation]`.
- Check main process stderr for `[camera]` / `[camera_mf]` lines.


| Symptom                                                                   | Likely cause                                                                                               |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `format_negotiation_failed: no suitable mode`                             | Wrong stream or unsupported pixel format; try **Refresh cameras**, another USB port, or note camera model. |
| `MFCreateDeviceSource failed: 0x…`                                        | Stale `deviceId`, device in use, or driver issue.                                                          |
| `Camera start timed out after 18000 ms` but `Open: ready` in stderr       | IPC/preview path stuck (camera thread blocked); rebuild native and restart app.                            |
| `getPreviewJpegAsync timed out`                                           | Async preview read not delivering frames (check pump / MJPEG downscale).                                   |
| `stopCaptureAsync timed out`                                              | Stop blocked behind a stuck read; quit app fully and retry.                                                |
| Whole UI freezes                                                          | Rebuild `camera_mf`; ensure you are not calling sync native APIs on the main thread (use current addon).   |
| App exits with code `3221226505` (`0xC0000409`) right after `Open: ready` | Native crash (often COM apartment); rebuild after `camera-mf` fix; full quit before retry.                 |


Note device label, USB port (built-in vs hub), and whether a full quit + rebuild was done before the run.

## On failure (historical)

- **Fail:** Record failing row + UI text + `[camera_mf]` stderr; fix MF native/main/renderer camera path only.

**Next:** [GATE_B.md](./GATE_B.md) (lifecycle soak), then frame pipeline (plan Phase 3).