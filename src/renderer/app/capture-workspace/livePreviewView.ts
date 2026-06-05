export interface LivePreviewView {
  setLoading: (loading: boolean) => void;
  setStatus: (message: string) => void;
  clearPreview: () => void;
  setPreviewSource: (src: string, onSettled: () => void) => void;
}

export const createLivePreviewView = (params: {
  getLivePreviewEl: () => HTMLImageElement | null;
  getCameraStatusEl: () => HTMLElement | null;
  setLivePreviewLoading: (loading: boolean) => void;
}): LivePreviewView => {
  const { getLivePreviewEl, getCameraStatusEl, setLivePreviewLoading } = params;
  return {
    setLoading: (loading) => {
      setLivePreviewLoading(loading);
    },
    setStatus: (message) => {
      const cameraStatusEl = getCameraStatusEl();
      if (!cameraStatusEl) {
        return;
      }
      cameraStatusEl.textContent = message;
    },
    clearPreview: () => {
      getLivePreviewEl()?.removeAttribute("src");
    },
    setPreviewSource: (src, onSettled) => {
      const livePreviewEl = getLivePreviewEl();
      if (!livePreviewEl) {
        return;
      }
      livePreviewEl.onload = onSettled;
      livePreviewEl.onerror = onSettled;
      livePreviewEl.src = src;
    }
  };
};

