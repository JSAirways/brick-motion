import { applyAppVersionLabels } from "../applyAppVersionLabels";
import { decodeRecentProjectPath } from "../../utils/recentProjectPath";
import { applyRecentProjectFilter } from "./recentFilter";

export interface BindStartScreenParams {
  root: HTMLElement;
  onCreateProject: () => void;
  onOpenProject: (projectPath: string) => Promise<void>;
}

export const bindStartScreen = ({
  root,
  onCreateProject,
  onOpenProject
}: BindStartScreenParams): void => {
  applyAppVersionLabels(root);
  const createButton = root.querySelector<HTMLButtonElement>("[data-action='create-project']");
  const openButton = root.querySelector<HTMLButtonElement>("[data-action='open-project']");

  createButton?.addEventListener("click", onCreateProject);

  openButton?.addEventListener("click", async () => {
    const picked = await window.brickMotion.pickDirectory();
    if (picked) {
      await onOpenProject(picked);
    }
  });

  const recentFilterInput = root.querySelector<HTMLInputElement>("#recentProjectsFilter");
  const recentList = root.querySelector<HTMLElement>("#recentProjectsList");
  if (recentFilterInput && recentList) {
    recentFilterInput.addEventListener("input", () => {
      const cards = recentList.querySelectorAll<HTMLElement>("[data-recent-card]");
      applyRecentProjectFilter(cards, recentFilterInput.value);
    });
  }

  recentList?.addEventListener("click", async (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }
    const openButton = target.closest<HTMLElement>("[data-open-recent]");
    if (openButton) {
      const encoded = openButton.getAttribute("data-open-recent");
      if (!encoded) {
        return;
      }
      await onOpenProject(decodeRecentProjectPath(encoded));
      return;
    }
  });

  recentList?.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }
    const openButton = target.closest<HTMLElement>("[data-open-recent]");
    if (!openButton) {
      return;
    }
    event.preventDefault();
    const encoded = openButton.getAttribute("data-open-recent");
    if (!encoded) {
      return;
    }
    await onOpenProject(decodeRecentProjectPath(encoded));
  });

};
