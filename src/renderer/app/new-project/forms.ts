import type { CaptureMode } from "../../../shared/types/project";
import { getClampedNumber, getTrimmedString } from "../../utils/formValue";

export interface NewProjectPayload {
  title: string;
  fps: number;
  captureMode: CaptureMode;
  sourcePath: string;
}

export const parseNewProjectForm = (form: HTMLFormElement): NewProjectPayload => {
  const formData = new FormData(form);
  return {
    title: getTrimmedString(formData, "title"),
    fps: getClampedNumber(formData, "fps", { min: 1, max: 60, fallback: 12 }),
    captureMode: String(formData.get("captureMode") ?? "jpeg") as CaptureMode,
    sourcePath: getTrimmedString(formData, "sourcePath")
  };
};
