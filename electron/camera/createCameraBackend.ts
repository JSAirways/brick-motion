import type { CameraBackend } from "./cameraBackend";
import { MediaFoundationBackend } from "./mediaFoundationBackend";

export type CameraBackendLabel = "media-foundation";

/** USB capture uses Media Foundation only (`native/camera-mf`). */
export function getActiveCameraBackendLabel(): CameraBackendLabel {
  return "media-foundation";
}

export function createCameraBackend(): CameraBackend {
  return new MediaFoundationBackend();
}
