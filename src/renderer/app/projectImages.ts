import type { ProjectSession } from "../../shared/types/project";

const mimeForRelativeImagePath = (relativePath: string): string => {
  const lower = relativePath.toLowerCase();
  return lower.endsWith(".png") ? "image/png" : "image/jpeg";
};

export const createProjectImageLoader = (reportReadError: (error: unknown) => void) => {
  const imageBlobUrlCache = new Map<string, string>();

  const clearImageBlobCache = (): void => {
    for (const url of imageBlobUrlCache.values()) {
      URL.revokeObjectURL(url);
    }
    imageBlobUrlCache.clear();
  };

  const revokeImageBlobCacheKey = (key: string): void => {
    const url = imageBlobUrlCache.get(key);
    if (url) {
      URL.revokeObjectURL(url);
      imageBlobUrlCache.delete(key);
    }
  };

  const getImageObjectUrl = async (session: ProjectSession, relativePath: string): Promise<string> => {
    const key = `${session.projectRoot}::${relativePath}`;
    const cached = imageBlobUrlCache.get(key);
    if (cached) {
      return cached;
    }
    try {
      const bytes = await window.brickMotion.readFileBuffer(session.projectRoot, relativePath);
      const blob = new Blob([bytes as BlobPart], { type: mimeForRelativeImagePath(relativePath) });
      const url = URL.createObjectURL(blob);
      imageBlobUrlCache.set(key, url);
      return url;
    } catch (error) {
      reportReadError(error);
      throw error;
    }
  };

  return {
    clearImageBlobCache,
    revokeImageBlobCacheKey,
    getImageObjectUrl
  };
};
