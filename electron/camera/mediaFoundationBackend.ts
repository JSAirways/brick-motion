import type { CaptureMode } from "../../src/shared/types/project";
import {
  CAPTURE_PREVIEW_MAX_LONG_EDGE_PX,
  LIVE_PREVIEW_MAX_LONG_EDGE_PX
} from "../../src/shared/previewJpeg";
import type { CameraBackend, CameraDeviceInfo } from "./cameraBackend";
import { getLastCameraMfLoadError, loadCameraMfAddon, type SetControlsResult } from "./loadCameraMfAddon";

export type MfCaptureProfile = {
  width: number;
  height: number;
  subtypeFourcc: number;
  pixelArea: number;
};

/** Media Foundation USB webcam backend (`native/camera-mf`). */
export class MediaFoundationBackend implements CameraBackend {
  private readonly addon = loadCameraMfAddon();

  private captureProfile: MfCaptureProfile | null = null;

  async listDevices(): Promise<CameraDeviceInfo[]> {
    if (!this.addon) {
      return [];
    }
    try {
      if (this.addon.listDevicesAsync) {
        return await this.addon.listDevicesAsync();
      }
      const raw = this.addon.listDevices();
      if (!Array.isArray(raw)) {
        return [];
      }
      return raw as CameraDeviceInfo[];
    } catch {
      return [];
    }
  }

  async start(deviceId: string): Promise<void> {
    if (!this.addon) {
      const detail = getLastCameraMfLoadError();
      throw new Error(
        detail ? `Native MF camera addon not loaded. ${detail}` : "Native MF camera addon not loaded."
      );
    }
    try {
      const profile = await this.addon.startCaptureAsync({
        deviceId,
        livePreviewMaxLongEdge: LIVE_PREVIEW_MAX_LONG_EDGE_PX,
        capturePreviewMaxLongEdge: CAPTURE_PREVIEW_MAX_LONG_EDGE_PX
      });
      if (
        !profile ||
        !Number.isFinite(profile.width) ||
        !Number.isFinite(profile.height) ||
        profile.width <= 0 ||
        profile.height <= 0
      ) {
        throw new Error("[media-foundation] Open succeeded but capture profile is missing.");
      }
      this.captureProfile = {
        width: Math.trunc(profile.width),
        height: Math.trunc(profile.height),
        subtypeFourcc: Math.trunc(profile.subtypeFourcc ?? 0),
        pixelArea: Math.trunc(profile.pixelArea ?? profile.width * profile.height)
      };
      console.info("[camera-mf] stream profile", this.captureProfile);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (detail.includes("timed out after")) {
        throw new Error(
          `[media-foundation] ${detail}. Quit the app, run npm run build:native, then npm run dev. Check the terminal for [camera_mf] lines.`
        );
      }
      throw new Error(detail.startsWith("[media-foundation]") ? detail : `[media-foundation] ${detail}`);
    }
  }

  async stop(): Promise<void> {
    this.captureProfile = null;
    if (!this.addon) {
      return;
    }
    try {
      if (this.addon.stopCaptureAsync) {
        await this.addon.stopCaptureAsync();
        return;
      }
      this.addon.stopCapture();
    } catch {
      /* best effort */
    }
  }

  async getCapabilities(): Promise<Record<string, unknown>> {
    if (!this.addon) {
      return {};
    }
    try {
      if (this.addon.getCapabilitiesAsync) {
        return (await this.addon.getCapabilitiesAsync()) as Record<string, unknown>;
      }
      return this.addon.getCapabilities() as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  async getControls(): Promise<Record<string, unknown>> {
    if (!this.addon) {
      return {};
    }
    try {
      if (this.addon.getControlsAsync) {
        return { ...(await this.addon.getControlsAsync()) } as Record<string, unknown>;
      }
      return { ...this.addon.getControls() } as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  async setControls(partial: Record<string, unknown>): Promise<void> {
    if (!this.addon) {
      return;
    }
    const numeric: Record<string, number> = {};
    for (const [k, v] of Object.entries(partial)) {
      if (typeof v === "number" && Number.isFinite(v)) {
        numeric[k] = Math.trunc(v);
      }
    }
    if (Object.keys(numeric).length === 0) {
      return;
    }
    let result: SetControlsResult;
    if (this.addon.setControlsAsync) {
      result = await this.addon.setControlsAsync(numeric);
    } else {
      result = this.addon.setControls(numeric);
    }
    if (result.unsupported.length > 0 || result.ignoredUnknown.length > 0) {
      console.warn("[camera-mf] setControls partial apply", {
        unsupported: result.unsupported,
        ignoredUnknown: result.ignoredUnknown
      });
    }
    if (Object.keys(result.failed).length > 0) {
      const details = Object.entries(result.failed)
        .map(([key, message]) => `${key}: ${message}`)
        .join("; ");
      throw new Error(`Camera controls failed: ${details}`);
    }
  }

  async getPreviewJpeg(): Promise<Buffer | null> {
    if (!this.addon) {
      return null;
    }
    const b = await this.addon.getPreviewJpegAsync();
    return b && b.length > 0 ? b : null;
  }

  async isCaptureOpen(): Promise<boolean> {
    if (!this.addon?.isCaptureOpen) {
      return true;
    }
    try {
      return Boolean(this.addon.isCaptureOpen());
    } catch {
      return false;
    }
  }

  async getPreviewFrameGeneration(): Promise<number> {
    if (!this.addon?.getPreviewFrameGeneration) {
      return 0;
    }
    try {
      const gen = this.addon.getPreviewFrameGeneration();
      return Number.isFinite(gen) ? gen : 0;
    } catch {
      return 0;
    }
  }

  async getRawFrameGeneration(): Promise<number> {
    if (!this.addon?.getRawFrameGeneration) {
      return 0;
    }
    try {
      const gen = this.addon.getRawFrameGeneration();
      return Number.isFinite(gen) ? gen : 0;
    } catch {
      return 0;
    }
  }

  watchDevices(onTopologyChange: () => void, onDeviceInvalidated?: () => void): () => void {
    if (!this.addon?.subscribeDevicesChanged || !this.addon.unsubscribeDevicesChanged) {
      return () => {
        /* polling fallback in CameraService */
      };
    }
    this.addon.subscribeDevicesChanged(onTopologyChange, onDeviceInvalidated);
    return () => {
      try {
        this.addon?.unsubscribeDevicesChanged?.();
      } catch {
        /* best effort */
      }
    };
  }

  async grabFrame(captureMode: CaptureMode): Promise<{ preview: Buffer; source: Buffer; sourceIsPng: boolean } | null> {
    if (!this.addon?.grabFrameAsync) {
      return null;
    }
    if (!this.captureProfile) {
      throw new Error("[media-foundation] Capture profile unknown (open camera first).");
    }
    let got: Awaited<ReturnType<NonNullable<typeof this.addon.grabFrameAsync>>>;
    try {
      got = await this.addon.grabFrameAsync(captureMode, CAPTURE_PREVIEW_MAX_LONG_EDGE_PX);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(detail.startsWith("[media-foundation]") ? detail : `[media-foundation] ${detail}`);
    }
    if (!got?.preview?.length || !got?.source?.length) {
      return null;
    }
    const sw = Math.trunc(got.sourceWidth ?? 0);
    const sh = Math.trunc(got.sourceHeight ?? 0);
    const expected = this.captureProfile;
    if (sw !== expected.width || sh !== expected.height) {
      throw new Error(
        `[media-foundation] Capture resolution mismatch: expected ${expected.width}x${expected.height}, got ${sw}x${sh}.`
      );
    }
    return {
      preview: Buffer.from(got.preview),
      source: Buffer.from(got.source),
      sourceIsPng: Boolean(got.sourceIsPng)
    };
  }
}
