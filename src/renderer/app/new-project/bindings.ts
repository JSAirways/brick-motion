import type { CaptureMode } from "../../../shared/types/project";
import { parseNewProjectForm } from "./forms";

export interface BindNewProjectFormParams {
  root: HTMLElement;
  onCancel: () => Promise<void>;
  onCreate: (payload: { title: string; fps: number; captureMode: CaptureMode; sourcePath: string }) => Promise<void>;
}

export const bindNewProjectForm = ({ root, onCancel, onCreate }: BindNewProjectFormParams): void => {
  const form = root.querySelector<HTMLFormElement>("#newProjectForm");
  const cancelButton = root.querySelector<HTMLButtonElement>("[data-action='cancel-new-project']");
  const pickPathButton = root.querySelector<HTMLButtonElement>("[data-action='pick-source-path']");
  const sourcePathInput = root.querySelector<HTMLInputElement>("#sourcePath");

  cancelButton?.addEventListener("click", async () => {
    await onCancel();
  });

  pickPathButton?.addEventListener("click", async () => {
    const picked = await window.brickMotion.pickDirectory();
    if (picked && sourcePathInput) {
      sourcePathInput.value = picked;
    }
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = parseNewProjectForm(form);
    if (!payload.title || !payload.sourcePath) {
      return;
    }
    await onCreate(payload);
  });
};
