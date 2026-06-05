import type { ProjectSession } from "../../../shared/types/project";

export interface WorkspaceShortcutsParams {
  root: HTMLElement;
  previousAbort: AbortController | null;
  getRoute: () => "start" | "new-project" | "workspace";
  getSession: () => ProjectSession | null;
  getIsPlaybackActive: () => boolean;
  setPlayhead: (next: "live" | number) => void;
  clearFrameSelection: () => void;
  setTimelineAnchor: (next: number | null) => void;
  addFrameSelection: (index: number) => void;
  renderTimeline: () => void;
  renderCurrentFrame: () => void;
  startPlayback: (direction: "forward" | "reverse") => void;
  stopPlayback: () => void;
  syncPlaybackUi: () => void;
  stepTimelineByKeyboardLogic: (delta: -1 | 1) => void;
  captureFrame: () => Promise<void>;
  deleteFrame: () => Promise<void>;
  duplicateFrames: () => Promise<void>;
  undoFrameAction: () => Promise<void>;
  redoFrameAction: () => Promise<void>;
  onEscape: () => Promise<boolean>;
}

export const bindWorkspaceKeyboardShortcuts = (params: WorkspaceShortcutsParams): AbortController => {
  const {
    root,
    previousAbort,
    getRoute,
    getSession,
    getIsPlaybackActive,
    setPlayhead,
    clearFrameSelection,
    setTimelineAnchor,
    addFrameSelection,
    renderTimeline,
    renderCurrentFrame,
    startPlayback,
    stopPlayback,
    syncPlaybackUi,
    stepTimelineByKeyboardLogic,
    captureFrame,
    deleteFrame,
    duplicateFrames,
    undoFrameAction,
    redoFrameAction,
    onEscape
  } = params;

  previousAbort?.abort();
  const abort = new AbortController();

  document.addEventListener(
    "keydown",
    (event) => {
      if (getRoute() !== "workspace") {
        return;
      }

      const target = event.target as HTMLElement | null;
      const rangeInput = target instanceof HTMLInputElement && target.type === "range" ? target : null;
      if (rangeInput && !event.ctrlKey && !event.metaKey && !event.altKey) {
        let direction = 0;
        if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
          direction = -1;
        } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
          direction = 1;
        }
        if (direction !== 0) {
          event.preventDefault();
          event.stopPropagation();
          const stepBase = Number(rangeInput.step);
          const step = Number.isFinite(stepBase) && stepBase > 0 ? stepBase : 1;
          const multiplier = event.shiftKey ? 10 : 1;
          const min = Number(rangeInput.min);
          const max = Number(rangeInput.max);
          const current = Number(rangeInput.value);
          const next = current + direction * step * multiplier;
          const clamped = Math.min(max, Math.max(min, next));
          rangeInput.value = String(clamped);
          rangeInput.dispatchEvent(new Event("input", { bubbles: true }));
          return;
        }
      }

      const isTextInput =
        target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (isTextInput) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        void onEscape().then((consumed) => {
          if (consumed) {
            return;
          }
          clearFrameSelection();
          setTimelineAnchor(null);
          renderTimeline();
        });
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        const session = getSession();
        if (!session) {
          return;
        }
        const total = session.project.frameIdOrder.length;
        if (total === 0) {
          return;
        }
        clearFrameSelection();
        for (let i = 0; i < total; i += 1) {
          addFrameSelection(i);
        }
        setTimelineAnchor(total - 1);
        renderTimeline();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        void duplicateFrames();
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        stepTimelineByKeyboardLogic(-1);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        stepTimelineByKeyboardLogic(1);
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        stopPlayback();
        syncPlaybackUi();
        const session = getSession();
        if (!session) {
          return;
        }
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
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        stopPlayback();
        syncPlaybackUi();
        const session = getSession();
        if (!session) {
          return;
        }
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
        return;
      }
      if (event.key === " ") {
        event.preventDefault();
        if (!getIsPlaybackActive()) {
          startPlayback("forward");
        } else {
          stopPlayback();
          syncPlaybackUi();
        }
        return;
      }

      const shuttleKey = event.key.toLowerCase();
      if ((shuttleKey === "j" || shuttleKey === "l") && event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey) {
        return;
      }
      if (shuttleKey === "j" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        startPlayback("reverse");
        return;
      }
      if (shuttleKey === "k" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        stopPlayback();
        syncPlaybackUi();
        return;
      }
      if (shuttleKey === "l" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        startPlayback("forward");
        return;
      }

      if (event.key.toLowerCase() === "o") {
        event.preventDefault();
        root.querySelector<HTMLInputElement>("#onionToggle")?.click();
        return;
      }
      if (event.key === "Delete" || event.key === "Del" || event.key === "Backspace") {
        event.preventDefault();
        void deleteFrame();
        return;
      }
      if (event.key.toLowerCase() === "c" && !event.isComposing && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        void captureFrame();
        return;
      }

      const key = event.key.toLowerCase();
      const isUndo = (event.ctrlKey || event.metaKey) && !event.shiftKey && key === "z";
      const isRedo = (event.ctrlKey || event.metaKey) && ((event.shiftKey && key === "z") || (!event.shiftKey && key === "y"));
      if (isUndo) {
        event.preventDefault();
        void undoFrameAction();
        return;
      }
      if (isRedo) {
        event.preventDefault();
        void redoFrameAction();
      }
    },
    { signal: abort.signal }
  );

  return abort;
};
