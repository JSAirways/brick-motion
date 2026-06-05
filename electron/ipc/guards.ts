import type { CaptureMode } from "../../src/shared/types/project";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const requireRecord = (value: unknown, message: string): Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new Error(message);
  }
  return value;
};

export const requireString = (value: unknown, message: string): string => {
  if (typeof value !== "string") {
    throw new Error(message);
  }
  return value;
};

export const requireNonEmptyString = (value: unknown, message: string): string => {
  const next = requireString(value, message).trim();
  if (!next) {
    throw new Error(message);
  }
  return next;
};

export const requireNumber = (value: unknown, message: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(message);
  }
  return value;
};

export const requireCaptureMode = (value: unknown): CaptureMode => {
  if (value === "jpeg" || value === "png") {
    return value;
  }
  throw new Error("Invalid capture mode.");
};
