/**
 * Resolve `<select value>` to a device id. Option values are HTML-escaped symbolic links
 * from `populateCameraDeviceSelect` (see `escapeHtml` in camera.ts).
 */
export function resolveCameraSelectValueToId(
  raw: string | null | undefined,
  devices: Array<{ id: string; label: string }>
): string | null {
  const t = typeof raw === "string" ? raw.trim() : "";
  if (!t) {
    return null;
  }
  const match = devices.find((d) => d.id === t || d.id.trim() === t);
  return match?.id ?? null;
}
