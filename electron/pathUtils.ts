import * as path from "node:path";

/**
 * Resolves a project-relative path and ensures the result stays inside projectRoot.
 */
export const resolveSafePathInsideProject = (projectRoot: string, relativePath: string): string => {
  const resolvedRoot = path.resolve(projectRoot);
  const candidate = path.resolve(resolvedRoot, relativePath);
  const rel = path.relative(resolvedRoot, candidate);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Path escapes project directory.");
  }
  return candidate;
};

export const resolveFramePathsInsideProject = (
  projectRoot: string,
  input: { previewPath: string; sourcePath: string; thumbPath?: string | null }
): { previewAbs: string; sourceAbs: string; thumbAbs: string | null } => ({
  previewAbs: resolveSafePathInsideProject(projectRoot, input.previewPath),
  sourceAbs: resolveSafePathInsideProject(projectRoot, input.sourcePath),
  thumbAbs:
    typeof input.thumbPath === "string" && input.thumbPath.trim().length > 0
      ? resolveSafePathInsideProject(projectRoot, input.thumbPath)
      : null
});
