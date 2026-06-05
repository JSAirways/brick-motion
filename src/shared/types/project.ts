export type CaptureMode = "jpeg" | "png";

/** Stop-motion playback: hold each frame for `1/fps` after decode vs. align to wall clock from play start (may skip frames if behind). */
export type PlaybackTimingMode = "hold_after_decode" | "wall_clock";

export interface FrameRecord {
  sequenceIndex: number;
  previewPath: string;
  /** Small JPEG for the timeline strip (`frames/timeline-thumb/`). */
  timelineThumbPath: string;
  sourcePath: string;
  createdAt: string;
}

export interface SequenceRecord {
  id: string;
  title: string;
  frameIdOrder: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectFile {
  appVersion: number;
  projectTitle: string;
  captureMode: CaptureMode;
  fps: number;
  sourcePath: string;
  /** Active sequence frame order mirror for renderer/runtime convenience. */
  frameIdOrder: string[];
  sequenceOrder: string[];
  sequencesById: Record<string, SequenceRecord>;
  activeSequenceId: string;
  framesById: Record<string, FrameRecord>;
  cameraProfile: {
    deviceId: string | null;
    /** Last selected camera label used as fallback when device ids are reassigned by the OS. */
    deviceLabel?: string | null;
    /** When set, caps the zoom range slider max (device capabilities are often wrong). Omit or null to use the driver range. */
    zoomSliderMax?: number | null;
    supportedControls: Record<string, unknown>;
    values: Record<string, unknown>;
  };
  uiState: {
    onionEnabled: boolean;
    onionOpacity: number;
    loopEnabled: boolean;
    timelinePosition: "live" | number;
    /** How timeline playback spaces frames (default hold-after-decode). */
    playbackTimingMode: PlaybackTimingMode;
    /** When true, show target vs. measured ms (and wall-clock skips) on the preview area during playback. */
    showPlaybackFpsOverlay: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSession {
  projectRoot: string;
  projectFilePath: string;
  project: ProjectFile;
  /** Set when `openProject` dropped timeline entries whose image files were missing on disk. */
  missingFramesRemoved?: number;
  /** Frames removed because required preview/source assets were missing. */
  missingFrameAssetsRemoved?: number;
  /** Timeline thumbs regenerated from preview JPEG on `project:open`. */
  timelineThumbsRepaired?: number;
}
