import type { CaptureMode } from "../../shared/types/project";
import { bindNewProjectForm as bindNewProjectFormView } from "./new-project/bindings";
import { bindStartScreen as bindStartScreenView } from "./start/bindings";

export const bindStartRoute = (params: {
  root: HTMLElement;
  draw: () => void;
  setRoute: (route: "start" | "new-project" | "workspace") => void;
  openProject: (projectDirectory: string) => Promise<void>;
}) => {
  const { root, draw, setRoute, openProject } = params;
  bindStartScreenView({
    root,
    onCreateProject: () => {
      setRoute("new-project");
      draw();
    },
    onOpenProject: openProject
  });
};

export const bindNewProjectRoute = (params: {
  root: HTMLElement;
  draw: () => void;
  setRoute: (route: "start" | "new-project" | "workspace") => void;
  createProject: (payload: {
    title: string;
    fps: number;
    captureMode: CaptureMode;
    sourcePath: string;
  }) => Promise<void>;
}) => {
  const { root, draw, setRoute, createProject } = params;
  bindNewProjectFormView({
    root,
    onCancel: async () => {
      setRoute("start");
      draw();
    },
    onCreate: async (payload) => {
      await createProject(payload);
    }
  });
};
