import { startCameraWithRetry, withTimeout } from "./camera";
import { CAMERA_POLICY, type CameraPhase } from "./cameraPolicy";
import { resolveCameraSelectValueToId } from "../../utils/cameraDeviceSelect";
import { cameraOpenErrorStatusLine, classifyCameraOpenError } from "../../../shared/cameraErrors";
import { ipcInvokeErrorMessage } from "../../utils/ipcErrorMessage";
import type { ProjectSession } from "../../../shared/types/project";
import type { CameraRuntime } from "./cameraRuntime";
import type { LivePreviewView } from "./livePreviewView";
import { createPreviewFrameSink } from "./previewFrameSink";

export interface CameraController {
  initCamera: (preferredDeviceId?: string | null, options?: { forceReopen?: boolean }) => Promise<void>;
  setPreviewUi: (livePreviewEl: HTMLImageElement | null, livePreviewView: LivePreviewView) => void;
  /** Re-wire IPC preview frames after workspace DOM rebuild (camera stays open). */
  reattachPreviewSubscription: () => void;
  /** Re-wire status/device IPC after workspace DOM rebuild or stopStream cleared listeners. */
  ensureIpcSubscriptions: () => void;
  dispose: () => Promise<void>;
  getPhase: () => CameraPhase;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });

const pickNonEmpty = (value: string | null | undefined): string | null => {
  const t = typeof value === "string" ? value.trim() : "";
  return t.length > 0 ? t : null;
};

const resolvePreferredCameraId = (params: {
  devices: Array<{ id: string; label: string }>;
  preferredFromSelect?: string | null;
  preferredFromProject?: string | null;
  preferredLabelFromProject?: string | null;
}): string | null => {
  const { devices, preferredFromSelect, preferredFromProject, preferredLabelFromProject } = params;
  let deviceId = pickNonEmpty(preferredFromSelect) ?? pickNonEmpty(preferredFromProject);
  if (deviceId && !devices.some((d) => d.id === deviceId || d.id.trim() === deviceId)) {
    deviceId = null;
  }
  if (!deviceId) {
    const preferredLabel = pickNonEmpty(preferredLabelFromProject)?.toLocaleLowerCase();
    if (preferredLabel) {
      const byLabel = devices.find((d) => d.label.trim().toLocaleLowerCase() === preferredLabel);
      deviceId = pickNonEmpty(byLabel?.id);
    }
  }
  if (!deviceId && devices.length > 0) {
    deviceId = pickNonEmpty(devices[0].id);
  }
  return deviceId;
};

export const createCameraController = (params: {
  cameraRuntime: CameraRuntime;
  getSession: () => ProjectSession | null;
  getPlayhead: () => "live" | number;
  getRoute: () => "start" | "new-project" | "workspace";
  getLivePreviewEl: () => HTMLImageElement | null;
  getLivePreviewView: () => LivePreviewView;
  populateCameraDevices: () => Promise<Array<{ id: string; label: string }>>;
  getLastKnownCameraDevices: () => Array<{ id: string; label: string }>;
  setLastKnownCameraDevices: (devices: Array<{ id: string; label: string }>) => void;
  renderCameraControls: () => void;
  persistCameraProfileNow: () => void;
  syncFocusOverlayUi: () => void;
  reportCameraUnavailable: (detail: string) => void;
}): CameraController => {
  const {
    cameraRuntime,
    getSession,
    getPlayhead,
    getRoute,
    getLivePreviewEl,
    getLivePreviewView,
    populateCameraDevices,
    getLastKnownCameraDevices,
    setLastKnownCameraDevices,
    renderCameraControls,
    persistCameraProfileNow,
    syncFocusOverlayUi,
    reportCameraUnavailable
  } = params;

  let phase: CameraPhase = "idle";
  let noPreviewAutoRetryCount = 0;
  let initCameraInFlight = false;
  let queuedInitCameraDeviceId: string | null | undefined = undefined;
  let hotplugReconnectTimer: number | null = null;
  let livePreviewEl: HTMLImageElement | null = getLivePreviewEl();
  let livePreviewView: LivePreviewView = getLivePreviewView();

  const previewFrameSink = createPreviewFrameSink({
    getLivePreviewView: () => livePreviewView,
    getPreviewObjectUrl: () => cameraRuntime.getPreviewObjectUrl(),
    setPreviewObjectUrl: (url) => {
      cameraRuntime.setPreviewObjectUrl(url);
    },
    currentSessionToken: () => cameraRuntime.currentSessionToken()
  });

  const deliverPreviewFrame = (jpeg: Uint8Array): void => {
    if (!jpeg.byteLength || phase === "disconnected" || phase === "idle") {
      return;
    }
    if (phase === "stalled") {
      setPhase("live");
      livePreviewView.setStatus("Live camera feed");
    }
    previewFrameSink.submit(jpeg);
  };

  const setPhase = (next: CameraPhase): void => {
    phase = next;
  };

  const applyDisconnectedState = async (): Promise<void> => {
    setPhase("disconnected");
    previewFrameSink.reset();
    livePreviewView.setLoading(false);
    livePreviewView.setStatus("Camera disconnected — plug in or choose another device");
    livePreviewView.clearPreview();
    try {
      await withTimeout(window.brickMotion.cameraClose(), CAMERA_POLICY.stopBeforeOpenTimeoutMs, "Camera stop");
    } catch {
      /* best effort */
    }
  };

  const scheduleHotplugReconnect = (deviceId: string | null): void => {
    if (!deviceId) {
      return;
    }
    if (hotplugReconnectTimer !== null) {
      window.clearTimeout(hotplugReconnectTimer);
    }
    hotplugReconnectTimer = window.setTimeout(() => {
      hotplugReconnectTimer = null;
      if (initCameraInFlight || getRoute() !== "workspace" || !getSession() || getPlayhead() !== "live") {
        return;
      }
      livePreviewView.setLoading(true);
      livePreviewView.setStatus("Camera detected — starting preview…");
      noPreviewAutoRetryCount = 0;
      void initCamera(deviceId, { forceReopen: true });
    }, CAMERA_POLICY.reopenSettleDelayMs);
  };

  const handleDevicesChanged = (event: {
    devices: Array<{ id: string; label: string }>;
    addedIds: string[];
    removedIds: string[];
  }): void => {
    setLastKnownCameraDevices(event.devices);
    if (getRoute() !== "workspace" || !getSession()) {
      return;
    }
    void (async () => {
      const sessionAfter = getSession();
      if (!sessionAfter) {
        return;
      }
      try {
        await populateCameraDevices();
      } catch {
        /* keep previous list on refresh failures */
      }
      const profileId =
        typeof sessionAfter.project.cameraProfile.deviceId === "string"
          ? sessionAfter.project.cameraProfile.deviceId
          : null;
      const profileLabel =
        typeof sessionAfter.project.cameraProfile.deviceLabel === "string"
          ? sessionAfter.project.cameraProfile.deviceLabel
          : null;
      const profileListed = profileId ? event.devices.some((d) => d.id === profileId) : false;
      const profileRemoved = Boolean(profileId && event.removedIds.includes(profileId));

      const targetId = resolvePreferredCameraId({
        devices: event.devices,
        preferredFromProject: profileId,
        preferredLabelFromProject: profileLabel
      });

      if (profileRemoved) {
        await applyDisconnectedState();
      }

      if (getPlayhead() !== "live" || initCameraInFlight) {
        return;
      }

      if (!targetId) {
        return;
      }

      const awaitingReconnect =
        phase === "disconnected" || phase === "stalled" || phase === "error" || phase === "idle";
      const deviceReturned =
        Boolean(profileId && event.addedIds.includes(profileId)) ||
        Boolean(targetId && event.addedIds.includes(targetId));
      if (awaitingReconnect && deviceReturned) {
        scheduleHotplugReconnect(targetId);
      }
    })();
  };

  const ensureIpcSubscriptions = (): void => {
    cameraRuntime.ensureStatusSubscription(() =>
      window.brickMotion.cameraStatusSubscribe((event) => {
        livePreviewView.setLoading(false);
        if (event.code === "device_removed") {
          void applyDisconnectedState();
          return;
        }
        if (event.code === "preview_stalled") {
          setPhase("stalled");
          livePreviewView.setStatus("Preview stalled. Reconnect camera or retry device.");
          return;
        }
        setPhase("error");
        livePreviewView.setStatus(`Preview error: ${event.detail}`);
      })
    );
    cameraRuntime.ensureDevicesChangedSubscription(() =>
      window.brickMotion.cameraDevicesChangedSubscribe(handleDevicesChanged)
    );
  };

  const dispose = async (): Promise<void> => {
    if (hotplugReconnectTimer !== null) {
      window.clearTimeout(hotplugReconnectTimer);
      hotplugReconnectTimer = null;
    }
    setPhase("idle");
    noPreviewAutoRetryCount = 0;
    cameraRuntime.stopStream();
    try {
      await withTimeout(
        window.brickMotion.cameraClose(),
        CAMERA_POLICY.stopBeforeOpenTimeoutMs,
        "Camera stop"
      );
    } catch {
      /* best effort */
    }
  };

  const bindPreviewSubscription = (): void => {
    cameraRuntime.setPreviewSubscription(() =>
      window.brickMotion.cameraPreviewSubscribe((jpeg) => {
        deliverPreviewFrame(jpeg);
      })
    );
  };

  const initCamera = async (
    preferredDeviceId?: string | null,
    options?: { forceReopen?: boolean }
  ): Promise<void> => {
    if (initCameraInFlight) {
      queuedInitCameraDeviceId = preferredDeviceId;
      return;
    }
    initCameraInFlight = true;
    if (!livePreviewEl) {
      initCameraInFlight = false;
      return;
    }
    const reopen = Boolean(options?.forceReopen) || (phase !== "live" && phase !== "opening" && phase !== "stalled");
    if (reopen) {
      cameraRuntime.prepareCameraReopen();
      setPhase("idle");
    }
    try {
      const session = getSession();
      if (!session) {
        return;
      }
      if (getPlayhead() === "live") {
        livePreviewView.setLoading(true);
        livePreviewView.setStatus("Starting camera…");
      }
      try {
        await withTimeout(
          window.brickMotion.cameraClose(),
          CAMERA_POLICY.stopBeforeOpenTimeoutMs,
          "Camera stop"
        );
      } catch {
        /* best effort; continue with fresh start attempt */
      }
      await sleep(CAMERA_POLICY.reopenSettleDelayMs);
      setPhase("listing");
      let devices: Array<{ id: string; label: string }> = [];
      try {
        devices = await withTimeout(
          populateCameraDevices(),
          CAMERA_POLICY.listDevicesTimeoutMs,
          "Camera device discovery"
        );
      } catch {
        const fallbackDeviceId =
          typeof session.project.cameraProfile.deviceId === "string" ? session.project.cameraProfile.deviceId : null;
        const fallbackDeviceLabel =
          typeof session.project.cameraProfile.deviceLabel === "string"
            ? session.project.cameraProfile.deviceLabel
            : "Last selected camera";
        const lastKnownCameraDevices = getLastKnownCameraDevices();
        if (fallbackDeviceId) {
          devices = [...lastKnownCameraDevices];
          if (!devices.some((d) => d.id === fallbackDeviceId)) {
            devices.push({ id: fallbackDeviceId, label: fallbackDeviceLabel });
          }
          livePreviewView.setStatus("Camera discovery timed out; trying last selected camera…");
        } else if (lastKnownCameraDevices.length > 0) {
          devices = [...lastKnownCameraDevices];
          livePreviewView.setStatus("Camera discovery timed out; trying previously discovered camera list…");
        } else {
          throw new Error("Camera device discovery timed out and no fallback camera is available.");
        }
      }
      const deviceId = resolvePreferredCameraId({
        devices,
        preferredFromSelect: resolveCameraSelectValueToId(preferredDeviceId, devices),
        preferredFromProject:
          typeof session.project.cameraProfile.deviceId === "string" ? session.project.cameraProfile.deviceId : null,
        preferredLabelFromProject:
          typeof session.project.cameraProfile.deviceLabel === "string" ? session.project.cameraProfile.deviceLabel : null
      });
      if (!deviceId) {
        setPhase("error");
        livePreviewView.setLoading(false);
        livePreviewView.setStatus("No camera found — connect a device or click Refresh cameras");
        livePreviewView.clearPreview();
        renderCameraControls();
        persistCameraProfileNow();
        syncFocusOverlayUi();
        return;
      }
      session.project.cameraProfile.deviceId = deviceId;
      session.project.cameraProfile.deviceLabel = devices.find((d) => d.id === deviceId)?.label ?? null;

      if (!options?.forceReopen && phase === "live") {
        if (getPlayhead() === "live") {
          livePreviewView.setLoading(false);
          livePreviewView.setStatus("Live camera feed");
        }
        renderCameraControls();
        persistCameraProfileNow();
        syncFocusOverlayUi();
        return;
      }

      let hideLivePreviewSpinnerOnFrame = true;
      const previewSessionAtStart = cameraRuntime.currentSessionToken();
      let previewStartWatchdog: number | null = window.setTimeout(() => {
        if (
          !hideLivePreviewSpinnerOnFrame ||
          getRoute() !== "workspace" ||
          previewSessionAtStart !== cameraRuntime.currentSessionToken()
        ) {
          return;
        }
        hideLivePreviewSpinnerOnFrame = false;
        if (noPreviewAutoRetryCount < CAMERA_POLICY.previewAutoRetryMax) {
          noPreviewAutoRetryCount += 1;
          livePreviewView.setStatus("No preview frames yet, retrying camera…");
          void initCamera(deviceId, { forceReopen: true });
          return;
        }
        setPhase("error");
        livePreviewView.setLoading(false);
        livePreviewView.setStatus("Camera started, but no preview frames received yet. Try Refresh cameras.");
      }, CAMERA_POLICY.previewStartWatchdogMs);

      cameraRuntime.setPreviewSubscription(() =>
        window.brickMotion.cameraPreviewSubscribe((jpeg) => {
          if (phase === "disconnected" || phase === "idle") {
            return;
          }
          if (hideLivePreviewSpinnerOnFrame && jpeg.byteLength > 0) {
            hideLivePreviewSpinnerOnFrame = false;
            noPreviewAutoRetryCount = 0;
            if (previewStartWatchdog !== null) {
              clearTimeout(previewStartWatchdog);
              previewStartWatchdog = null;
            }
            setPhase("live");
            livePreviewView.setLoading(false);
          }
          if (!jpeg.byteLength) {
            return;
          }
          deliverPreviewFrame(jpeg);
        })
      );

      setPhase("opening");
      await startCameraWithRetry({ deviceId });
      if (getPlayhead() === "live") {
        livePreviewView.setStatus("Live camera feed");
      }
      renderCameraControls();
      persistCameraProfileNow();
      syncFocusOverlayUi();
    } catch (error) {
      setPhase("error");
      const rawDetail = ipcInvokeErrorMessage(error, "Camera could not start.");
      const { code, detail } = classifyCameraOpenError(rawDetail);
      const statusLine = cameraOpenErrorStatusLine(code);
      livePreviewView.setLoading(false);
      livePreviewView.setStatus(
        code === "unknown" ? rawDetail : `${statusLine} (${detail})`
      );
      livePreviewView.clearPreview();
      reportCameraUnavailable(rawDetail);
      renderCameraControls();
      syncFocusOverlayUi();
    } finally {
      initCameraInFlight = false;
      if (queuedInitCameraDeviceId !== undefined) {
        const nextPreferred = queuedInitCameraDeviceId;
        queuedInitCameraDeviceId = undefined;
        void initCamera(nextPreferred, { forceReopen: true });
      }
    }
  };

  const setPreviewUi = (el: HTMLImageElement | null, view: LivePreviewView): void => {
    livePreviewEl = el;
    livePreviewView = view;
  };

  const reattachPreviewSubscription = (): void => {
    bindPreviewSubscription();
  };

  return {
    initCamera,
    setPreviewUi,
    reattachPreviewSubscription,
    ensureIpcSubscriptions,
    dispose,
    getPhase: () => phase
  };
};
