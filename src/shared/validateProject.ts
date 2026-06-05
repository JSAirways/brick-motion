import type { CaptureMode, FrameRecord, PlaybackTimingMode, ProjectFile, SequenceRecord } from "./types/project";

export type ValidateProjectResult = { ok: true; project: ProjectFile } | { ok: false; error: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Accepts current `project.json` values. */
export const normalizeCaptureMode = (value: unknown): CaptureMode | null => {
  if (value === "jpeg" || value === "png") {
    return value;
  }
  if (value === "jpeg_only") {
    return "jpeg";
  }
  if (value === "png_master_with_jpeg_preview") {
    return "png";
  }
  return null;
};

const isPlaybackTimingMode = (value: unknown): value is PlaybackTimingMode =>
  value === "hold_after_decode" || value === "wall_clock";

/** Same basename as preview, under `frames/timeline-thumb/` (matches capture layout). */
const defaultTimelineThumbPathFromPreview = (previewPath: string): string => {
  const i = previewPath.lastIndexOf("/");
  const file = i >= 0 ? previewPath.slice(i + 1) : previewPath;
  return `frames/timeline-thumb/${file}`;
};

function validateFrameRecord(frame: unknown, _frameId: string): FrameRecord | null {
  if (!isRecord(frame)) {
    return null;
  }
  const { sequenceIndex, previewPath, sourcePath, createdAt, timelineThumbPath } = frame;
  if (typeof sequenceIndex !== "number" || !Number.isFinite(sequenceIndex)) {
    return null;
  }
  if (typeof previewPath !== "string" || typeof sourcePath !== "string") {
    return null;
  }
  if (previewPath.includes("..") || sourcePath.includes("..")) {
    return null;
  }
  if (typeof createdAt !== "string") {
    return null;
  }
  let thumb: string;
  if (typeof timelineThumbPath === "string" && timelineThumbPath.length > 0 && !timelineThumbPath.includes("..")) {
    thumb = timelineThumbPath;
  } else {
    thumb = defaultTimelineThumbPathFromPreview(previewPath);
  }
  return { sequenceIndex, previewPath, timelineThumbPath: thumb, sourcePath, createdAt };
}

/**
 * Validates parsed JSON from disk (or IPC) against the expected project shape.
 */
export function parseAndValidateProject(raw: unknown): ValidateProjectResult {
  if (!isRecord(raw)) {
    return { ok: false, error: "Project file must be a JSON object." };
  }

  const appVersion = raw.appVersion;
  if (typeof appVersion !== "number" || !Number.isFinite(appVersion) || appVersion < 1) {
    return { ok: false, error: "Invalid or missing appVersion." };
  }

  const projectTitle = raw.projectTitle;
  if (typeof projectTitle !== "string" || projectTitle.trim().length === 0) {
    return { ok: false, error: "Invalid or missing projectTitle." };
  }

  const captureMode = normalizeCaptureMode(raw.captureMode);
  if (!captureMode) {
    return { ok: false, error: "Invalid captureMode." };
  }

  const fps = raw.fps;
  if (typeof fps !== "number" || !Number.isFinite(fps) || fps < 1 || fps > 120) {
    return { ok: false, error: "Invalid fps (expected 1–120)." };
  }

  const sourcePath = raw.sourcePath;
  if (typeof sourcePath !== "string" || sourcePath.length === 0) {
    return { ok: false, error: "Invalid sourcePath." };
  }

  if (!Array.isArray(raw.sequenceOrder)) {
    return { ok: false, error: "sequenceOrder must be an array." };
  }
  const sequenceOrder = raw.sequenceOrder.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
  if (sequenceOrder.length !== raw.sequenceOrder.length || sequenceOrder.length === 0) {
    return { ok: false, error: "sequenceOrder must contain non-empty sequence ids." };
  }
  const activeSequenceId = typeof raw.activeSequenceId === "string" ? raw.activeSequenceId.trim() : "";
  if (!activeSequenceId) {
    return { ok: false, error: "activeSequenceId is required." };
  }

  if (!isRecord(raw.framesById)) {
    return { ok: false, error: "framesById must be an object." };
  }

  const framesById: Record<string, FrameRecord> = {};
  for (const [frameId, frame] of Object.entries(raw.framesById)) {
    const valid = validateFrameRecord(frame, frameId);
    if (!valid) {
      return { ok: false, error: `Invalid frame record for id "${frameId}".` };
    }
    framesById[frameId] = valid;
  }

  if (!isRecord(raw.sequencesById)) {
    return { ok: false, error: "sequencesById must be an object." };
  }
  const sequencesById: Record<string, SequenceRecord> = {};
  for (const [sequenceId, sequenceRaw] of Object.entries(raw.sequencesById)) {
    if (!isRecord(sequenceRaw)) {
      return { ok: false, error: `Invalid sequence record for id "${sequenceId}".` };
    }
    const title = typeof sequenceRaw.title === "string" ? sequenceRaw.title.trim() : "";
    const createdAt = typeof sequenceRaw.createdAt === "string" ? sequenceRaw.createdAt : "";
    const updatedAt = typeof sequenceRaw.updatedAt === "string" ? sequenceRaw.updatedAt : "";
    if (!title || !createdAt || !updatedAt || !Array.isArray(sequenceRaw.frameIdOrder)) {
      return { ok: false, error: `Invalid sequence fields for id "${sequenceId}".` };
    }
    const seqFrameOrder = sequenceRaw.frameIdOrder.filter((id): id is string => typeof id === "string");
    if (seqFrameOrder.length !== sequenceRaw.frameIdOrder.length) {
      return { ok: false, error: `Sequence "${sequenceId}" frameIdOrder must contain only strings.` };
    }
    for (const frameId of seqFrameOrder) {
      if (!framesById[frameId]) {
        return { ok: false, error: `Sequence "${sequenceId}" references missing frame "${frameId}".` };
      }
    }
    sequencesById[sequenceId] = {
      id: sequenceId,
      title,
      frameIdOrder: seqFrameOrder,
      createdAt,
      updatedAt
    };
  }
  for (const sequenceId of sequenceOrder) {
    if (!sequencesById[sequenceId]) {
      return { ok: false, error: `sequenceOrder references missing sequence "${sequenceId}".` };
    }
  }
  if (!sequencesById[activeSequenceId]) {
    return { ok: false, error: "activeSequenceId references missing sequence." };
  }
  const frameIdOrder = sequencesById[activeSequenceId]?.frameIdOrder ?? [];

  if (!isRecord(raw.cameraProfile)) {
    return { ok: false, error: "cameraProfile must be an object." };
  }
  const cp = raw.cameraProfile;
  if (cp.backend !== undefined) {
    return { ok: false, error: "cameraProfile.backend is no longer supported." };
  }
  const deviceId = cp.deviceId;
  if (deviceId !== null && typeof deviceId !== "string") {
    return { ok: false, error: "cameraProfile.deviceId must be string or null." };
  }
  const deviceLabel = cp.deviceLabel;
  if (deviceLabel !== undefined && deviceLabel !== null && typeof deviceLabel !== "string") {
    return { ok: false, error: "cameraProfile.deviceLabel must be string, null, or omitted." };
  }
  const zoomSliderMax = cp.zoomSliderMax;
  if (
    zoomSliderMax !== undefined &&
    zoomSliderMax !== null &&
    (typeof zoomSliderMax !== "number" || !Number.isFinite(zoomSliderMax))
  ) {
    return { ok: false, error: "cameraProfile.zoomSliderMax must be a number, null, or omitted." };
  }
  if (!isRecord(cp.supportedControls)) {
    return { ok: false, error: "cameraProfile.supportedControls must be an object." };
  }
  if (!isRecord(cp.values)) {
    return { ok: false, error: "cameraProfile.values must be an object." };
  }

  if (!isRecord(raw.uiState)) {
    return { ok: false, error: "uiState must be an object." };
  }
  const us = raw.uiState;
  if (typeof us.onionEnabled !== "boolean") {
    return { ok: false, error: "uiState.onionEnabled must be boolean." };
  }
  if (typeof us.onionOpacity !== "number" || !Number.isFinite(us.onionOpacity)) {
    return { ok: false, error: "uiState.onionOpacity must be a number." };
  }
  if (typeof us.loopEnabled !== "boolean") {
    return { ok: false, error: "uiState.loopEnabled must be boolean." };
  }
  const tp = us.timelinePosition;
  if (tp !== "live" && (typeof tp !== "number" || !Number.isFinite(tp))) {
    return { ok: false, error: "uiState.timelinePosition must be 'live' or a number." };
  }

  const playbackTimingRaw = us.playbackTimingMode;
  if (
    playbackTimingRaw !== undefined &&
    playbackTimingRaw !== null &&
    !isPlaybackTimingMode(playbackTimingRaw)
  ) {
    return { ok: false, error: "uiState.playbackTimingMode must be hold_after_decode or wall_clock." };
  }
  const playbackTimingMode: PlaybackTimingMode =
    playbackTimingRaw === undefined || playbackTimingRaw === null
      ? "hold_after_decode"
      : playbackTimingRaw;

  const showPlaybackFpsOverlay =
    typeof us.showPlaybackFpsOverlay === "boolean" ? us.showPlaybackFpsOverlay : false;

  const createdAt = raw.createdAt;
  const updatedAt = raw.updatedAt;
  if (typeof createdAt !== "string" || typeof updatedAt !== "string") {
    return { ok: false, error: "createdAt and updatedAt must be strings." };
  }

  const cameraProfile: ProjectFile["cameraProfile"] = {
    deviceId: deviceId === null ? null : deviceId,
    supportedControls: cp.supportedControls as Record<string, unknown>,
    values: cp.values as Record<string, unknown>
  };
  if (deviceLabel === null) {
    cameraProfile.deviceLabel = null;
  } else if (typeof deviceLabel === "string") {
    cameraProfile.deviceLabel = deviceLabel;
  }
  if (zoomSliderMax === null) {
    cameraProfile.zoomSliderMax = null;
  } else if (zoomSliderMax !== undefined) {
    cameraProfile.zoomSliderMax = zoomSliderMax;
  }

  const project: ProjectFile = {
    appVersion,
    projectTitle,
    captureMode,
    fps,
    sourcePath,
    frameIdOrder,
    sequenceOrder,
    sequencesById,
    activeSequenceId,
    framesById,
    cameraProfile,
    uiState: {
      onionEnabled: us.onionEnabled,
      onionOpacity: us.onionOpacity,
      loopEnabled: us.loopEnabled,
      timelinePosition: tp,
      playbackTimingMode,
      showPlaybackFpsOverlay
    },
    createdAt,
    updatedAt
  };

  return { ok: true, project };
}

export interface CreateProjectPayload {
  title: string;
  fps: number;
  captureMode: CaptureMode;
  sourcePath: string;
}

export function validateCreateProjectPayload(raw: unknown): CreateProjectPayload | null {
  if (!isRecord(raw)) {
    return null;
  }
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const sourcePath = typeof raw.sourcePath === "string" ? raw.sourcePath.trim() : "";
  const fps = Number(raw.fps);
  if (!title || !sourcePath || !Number.isFinite(fps) || fps < 1 || fps > 120) {
    return null;
  }
  const captureMode = normalizeCaptureMode(raw.captureMode);
  if (!captureMode) {
    return null;
  }
  return { title, fps, captureMode, sourcePath };
}
