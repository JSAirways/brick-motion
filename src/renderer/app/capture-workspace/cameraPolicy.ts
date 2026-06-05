/** Renderer-side camera timeouts and retry policy (single source of truth). */
export const CAMERA_POLICY = {
  /** Device list IPC + populate select. */
  listDevicesTimeoutMs: 10_000,
  /** `camera:open` first attempt (native open budget is ~12s). */
  openTimeoutMs: 18_000,
  /** One stop→open retry after first open failure. */
  openRetryTimeoutMs: 18_000,
  stopBeforeRetryTimeoutMs: 8_000,
  /** Best-effort stop before a fresh open attempt. */
  stopBeforeOpenTimeoutMs: 3_000,
  /** No preview frames after open — one auto-retry then surface error. */
  previewStartWatchdogMs: 25_000,
  previewAutoRetryMax: 1,
  /** After hotplug or failed open, wait before reopen so the USB driver can settle. */
  reopenSettleDelayMs: 1_200,
  /** Pause between stop and second open attempt in native start retry. */
  openRetrySettleMs: 800
} as const;

export type CameraPhase =
  | "idle"
  | "listing"
  | "opening"
  | "live"
  | "stalled"
  | "disconnected"
  | "error";
