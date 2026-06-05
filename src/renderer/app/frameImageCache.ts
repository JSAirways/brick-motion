import type { FrameRecord } from "../../shared/types/project";

export const frameImageCacheKey = (projectRoot: string, relativePath: string): string =>
  `${projectRoot}::${relativePath}`;

/** Invalidate blob URLs for all on-disk assets tied to one frame. */
export const invalidateFrameImageCaches = (
  revokeBlobUrl: (cacheKey: string) => void,
  projectRoot: string,
  frame: Pick<FrameRecord, "previewPath" | "sourcePath" | "timelineThumbPath">
): void => {
  revokeBlobUrl(frameImageCacheKey(projectRoot, frame.previewPath));
  revokeBlobUrl(frameImageCacheKey(projectRoot, frame.sourcePath));
  revokeBlobUrl(frameImageCacheKey(projectRoot, frame.timelineThumbPath));
};
