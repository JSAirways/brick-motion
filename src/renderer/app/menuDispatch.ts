import type { MenuCommandEvent } from "../../shared/types/ipc";

type Route = "start" | "new-project" | "workspace";

export const createMenuCommandDispatcher = (params: {
  getRoute: () => Route;
  setRoute: (route: Route) => void;
  draw: () => void;
  root: HTMLElement;
  openProject: (projectDirectory: string) => Promise<void>;
  dispatchWorkspaceMenuCommand: (event: MenuCommandEvent) => void;
}) => {
  const { getRoute, setRoute, draw, root, openProject, dispatchWorkspaceMenuCommand } = params;

  return (event: MenuCommandEvent): void => {
    switch (event.id) {
      case "file:new-project":
        setRoute("new-project");
        draw();
        return;
      case "file:open-project":
        void (async () => {
          const picked = await window.brickMotion.pickDirectory();
          if (picked) {
            await openProject(picked);
          }
        })();
        return;
      case "file:project-settings":
        if (getRoute() === "workspace") {
          root.querySelector<HTMLButtonElement>("[data-action='open-project-settings-panel']")?.click();
        }
        return;
      case "file:export-sequence":
        if (getRoute() === "workspace") {
          root.querySelector<HTMLButtonElement>("[data-action='open-export-panel']")?.click();
        }
        return;
      case "file:close-project":
        if (getRoute() === "workspace") {
          root.querySelector<HTMLButtonElement>("[data-action='back-to-start']")?.click();
        }
        return;
      default:
        dispatchWorkspaceMenuCommand(event);
    }
  };
};
