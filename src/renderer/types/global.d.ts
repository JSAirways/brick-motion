import type { AppInfo } from "../../shared/appInfo";
import type { CaptureMode } from "../../shared/types/project";
import type { FrameRecord, ProjectFile, ProjectSession } from "../../shared/types/project";
import type { MenuCommandEvent, RecentProjectEntry } from "../../shared/types/ipc";

declare global {
  interface Window {
    brickMotion: {
      getAppInfo: () => Promise<AppInfo>;
      pickDirectory: () => Promise<string | null>;
      setMenuVisibility: (visible: boolean) => Promise<{ ok: boolean }>;
      exitFullscreen: () => Promise<{ ok: boolean; wasFullscreen: boolean }>;
      openPath: (targetPath: string) => Promise<{ ok: boolean }>;
      createProject: (payload: {
        title: string;
        fps: number;
        captureMode: CaptureMode;
        sourcePath: string;
      }) => Promise<ProjectSession>;
      openProject: (projectDirectory: string) => Promise<ProjectSession>;
      listRecentProjects: () => Promise<RecentProjectEntry[]>;
      saveProject: (projectRoot: string, project: ProjectFile) => Promise<{ ok: boolean }>;
      captureFrame: (payload: {
        projectRoot: string;
        frameId: string;
        sequenceIndex: number;
        previewDataUrl: string;
        sourceDataUrl: string;
      }) => Promise<{ frame: FrameRecord }>;
      captureFrameFromPaths: (payload: {
        projectRoot: string;
        frameId: string;
        sequenceIndex: number;
        previewPath: string;
        sourcePath: string;
      }) => Promise<{ frame: FrameRecord }>;
      deleteFrameFiles: (payload: {
        projectRoot: string;
        previewPath: string;
        sourcePath: string;
        thumbPath?: string | null;
      }) => Promise<{ ok: boolean }>;
      deleteFrameFilesUndoable: (payload: {
        projectRoot: string;
        undoToken: string;
        frameId: string;
        previewPath: string;
        sourcePath: string;
        thumbPath?: string | null;
      }) => Promise<{ ok: boolean }>;
      restoreUndoDelete: (payload: { projectRoot: string; undoToken: string }) => Promise<{ ok: boolean }>;
      readFileBuffer: (projectRoot: string, relativePath: string) => Promise<Uint8Array>;
      readFileDataUrl: (projectRoot: string, relativePath: string) => Promise<string>;
      exportSequenceAdvanced: (payload: {
        projectRoot: string;
        sequenceExports: Array<{ sequenceId: string; title: string; frameIdOrder: string[] }>;
        framesById: Record<string, { sourcePath: string }>;
        destinationMode: "project_default" | "custom";
        customExportRoot?: string | null;
        conflictAction?: "replace" | "keep_both" | null;
        frameFilePrefix?: string | null;
      }) => Promise<
        | { status: "ok"; exportDir: string; exportedCount: number }
        | { status: "cancelled" }
      >;
      relocateProjectRoot: (payload: {
        projectRoot: string;
        nextProjectRoot: string;
        project: ProjectFile;
      }) => Promise<ProjectSession>;
      cameraOpen: (payload: { deviceId: string }) => Promise<void>;
      cameraClose: () => Promise<void>;
      cameraListDevices: (payload?: Record<string, unknown>) => Promise<Array<{ id: string; label: string }>>;
      cameraGetCapabilities: (payload?: Record<string, unknown>) => Promise<Record<string, unknown>>;
      cameraGetControls: (payload?: Record<string, unknown>) => Promise<Record<string, unknown>>;
      cameraSetControls: (payload: {
        partial: Record<string, unknown>;
      }) => Promise<void>;
      cameraCaptureLive: (payload: {
        projectRoot: string;
        frameId: string;
        sequenceIndex: number;
        captureMode: CaptureMode;
      }) => Promise<{ frame: FrameRecord }>;
      cameraPreviewSubscribe: (handler: (jpeg: Uint8Array) => void) => () => void;
      cameraStatusSubscribe: (handler: (event: {
        phase: "stalled" | "error" | "disconnected";
        code: "preview_stalled" | "preview_read_failed" | "device_removed";
        detail: string;
        deviceId?: string;
      }) => void) => () => void;
      cameraDevicesChangedSubscribe: (handler: (event: {
        devices: Array<{ id: string; label: string }>;
        addedIds: string[];
        removedIds: string[];
      }) => void) => () => void;
      menuCommandSubscribe: (handler: (event: MenuCommandEvent) => void) => () => void;
    };
  }
}

export {};
