import type { ProjectFile } from "../../../shared/types/project";

export const sanitizeTimelineSelection = (params: {
  selection: Set<number>;
  frameCount: number;
}): void => {
  const { selection, frameCount } = params;
  for (const idx of [...selection]) {
    if (idx < 0 || idx >= frameCount) {
      selection.delete(idx);
    }
  }
};

export const buildTimelineScaleHtml = (params: {
  project: ProjectFile;
  playhead: "live" | number;
  formatSeconds: (value: number) => string;
}): string => {
  const { project, playhead, formatSeconds } = params;
  return project.frameIdOrder
    .map((_, index) => {
      const elapsed = (index + 1) / Math.max(1, project.fps);
      const isActive = playhead === index;
      return `<div class="bm-timeline-scale-cell text-center small ${isActive ? "text-primary fw-bold" : "text-secondary"}">${formatSeconds(elapsed)}</div>`;
    })
    .join("");
};

export const buildTimelineFrameButtonHtml = (params: {
  project: ProjectFile;
  index: number;
  playhead: "live" | number;
  frameSelection: Set<number>;
  escapeHtml: (value: string) => string;
}): string => {
  const { project, index, playhead, frameSelection, escapeHtml } = params;
  const frameId = project.frameIdOrder[index];
  const frame = frameId ? project.framesById[frameId] : undefined;
  const rel = frame?.timelineThumbPath ?? "";
  const imgTag =
    frame && rel.length > 0
      ? `<img class="bm-thumb-img" alt="" width="140" height="79" decoding="async" data-image-path="${escapeHtml(rel)}" />`
      : "";
  const activeClass = playhead === index ? "bm-thumb-active" : "";
  const selectedClass = frameSelection.has(index) ? " bm-thumb-selected" : "";
  return `<button type="button" class="btn btn-sm p-0 btn-outline-secondary bm-thumb position-relative ${activeClass}${selectedClass}" data-frame-index="${index}">${imgTag}<span class="bm-thumb-label text-white fw-bold fs-4">#${index + 1}</span></button>`;
};

export const buildTimelineScaleCellHtml = (params: {
  index: number;
  fps: number;
  playhead: "live" | number;
  formatSeconds: (value: number) => string;
}): string => {
  const elapsed = (params.index + 1) / Math.max(1, params.fps);
  const isActive = params.playhead === params.index;
  return `<div class="bm-timeline-scale-cell text-center small ${isActive ? "text-primary fw-bold" : "text-secondary"}">${params.formatSeconds(elapsed)}</div>`;
};

export const buildTimelineTrackHtml = (params: {
  project: ProjectFile;
  playhead: "live" | number;
  frameSelection: Set<number>;
  escapeHtml: (value: string) => string;
}): string => {
  const { project, playhead, frameSelection, escapeHtml } = params;
  return project.frameIdOrder
    .map((frameId, index) => {
      const frame = project.framesById[frameId];
      const rel = frame?.timelineThumbPath ?? "";
      const imgTag =
        frame && rel.length > 0
          ? `<img class="bm-thumb-img" alt="" width="140" height="79" decoding="async" data-image-path="${escapeHtml(rel)}" />`
          : "";
      const activeClass = playhead === index ? "bm-thumb-active" : "";
      const selectedClass = frameSelection.has(index) ? " bm-thumb-selected" : "";
      return `<button type="button" class="btn btn-sm p-0 btn-outline-secondary bm-thumb position-relative ${activeClass}${selectedClass}" data-frame-index="${index}">${imgTag}<span class="bm-thumb-label text-white fw-bold fs-4">#${index + 1}</span></button>`;
    })
    .join("");
};

export const TIMELINE_EMPTY_PLACEHOLDER_HTML =
  '<button type="button" class="btn btn-sm p-0 btn-outline-secondary bm-thumb bm-timeline-placeholder" disabled tabindex="-1" aria-hidden="true"><span class="bm-thumb-label text-white fw-bold fs-6">#0</span></button>';

export const buildTimelineInitialTrackHtml = (frameCount: number): string => {
  if (frameCount <= 0) {
    return TIMELINE_EMPTY_PLACEHOLDER_HTML;
  }
  return Array.from(
    { length: frameCount },
    (_item, index) =>
      `<button type="button" class="btn btn-sm p-0 btn-outline-secondary bm-thumb position-relative" data-frame-index="${index}"><span class="bm-thumb-label text-white">#${index + 1}</span></button>`
  ).join("");
};
