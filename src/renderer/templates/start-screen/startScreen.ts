import { escapeHtml } from "../../utils/htmlEscape";
import type { RecentProjectEntry } from "../../../shared/types/ipc";
import { encodeRecentProjectPath } from "../../utils/recentProjectPath";

const toCaptureModeLabel = (captureMode: string | null): string => {
  if (captureMode === "png") {
    return "PNG source";
  }
  if (captureMode === "jpeg") {
    return "JPEG source";
  }
  return "Mode n/a";
};

const formatRelativeDate = (iso: string | null, fallbackLabel: string): string => {
  if (!iso) {
    return fallbackLabel;
  }
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) {
    return fallbackLabel;
  }
  const now = Date.now();
  const diffMs = Math.max(0, now - date.getTime());
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < hour) {
    const mins = Math.max(1, Math.floor(diffMs / minute));
    return `${mins}m ago`;
  }
  if (diffMs < day) {
    const hrs = Math.floor(diffMs / hour);
    return `${hrs}h ago`;
  }
  const days = Math.floor(diffMs / day);
  if (days < 7) {
    return `${days}d ago`;
  }
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(date);
};

const renderRecentProjects = (projects: RecentProjectEntry[]): string => {
  if (projects.length === 0) {
    return `<p class="text-secondary mb-0">No recent projects found yet.</p>`;
  }

  const rows = projects
    .map(
      (project) => `
      <div class="col-12 col-lg-6" data-recent-card>
        <article
          class="bm-recent-card h-100 border rounded-3 p-3"
          data-open-recent="${escapeHtml(encodeRecentProjectPath(project.projectPath))}"
          tabindex="0"
          role="button"
          aria-label="Open recent project ${escapeHtml(project.projectTitle)}"
          title="${escapeHtml(project.projectPath)}"
        >
          <div class="d-flex align-items-start justify-content-between gap-2 mb-3">
            <div class="flex-grow-1">
              <div class="fw-semibold text-light text-truncate">${escapeHtml(project.projectTitle)}</div>
              <div class="small text-secondary">Updated ${escapeHtml(
                formatRelativeDate(project.updatedAt, "recently")
              )}</div>
            </div>
          </div>
          <div class="bm-recent-meta">
            <div class="bm-recent-meta-item">
              <span class="text-secondary">Frames</span>
              <strong>${project.frameCount ?? 0}</strong>
            </div>
            <div class="bm-recent-meta-item">
              <span class="text-secondary">Mode</span>
              <strong>${escapeHtml(toCaptureModeLabel(project.captureMode))}</strong>
            </div>
          </div>
        </article>
      </div>
    `
    )
    .join("");

  return `<div class="row g-3">${rows}</div>`;
};

const toAssetUrl = (fileName: string): string => new URL(`./assets/${fileName}`, window.location.href).toString();

const START_SPLASH_IMAGES: string[] = [
  toAssetUrl("splash_screen_01.jpg"),
  toAssetUrl("splash_screen_02.jpg"),
  toAssetUrl("splash_screen_03.jpg"),
  toAssetUrl("splash_screen_04.jpg"),
  toAssetUrl("splash_screen_05.jpg")
];

const resolveLaunchSplashImage = (): string => {
  const fromSession = window.sessionStorage.getItem("brick-motion.splash-image");
  if (fromSession && START_SPLASH_IMAGES.includes(fromSession)) {
    return fromSession;
  }
  const idx = Math.floor(Math.random() * START_SPLASH_IMAGES.length);
  return START_SPLASH_IMAGES[idx] ?? START_SPLASH_IMAGES[0];
};

export const renderStartScreen = (recentProjects: RecentProjectEntry[]): string => {
  const splashImage = resolveLaunchSplashImage();

  return `
  <main class="container-fluid min-vh-100 d-flex align-items-center justify-content-center bm-page bm-start-screen" style="--bm-start-bg-image: url('${splashImage}')">
    <section class="bm-panel bm-start-content shadow-lg p-4 p-lg-5">
      <header class="mb-4">
        <div class="d-flex align-items-center gap-3 mb-1">
          <img src="${toAssetUrl("logo.jpg")}" alt="" class="bm-brand-logo" />
          <div>
            <h1 class="bm-panel-title mb-0">Brick-Motion</h1>
            <p class="bm-panel-subtitle mb-0 mt-1">Create and animate stop-motion projects locally.</p>
          </div>
        </div>
      </header>

      <div class="row g-3 mb-4">
        <div class="col-12 col-lg-6">
          <button type="button" class="btn btn-primary w-100 py-3" data-action="create-project">
            <i class="bi bi-plus-square me-2"></i>
            Create New Project
          </button>
        </div>
        <div class="col-12 col-lg-6">
          <button type="button" class="btn btn-outline-primary w-100 py-3" data-action="open-project">
            <i class="bi bi-folder2-open me-2"></i>
            Open Existing Project
          </button>
        </div>
      </div>

      <div>
        <div class="d-flex align-items-center justify-content-between gap-2 mb-2">
          <h2 class="bm-section-title mb-0">Recent Projects</h2>
        </div>
        <div class="input-group mb-3 bm-recent-search bm-search-group">
          <span class="input-group-text"><i class="bi bi-search"></i></span>
          <input
            type="search"
            class="form-control"
            id="recentProjectsFilter"
            placeholder="Filter by title or metadata"
            autocomplete="off"
          />
        </div>
        <div id="recentProjectsList">
          ${renderRecentProjects(recentProjects)}
        </div>
      </div>
    </section>
    <div class="bm-start-copyright">
      <div>Copyright (c) 2026 Jonan Steiner</div>
      <div class="bm-start-version-detail" id="startAppVersionDetail" aria-live="polite"></div>
    </div>
  </main>
`;
};
