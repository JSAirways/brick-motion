import type { ProjectSession } from "../../../shared/types/project";

export interface WorkspaceRefs {
  refreshCamerasButton: HTMLButtonElement | null;
  cameraDeviceSelect: HTMLSelectElement | null;
  projectSettingsForm: HTMLFormElement | null;
  changeProjectFolderButton: HTMLButtonElement | null;
  exportPathModeDefault: HTMLInputElement | null;
  exportPathModeCustom: HTMLInputElement | null;
  exportConflictReplace: HTMLInputElement | null;
  exportConflictKeepBoth: HTMLInputElement | null;
  exportScopeActive: HTMLInputElement | null;
  exportScopeSelected: HTMLInputElement | null;
  exportScopeAll: HTMLInputElement | null;
  exportSequenceSelectionList: HTMLElement | null;
  customExportPathInput: HTMLInputElement | null;
  exportFramePrefixInput: HTMLInputElement | null;
  pickExportPathButton: HTMLButtonElement | null;
  exportSequenceForm: HTMLFormElement | null;
  openExportAfterDone: HTMLInputElement | null;
}

export interface WorkspaceContext {
  refs: WorkspaceRefs;
  sanitizeFrameFilePrefix: (raw: string) => string;
  getCurrentSession: () => ProjectSession | null;
  setCurrentSession: (session: ProjectSession) => void;
  setStatus: (message: string) => void;
  draw: () => void;
  clearFrameHistory: () => void;
  populateCameraDevices: () => Promise<Array<{ id: string; label: string }>>;
  initCamera: (preferredDeviceId?: string | null, options?: { forceReopen?: boolean }) => Promise<void>;
  isCameraDeviceChangeSuppressed: () => boolean;
  syncExportPathUi: () => void;
  saveProject: () => Promise<void>;
}
