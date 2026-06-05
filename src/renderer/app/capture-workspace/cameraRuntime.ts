export interface CameraRuntime {
  currentSessionToken: () => number;
  /** Tear down preview IPC only; keep status/devices listeners for hotplug. */
  prepareCameraReopen: () => void;
  stopStream: () => void;
  getPreviewObjectUrl: () => string | null;
  setPreviewObjectUrl: (url: string | null) => void;
  hasStatusSubscription: () => boolean;
  ensureStatusSubscription: (subscribe: () => () => void) => void;
  hasDevicesChangedSubscription: () => boolean;
  ensureDevicesChangedSubscription: (subscribe: () => () => void) => void;
  setPreviewSubscription: (subscribe: () => () => void) => void;
  resetRetryCounter: () => void;
}

export const createCameraRuntime = (params: {
  closeCamera: () => Promise<void>;
  onResetRetryCounter: () => void;
}): CameraRuntime => {
  const { closeCamera, onResetRetryCounter } = params;
  let previewUnsubscribe: (() => void) | null = null;
  let statusUnsubscribe: (() => void) | null = null;
  let devicesChangedUnsubscribe: (() => void) | null = null;
  let livePreviewObjectUrl: string | null = null;
  let sessionToken = 0;

  const clearPreviewObjectUrl = (): void => {
    if (!livePreviewObjectUrl) {
      return;
    }
    URL.revokeObjectURL(livePreviewObjectUrl);
    livePreviewObjectUrl = null;
  };

  const clearSubscriptions = (): void => {
    previewUnsubscribe?.();
    previewUnsubscribe = null;
    statusUnsubscribe?.();
    statusUnsubscribe = null;
    devicesChangedUnsubscribe?.();
    devicesChangedUnsubscribe = null;
  };

  const prepareCameraReopen = (): void => {
    previewUnsubscribe?.();
    previewUnsubscribe = null;
    onResetRetryCounter();
    sessionToken += 1;
    clearPreviewObjectUrl();
  };

  const stopStream = (): void => {
    void closeCamera().catch(() => {
      /* best effort */
    });
    clearSubscriptions();
    onResetRetryCounter();
    sessionToken += 1;
    clearPreviewObjectUrl();
  };

  return {
    currentSessionToken: () => sessionToken,
    prepareCameraReopen,
    stopStream,
    getPreviewObjectUrl: () => livePreviewObjectUrl,
    setPreviewObjectUrl: (url) => {
      livePreviewObjectUrl = url;
    },
    hasStatusSubscription: () => Boolean(statusUnsubscribe),
    ensureStatusSubscription: (subscribe) => {
      statusUnsubscribe?.();
      statusUnsubscribe = subscribe();
    },
    hasDevicesChangedSubscription: () => Boolean(devicesChangedUnsubscribe),
    ensureDevicesChangedSubscription: (subscribe) => {
      devicesChangedUnsubscribe?.();
      devicesChangedUnsubscribe = subscribe();
    },
    setPreviewSubscription: (subscribe) => {
      previewUnsubscribe?.();
      previewUnsubscribe = subscribe();
    },
    resetRetryCounter: onResetRetryCounter
  };
};

