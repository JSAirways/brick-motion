/** Stable codes for camera open failures (match native `last_error_` / main-process messages). */
export type CameraOpenErrorCode =
  | "addon_not_loaded"
  | "open_timeout"
  | "open_cancelled"
  | "format_negotiation_failed"
  | "device_required"
  | "unknown";

export const classifyCameraOpenError = (
  message: string
): { code: CameraOpenErrorCode; detail: string } => {
  const detail = message.trim();
  const lower = detail.toLowerCase();
  if (lower.includes("native mf camera addon not loaded") || lower.includes("addon not loaded")) {
    return { code: "addon_not_loaded", detail };
  }
  if (lower.includes("open_timeout") || lower.includes("timed out after")) {
    return { code: "open_timeout", detail };
  }
  if (lower.includes("open_cancelled")) {
    return { code: "open_cancelled", detail };
  }
  if (lower.includes("format_negotiation") || lower.includes("negotiation_failed")) {
    return { code: "format_negotiation_failed", detail };
  }
  if (lower.includes("deviceid required") || lower.includes("device id required")) {
    return { code: "device_required", detail };
  }
  return { code: "unknown", detail };
};

/** Short workspace status line from a classified open error. */
export const cameraOpenErrorStatusLine = (code: CameraOpenErrorCode): string => {
  switch (code) {
    case "addon_not_loaded":
      return "Camera module not loaded — run npm run build:native, then restart the app.";
    case "open_timeout":
      return "Camera open timed out — quit other apps using the webcam, then Refresh cameras.";
    case "open_cancelled":
      return "Camera open was cancelled — try Refresh cameras.";
    case "format_negotiation_failed":
      return "Camera format not supported — try another device or USB port.";
    case "device_required":
      return "No camera selected — choose a device from the list.";
    default:
      return "Camera could not start — see details below.";
  }
};
