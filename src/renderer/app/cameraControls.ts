import type { ProjectSession } from "../../shared/types/project";
import { escapeHtml } from "../utils/htmlEscape";

export const rangeControls = [
  "focusDistance",
  "zoom",
  "colorTemperature",
  "exposureCompensation",
  "exposureTime",
  "iso",
  "sensitivity",
  "gain",
  "brightness",
  "contrast",
  "saturation",
  "sharpness"
] as const;

export const CAMERA_CONTROL_LABELS: Record<string, string> = {
  focusDistance: "Focus distance",
  zoom: "Zoom",
  pan: "Pan",
  tilt: "Tilt",
  colorTemperature: "Color temperature",
  exposureCompensation: "Exposure compensation",
  exposureTime: "Exposure time",
  iso: "ISO",
  sensitivity: "Sensitivity",
  gain: "Gain",
  brightness: "Brightness",
  contrast: "Contrast",
  saturation: "Saturation",
  sharpness: "Sharpness"
};

export type NumCap = { min?: number; max?: number; step?: number };
const PAN_TILT_ZOOM_THRESHOLD = 100;
const cameraSettingsMetadataKeys = new Set([
  "deviceId",
  "groupId",
  "facingMode",
  "frameRate",
  "width",
  "height",
  "aspectRatio",
  "resizeMode"
]);

const hasNumericRangeCapability = (cap: unknown): cap is NumCap =>
  Boolean(cap) &&
  typeof (cap as NumCap).min === "number" &&
  typeof (cap as NumCap).max === "number" &&
  Number.isFinite((cap as NumCap).min) &&
  Number.isFinite((cap as NumCap).max);

const isPrimitiveConstraintValue = (value: unknown): value is string | number | boolean =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean";

const getRangeControlKeysFromCapabilities = (caps: Record<string, unknown>): string[] =>
  Object.entries(caps)
    .filter(([key, cap]) => !cameraSettingsMetadataKeys.has(key) && hasNumericRangeCapability(cap))
    .map(([key]) => key)
    .sort();

const getCurrentZoomValue = (settings: Record<string, unknown>, caps: Record<string, unknown>): number | null => {
  const zoomCap = caps.zoom as NumCap | undefined;
  const rawZoom = settings.zoom;
  if (
    !zoomCap ||
    typeof zoomCap.min !== "number" ||
    typeof zoomCap.max !== "number" ||
    typeof rawZoom !== "number" ||
    !Number.isFinite(rawZoom)
  ) {
    return null;
  }
  return Math.min(zoomCap.max, Math.max(zoomCap.min, rawZoom));
};

export const formatCapabilityNumber = (value: number, step?: number): string => {
  if (!Number.isFinite(value)) {
    return "—";
  }
  const s = step ?? 0;
  if (s > 0 && s < 1) {
    return value.toFixed(2);
  }
  if (Number.isInteger(value) && (!s || s >= 1)) {
    return String(Math.round(value));
  }
  return value.toFixed(2);
};

/** Optional project zoomSliderMax caps the zoom range slider max. */
export const getEffectiveNumCap = (key: string, cap: NumCap, zoomSliderMax?: number | null): NumCap => {
  if (key !== "zoom") {
    return cap;
  }
  if (typeof zoomSliderMax !== "number" || !Number.isFinite(zoomSliderMax)) {
    return cap;
  }
  const lo = typeof cap.min === "number" ? cap.min : 0;
  const hi = typeof cap.max === "number" ? cap.max : zoomSliderMax;
  const clamped = Math.min(hi, Math.max(lo, zoomSliderMax));
  return { ...cap, min: lo, max: clamped };
};

export interface RenderCameraControlsParams {
  cameraControlsContainer: HTMLElement;
  session: ProjectSession;
  getCapabilities: () => Promise<Record<string, unknown>>;
  getControls: () => Promise<Record<string, unknown>>;
  setControls: (partial: Record<string, unknown>) => Promise<void>;
  saveProject: () => Promise<void>;
  /**
   * After each await, if this returns true, abort so an out-of-order completion
   * cannot overwrite the panel or cameraProfile with stale device data.
   */
  abortIfStale?: () => boolean;
}

export const renderCameraControlsInner = async ({
  cameraControlsContainer,
  session,
  getCapabilities,
  getControls,
  setControls,
  saveProject,
  abortIfStale
}: RenderCameraControlsParams): Promise<void> => {
  const stale = (): boolean => abortIfStale?.() ?? false;

  const capabilities = await getCapabilities();
  if (stale()) {
    return;
  }
  const settings = (await getControls()) as Record<string, unknown>;
  if (stale()) {
    return;
  }

  const dynamicRangeKeys = getRangeControlKeysFromCapabilities(capabilities);
  const rangeKeys = Array.from(new Set([...rangeControls, ...dynamicRangeKeys]));
  const currentZoomValue = getCurrentZoomValue(settings, capabilities);
  const shouldShowPanTilt = currentZoomValue !== null && currentZoomValue > PAN_TILT_ZOOM_THRESHOLD;
  const allowedSettingsKeys = new Set<string>([...rangeKeys]);
  const persistedFromControls = Object.fromEntries(
    Object.entries(settings).filter(([key, value]) => {
      if (!allowedSettingsKeys.has(key) || cameraSettingsMetadataKeys.has(key)) {
        return false;
      }
      return isPrimitiveConstraintValue(value);
    })
  );

  const zoomSliderMax = session.project.cameraProfile.zoomSliderMax;
  let lastZoomRequested: number | null = null;
  let lastZoomReadback: number | null =
    typeof settings.zoom === "number" && Number.isFinite(settings.zoom) ? Number(settings.zoom) : null;
  let zoomNoEffectCount = 0;

  const zoomDeviceCap = capabilities.zoom as NumCap | undefined;
  const zoomDeviceMin = typeof zoomDeviceCap?.min === "number" ? zoomDeviceCap.min : 0;
  const zoomDeviceMax = typeof zoomDeviceCap?.max === "number" ? zoomDeviceCap.max : 1000;
  const zoomDeviceStep =
    zoomDeviceCap?.step !== undefined && typeof zoomDeviceCap.step === "number" && zoomDeviceCap.step > 0
      ? zoomDeviceCap.step
      : 1;
  const gainCap = hasNumericRangeCapability(capabilities.gain);
  const hideIsoLikeWhenGain = (key: string): boolean =>
    !(gainCap && (key === "iso" || key === "sensitivity"));

  const sliderSections: Array<{ title: string; keys: string[] }> = [
    { title: "Focus", keys: ["focusDistance", "zoom", ...(shouldShowPanTilt ? ["pan", "tilt"] : [])] },
    { title: "White balance", keys: ["colorTemperature"] },
    {
      title: "Exposure",
      keys: [
        "exposureCompensation",
        "exposureTime",
        "iso",
        "sensitivity",
        "gain",
        "brightness",
        "contrast",
        "saturation",
        "sharpness"
      ].filter(hideIsoLikeWhenGain)
    }
  ];

  const assignedKeys = new Set(sliderSections.flatMap((s) => s.keys));

  const buildSliderRow = (key: string): string => {
    const label = CAMERA_CONTROL_LABELS[key] ?? key;
    const cap = capabilities[key] as NumCap | undefined;
    const hasRange =
      key !== "zoom" &&
      Boolean(cap) &&
      typeof cap!.min === "number" &&
      typeof cap!.max === "number" &&
      Number.isFinite(cap!.min) &&
      Number.isFinite(cap!.max);
    const effective = hasRange ? getEffectiveNumCap(key, cap!, zoomSliderMax) : null;
    const min = hasRange && effective ? effective.min! : 0;
    const max = hasRange && effective ? effective.max! : 100;
    const deviceStep =
      hasRange && effective && effective.step !== undefined && effective.step > 0 ? effective.step : 1;
    /** Driver often reports a coarse step; IAMCameraControl::Set still accepts integer values in range. */
    const step = key === "focusDistance" ? 1 : deviceStep;
    const raw = settings[key];
    const parsed = typeof raw === "number" && Number.isFinite(raw) ? raw : min;
    const displayValue = hasRange ? Math.min(Math.max(parsed, min), max) : Number.isFinite(parsed) ? parsed : min;

    if (!hasRange) {
      const safeLabel = escapeHtml(label);
      return `
            <div class="mb-3">
              <div class="d-flex justify-content-between align-items-baseline mb-1 gap-2">
                <span class="form-label mb-0 text-secondary">${safeLabel}</span>
                <span class="small text-secondary font-monospace text-nowrap">— / —</span>
              </div>
              <input type="range" class="form-range opacity-50" disabled
                min="${min}" max="${max}" step="${step}" value="${displayValue}" />
              <p class="text-secondary small mb-0 mt-1">This device does not support manual control for ${safeLabel}.</p>
            </div>
          `;
    }

    const safeLabel = escapeHtml(label);
    return `
          <div class="mb-3">
            <div class="d-flex justify-content-between align-items-baseline mb-1 gap-2">
              <label class="form-label mb-0" for="camera-${key}">${safeLabel}</label>
              <span class="small text-secondary font-monospace text-nowrap" data-camera-readout="${key}">${formatCapabilityNumber(displayValue, step)} / ${formatCapabilityNumber(max, step)}</span>
            </div>
            <input id="camera-${key}" data-camera-control="${key}" type="range" class="form-range"
              min="${min}" max="${max}" step="${step}" value="${displayValue}" />
          </div>
        `;
  };

  const capabilityRows: string[] = [];
  sliderSections.forEach((section) => {
    const rows = section.keys.map((key) => buildSliderRow(key)).join("");
    capabilityRows.push(`
          <section class="border rounded-2 p-3">
            <div class="small fw-semibold mb-2">${section.title}</div>
            ${rows}
          </section>
        `);
  });

  const ungroupedKeys = rangeKeys.filter((k) => k !== "pan" && k !== "tilt" && !assignedKeys.has(k));
  if (ungroupedKeys.length > 0) {
    const rows = ungroupedKeys.map((key) => buildSliderRow(key)).join("");
    capabilityRows.push(`
          <section class="border rounded-2 p-3">
            <div class="small fw-semibold mb-2">Additional controls</div>
            ${rows}
          </section>
        `);
  }

  if (stale()) {
    return;
  }
  session.project.cameraProfile.supportedControls = capabilities;
  session.project.cameraProfile.values = {
    ...session.project.cameraProfile.values,
    ...persistedFromControls
  };
  cameraControlsContainer.innerHTML = capabilityRows.join("");

  const updateReadout = (ctrlKey: string): void => {
    const input = cameraControlsContainer.querySelector<HTMLInputElement>(`[data-camera-control="${ctrlKey}"]`);
    const readout = cameraControlsContainer.querySelector(`[data-camera-readout="${ctrlKey}"]`);
    if (!input || !readout || input.disabled) {
      return;
    }
    const maxVal = Number(input.max);
    const stepVal = Number(input.step) || 1;
    const val = Number(input.value);
    readout.textContent = `${formatCapabilityNumber(val, stepVal)} / ${formatCapabilityNumber(maxVal, stepVal)}`;
  };

  type ControlApplyState = { inFlight: boolean; queuedValue: number | null };
  const controlApplyStates = new Map<string, ControlApplyState>();
  const enqueueControlApply = (controlKey: string, requestedValue: number): void => {
    let applyState = controlApplyStates.get(controlKey);
    if (!applyState) {
      applyState = { inFlight: false, queuedValue: null };
      controlApplyStates.set(controlKey, applyState);
    }
    applyState.queuedValue = requestedValue;
    if (applyState.inFlight) {
      return;
    }
    applyState.inFlight = true;
    void (async () => {
      while (applyState && applyState.queuedValue !== null) {
        const nextValue = applyState.queuedValue;
        applyState.queuedValue = null;
        try {
          await setControls({ [controlKey]: nextValue });
          session.project.cameraProfile.values[controlKey] = nextValue;
          await saveProject();
        } catch {
          /* Driver may reject unsupported combinations */
        }
      }
      if (applyState) {
        applyState.inFlight = false;
      }
    })();
  };

  cameraControlsContainer.querySelectorAll<HTMLInputElement>("[data-camera-control]").forEach((control) => {
    const controlKey = control.dataset.cameraControl;
    if (!controlKey) {
      return;
    }
    control.addEventListener("input", () => {
      updateReadout(controlKey);
      if (control.disabled) {
        return;
      }
      const nextValue = Number(control.value);
      enqueueControlApply(controlKey, nextValue);
    });
    updateReadout(controlKey);
  });
};
