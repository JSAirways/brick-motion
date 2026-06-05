import type { CaptureMode } from "../../shared/types/project";

export const captureModeLabel = (mode: CaptureMode): string => {
  if (mode === "png") {
    return "PNG";
  }
  return "JPEG";
};
