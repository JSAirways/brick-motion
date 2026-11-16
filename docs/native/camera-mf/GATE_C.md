# Gate C — generation 1 MJPEG acceptance

See [CAMERA_CAPTURE.md](./CAMERA_CAPTURE.md) for architecture.

Run with `npm run dev` after `npm run build:native:gyp-rebuild`. Watch stderr `[camera_mf]` lines.

- [ ] Open: `v1 open: … MJPEG (live preview + capture)`
- [ ] Live preview updates ≥ 5/s for 30 s
- [ ] 20 sequential captures at stream resolution
- [ ] No `preview reader` / `hi-res switch` / `using live frame` in logs
- [ ] Failed capture shows error, no new timeline frame
- [ ] Live preview OK within ~1 s after each capture
