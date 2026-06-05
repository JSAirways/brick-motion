import { nativeImage } from "electron";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { resolveSafePathInsideProject } from "./pathUtils";
import type { FrameRecord, ProjectFile } from "../src/shared/types/project";
import { TIMELINE_THUMB_JPEG_QUALITY, TIMELINE_THUMB_MAX_LONG_EDGE_PX } from "../src/shared/timelineThumb";

const toPosixPath = (value: string): string => value.replace(/\\/g, "/");

const ensureDir = async (dirPath: string): Promise<void> => {
  await fs.mkdir(dirPath, { recursive: true });
};

const removeIfExists = async (filePath: string): Promise<void> => {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw error;
    }
  }
};

/** Downscale a capture preview JPEG to timeline-thumb size (derived from preview, not source). */
export const buildTimelineThumbJpegBuffer = (previewBuffer: Buffer): Buffer => {
  const img = nativeImage.createFromBuffer(previewBuffer);
  if (img.isEmpty()) {
    return previewBuffer;
  }
  const { width, height } = img.getSize();
  if (width <= 0 || height <= 0) {
    return previewBuffer;
  }
  const longEdge = Math.max(width, height);
  if (longEdge <= TIMELINE_THUMB_MAX_LONG_EDGE_PX) {
    return Buffer.from(img.toJPEG(TIMELINE_THUMB_JPEG_QUALITY));
  }
  let nw = width;
  let nh = height;
  if (width >= height) {
    nw = TIMELINE_THUMB_MAX_LONG_EDGE_PX;
    nh = Math.max(1, Math.round((height * TIMELINE_THUMB_MAX_LONG_EDGE_PX) / width));
  } else {
    nh = TIMELINE_THUMB_MAX_LONG_EDGE_PX;
    nw = Math.max(1, Math.round((width * TIMELINE_THUMB_MAX_LONG_EDGE_PX) / height));
  }
  const resized = img.resize({ width: nw, height: nh, quality: "good" });
  return Buffer.from(resized.toJPEG(TIMELINE_THUMB_JPEG_QUALITY));
};

export const writeTimelineThumbFromPreviewFile = async (
  projectRoot: string,
  fr: FrameRecord
): Promise<boolean> => {
  try {
    const previewAbs = resolveSafePathInsideProject(projectRoot, fr.previewPath);
    const thumbAbs = resolveSafePathInsideProject(projectRoot, fr.timelineThumbPath);
    const previewBuf = await fs.readFile(previewAbs);
    const thumbBuf = buildTimelineThumbJpegBuffer(previewBuf);
    await ensureDir(path.dirname(thumbAbs));
    const tmp = `${thumbAbs}.${process.pid}-${Date.now()}.tmp`;
    await fs.writeFile(tmp, thumbBuf);
    await fs.rename(tmp, thumbAbs);
    return true;
  } catch {
    return false;
  }
};

/** Atomic write of preview, source, and timeline thumb for one captured frame. */
export const writeCapturedFrameBuffers = async (params: {
  projectRoot: string;
  frameId: string;
  sequenceIndex: number;
  previewBuffer: Buffer;
  sourceBuffer: Buffer;
  sourceExtension: "jpg" | "png";
}): Promise<FrameRecord> => {
  const startedAt = Date.now();
  const baseName = `frame_${String(params.sequenceIndex + 1).padStart(6, "0")}_${params.frameId}`;
  const previewRelative = toPosixPath(path.join("frames", "preview-jpeg", `${baseName}.jpg`));
  const thumbRelative = toPosixPath(path.join("frames", "timeline-thumb", `${baseName}.jpg`));
  const sourceDirName = params.sourceExtension === "png" ? "source-png" : "source-jpeg";
  const sourceRelative = toPosixPath(
    path.join("frames", sourceDirName, `${baseName}.${params.sourceExtension === "png" ? "png" : "jpg"}`)
  );
  const previewAbsolute = path.join(params.projectRoot, previewRelative);
  const thumbAbsolute = path.join(params.projectRoot, thumbRelative);
  const sourceAbsolute = path.join(params.projectRoot, sourceRelative);
  const createdAt = new Date().toISOString();

  await ensureDir(path.dirname(previewAbsolute));
  await ensureDir(path.dirname(thumbAbsolute));
  await ensureDir(path.dirname(sourceAbsolute));

  const previewTmp = `${previewAbsolute}.tmp`;
  const thumbTmp = `${thumbAbsolute}.tmp`;
  const sourceTmp = `${sourceAbsolute}.tmp`;
  const thumbBuffer = buildTimelineThumbJpegBuffer(params.previewBuffer);

  try {
    await fs.writeFile(previewTmp, params.previewBuffer);
    await fs.writeFile(sourceTmp, params.sourceBuffer);
    await fs.writeFile(thumbTmp, thumbBuffer);
    await fs.rename(previewTmp, previewAbsolute);
    await fs.rename(sourceTmp, sourceAbsolute);
    await fs.rename(thumbTmp, thumbAbsolute);
  } catch (error) {
    await Promise.all([removeIfExists(previewTmp), removeIfExists(sourceTmp), removeIfExists(thumbTmp)]);
    await Promise.all([
      removeIfExists(previewAbsolute),
      removeIfExists(sourceAbsolute),
      removeIfExists(thumbAbsolute)
    ]);
    throw error;
  }

  console.info("[frame] wrote assets", {
    frameId: params.frameId,
    elapsedMs: Date.now() - startedAt,
    previewBytes: params.previewBuffer.byteLength,
    sourceBytes: params.sourceBuffer.byteLength,
    thumbBytes: thumbBuffer.byteLength,
    sourceExtension: params.sourceExtension
  });

  return {
    sequenceIndex: params.sequenceIndex,
    previewPath: previewRelative,
    timelineThumbPath: thumbRelative,
    sourcePath: sourceRelative,
    createdAt
  };
};

export const reconcileProjectFramesOnDisk = async (
  projectRoot: string,
  project: ProjectFile
): Promise<{ project: ProjectFile; removed: number; thumbsRepaired: number; missingAssets: number }> => {
  const nextSequences = structuredClone(project.sequencesById);
  const activeSequence = nextSequences[project.activeSequenceId];
  const nextActiveOrder: string[] = [];
  const nextById = { ...project.framesById };
  let removed = 0;
  let thumbsRepaired = 0;
  let missingAssets = 0;
  for (const sequenceId of project.sequenceOrder) {
    const sequence = nextSequences[sequenceId];
    if (!sequence) {
      continue;
    }
    const nextSequenceOrder: string[] = [];
    for (const id of sequence.frameIdOrder) {
      const fr = nextById[id];
      if (!fr) {
        removed += 1;
        continue;
      }
      try {
        await fs.access(resolveSafePathInsideProject(projectRoot, fr.previewPath));
        await fs.access(resolveSafePathInsideProject(projectRoot, fr.sourcePath));
      } catch {
        delete nextById[id];
        removed += 1;
        missingAssets += 1;
        continue;
      }
      try {
        await fs.access(resolveSafePathInsideProject(projectRoot, fr.timelineThumbPath));
        nextSequenceOrder.push(id);
      } catch {
        if (await writeTimelineThumbFromPreviewFile(projectRoot, fr)) {
          thumbsRepaired += 1;
          nextSequenceOrder.push(id);
        } else {
          delete nextById[id];
          removed += 1;
          missingAssets += 1;
        }
      }
    }
    sequence.frameIdOrder = nextSequenceOrder;
    if (sequenceId === project.activeSequenceId) {
      nextActiveOrder.push(...nextSequenceOrder);
    }
  }
  if (removed === 0 && thumbsRepaired === 0) {
    return { project, removed: 0, thumbsRepaired: 0, missingAssets: 0 };
  }
  const updatedAt = new Date().toISOString();
  const next: ProjectFile = {
    ...project,
    frameIdOrder: nextActiveOrder,
    sequencesById: nextSequences,
    framesById: nextById,
    updatedAt
  };
  (activeSequence?.frameIdOrder ?? nextActiveOrder).forEach((frameId, index) => {
    const row = next.framesById[frameId];
    if (row) {
      row.sequenceIndex = index;
    }
  });
  return { project: next, removed, thumbsRepaired, missingAssets };
};
