import type { ProjectSession } from "../../../shared/types/project";

export const bindTimelineScrollSync = (
  timelineScrollTrack: HTMLElement | null,
  timelineScrollScale: HTMLElement | null
): void => {
  if (!timelineScrollTrack || !timelineScrollScale) {
    return;
  }
  const syncScroll = (source: HTMLElement, target: HTMLElement): void => {
    if (target.scrollLeft !== source.scrollLeft) {
      target.scrollLeft = source.scrollLeft;
    }
  };
  timelineScrollTrack.addEventListener("scroll", () => syncScroll(timelineScrollTrack, timelineScrollScale));
  timelineScrollScale.addEventListener("scroll", () => syncScroll(timelineScrollScale, timelineScrollTrack));
};

export const bindTimelineDragPan = (params: {
  timelineGrid: HTMLElement | null;
  timelineTrack: HTMLElement | null;
  timelineLiveButton: HTMLButtonElement | null;
  getScrollLeft: () => number;
  setScrollLeft: (value: number) => void;
}): void => {
  const { timelineGrid, timelineTrack, timelineLiveButton, getScrollLeft, setScrollLeft } = params;
  let timelineDragging = false;
  let suppressTimelineClick = false;
  let dragStartClientX = 0;
  let dragStartScrollLeft = 0;

  const onTimelineDragMove = (event: MouseEvent): void => {
    if (!timelineDragging) {
      return;
    }
    const deltaX = event.clientX - dragStartClientX;
    if (Math.abs(deltaX) > 3) {
      suppressTimelineClick = true;
    }
    setScrollLeft(dragStartScrollLeft - deltaX);
    event.preventDefault();
  };

  const endTimelineDrag = (): void => {
    if (!timelineDragging) {
      return;
    }
    timelineDragging = false;
    timelineGrid?.classList.remove("bm-timeline-dragging");
    window.removeEventListener("mousemove", onTimelineDragMove);
    window.removeEventListener("mouseup", endTimelineDrag);
  };

  const beginTimelineDrag = (event: MouseEvent): void => {
    if (event.button !== 0) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, select, textarea")) {
      return;
    }
    timelineDragging = true;
    suppressTimelineClick = false;
    dragStartClientX = event.clientX;
    dragStartScrollLeft = getScrollLeft();
    timelineGrid?.classList.add("bm-timeline-dragging");
    window.addEventListener("mousemove", onTimelineDragMove);
    window.addEventListener("mouseup", endTimelineDrag);
    event.preventDefault();
  };

  const blockClickAfterDrag = (event: MouseEvent): void => {
    if (!suppressTimelineClick) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    suppressTimelineClick = false;
  };

  timelineGrid?.addEventListener("mousedown", beginTimelineDrag);
  timelineTrack?.addEventListener("click", blockClickAfterDrag, true);
  timelineLiveButton?.addEventListener("click", blockClickAfterDrag, true);
};

export const stepTimelineByKeyboardButtons = (
  root: HTMLElement,
  direction: -1 | 1
): void => {
  const frameButtons = Array.from(root.querySelectorAll<HTMLButtonElement>("#timelineTrack button[data-frame-index]"));
  const liveNavButton = root.querySelector<HTMLButtonElement>("#timelineLiveButton");
  const timelineButtons: HTMLButtonElement[] = liveNavButton ? [...frameButtons, liveNavButton] : frameButtons;
  if (timelineButtons.length === 0) {
    return;
  }
  const activeIndex = timelineButtons.findIndex((button) => {
    const isLive = button.dataset.frameIndex === "live";
    return isLive ? button.classList.contains("btn-primary") : button.classList.contains("bm-thumb-active");
  });
  const liveIndex = timelineButtons.findIndex((button) => button.dataset.frameIndex === "live");

  if (direction < 0) {
    if (activeIndex === -1 || activeIndex === liveIndex) {
      timelineButtons[Math.max(0, liveIndex - 1)]?.click();
      return;
    }
    timelineButtons[Math.max(0, activeIndex - 1)]?.click();
    return;
  }

  // Forward from live: stay on live (do not wrap to frame 0).
  if (activeIndex === -1 || activeIndex === liveIndex) {
    return;
  }
  timelineButtons[Math.min(liveIndex, activeIndex + 1)]?.click();
};

export const bindTimelineFrameButtonClick = (
  button: HTMLButtonElement,
  onFrameButtonClick: (event: MouseEvent, index: number) => void
): void => {
  button.addEventListener("click", (event) => {
    const index = Number(button.dataset.frameIndex);
    if (!Number.isFinite(index)) {
      return;
    }
    onFrameButtonClick(event, index);
  });
};

export const bindTimelineFrameButtonClicks = (params: {
  timelineTrack: HTMLElement;
  onFrameButtonClick: (event: MouseEvent, index: number) => void;
}): void => {
  const { timelineTrack, onFrameButtonClick } = params;
  timelineTrack.querySelectorAll<HTMLButtonElement>("[data-frame-index]").forEach((button) => {
    bindTimelineFrameButtonClick(button, onFrameButtonClick);
  });
};

export const jumpToHomeOrLive = (params: {
  session: ProjectSession;
  stopPlayback: () => void;
  syncPlaybackUi: () => void;
  setPlayhead: (next: "live" | number) => void;
  clearFrameSelection: () => void;
  addFrameSelection: (index: number) => void;
  setTimelineAnchor: (next: number | null) => void;
  renderCurrentFrame: () => void;
  renderTimeline: () => void;
}): void => {
  const {
    session,
    stopPlayback,
    syncPlaybackUi,
    setPlayhead,
    clearFrameSelection,
    addFrameSelection,
    setTimelineAnchor,
    renderCurrentFrame,
    renderTimeline
  } = params;
  stopPlayback();
  syncPlaybackUi();
  const total = session.project.frameIdOrder.length;
  if (total === 0) {
    setPlayhead("live");
  } else {
    setPlayhead(0);
    clearFrameSelection();
    addFrameSelection(0);
    setTimelineAnchor(0);
  }
  renderCurrentFrame();
  renderTimeline();
};

export const jumpToEndOrLive = (params: {
  session: ProjectSession;
  stopPlayback: () => void;
  syncPlaybackUi: () => void;
  setPlayhead: (next: "live" | number) => void;
  clearFrameSelection: () => void;
  addFrameSelection: (index: number) => void;
  setTimelineAnchor: (next: number | null) => void;
  renderCurrentFrame: () => void;
  renderTimeline: () => void;
}): void => {
  const {
    session,
    stopPlayback,
    syncPlaybackUi,
    setPlayhead,
    clearFrameSelection,
    addFrameSelection,
    setTimelineAnchor,
    renderCurrentFrame,
    renderTimeline
  } = params;
  stopPlayback();
  syncPlaybackUi();
  const total = session.project.frameIdOrder.length;
  if (total === 0) {
    setPlayhead("live");
  } else {
    const lastIndex = total - 1;
    setPlayhead(lastIndex);
    clearFrameSelection();
    addFrameSelection(lastIndex);
    setTimelineAnchor(lastIndex);
  }
  renderCurrentFrame();
  renderTimeline();
};

export const jumpToLive = (params: {
  stopPlayback: () => void;
  clearFrameSelection: () => void;
  setTimelineAnchor: (next: number | null) => void;
  setPlayhead: (next: "live" | number) => void;
  renderCurrentFrame: () => void;
  renderTimeline: () => void;
}): void => {
  const { stopPlayback, clearFrameSelection, setTimelineAnchor, setPlayhead, renderCurrentFrame, renderTimeline } = params;
  stopPlayback();
  clearFrameSelection();
  setTimelineAnchor(null);
  setPlayhead("live");
  renderCurrentFrame();
  renderTimeline();
};
