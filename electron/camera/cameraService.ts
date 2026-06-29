import type { WebContents } from "electron";
import type { CaptureMode } from "../../src/shared/types/project";
import type { CameraDeviceInfo } from "./cameraBackend";
import { createCameraBackend } from "./createCameraBackend";

/** Poll interval when no new preview frame is available (camera-driven rate otherwise). */
const PREVIEW_POLL_MS = 16;
/** No preview JPEG for this long → stalled (miss count × PREVIEW_POLL_MS). */
const PREVIEW_STALL_MS = 9000;
const PREVIEW_STALLED_THRESHOLD = Math.max(30, Math.ceil(PREVIEW_STALL_MS / PREVIEW_POLL_MS));
/** Fallback poll when native CM notifications are unavailable. */
const DEVICE_WATCH_POLL_MS = 1000;
/** Empty preview polls before checking whether the active device disappeared from the system. */
const PREVIEW_UNPLUG_CHECK_MISSES = 15;
/** Brief grace after capture so grab encode does not trip stale/disconnect heuristics. */
const POST_CAPTURE_GRACE_MS = 400;

export type CameraStatusEvent =
  | { phase: "stalled"; code: "preview_stalled"; detail: string }
  | { phase: "error"; code: "preview_read_failed"; detail: string }
  | { phase: "disconnected"; code: "device_removed"; detail: string; deviceId: string };

export interface CameraDevicesChangedEvent {
  devices: CameraDeviceInfo[];
  addedIds: string[];
  removedIds: string[];
}

/**
 * Main-process camera orchestration for one active USB camera session.
 * Keeps preview fan-out and lifecycle cleanup centralized.
 */
export class CameraService {
  private previewTarget: WebContents | null = null;

  private readonly backend = createCameraBackend();

  private sessionChain: Promise<void> = Promise.resolve();

  private previewTimer: ReturnType<typeof setTimeout> | null = null;

  private previewLoopActive = false;

  private previewReadInFlight = false;

  private consecutivePreviewMisses = 0;

  private previewStalledNotified = false;

  private onStatus: ((event: CameraStatusEvent) => void) | null = null;

  private closingPromise: Promise<void> | null = null;

  private deviceWatchTimer: ReturnType<typeof setInterval> | null = null;

  private deviceWatchUnsubscribe: (() => void) | null = null;

  private deviceWatchStarted = false;

  private knownDeviceIds = new Set<string>();

  private onDevicesChanged: ((event: CameraDevicesChangedEvent) => void) | null = null;

  private activeDeviceId: string | null = null;

  /** Last device opened in this session (used for hotplug reconnect). */
  private lastOpenedDeviceId: string | null = null;

  private lastPreviewGeneration = 0;

  private lastSentPreviewGeneration = 0;

  private lastGenerationChangeAt = 0;

  private lastRawGeneration = 0;

  private lastRawGenerationChangeAt = 0;

  /** Set when the last-opened device drops out of enumeration (phantom entries may remain). */
  private lastOpenedDeviceAbsentFromList = false;

  /** After disconnect, allow one reconnect signal when the device is back (CM poll or natural add). */
  private hotplugReconnectPending = false;

  /** GrabStill runs on the camera thread; skip competing preview reads while true. */
  private capturingFrame = false;

  /** After capture, ignore stale-preview disconnect briefly. */
  private postCaptureGraceUntilMs = 0;

  setPreviewTarget(wc: WebContents | null): void {
    this.previewTarget = wc;
  }

  setStatusListener(listener: ((event: CameraStatusEvent) => void) | null): void {
    this.onStatus = listener;
  }

  setDevicesChangedListener(listener: ((event: CameraDevicesChangedEvent) => void) | null): void {
    this.onDevicesChanged = listener;
  }

  private stopDeviceWatch(): void {
    this.deviceWatchStarted = false;
    if (this.deviceWatchTimer !== null) {
      clearInterval(this.deviceWatchTimer);
      this.deviceWatchTimer = null;
    }
    if (this.deviceWatchUnsubscribe) {
      this.deviceWatchUnsubscribe();
      this.deviceWatchUnsubscribe = null;
    }
  }

  /** Idempotent; keeps hotplug updates flowing on start screen and while idle. */
  ensureDeviceWatch(): void {
    if (this.deviceWatchStarted) {
      return;
    }
    this.deviceWatchStarted = true;
    void this.pollDevicesChanged().catch(() => {
      /* establish baseline */
    });
    if (this.backend.watchDevices) {
      this.deviceWatchUnsubscribe = this.backend.watchDevices(
        () => {
          void this.pollDevicesChanged({ notifyRenderer: true, allowHotplugReconnect: true }).catch(() => {
            /* best effort */
          });
        },
        () => {
          if (this.capturingFrame || Date.now() < this.postCaptureGraceUntilMs) {
            return;
          }
          void this.handleActiveDeviceInvalidated().catch(() => {
            /* best effort */
          });
        }
      );
    }
    this.deviceWatchTimer = setInterval(() => {
      void this.pollAndVerify().catch(() => {
        /* best effort poll */
      });
    }, DEVICE_WATCH_POLL_MS);
  }

  private notePreviewGeneration(generation: number): void {
    if (generation <= 0) {
      return;
    }
    if (generation !== this.lastPreviewGeneration) {
      this.lastPreviewGeneration = generation;
    }
    this.lastGenerationChangeAt = Date.now();
  }

  private noteRawGeneration(generation: number): void {
    if (generation <= 0) {
      return;
    }
    if (generation !== this.lastRawGeneration) {
      this.lastRawGeneration = generation;
    }
    this.lastRawGenerationChangeAt = Date.now();
  }

  private async pollAndVerify(): Promise<void> {
    await this.pollDevicesChanged({ notifyRenderer: true });
    if (!this.activeDeviceId) {
      return;
    }
    const nativeOpen = (await this.backend.isCaptureOpen?.()) ?? true;
    if (!nativeOpen && Date.now() >= this.postCaptureGraceUntilMs && !this.capturingFrame) {
      await this.handleActiveDeviceInvalidated("native_capture_closed");
      return;
    }
    await this.verifyActiveDeviceStillPresent();
  }

  async handleActiveDeviceInvalidated(reason = "unknown"): Promise<void> {
    if (!this.activeDeviceId) {
      return;
    }
    console.warn(`[camera] active device invalidated (${reason})`);
    const removedDeviceId = this.activeDeviceId;
    this.lastOpenedDeviceAbsentFromList = true;
    this.hotplugReconnectPending = true;
    this.knownDeviceIds.delete(removedDeviceId);
    await this.close();
    this.onStatus?.({
      phase: "disconnected",
      code: "device_removed",
      detail: "Active camera was disconnected.",
      deviceId: removedDeviceId
    });
    await this.pollDevicesChanged({ notifyRenderer: true });
  }

  private async verifyActiveDeviceStillPresent(): Promise<void> {
    if (!this.activeDeviceId || this.capturingFrame || Date.now() < this.postCaptureGraceUntilMs) {
      return;
    }
    const nativeOpen = (await this.backend.isCaptureOpen?.()) ?? true;
    if (nativeOpen) {
      return;
    }
    const devices = await this.backend.listDevices();
    if (!devices.some((d) => d.id === this.activeDeviceId)) {
      await this.handleActiveDeviceInvalidated("device_not_enumerated");
    }
  }

  private async pollDevicesChanged(options?: {
    notifyRenderer?: boolean;
    allowHotplugReconnect?: boolean;
  }): Promise<void> {
    const devices = await this.backend.listDevices();
    const nextIds = new Set(devices.map((d) => d.id));
    const addedIds = [...nextIds].filter((id) => !this.knownDeviceIds.has(id));
    const removedIds = [...this.knownDeviceIds].filter((id) => !nextIds.has(id));
    // Do not treat the active device as removed when it is missing from enumeration while
    // capture is open (common on Windows when the stream is exclusive).
    if (this.lastOpenedDeviceId) {
      if (!nextIds.has(this.lastOpenedDeviceId)) {
        this.lastOpenedDeviceAbsentFromList = true;
      } else if (
        this.hotplugReconnectPending &&
        !this.activeDeviceId &&
        nextIds.has(this.lastOpenedDeviceId) &&
        (options?.allowHotplugReconnect || addedIds.includes(this.lastOpenedDeviceId))
      ) {
        if (!addedIds.includes(this.lastOpenedDeviceId)) {
          addedIds.push(this.lastOpenedDeviceId);
        }
      }
      if (addedIds.includes(this.lastOpenedDeviceId)) {
        this.lastOpenedDeviceAbsentFromList = false;
      }
    }
    const changed = addedIds.length > 0 || removedIds.length > 0;
    this.knownDeviceIds = nextIds;
    if (changed || options?.notifyRenderer) {
      this.onDevicesChanged?.({
        devices,
        addedIds,
        removedIds
      });
    }
    if (
      this.activeDeviceId &&
      removedIds.includes(this.activeDeviceId) &&
      !this.capturingFrame &&
      Date.now() >= this.postCaptureGraceUntilMs
    ) {
      const removedDeviceId = this.activeDeviceId;
      this.lastOpenedDeviceAbsentFromList = true;
      this.hotplugReconnectPending = true;
      this.knownDeviceIds.delete(removedDeviceId);
      await this.close();
      this.onStatus?.({
        phase: "disconnected",
        code: "device_removed",
        detail: "Active camera was disconnected.",
        deviceId: removedDeviceId
      });
    }
  }

  private clearPreviewLoop(): void {
    this.previewLoopActive = false;
    this.consecutivePreviewMisses = 0;
    this.previewStalledNotified = false;
    if (this.previewTimer !== null) {
      clearTimeout(this.previewTimer);
      this.previewTimer = null;
    }
  }

  private async withSessionLock<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.sessionChain;
    let release!: () => void;
    this.sessionChain = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private startPreviewLoop(): void {
    this.clearPreviewLoop();
    this.previewLoopActive = true;
    const tick = async (): Promise<void> => {
      if (!this.previewLoopActive) {
        return;
      }
      this.previewTimer = null;
      if (this.previewReadInFlight) {
        if (this.previewLoopActive) {
          this.previewTimer = setTimeout(() => void tick(), PREVIEW_POLL_MS);
        }
        return;
      }
      const t0 = Date.now();
      this.previewReadInFlight = true;
      let sentThisTick = false;
      try {
        if (this.capturingFrame) {
          if (this.previewLoopActive) {
            this.previewTimer = setTimeout(() => void tick(), PREVIEW_POLL_MS);
          }
          return;
        }
        const generation = (await this.backend.getPreviewFrameGeneration?.()) ?? 0;
        const rawGeneration = (await this.backend.getRawFrameGeneration?.()) ?? 0;
        this.notePreviewGeneration(generation);
        this.noteRawGeneration(rawGeneration);
        if (generation > 0 && generation === this.lastSentPreviewGeneration) {
          this.consecutivePreviewMisses = 0;
        } else {
          const buf = await this.backend.getPreviewJpeg();
          if (buf && buf.length > 0 && this.previewTarget && !this.previewTarget.isDestroyed()) {
            this.consecutivePreviewMisses = 0;
            this.previewStalledNotified = false;
            this.sendPreviewJpeg(buf);
            if (generation > 0) {
              this.lastSentPreviewGeneration = generation;
            }
            sentThisTick = true;
          } else if (!this.capturingFrame) {
            this.consecutivePreviewMisses += 1;
            if (
              this.activeDeviceId &&
              this.consecutivePreviewMisses >= PREVIEW_UNPLUG_CHECK_MISSES &&
              this.consecutivePreviewMisses % PREVIEW_UNPLUG_CHECK_MISSES === 0
            ) {
              void this.verifyActiveDeviceStillPresent().catch(() => {
                /* best effort */
              });
            }
          }
        }
      } catch (error) {
        if (!this.capturingFrame) {
          this.consecutivePreviewMisses += 1;
        }
        if (this.consecutivePreviewMisses >= PREVIEW_STALLED_THRESHOLD) {
          this.onStatus?.({
            phase: "error",
            code: "preview_read_failed",
            detail: error instanceof Error ? error.message : "Preview read failed repeatedly."
          });
        }
      } finally {
        this.previewReadInFlight = false;
      }
      if (
        !this.capturingFrame &&
        this.consecutivePreviewMisses >= PREVIEW_STALLED_THRESHOLD &&
        !this.previewStalledNotified
      ) {
        this.previewStalledNotified = true;
        this.onStatus?.({
          phase: "stalled",
          code: "preview_stalled",
          detail: "No preview frames received for an extended period."
        });
      }
      if (!this.previewLoopActive) {
        return;
      }
      const elapsed = Date.now() - t0;
      const wait = sentThisTick ? 0 : Math.max(0, PREVIEW_POLL_MS - elapsed);
      this.previewTimer = setTimeout(() => void tick(), wait);
    };
    void tick();
  }

  async listDevices(): Promise<CameraDeviceInfo[]> {
    this.ensureDeviceWatch();
    const devices = await this.backend.listDevices();
    this.knownDeviceIds = new Set(devices.map((d) => d.id));
    return devices;
  }

  async open(deviceId: string): Promise<void> {
    return this.withSessionLock(async () => {
      this.ensureDeviceWatch();
      if (this.activeDeviceId === deviceId && (await this.backend.isCaptureOpen?.())) {
        return;
      }
      this.clearPreviewLoop();
      await this.backend.start(deviceId);
      this.activeDeviceId = deviceId;
      this.lastOpenedDeviceId = deviceId;
      this.lastPreviewGeneration = 0;
      this.lastSentPreviewGeneration = 0;
      this.lastGenerationChangeAt = 0;
      this.lastRawGeneration = 0;
      this.lastRawGenerationChangeAt = 0;
      this.lastOpenedDeviceAbsentFromList = false;
      this.hotplugReconnectPending = false;
      this.startPreviewLoop();
    });
  }

  async close(): Promise<void> {
    return this.withSessionLock(async () => {
      this.clearPreviewLoop();
      this.activeDeviceId = null;
      this.lastPreviewGeneration = 0;
      this.lastSentPreviewGeneration = 0;
      this.lastGenerationChangeAt = 0;
      this.lastRawGeneration = 0;
      this.lastRawGenerationChangeAt = 0;
      await this.backend.stop();
      /* keep lastOpenedDeviceId for hotplug reconnect */
    });
  }

  async dispose(): Promise<void> {
    if (this.closingPromise) {
      return this.closingPromise;
    }
    this.closingPromise = this.close()
      .catch(() => {
        /* best effort on shutdown */
      })
      .finally(() => {
        this.stopDeviceWatch();
        this.previewTarget = null;
        this.closingPromise = null;
      });
    return this.closingPromise;
  }

  async getCapabilities(): Promise<Record<string, unknown>> {
    return this.backend.getCapabilities();
  }

  async getControls(): Promise<Record<string, unknown>> {
    return this.backend.getControls();
  }

  async setControls(partial: Record<string, unknown>): Promise<void> {
    await this.backend.setControls(partial);
  }

  async grabFrame(
    captureMode: CaptureMode
  ): Promise<{ preview: Buffer; source: Buffer; sourceIsPng: boolean } | null> {
    return this.withSessionLock(async () => {
      this.capturingFrame = true;
      try {
        return await this.backend.grabFrame(captureMode);
      } finally {
        this.capturingFrame = false;
        this.postCaptureGraceUntilMs = Date.now() + POST_CAPTURE_GRACE_MS;
        this.consecutivePreviewMisses = 0;
        this.previewStalledNotified = false;
      }
    });
  }

  private sendPreviewJpeg(buffer: Buffer): void {
    if (!this.previewTarget || this.previewTarget.isDestroyed()) {
      return;
    }
    const jpeg = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.previewTarget.send("camera:preview", jpeg);
  }
}

