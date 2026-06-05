import type { ProjectSession } from "../../../shared/types/project";

const THUMB_LOAD_CONCURRENCY = 6;

export const createTimelineThumbLazyLoader = (params: {
  getImageObjectUrl: (session: ProjectSession, relativePath: string) => Promise<string>;
  getRenderGeneration: () => number;
}) => {
  const { getImageObjectUrl, getRenderGeneration } = params;
  let timelineThumbObserver: IntersectionObserver | null = null;
  const thumbWaitQueue: Array<() => Promise<void>> = [];
  let thumbInflight = 0;

  const disconnect = (): void => {
    timelineThumbObserver?.disconnect();
    timelineThumbObserver = null;
  };

  const pumpQueue = (): void => {
    while (thumbInflight < THUMB_LOAD_CONCURRENCY && thumbWaitQueue.length > 0) {
      const job = thumbWaitQueue.shift();
      if (!job) {
        break;
      }
      thumbInflight += 1;
      void job().finally(() => {
        thumbInflight -= 1;
        pumpQueue();
      });
    }
  };

  const clearQueue = (): void => {
    thumbWaitQueue.length = 0;
  };

  const enqueue = (job: () => Promise<void>): void => {
    thumbWaitQueue.push(job);
    pumpQueue();
  };

  const observeTrackButtons = (params: {
    timelineTrack: HTMLElement;
    timelineScrollTrack: HTMLElement | null;
    session: ProjectSession;
    renderGeneration: number;
  }): void => {
    const { timelineTrack, timelineScrollTrack, session, renderGeneration } = params;
    const scrollRoot = timelineScrollTrack ?? null;
    timelineThumbObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            continue;
          }
          const btn = entry.target as HTMLButtonElement;
          const img = btn.querySelector<HTMLImageElement>("img.bm-thumb-img[data-image-path]");
          if (!img) {
            continue;
          }
          const rel = img.dataset.imagePath;
          if (!rel) {
            continue;
          }
          if (img.dataset.thumbLoad === "1" || img.dataset.thumbLoad === "pending" || img.dataset.thumbLoad === "err") {
            continue;
          }
          img.dataset.thumbLoad = "pending";
          enqueue(async () => {
            if (renderGeneration !== getRenderGeneration()) {
              delete img.dataset.thumbLoad;
              return;
            }
            try {
              const url = await getImageObjectUrl(session, rel);
              if (renderGeneration !== getRenderGeneration()) {
                delete img.dataset.thumbLoad;
                return;
              }
              img.src = url;
              img.dataset.thumbLoad = "1";
            } catch {
              img.dataset.thumbLoad = "err";
            }
          });
        }
      },
      {
        root: scrollRoot,
        rootMargin: "80px 320px",
        threshold: 0.01
      }
    );
    timelineTrack.querySelectorAll<HTMLButtonElement>("button[data-frame-index]").forEach((btn) => {
      if (btn.querySelector("img.bm-thumb-img[data-image-path]")) {
        timelineThumbObserver?.observe(btn);
      }
    });
  };

  return {
    disconnect,
    clearQueue,
    observeTrackButtons
  };
};
