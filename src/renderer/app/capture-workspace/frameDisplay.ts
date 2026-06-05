import type { ProjectSession } from "../../../shared/types/project";
import type { CameraPhase } from "./cameraPolicy";

export const createFrameDisplay = (params: {
  frameViewer: HTMLImageElement | null;
  livePreviewEl: HTMLImageElement | null;
  setLivePreviewLoading: (loading: boolean) => void;
  setCameraStatus: (message: string) => void;
  getCameraPhase: () => CameraPhase;
  getImageObjectUrl: (session: ProjectSession, relativePath: string) => Promise<string>;
  renderOnion: () => void;
}): {
  renderCurrentFrame: (session: ProjectSession | null, playhead: "live" | number) => void;
  showFrameSource: (src: string, frameNumber: number) => void;
} => {
  const { frameViewer, livePreviewEl, setLivePreviewLoading, setCameraStatus, getCameraPhase, getImageObjectUrl, renderOnion } =
    params;

  const renderCurrentFrame = (session: ProjectSession | null, playhead: "live" | number): void => {
    if (!session || !frameViewer || !livePreviewEl) {
      return;
    }

    if (playhead === "live") {
      frameViewer.classList.add("d-none");
      livePreviewEl.classList.remove("d-none");
      const phase = getCameraPhase();
      if (phase === "live" || phase === "opening") {
        setCameraStatus("Live camera feed");
      }
      renderOnion();
      return;
    }

    setLivePreviewLoading(false);
    const frameNumber = playhead + 1;
    const frameId = session.project.frameIdOrder[playhead];
    const frame = session.project.framesById[frameId];
    if (frame) {
      void getImageObjectUrl(session, frame.previewPath)
        .then((src) => {
          frameViewer.src = src;
          frameViewer.classList.remove("d-none");
          livePreviewEl.classList.add("d-none");
          setCameraStatus(`Frame ${frameNumber}`);
        })
        .catch(() => {
          /* Error already reported in getImageObjectUrl */
        });
    }
    renderOnion();
  };

  const showFrameSource = (src: string, frameNumber: number): void => {
    if (!frameViewer || !livePreviewEl) {
      return;
    }
    frameViewer.src = src;
    frameViewer.classList.remove("d-none");
    livePreviewEl.classList.add("d-none");
    setLivePreviewLoading(false);
    setCameraStatus(`Frame ${frameNumber}`);
  };

  return { renderCurrentFrame, showFrameSource };
};

