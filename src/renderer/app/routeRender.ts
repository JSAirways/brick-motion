import type { RecentProjectEntry } from "../../shared/types/ipc";
import type { ProjectSession } from "../../shared/types/project";
import { renderCaptureWorkspace } from "../templates/capture-workspace/shell";
import { renderNewProjectForm } from "../templates/new-project/newProjectForm";
import { renderStartScreen } from "../templates/start-screen/startScreen";

export const renderStartRoute = (params: {
  root: HTMLElement;
  recentProjects: RecentProjectEntry[];
  loading: boolean;
  withOverlay: (loading: boolean) => string;
  bind: () => void;
}) => {
  const { root, recentProjects, loading, withOverlay, bind } = params;
  root.innerHTML = `${renderStartScreen(recentProjects)}${withOverlay(loading)}`;
  bind();
};

export const renderNewProjectRoute = (params: {
  root: HTMLElement;
  loading: boolean;
  withOverlay: (loading: boolean) => string;
  bind: () => void;
}) => {
  const { root, loading, withOverlay, bind } = params;
  root.innerHTML = `${renderNewProjectForm()}${withOverlay(loading)}`;
  bind();
};

export const renderWorkspaceRoute = (params: {
  root: HTMLElement;
  session: ProjectSession;
  loading: boolean;
  withOverlay: (loading: boolean) => string;
  bind: () => void;
}) => {
  const { root, session, loading, withOverlay, bind } = params;
  root.innerHTML = `${renderCaptureWorkspace(session)}${withOverlay(loading)}`;
  bind();
};

export const reopenPendingWorkspacePanel = (
  root: HTMLElement,
  pendingPanelId: string | null
): string | null => {
  if (!pendingPanelId) {
    return null;
  }
  const actionMap: Record<string, string> = {
    sequenceManagerPanel: "open-sequence-panel",
    projectSettingsPanel: "open-project-settings-panel",
    exportPanel: "open-export-panel",
    cameraControlsPanel: "open-camera-controls-panel",
    helpPanel: "open-help-panel"
  };
  const action = actionMap[pendingPanelId];
  if (action) {
    root.querySelector<HTMLButtonElement>(`[data-action='${action}']`)?.click();
  }
  return null;
};
