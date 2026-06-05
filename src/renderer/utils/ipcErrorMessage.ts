/**
 * Normalize errors from `ipcRenderer.invoke` (and similar) for short UI copy.
 * Electron often wraps: `Error invoking remote method 'channel': Error: <detail>`.
 */
export function ipcInvokeErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string") {
    const t = error.trim();
    return t.length > 0 ? stripInvokeWrapper(t) : fallback;
  }
  if (error instanceof Error) {
    const t = error.message.trim();
    return t.length > 0 ? stripInvokeWrapper(t) : fallback;
  }
  return fallback;
}

function stripInvokeWrapper(msg: string): string {
  let s = msg.replace(/^Error invoking remote method '[^']+':\s*/i, "").trim();
  if (s.startsWith("Error: ")) {
    s = s.slice(7).trim();
  }
  return s;
}
