import type { CaptureMode } from "../../../shared/types/project";
import { getClampedNumber, getTrimmedString } from "../../utils/formValue";

export interface ParsedProjectSettings {
  title: string;
  captureMode: CaptureMode;
  fps: number;
  showPlaybackFpsOverlay: boolean;
}

export const parseProjectSettingsForm = (
  form: HTMLFormElement,
  fallback: { captureMode: CaptureMode; fps: number }
): ParsedProjectSettings => {
  const data = new FormData(form);
  return {
    title: getTrimmedString(data, "projectTitle"),
    captureMode: String(data.get("captureMode") ?? fallback.captureMode) as CaptureMode,
    fps: getClampedNumber(data, "fps", {
      min: 1,
      max: 60,
      fallback: fallback.fps
    }),
    showPlaybackFpsOverlay: Boolean(form.querySelector<HTMLInputElement>("#showPlaybackFpsOverlay")?.checked)
  };
};

export interface ParsedExportForm {
  exportScope: "active" | "selected" | "all";
  destinationMode: "project_default" | "custom";
  customExportRoot: string;
  conflictAction: "replace" | "keep_both";
  frameFilePrefix: string;
  selectedSequenceIds: string[];
}

export const parseExportSequenceForm = (
  form: HTMLFormElement,
  sanitizePrefix: (raw: string) => string
): ParsedExportForm => {
  const formData = new FormData(form);
  const exportScopeRaw = String(formData.get("exportScope") ?? "active");
  return {
    exportScope: exportScopeRaw === "all" ? "all" : exportScopeRaw === "selected" ? "selected" : "active",
    destinationMode:
      String(formData.get("exportPathMode") ?? "project_default") === "custom" ? "custom" : "project_default",
    customExportRoot: getTrimmedString(formData, "customExportPath"),
    conflictAction: String(formData.get("exportConflictMode") ?? "replace") === "keep_both" ? "keep_both" : "replace",
    frameFilePrefix: sanitizePrefix(String(formData.get("frameFilePrefix") ?? "")) || "frame_",
    selectedSequenceIds: formData
      .getAll("selectedSequence")
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
  };
};

export const buildRelocatedProjectRoot = (pickedDir: string, currentRoot: string): string => {
  const currentBaseName = currentRoot.split(/[\\/]/).filter(Boolean).pop() ?? "brick-motion-project";
  const separator = pickedDir.includes("\\") ? "\\" : "/";
  return `${pickedDir.replace(/[\\/]+$/, "")}${separator}${currentBaseName}`;
};
