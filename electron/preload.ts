import { contextBridge, ipcRenderer } from "electron";
import type { AppInfo } from "../src/shared/appInfo";
import type { CaptureMode, FrameRecord, ProjectFile, ProjectSession } from "../src/shared/types/project";
import type { MenuCommandEvent, MenuCommandId, RecentProjectEntry } from "../src/shared/types/ipc";

interface CreateProjectInput {
  title: string;
  fps: number;
  captureMode: CaptureMode;
  sourcePath: string;
}

const api = {
  getAppInfo: () => ipcRenderer.invoke("app:get-info") as Promise<AppInfo>,
  pickDirectory: () => ipcRenderer.invoke("dialog:pick-directory") as Promise<string | null>,
  setMenuVisibility: (visible: boolean) => ipcRenderer.invoke("menu:set-visible", visible) as Promise<{ ok: boolean }>,
  exitFullscreen: () => ipcRenderer.invoke("window:exit-fullscreen") as Promise<{ ok: boolean; wasFullscreen: boolean }>,
  openPath: (targetPath: string) => ipcRenderer.invoke("file:open-path", targetPath) as Promise<{ ok: boolean }>,
  createProject: (payload: CreateProjectInput) => ipcRenderer.invoke("project:create", payload) as Promise<ProjectSession>,
  openProject: (projectDirectory: string) => ipcRenderer.invoke("project:open", projectDirectory) as Promise<ProjectSession>,
  listRecentProjects: () => ipcRenderer.invoke("project:list-recent") as Promise<RecentProjectEntry[]>,
  saveProject: (projectRoot: string, project: ProjectFile) => ipcRenderer.invoke("project:save", { projectRoot, project }),
  captureFrame: (payload: {
    projectRoot: string;
    frameId: string;
    sequenceIndex: number;
    previewDataUrl: string;
    sourceDataUrl: string;
  }) => ipcRenderer.invoke("frame:capture", payload) as Promise<{ frame: FrameRecord }>,
  captureFrameFromPaths: (payload: {
    projectRoot: string;
    frameId: string;
    sequenceIndex: number;
    previewPath: string;
    sourcePath: string;
  }) => ipcRenderer.invoke("frame:capture-from-paths", payload) as Promise<{ frame: FrameRecord }>,
  deleteFrameFiles: (payload: {
    projectRoot: string;
    previewPath: string;
    sourcePath: string;
    thumbPath?: string | null;
  }) => ipcRenderer.invoke("frame:delete", payload),
  deleteFrameFilesUndoable: (payload: {
    projectRoot: string;
    undoToken: string;
    frameId: string;
    previewPath: string;
    sourcePath: string;
    thumbPath?: string | null;
  }) => ipcRenderer.invoke("frame:delete-undoable", payload),
  restoreUndoDelete: (payload: { projectRoot: string; undoToken: string }) =>
    ipcRenderer.invoke("frame:restore-undo-delete", payload) as Promise<{ ok: boolean }>,
  readFileBuffer: (projectRoot: string, relativePath: string) =>
    ipcRenderer.invoke("file:read-buffer", { projectRoot, relativePath }) as Promise<Uint8Array>,
  readFileDataUrl: (projectRoot: string, relativePath: string) =>
    ipcRenderer.invoke("file:read-data-url", { projectRoot, relativePath }) as Promise<string>,
  exportSequenceAdvanced: (payload: {
    projectRoot: string;
    sequenceExports: Array<{ sequenceId: string; title: string; frameIdOrder: string[] }>;
    framesById: Record<string, { sourcePath: string }>;
    destinationMode: "project_default" | "custom";
    customExportRoot?: string | null;
    conflictAction?: "replace" | "keep_both" | null;
    frameFilePrefix?: string | null;
  }) =>
    ipcRenderer.invoke("project:export-sequence-advanced", payload) as Promise<
      | { status: "ok"; exportDir: string; exportedCount: number }
      | { status: "cancelled" }
    >,
  relocateProjectRoot: (payload: { projectRoot: string; nextProjectRoot: string; project: ProjectFile }) =>
    ipcRenderer.invoke("project:relocate-root", payload) as Promise<ProjectSession>,
  cameraListDevices: (payload?: Record<string, unknown>) =>
    ipcRenderer.invoke("camera:list-devices", payload) as Promise<Array<{ id: string; label: string }>>,
  cameraOpen: (payload: { deviceId: string }) =>
    ipcRenderer.invoke("camera:open", payload) as Promise<void>,
  cameraClose: () => ipcRenderer.invoke("camera:close") as Promise<void>,
  cameraGetCapabilities: (payload?: Record<string, unknown>) =>
    ipcRenderer.invoke("camera:get-capabilities", payload) as Promise<Record<string, unknown>>,
  cameraGetControls: (payload?: Record<string, unknown>) =>
    ipcRenderer.invoke("camera:get-controls", payload) as Promise<Record<string, unknown>>,
  cameraSetControls: (payload: { partial: Record<string, unknown> }) =>
    ipcRenderer.invoke("camera:set-controls", payload) as Promise<void>,
  cameraCaptureLive: (payload: {
    projectRoot: string;
    frameId: string;
    sequenceIndex: number;
    captureMode: CaptureMode;
  }) => ipcRenderer.invoke("camera:capture-live", payload) as Promise<{ frame: FrameRecord }>,
  cameraPreviewSubscribe: (handler: (jpeg: Uint8Array) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      if (payload == null) {
        return;
      }
      // Main always sends Uint8Array; structured clone already produced an isolated copy in the renderer.
      if (payload instanceof Uint8Array) {
        if (!payload.byteLength) {
          return;
        }
        handler(payload);
        return;
      }
      // Ignore unexpected payload types to keep renderer contract strict.
    };
    ipcRenderer.on("camera:preview", wrapped);
    return () => {
      ipcRenderer.removeListener("camera:preview", wrapped);
    };
  },
  cameraStatusSubscribe: (handler: (event: {
    phase: "stalled" | "error" | "disconnected";
    code: "preview_stalled" | "preview_read_failed" | "device_removed";
    detail: string;
    deviceId?: string;
  }) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      if (!payload || typeof payload !== "object") {
        return;
      }
      const row = payload as { phase?: unknown; code?: unknown; detail?: unknown; deviceId?: unknown };
      const phaseOk = row.phase === "stalled" || row.phase === "error" || row.phase === "disconnected";
      const codeOk =
        row.code === "preview_stalled" || row.code === "preview_read_failed" || row.code === "device_removed";
      if (!phaseOk || !codeOk || typeof row.detail !== "string") {
        return;
      }
      const phase = row.phase as "stalled" | "error" | "disconnected";
      const code = row.code as "preview_stalled" | "preview_read_failed" | "device_removed";
      const deviceId = typeof row.deviceId === "string" ? row.deviceId : undefined;
      handler({ phase, code, detail: row.detail, deviceId });
    };
    ipcRenderer.on("camera:status", wrapped);
    return () => {
      ipcRenderer.removeListener("camera:status", wrapped);
    };
  },
  cameraDevicesChangedSubscribe: (handler: (event: {
    devices: Array<{ id: string; label: string }>;
    addedIds: string[];
    removedIds: string[];
  }) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      if (!payload || typeof payload !== "object") {
        return;
      }
      const row = payload as { devices?: unknown; addedIds?: unknown; removedIds?: unknown };
      if (!Array.isArray(row.devices) || !Array.isArray(row.addedIds) || !Array.isArray(row.removedIds)) {
        return;
      }
      const devices = row.devices
        .filter((d): d is { id: string; label: string } =>
          Boolean(d) &&
          typeof d === "object" &&
          typeof (d as { id?: unknown }).id === "string" &&
          typeof (d as { label?: unknown }).label === "string"
        )
        .map((d) => ({ id: d.id, label: d.label }));
      const addedIds = row.addedIds.filter((id): id is string => typeof id === "string");
      const removedIds = row.removedIds.filter((id): id is string => typeof id === "string");
      handler({ devices, addedIds, removedIds });
    };
    ipcRenderer.on("camera:devices-changed", wrapped);
    return () => {
      ipcRenderer.removeListener("camera:devices-changed", wrapped);
    };
  },
  menuCommandSubscribe: (handler: (event: MenuCommandEvent) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      if (!payload || typeof payload !== "object") {
        return;
      }
      const row = payload as { id?: unknown; payload?: unknown };
      if (typeof row.id !== "string") {
        return;
      }
      handler({
        id: row.id as MenuCommandId,
        payload: (row.payload as MenuCommandEvent["payload"]) ?? null
      });
    };
    ipcRenderer.on("menu:command", wrapped);
    return () => {
      ipcRenderer.removeListener("menu:command", wrapped);
    };
  }
};

contextBridge.exposeInMainWorld("brickMotion", api);
