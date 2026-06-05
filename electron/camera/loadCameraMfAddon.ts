import * as fs from "node:fs";
import * as path from "node:path";

export type SetControlsResult = {
  applied: string[];
  failed: Record<string, string>;
  ignoredUnknown: string[];
  unsupported: string[];
};

/** Media Foundation N-API addon — prefer *Async exports (sync calls block the Electron main thread). */
export interface CameraMfNative {
  listDevices(): unknown;
  listDevicesAsync(): Promise<Array<{ id: string; label: string }>>;
  startCaptureAsync(payload: {
    deviceId: string;
    livePreviewMaxLongEdge: number;
    capturePreviewMaxLongEdge: number;
  }): Promise<{
    width: number;
    height: number;
    subtypeFourcc: number;
    pixelArea: number;
  }>;
  stopCapture(): void;
  stopCaptureAsync(): Promise<void>;
  isCaptureOpen?(): boolean;
  getPreviewFrameGeneration?(): number;
  getRawFrameGeneration?(): number;
  getPreviewJpegAsync(): Promise<Buffer | null>;
  grabFrameAsync?(
    captureMode: string,
    capturePreviewMaxLongEdge?: number
  ): Promise<{
    preview: Buffer;
    source: Buffer;
    sourceIsPng: boolean;
    sourceWidth: number;
    sourceHeight: number;
  }>;
  getCapabilities(): Record<string, { min: number; max: number; step: number }>;
  getCapabilitiesAsync(): Promise<Record<string, { min: number; max: number; step: number }>>;
  getControls(): Record<string, number>;
  getControlsAsync(): Promise<Record<string, number>>;
  setControls(partial: Record<string, number>): SetControlsResult;
  setControlsAsync(partial: Record<string, number>): Promise<SetControlsResult>;
  subscribeDevicesChanged?(onTopologyChange: () => void, onDeviceInvalidated?: () => void): void;
  unsubscribeDevicesChanged?(): void;
}

let lastCameraMfLoadError: string | null = null;

export function getLastCameraMfLoadError(): string | null {
  return lastCameraMfLoadError;
}

export function loadCameraMfAddon(): CameraMfNative | null {
  lastCameraMfLoadError = null;
  const candidates = [
    path.join(__dirname, "..", "..", "..", "native", "camera-mf", "build", "Release", "camera_mf.node"),
    path.join(__dirname, "..", "..", "..", "native", "camera-mf", "build", "Debug", "camera_mf.node")
  ];
  if (process.resourcesPath) {
    candidates.unshift(
      path.join(process.resourcesPath, "native", "camera-mf", "build", "Release", "camera_mf.node"),
      path.join(process.resourcesPath, "native", "camera-mf", "build", "Debug", "camera_mf.node"),
      path.join(process.resourcesPath, "app.asar.unpacked", "native", "camera-mf", "build", "Release", "camera_mf.node"),
      path.join(process.resourcesPath, "app.asar.unpacked", "native", "camera-mf", "build", "Debug", "camera_mf.node")
    );
  }
  const tried: string[] = [];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      tried.push(`${candidate} (missing)`);
      continue;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires -- native .node load
      return require(candidate) as CameraMfNative;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      tried.push(`${candidate}: ${msg}`);
    }
  }
  lastCameraMfLoadError = tried.length > 0 ? tried.join("; ") : "No camera_mf.node candidates.";
  return null;
}
