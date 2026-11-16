# Gate B — Camera lifecycle and hotplug soak

Run after [Gate A](./GATE_A.md) passes. Confirms the app releases the device and hotplug stays reliable beyond the single-session Gate A spot checks.

## Setup

Same as Gate A: `npm run build:native`, quit the app, `npm run dev`.

## Checklist


| #   | Test                                                                                                                                                         | Pass? |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| 1   | **Quit release** — Live preview, then normal quit. Webcam available in Camera app / another app within ~5s. No `stopCaptureAsync timed out` storm in stderr. | yes   |
| 2   | **Window close** — Close the workspace window (if applicable) or back to start; device released before opening another app.                                  | yes   |
| 3   | **Hotplug ×3** — Unplug → disconnected UI; replug → auto preview without Refresh. Repeat 3 cycles.                                                           | yes   |
| 4   | **Hotplug during capture** — Unplug while on live playhead after at least one captured frame; replug; capture another frame successfully.                    | yes   |
| 5   | **Second device** (optional) — If available: switch via dropdown or hotplug; preview and one grab work.                                                      | yes   |


## Success signals

- Terminal on startup: `[camera] active backend: media-foundation`
- Unplug: UI shows disconnected message; preview clears
- Replug: “Camera detected — starting preview…” then live image (no manual Refresh)
- Quit: no hang on exit; no orphaned camera LED / busy device

## Gate result

**Passed** — rows 1–5 verified (quit release, navigation back, hotplug ×3+, capture after replug, device dropdown repopulates on workspace bind).

## On failure (historical)

- **Fail:** Note row, UI text, and `[camera_mf]` / `[camera]` stderr.

**Next:** MF camera makeover complete for core phases; optional follow-ups in plan (`renderer-polish` done). Further work: export/sequence features per product roadmap.
