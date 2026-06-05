import type { ProjectSession } from "../../../shared/types/project";

type PlaybackDirection = "forward" | "reverse";

export interface PlaybackController {
  startPlayback: (direction: PlaybackDirection) => void;
  stopPlayback: () => void;
  isPlaybackActive: () => boolean;
}

export const createPlaybackController = (params: {
  getSession: () => ProjectSession | null;
  getPlayhead: () => "live" | number;
  setPlayhead: (next: "live" | number) => void;
  getLoopPlayback: () => boolean;
  clearFrameSelection: () => void;
  clearTimelineAnchor: () => void;
  updatePlaybackTimelineVisuals: () => void;
  renderCurrentFrame: () => void;
  syncPlaybackUi: () => void;
  showFrameSource: (src: string, frameNumber: number) => void;
  decodeShownFrame: () => Promise<void>;
  renderOnion: () => void;
  getImageObjectUrl: (session: ProjectSession, relativePath: string) => Promise<string>;
  setPlaybackStatsText: (text: string) => void;
  hidePlaybackStats: () => void;
}): PlaybackController => {
  const {
    getSession,
    getPlayhead,
    setPlayhead,
    getLoopPlayback,
    clearFrameSelection,
    clearTimelineAnchor,
    updatePlaybackTimelineVisuals,
    renderCurrentFrame,
    syncPlaybackUi,
    showFrameSource,
    decodeShownFrame,
    renderOnion,
    getImageObjectUrl,
    setPlaybackStatsText,
    hidePlaybackStats
  } = params;

  let playbackTimeoutId: number | null = null;
  let playbackWaitResolve: (() => void) | null = null;
  let isActive = false;
  let epoch = 0;

  const stopPlayback = (): void => {
    if (playbackTimeoutId !== null) {
      window.clearTimeout(playbackTimeoutId);
      playbackTimeoutId = null;
    }
    const resolveWait = playbackWaitResolve;
    playbackWaitResolve = null;
    resolveWait?.();
    isActive = false;
    epoch += 1;
  };

  const waitPlaybackHold = (durationMs: number, runGen: number): Promise<void> =>
    new Promise((resolve) => {
      if (epoch !== runGen || !isActive) {
        resolve();
        return;
      }
      const finish = (): void => {
        playbackTimeoutId = null;
        playbackWaitResolve = null;
        resolve();
      };
      playbackWaitResolve = finish;
      playbackTimeoutId = window.setTimeout(finish, durationMs);
    });

  const doubleRequestAnimationFrame = (): Promise<void> =>
    new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    });

  const loadFrameForPlayback = async (index: number, runGen: number): Promise<boolean> => {
    const session = getSession();
    if (!session) {
      return false;
    }
    if (epoch !== runGen || !isActive) {
      return false;
    }
    const frameId = session.project.frameIdOrder[index];
    const frame = session.project.framesById[frameId];
    if (!frame) {
      return false;
    }
    let src: string;
    try {
      src = await getImageObjectUrl(session, frame.previewPath);
    } catch {
      return false;
    }
    if (epoch !== runGen || !isActive) {
      return false;
    }
    showFrameSource(src, index + 1);
    try {
      await decodeShownFrame();
    } catch {
      /* decode() rejects for invalid image; ignore and rely on paint */
    }
    if (epoch !== runGen || !isActive) {
      return false;
    }
    await doubleRequestAnimationFrame();
    if (epoch !== runGen || !isActive) {
      return false;
    }
    renderOnion();
    return true;
  };

  const preloadPlaybackNeighbor = (index: number): void => {
    const session = getSession();
    if (!session) {
      return;
    }
    const total = session.project.frameIdOrder.length;
    if (index < 0 || index >= total) {
      return;
    }
    const frameId = session.project.frameIdOrder[index];
    const frame = session.project.framesById[frameId];
    if (frame) {
      void getImageObjectUrl(session, frame.previewPath).catch(() => {});
    }
  };

  const runPlaybackLoop = async (runGen: number, direction: PlaybackDirection, wallClockAnchorMs: number): Promise<void> => {
    const session = getSession();
    if (!session) {
      return;
    }
    const total = session.project.frameIdOrder.length;
    if (total === 0) {
      return;
    }
    const fps = Math.max(1, session.project.fps);
    const frameDurationMs = 1000 / fps;
    const useWallClock = session.project.uiState.playbackTimingMode === "wall_clock" && direction === "forward";
    let wallTick = 0;
    let wallClockSkips = 0;
    let sumHoldMs = 0;
    let holdSamples = 0;

    const pushPlaybackStatsText = (extra: string): void => {
      if (!session.project.uiState.showPlaybackFpsOverlay) {
        return;
      }
      const target = frameDurationMs.toFixed(2);
      setPlaybackStatsText(`${extra} · target ${target} ms/f · skips ${wallClockSkips}`);
    };

    while (isActive && epoch === runGen) {
      const currentPlayhead = getPlayhead();
      if (typeof currentPlayhead !== "number") {
        break;
      }
      let idx = currentPlayhead;

      if (useWallClock) {
        let guard = 0;
        while (
          guard < total + 2 &&
          performance.now() > wallClockAnchorMs + (wallTick + 1) * frameDurationMs &&
          typeof getPlayhead() === "number"
        ) {
          const cur = getPlayhead();
          if (typeof cur !== "number") {
            break;
          }
          guard += 1;
          wallClockSkips += 1;
          if (cur >= total - 1) {
            if (getLoopPlayback()) {
              setPlayhead(0);
            } else {
              setPlayhead("live");
              stopPlayback();
              renderCurrentFrame();
              syncPlaybackUi();
              updatePlaybackTimelineVisuals();
              hidePlaybackStats();
              return;
            }
          } else {
            setPlayhead(cur + 1);
          }
          wallTick += 1;
          const maybeIdx = getPlayhead();
          if (typeof maybeIdx !== "number") {
            break;
          }
          idx = maybeIdx;
        }
      }

      const nextIdx = getPlayhead();
      if (typeof nextIdx !== "number") {
        break;
      }
      idx = nextIdx;

      if (direction === "forward") {
        preloadPlaybackNeighbor(idx + 1);
      } else {
        preloadPlaybackNeighbor(idx - 1);
      }

      const holdStart = performance.now();
      const ok = await loadFrameForPlayback(idx, runGen);
      if (!ok || !isActive || epoch !== runGen) {
        return;
      }

      updatePlaybackTimelineVisuals();

      if (useWallClock) {
        const deadline = wallClockAnchorMs + (wallTick + 1) * frameDurationMs;
        const waitMs = Math.max(0, deadline - performance.now());
        await waitPlaybackHold(waitMs, runGen);
        wallTick += 1;
      } else {
        await waitPlaybackHold(frameDurationMs, runGen);
      }

      const held = performance.now() - holdStart;
      sumHoldMs += held;
      holdSamples += 1;
      if (session.project.uiState.showPlaybackFpsOverlay) {
        const avg = holdSamples > 0 ? (sumHoldMs / holdSamples).toFixed(1) : "—";
        pushPlaybackStatsText(`avg ${avg} ms/f`);
      }

      if (!isActive || epoch !== runGen) {
        return;
      }

      if (direction === "forward") {
        if (idx >= total - 1) {
          if (getLoopPlayback()) {
            setPlayhead(0);
          } else {
            setPlayhead("live");
            stopPlayback();
            renderCurrentFrame();
            syncPlaybackUi();
            updatePlaybackTimelineVisuals();
            hidePlaybackStats();
            return;
          }
        } else {
          setPlayhead(idx + 1);
        }
      } else if (idx <= 0) {
        if (getLoopPlayback()) {
          setPlayhead(total - 1);
        } else {
          stopPlayback();
          syncPlaybackUi();
          updatePlaybackTimelineVisuals();
          hidePlaybackStats();
          return;
        }
      } else {
        setPlayhead(idx - 1);
      }
    }
    hidePlaybackStats();
  };

  const startPlayback = (direction: PlaybackDirection): void => {
    const session = getSession();
    if (!session) {
      return;
    }
    const total = session.project.frameIdOrder.length;
    if (total === 0) {
      return;
    }
    clearFrameSelection();
    clearTimelineAnchor();
    stopPlayback();
    const runGen = epoch;
    isActive = true;

    const currentPlayhead = getPlayhead();
    if (direction === "forward") {
      if (currentPlayhead === "live") {
        setPlayhead(0);
      }
    } else if (currentPlayhead === "live") {
      setPlayhead(total - 1);
    }

    syncPlaybackUi();
    void runPlaybackLoop(runGen, direction, performance.now());
  };

  return {
    startPlayback,
    stopPlayback,
    isPlaybackActive: () => isActive
  };
};

