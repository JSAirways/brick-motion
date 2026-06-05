import { escapeHtml } from "../../utils/htmlEscape";
import { ipcInvokeErrorMessage } from "../../utils/ipcErrorMessage";
import { CAMERA_POLICY } from "./cameraPolicy";

export const withTimeout = async <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms} ms.`));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
};

export const populateCameraDeviceSelect = async (params: {
  cameraDeviceSelect: HTMLSelectElement | null;
  selectedDeviceId: string | null | undefined;
  setSuppressCameraDeviceChange: (value: boolean) => void;
}): Promise<Array<{ id: string; label: string }>> => {
  const { cameraDeviceSelect, selectedDeviceId, setSuppressCameraDeviceChange } = params;
  if (!cameraDeviceSelect) {
    return [];
  }
  const cameras = await window.brickMotion.cameraListDevices({});
  setSuppressCameraDeviceChange(true);
  try {
    cameraDeviceSelect.innerHTML = cameras
      .map((device, index) => {
        const label = escapeHtml(device.label || `Camera ${index + 1}`);
        const optVal = escapeHtml(device.id);
        const selected = device.id === selectedDeviceId ? "selected" : "";
        return `<option value="${optVal}" ${selected}>${label}</option>`;
      })
      .join("");
  } finally {
    setSuppressCameraDeviceChange(false);
  }
  return cameras;
};

export const startCameraWithRetry = async (params: {
  deviceId: string;
}): Promise<void> => {
  const { deviceId } = params;
  try {
    await withTimeout(
      window.brickMotion.cameraOpen({ deviceId }),
      CAMERA_POLICY.openTimeoutMs,
      "Camera start"
    );
    return;
  } catch (firstError) {
    const firstDetail = ipcInvokeErrorMessage(firstError, "Camera start failed.");
    let stopDetail = "ok";
    try {
      await withTimeout(
        window.brickMotion.cameraClose(),
        CAMERA_POLICY.stopBeforeRetryTimeoutMs,
        "Camera stop before retry"
      );
    } catch (stopError) {
      stopDetail = ipcInvokeErrorMessage(stopError, "Camera stop before retry failed.");
    }
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, CAMERA_POLICY.openRetrySettleMs);
    });
    try {
      await withTimeout(
        window.brickMotion.cameraOpen({ deviceId }),
        CAMERA_POLICY.openRetryTimeoutMs,
        "Camera start retry"
      );
    } catch (retryError) {
      const retryDetail = ipcInvokeErrorMessage(retryError, "Camera start retry failed.");
      throw new Error(
        `Camera start failed on both attempts. First: ${firstDetail} | Stop before retry: ${stopDetail} | Retry: ${retryDetail}`
      );
    }
  }
};
