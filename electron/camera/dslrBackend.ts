import type { CaptureMode } from "../../src/shared/types/project";
import type { CameraBackend, CameraDeviceInfo } from "./cameraBackend";

/**
 * Placeholder backend for future tethered DSLR / remote capture.
 * Keeps the app runnable when `cameraProfile.backend` is `dslr`.
 */
export class DslrBackend implements CameraBackend {
  async listDevices(): Promise<CameraDeviceInfo[]> {
    return [];
  }

  async start(_deviceId: string): Promise<void> {
    /* no-op until a tether implementation exists */
  }

  async stop(): Promise<void> {
    /* no-op */
  }

  async getCapabilities(): Promise<Record<string, unknown>> {
    return {};
  }

  async getControls(): Promise<Record<string, unknown>> {
    return {};
  }

  async setControls(_partial: Record<string, unknown>): Promise<void> {
    /* no-op */
  }

  async getPreviewJpeg(): Promise<Buffer | null> {
    return null;
  }

  async grabFrame(_captureMode: CaptureMode): Promise<{
    preview: Buffer;
    source: Buffer;
    sourceIsPng: boolean;
  } | null> {
    return null;
  }
}
