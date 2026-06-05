import type { CaptureMode } from "../../src/shared/types/project";

export interface CameraDeviceInfo {
  id: string;
  label: string;
}

/**
 * Pluggable native camera pipeline (USB: Media Foundation via `native/camera-mf`).
 * Future: DSLR/tether backends implement the same surface.
 */
export interface CameraBackend {
  listDevices(): Promise<CameraDeviceInfo[]>;
  start(deviceId: string): Promise<void>;
  stop(): Promise<void>;
  getCapabilities(): Promise<Record<string, unknown>>;
  getControls(): Promise<Record<string, unknown>>;
  setControls(partial: Record<string, unknown>): Promise<void>;
  /** Latest MJPEG / JPEG preview for live UI (may be null between frames). */
  getPreviewJpeg(): Promise<Buffer | null>;
  /** Returns encoded preview + source stills, or null if not available. */
  grabFrame(captureMode: CaptureMode): Promise<{ preview: Buffer; source: Buffer; sourceIsPng: boolean } | null>;
  /** When implemented, invokes onChange on OS device arrival/removal (no polling). */
  watchDevices?(onTopologyChange: () => void, onDeviceInvalidated?: () => void): () => void;
  /** Whether native capture is still open (false after unplug / invalidate). */
  isCaptureOpen?(): Promise<boolean>;
  /** Increments when the native pipeline delivers a new preview frame. */
  getPreviewFrameGeneration?(): Promise<number>;
  /** Increments on every ingested device frame (may be faster than preview encode). */
  getRawFrameGeneration?(): Promise<number>;
}
