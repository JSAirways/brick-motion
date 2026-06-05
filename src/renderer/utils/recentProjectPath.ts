export const encodeRecentProjectPath = (projectPath: string): string => encodeURIComponent(projectPath);

export const decodeRecentProjectPath = (raw: string): string => {
  try {
    return decodeURIComponent(raw);
  } catch {
    // Legacy or malformed encoding: use attribute value as-is.
    return raw;
  }
};
