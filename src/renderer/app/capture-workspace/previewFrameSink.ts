import type { LivePreviewView } from "./livePreviewView";

export interface PreviewFrameSink {
  submit: (jpeg: Uint8Array) => void;
  reset: () => void;
}

export const createPreviewFrameSink = (params: {
  getLivePreviewView: () => LivePreviewView;
  getPreviewObjectUrl: () => string | null;
  setPreviewObjectUrl: (url: string | null) => void;
  currentSessionToken: () => number;
}): PreviewFrameSink => {
  const { getLivePreviewView, getPreviewObjectUrl, setPreviewObjectUrl, currentSessionToken } = params;
  let decodePending = false;
  let pendingJpeg: Uint8Array | null = null;

  const paintJpeg = (jpeg: Uint8Array): void => {
    const livePreviewView = getLivePreviewView();
    if (!livePreviewView) {
      return;
    }
    const blob = new Blob([jpeg as BlobPart], { type: "image/jpeg" });
    const prevUrl = getPreviewObjectUrl();
    const nextUrl = URL.createObjectURL(blob);
    setPreviewObjectUrl(nextUrl);
    const sessionAtPaint = currentSessionToken();
    decodePending = true;
    const onSettled = (): void => {
      if (sessionAtPaint !== currentSessionToken()) {
        URL.revokeObjectURL(nextUrl);
        decodePending = false;
        pendingJpeg = null;
        return;
      }
      if (prevUrl) {
        URL.revokeObjectURL(prevUrl);
      }
      decodePending = false;
      if (pendingJpeg) {
        const next = pendingJpeg;
        pendingJpeg = null;
        paintJpeg(next);
      }
    };
    livePreviewView.setPreviewSource(nextUrl, onSettled);
  };

  return {
    submit: (jpeg) => {
      if (!jpeg.byteLength) {
        return;
      }
      if (decodePending) {
        pendingJpeg = jpeg;
        return;
      }
      paintJpeg(jpeg);
    },
    reset: () => {
      decodePending = false;
      pendingJpeg = null;
    }
  };
};
