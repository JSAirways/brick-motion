# camera-mf (Media Foundation)

Media Foundation USB webcam backend for Brick Motion (sole USB capture stack).

## Status

- MF device enumeration (`listDevices`) via symbolic link
- Format negotiation: largest MJPEG mode only (single stream for live + capture); see [CAMERA_CAPTURE.md](./CAMERA_CAPTURE.md)
- `startCaptureAsync` with open deadline and first-preview readiness
- `getPreviewJpegAsync` / `grabFrameAsync` with WIC JPEG/PNG encode
- Manual controls (`getCapabilities`, `getControls`, `setControls`) via IAMVideoProcAmp / IAMCameraControl
- Dedicated STA camera thread + synchronous `RunOnCameraThread`
- Hotplug: `CM_Register_Notification` on video capture interface → `subscribeDevicesChanged`
- `napi_add_env_cleanup_hook` → hotplug teardown + `ShutdownMfCamera()`

## Try in the app (dev)

```bash
npm run build:native
npm run dev
```

Validation: [GATE_A.md](./GATE_A.md) (hardware smoke), then [GATE_B.md](./GATE_B.md) (lifecycle soak).

## Build

```bash
npm run build:native
npm run rebuild:native
```

Output: `native/camera-mf/build/Release/camera_mf.node`
