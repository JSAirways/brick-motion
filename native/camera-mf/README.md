# camera-mf (Media Foundation)

Windows Media Foundation USB webcam backend for Brick-Motion.

## Build

```bash
npm run build:native
npm run rebuild:native
```

Output: `native/camera-mf/build/Release/camera_mf.node`

## Development

```bash
npm run build:native
npm run dev
```

Quit the app fully before rebuilding — Windows locks `camera_mf.node` while Electron is running.

## Requirements

- Windows
- Visual Studio Build Tools (C++ workload)
- Node.js native addon toolchain (`node-gyp`)
