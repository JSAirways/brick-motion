import type { MenuCommandEvent } from "../../../shared/types/ipc";

export interface WorkspaceMenuCommandContext {
  createSequence: () => Promise<void>;
  duplicateActiveSequence: () => Promise<void>;
  renameActiveSequence: () => Promise<void>;
  deleteActiveSequence: () => Promise<void>;
  activateNextSequence: () => Promise<void>;
  activatePreviousSequence: () => Promise<void>;
  openSequenceManager: () => void;
  captureFrame: () => Promise<void>;
  duplicateFrames: () => Promise<void>;
  deleteFrame: () => Promise<void>;
  undoFrameAction: () => Promise<void>;
  redoFrameAction: () => Promise<void>;
  stopPlayback: () => void;
  startPlayback: (direction: "forward" | "reverse") => void;
  syncPlaybackUi: () => void;
  toggleLoopPlaybackAction: () => Promise<void>;
  stepTimelineByKeyboardLogic: (delta: -1 | 1) => void;
  jumpToHome: () => void;
  jumpToEnd: () => void;
  jumpToLive: () => void;
  getIsPlaybackActive: () => boolean;
}

export const createWorkspaceMenuCommandHandler = (ctx: WorkspaceMenuCommandContext) => {
  return (event: MenuCommandEvent): void => {
    switch (event.id) {
      case "sequence:new":
        void ctx.createSequence();
        break;
      case "sequence:duplicate":
        void ctx.duplicateActiveSequence();
        break;
      case "sequence:rename":
        void ctx.renameActiveSequence();
        break;
      case "sequence:delete":
        void ctx.deleteActiveSequence();
        break;
      case "sequence:next":
        void ctx.activateNextSequence();
        break;
      case "sequence:previous":
        void ctx.activatePreviousSequence();
        break;
      case "sequence:open-manager":
        ctx.openSequenceManager();
        break;
      case "frame:capture":
        void ctx.captureFrame();
        break;
      case "frame:duplicate":
        void ctx.duplicateFrames();
        break;
      case "frame:delete":
        void ctx.deleteFrame();
        break;
      case "frame:undo":
        void ctx.undoFrameAction();
        break;
      case "frame:redo":
        void ctx.redoFrameAction();
        break;
      case "frame:jump-live":
        ctx.jumpToLive();
        break;
      case "playback:toggle":
        if (!ctx.getIsPlaybackActive()) {
          ctx.startPlayback("forward");
        } else {
          ctx.stopPlayback();
          ctx.syncPlaybackUi();
        }
        break;
      case "playback:reverse":
        ctx.startPlayback("reverse");
        break;
      case "playback:stop":
        ctx.stopPlayback();
        ctx.syncPlaybackUi();
        break;
      case "playback:toggle-loop":
        void ctx.toggleLoopPlaybackAction();
        break;
      case "playback:prev-frame":
        ctx.stepTimelineByKeyboardLogic(-1);
        break;
      case "playback:next-frame":
        ctx.stepTimelineByKeyboardLogic(1);
        break;
      case "playback:home":
        ctx.jumpToHome();
        break;
      case "playback:end":
        ctx.jumpToEnd();
        break;
      default:
        break;
    }
  };
};
