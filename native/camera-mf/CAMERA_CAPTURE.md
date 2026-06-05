# Camera capture architecture (generation 1 — MJPEG)

## Single MJPEG stream

One negotiated **largest usable mode** is used for the entire session (prefer MJPEG, fallback to RGB32 conversion when needed). Live preview and shutter capture read the same `latest_sample_bytes_` cache. There is **no** separate preview reader and no mid-session format switching.

### Data flow

1. **Open** — enumerate presentation modes, pick highest pixel-area **MJPEG** only; fail if none. Apply to presentation + `IMFSourceReader` with `MF_SOURCE_READER_ENABLE_VIDEO_PROCESSING` = FALSE.
2. **Pump** — async `ReadSample` → `IngestSample` (full JPEG buffer on camera thread).
3. **Preview** — each new MJPEG sample triggers `SchedulePreviewEncodeFromCache` (no fps cap; worker coalesces to latest frame). `DownscaleJpegMaxLongEdge` to live preview cap.
4. **Grab** — `CopyLatestSampleBytes` from cache; validate dimensions match `stream_profile_`; encode preview (capped) + source (native MJPEG).

### Outputs

| Output | Resolution |
|--------|------------|
| Live `camera:preview` | 960 px long edge (`LIVE_PREVIEW_MAX_LONG_EDGE_PX`) |
| Disk capture preview | 960 px long edge (`CAPTURE_PREVIEW_MAX_LONG_EDGE_PX`) |
| Disk capture source | Native MJPEG stream size (no cap) |
| Timeline thumb | Derived from capture preview in Electron |

### Addon contract

- `startCaptureAsync` resolves `{ width, height, subtypeFourcc, pixelArea }`.
- `grabFrameAsync` rejects on failure with `LastError()` (e.g. `stream_not_ready`, `capture_resolution_mismatch`).
- Success includes `sourceWidth` / `sourceHeight` for Electron dimension checks.

## Manual acceptance (target webcam)

| Check | Pass |
|-------|------|
| Open log | `v1 open: … MJPEG (live preview + capture)` |
| Live preview | `preview_frame_generation` ≥ 5/s for 30 s |
| 20 captures | Each success logs `GrabStill: MJPEG …`; dimensions match open profile |
| Failed grab | UI error; no timeline / disk write |
| Source files | On-disk dimensions match open profile |

## Future (not v1)

Higher-resolution still capture (e.g. max-area YUY2) would need a new negotiation path and is intentionally out of scope for v1.
