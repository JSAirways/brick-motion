import type { ProjectSession } from "../../../shared/types/project";
import { buildTimelineInitialTrackHtml } from "../../app/capture-workspace/timelineRender";
import { captureModeLabel } from "../../utils/captureModeLabel";
import { escapeHtml } from "../../utils/htmlEscape";

const frameCount = (session: ProjectSession): number => session.project.frameIdOrder.length;

/** Runtime-safe defaults when older `project.json` omits new `uiState` fields. */
const workspaceUi = (session: ProjectSession) => ({
  showPlaybackFpsOverlay: Boolean(session.project.uiState.showPlaybackFpsOverlay)
});

const safeFps = (session: ProjectSession): number => {
  const f = session.project.fps;
  return typeof f === "number" && Number.isFinite(f) ? Math.max(1, Math.min(60, f)) : 12;
};

const renderSequenceTiles = (session: ProjectSession): string => {
  const project = session.project;
  return project.sequenceOrder
    .map((sequenceId) => {
      const sequence = project.sequencesById[sequenceId];
      if (!sequence) {
        return "";
      }
      const firstFrameId = sequence.frameIdOrder[0];
      const firstFrame = firstFrameId ? project.framesById[firstFrameId] : null;
      const thumbPath = firstFrame?.timelineThumbPath ?? "";
      const isActive = project.activeSequenceId === sequenceId;
      return `<article class="bm-sequence-item bm-sequence-card ${isActive ? "bm-sequence-card-active" : ""}" data-sequence-id="${escapeHtml(sequenceId)}"><button type="button" class="btn p-0 bm-sequence-open ${isActive ? "bm-thumb-active" : ""}" data-sequence-open="${escapeHtml(sequenceId)}" aria-label="Open sequence ${escapeHtml(sequence.title)}"><div class="bm-thumb position-relative bm-sequence-tile"><div class="bm-sequence-media-overlay"></div>${thumbPath ? `<img class="bm-thumb-img" alt="" width="140" height="79" decoding="async" data-image-path="${escapeHtml(thumbPath)}" />` : `<div class="bm-sequence-empty"><i class="bi bi-image"></i></div>`}<div class="bm-sequence-overlay-meta"><span class="bm-sequence-title text-white fw-semibold">${escapeHtml(sequence.title)}</span><span class="bm-sequence-frame-count">${sequence.frameIdOrder.length} frame${sequence.frameIdOrder.length === 1 ? "" : "s"}</span></div></div></button><div class="bm-sequence-actions"><button type="button" class="btn btn-sm bm-icon-control" data-sequence-action="rename" data-sequence-id="${escapeHtml(sequenceId)}" aria-label="Rename sequence ${escapeHtml(sequence.title)}" title="Rename sequence"><i class="bi bi-pencil"></i></button><button type="button" class="btn btn-sm bm-icon-control" data-sequence-action="duplicate" data-sequence-id="${escapeHtml(sequenceId)}" aria-label="Duplicate sequence ${escapeHtml(sequence.title)}" title="Duplicate sequence"><i class="bi bi-files"></i></button><button type="button" class="btn btn-sm bm-sequence-trash bm-icon-control" data-sequence-action="delete" data-sequence-id="${escapeHtml(sequenceId)}" aria-label="Delete sequence ${escapeHtml(sequence.title)}" title="Delete sequence"><i class="bi bi-trash3"></i></button></div><form class="bm-sequence-edit-row d-none" data-sequence-edit-row="${escapeHtml(sequenceId)}"><input type="text" class="form-control form-control-sm" data-sequence-edit-input="${escapeHtml(sequenceId)}" value="${escapeHtml(sequence.title)}" /><button type="submit" class="btn btn-sm bm-icon-control btn-primary" aria-label="Save sequence title" title="Save"><i class="bi bi-check-lg"></i></button><button type="button" class="btn btn-sm bm-icon-control btn-outline-secondary" data-sequence-edit-cancel="${escapeHtml(sequenceId)}" aria-label="Cancel rename" title="Cancel"><i class="bi bi-x-lg"></i></button></form></article>`;
    })
    .join("");
};

export const renderCaptureWorkspace = (session: ProjectSession): string => `
  <main class="container-fluid vh-100 p-0 bg-dark-subtle">
    <div class="row g-0 h-100 flex-column flex-nowrap">
      <div class="col-auto">
        <header class="d-flex justify-content-between align-items-center px-3 py-2 border-bottom border-secondary bg-body">
          <div>
            <h1 class="bm-workspace-title mb-0">${escapeHtml(session.project.projectTitle)}</h1>
          </div>
          <div class="d-flex align-items-center gap-1">
            <button
              class="btn btn-outline-secondary border-0 bm-icon-control"
              type="button"
              data-action="open-sequence-panel"
              aria-controls="sequenceManagerPanel"
              title="Sequences"
              aria-label="Sequences"
            >
              <i class="bi bi-collection"></i>
            </button>
            <button
              class="btn btn-outline-secondary border-0 bm-icon-control"
              type="button"
              data-action="open-project-settings-panel"
              aria-controls="projectSettingsPanel"
              title="Project settings"
              aria-label="Project settings"
            >
              <i class="bi bi-gear"></i>
            </button>
            <button
              class="btn btn-outline-secondary border-0 bm-icon-control"
              type="button"
              data-action="open-export-panel"
              aria-controls="exportPanel"
              title="Export"
              aria-label="Export"
            >
              <i class="bi bi-box-arrow-up-right"></i>
            </button>
            <button
              type="button"
              class="btn btn-outline-secondary border-0 bm-icon-control"
              data-action="open-help-panel"
              title="Help"
              aria-label="Help"
            >
              <i class="bi bi-question-circle"></i>
            </button>
            <button
              type="button"
              class="btn btn-outline-secondary border-0 bm-icon-control"
              data-action="back-to-start"
              title="Start screen"
              aria-label="Start screen"
            >
              <i class="bi bi-house-door"></i>
            </button>
          </div>
        </header>
      </div>

      <section class="col bm-workspace">
        <div class="row g-0 h-100">
          <div class="col-12 bm-main-area">
            <div class="row g-0 h-100 flex-column flex-nowrap">
              <div class="col bm-live-container position-relative bg-black">
                <div class="bm-live-preview bg-black position-relative">
                  <img
                    id="livePreview"
                    class="bm-live-video"
                    alt="Live camera preview"
                  />
                  <img id="frameViewer" class="bm-frame-viewer d-none" alt="Frame preview" />
                  <img id="onionViewer" class="bm-onion-viewer d-none" alt="Onion skin overlay" />
                  <div id="livePreviewLoading" class="bm-live-preview-loading d-none" aria-busy="false">
                    <div class="spinner-border bm-live-preview-spinner" role="status"></div>
                    <span class="visually-hidden">Loading camera preview</span>
                  </div>
                  <div id="cameraStatus" class="bm-camera-status">Initializing camera...</div>
                  <div id="playbackStatsOverlay" class="bm-playback-stats d-none position-absolute bottom-0 end-0 m-2 p-2 small text-white rounded-2"></div>
                  <div
                    id="onionOpacityOverlay"
                    class="bm-onion-opacity-overlay d-none"
                    role="region"
                    aria-label="Onion skin opacity"
                  >
                    <input
                      type="range"
                      class="form-range"
                      min="0"
                      max="1"
                      step="0.05"
                      value="0.45"
                      id="onionOpacity"
                      aria-label="Onion skin opacity"
                    />
                  </div>
                </div>

                <div class="position-absolute top-0 end-0 m-3 d-flex flex-column gap-2">
                  <button
                    id="cameraControlsOpenBtn"
                    class="btn btn-secondary shadow-sm"
                    type="button"
                    data-action="open-camera-controls-panel"
                    aria-controls="cameraControlsPanel"
                    aria-label="Camera controls"
                  >
                    <i class="bi bi-camera-video"></i>
                  </button>
                </div>

                <aside class="bm-sidepanel" id="projectSettingsPanel" aria-hidden="true">
                  <div class="offcanvas-header">
                    <h2 class="offcanvas-title">Project Settings</h2>
                    <button type="button" class="btn btn-outline-secondary border-0 bm-icon-control bm-offcanvas-close ms-auto" data-action="close-project-settings-panel" aria-label="Close panel">
                      <i class="bi bi-x-lg"></i>
                    </button>
                  </div>
                  <div class="offcanvas-body">
                    <form id="projectSettingsForm" class="vstack gap-3">
                      <div>
                        <label class="form-label" for="settingsProjectTitle">Project title</label>
                        <input id="settingsProjectTitle" name="projectTitle" class="form-control" type="text" value="${escapeHtml(session.project.projectTitle)}" required />
                      </div>
                      <div>
                        <label class="form-label" for="settingsCaptureMode">Capture mode</label>
                        <select id="settingsCaptureMode" name="captureMode" class="form-select">
                          <option value="jpeg" ${session.project.captureMode === "jpeg" ? "selected" : ""}>${escapeHtml(captureModeLabel("jpeg"))}</option>
                          <option value="png" ${session.project.captureMode === "png" ? "selected" : ""}>${escapeHtml(captureModeLabel("png"))}</option>
                        </select>
                      </div>
                      <div>
                        <label class="form-label" for="settingsFps">Framerate</label>
                        <input id="settingsFps" name="fps" class="form-control" type="number" min="1" max="60" value="${escapeHtml(String(safeFps(session)))}" required />
                      </div>
                      <div class="form-check">
                        <input class="form-check-input" type="checkbox" id="showPlaybackFpsOverlay" ${workspaceUi(session).showPlaybackFpsOverlay ? "checked" : ""} />
                        <label class="form-check-label" for="showPlaybackFpsOverlay">Show playback stats overlay</label>
                      </div>
                      <div>
                        <label class="form-label d-block mb-1">Project Folder</label>
                        <div class="small text-secondary text-break mb-2" id="settingsProjectFolderPath">${escapeHtml(session.projectRoot)}</div>
                        <button type="button" class="btn btn-outline-primary" data-action="change-project-folder">
                          <i class="bi bi-folder-symlink me-1"></i>
                          Change Folder
                        </button>
                      </div>
                      
                        <button type="submit" class="btn btn-primary mt-3">
                          <i class="bi bi-floppy me-1"></i>
                          Save Settings
                        </button>
                    </form>
                  </div>
                </aside>

                <aside class="bm-sidepanel" id="sequenceManagerPanel" aria-hidden="true">
                  <div class="offcanvas-header">
                    <h2 class="offcanvas-title mb-0">Sequences</h2>
                    <button type="button" class="btn btn-outline-secondary border-0 bm-icon-control bm-offcanvas-close ms-auto" data-action="close-sequence-panel" aria-label="Close panel">
                      <i class="bi bi-x-lg"></i>
                    </button>
                  </div>
                  <div class="offcanvas-body">
                    <div class="input-group mb-3 bm-sequence-search bm-search-group">
                      <span class="input-group-text"><i class="bi bi-search"></i></span>
                      <input id="sequenceSearchInput" class="form-control" type="search" placeholder="Search sequences..." autocomplete="off" />
                    </div>
                    <div id="sequenceTileGrid" class="bm-sequence-grid">
                      ${renderSequenceTiles(session)}
                    </div>
                    <div class="mt-3">
                      <button type="button" class="btn btn-primary w-100" id="createSequenceButton">
                        <i class="bi bi-plus-lg me-1"></i>New Sequence
                      </button>
                    </div>
                  </div>
                </aside>

                <aside class="bm-sidepanel" id="exportPanel" aria-hidden="true">
                  <div class="offcanvas-header">
                    <h2 class="offcanvas-title">Export Frames</h2>
                    <button type="button" class="btn btn-outline-secondary border-0 bm-icon-control bm-offcanvas-close ms-auto" data-action="close-export-panel" aria-label="Close panel">
                      <i class="bi bi-x-lg"></i>
                    </button>
                  </div>
                  <div class="offcanvas-body">
                    <form id="exportSequenceForm" class="vstack gap-3">
                      <div class="pb-2 border-bottom border-secondary-subtle">
                        <label class="form-label d-block mb-2">Export Scope</label>
                        <div class="form-check">
                          <input class="form-check-input" type="radio" name="exportScope" id="exportScopeActive" value="active" checked />
                          <label class="form-check-label" for="exportScopeActive">Active Sequence</label>
                        </div>
                        <div class="form-check mt-1">
                          <input class="form-check-input" type="radio" name="exportScope" id="exportScopeSelected" value="selected" />
                          <label class="form-check-label" for="exportScopeSelected">Selected Sequences</label>
                        </div>
                        <div class="form-check mt-1">
                          <input class="form-check-input" type="radio" name="exportScope" id="exportScopeAll" value="all" />
                          <label class="form-check-label" for="exportScopeAll">All Sequences</label>
                        </div>
                        <div id="exportSequenceSelectionList" class="mt-2"></div>
                      </div>
                      <div class="pb-2 border-bottom border-secondary-subtle">
                        <label class="form-label d-block mb-2">Save To</label>
                        <div class="form-check">
                          <input class="form-check-input" type="radio" name="exportPathMode" id="exportPathModeDefault" value="project_default" checked />
                          <label class="form-check-label" for="exportPathModeDefault">Project Exports</label>
                        </div>
                        <div class="form-check mt-1">
                          <input class="form-check-input" type="radio" name="exportPathMode" id="exportPathModeCustom" value="custom" />
                          <label class="form-check-label" for="exportPathModeCustom">Custom Folder</label>
                        </div>
                      </div>

                      <div id="customExportPathGroup" class="d-none pb-2 border-bottom border-secondary-subtle">
                        <label class="form-label" for="customExportPathInput">Folder</label>
                        <div class="d-flex gap-2 bm-export-path-picker">
                          <input id="customExportPathInput" name="customExportPath" class="form-control" type="text" placeholder="Choose a folder..." />
                          <button type="button" class="btn btn-outline-secondary flex-shrink-0" data-action="pick-export-path">Choose...</button>
                        </div>
                      </div>

                      <div class="pb-2 border-bottom border-secondary-subtle">
                        <label class="form-label d-block mb-2">If Folder Already Contains Frames</label>
                        <div class="form-check">
                          <input class="form-check-input" type="radio" name="exportConflictMode" id="exportConflictReplace" value="replace" checked />
                          <label class="form-check-label" for="exportConflictReplace">Replace Existing</label>
                        </div>
                        <div class="form-check mt-1">
                          <input class="form-check-input" type="radio" name="exportConflictMode" id="exportConflictKeepBoth" value="keep_both" />
                          <label class="form-check-label" for="exportConflictKeepBoth">Create New Folder</label>
                        </div>
                      </div>

                      <div class="pb-2 border-bottom border-secondary-subtle">
                        <label class="form-label" for="exportFramePrefixInput">Frame filename prefix</label>
                        <input id="exportFramePrefixInput" name="frameFilePrefix" class="form-control" type="text" value="frame_" placeholder="e.g. shotA_" />
                        <div class="form-text">Example output: <span class="text-secondary" id="exportFileNameExample">frame_000001.jpg</span></div>
                      </div>

                      <div>
                        <div class="small text-secondary" id="exportSummaryText">—</div>
                      </div>

                      <div class="form-check">
                        <input class="form-check-input" type="checkbox" id="openExportAfterDone" checked />
                        <label class="form-check-label" for="openExportAfterDone">Open folder after export</label>
                      </div>

                      <button type="submit" class="btn btn-primary mt-2">
                        <i class="bi bi-box-arrow-up-right me-1"></i>
                        Export
                      </button>
                    </form>
                  </div>
                </aside>

                <aside class="bm-sidepanel" id="cameraControlsPanel" aria-hidden="true">
                  <div class="offcanvas-header">
                    <h2 class="offcanvas-title">Camera Controls</h2>
                    <button type="button" class="btn btn-outline-secondary border-0 bm-icon-control bm-offcanvas-close ms-auto" data-action="close-camera-controls-panel" aria-label="Close panel">
                      <i class="bi bi-x-lg"></i>
                    </button>
                  </div>
                  <div class="offcanvas-body">
                    <div class="vstack gap-3 mb-3">
                      <div>
                        <label class="form-label" for="cameraDeviceSelect">Camera Device</label>
                        <select id="cameraDeviceSelect" class="form-select"></select>
                      </div>
                      <div class="d-flex gap-2">
                        <button type="button" class="btn btn-outline-primary flex-fill" data-action="refresh-cameras">
                          <i class="bi bi-arrow-repeat me-1"></i>
                          Refresh Devices
                        </button>
                      </div>
                    </div>
                    <div id="cameraControlsContainer" class="vstack gap-3">
                      <p class="text-secondary mb-0">Camera controls will appear for supported capabilities.</p>
                    </div>
                  </div>
                </aside>

                <aside class="bm-sidepanel" id="helpPanel" aria-hidden="true">
                  <div class="offcanvas-header">
                    <h2 class="offcanvas-title">Help</h2>
                    <button type="button" class="btn btn-outline-secondary border-0 bm-icon-control bm-offcanvas-close ms-auto" data-action="close-help-panel" aria-label="Close panel">
                      <i class="bi bi-x-lg"></i>
                    </button>
                  </div>
                  <div class="offcanvas-body">
                    <div class="vstack gap-3 bm-help-panel">
                      <section class="bm-help-card">
                        <h3 class="bm-section-title mb-2">Quick Start</h3>
                        <ul class="small mb-0 ps-3">
                          <li>Capture with <strong>C</strong> or the camera button in the toolbar.</li>
                          <li>Use <strong>Sequence Manager</strong> to split shots/takes and keep timelines tidy.</li>
                          <li>Export active, selected, or all sequences from the <strong>Export</strong> panel.</li>
                          <li><strong>Esc</strong> exits fullscreen first, then clears frame selection.</li>
                        </ul>
                      </section>
                      <section class="bm-help-card">
                        <h3 class="bm-section-title mb-2">Playback & Timeline</h3>
                        <table class="table table-sm bm-help-shortcuts mb-0">
                          <tbody>
                            <tr><td><kbd>Space</kbd></td><td>Play/Pause</td></tr>
                            <tr><td><kbd>J</kbd> / <kbd>K</kbd> / <kbd>L</kbd></td><td>Reverse / Stop / Forward</td></tr>
                            <tr><td><kbd>←</kbd> / <kbd>→</kbd></td><td>Previous / Next frame</td></tr>
                            <tr><td><kbd>Home</kbd> / <kbd>End</kbd></td><td>First / Last frame</td></tr>
                            <tr><td><kbd>O</kbd></td><td>Toggle onion skin</td></tr>
                          </tbody>
                        </table>
                      </section>
                      <section class="bm-help-card">
                        <h3 class="bm-section-title mb-2">Editing</h3>
                        <table class="table table-sm bm-help-shortcuts mb-0">
                          <tbody>
                            <tr><td><kbd>C</kbd></td><td>Capture frame</td></tr>
                            <tr><td><kbd>Delete</kbd> / <kbd>Backspace</kbd></td><td>Delete selected frame(s)</td></tr>
                            <tr><td><kbd>Ctrl/Cmd</kbd> + <kbd>D</kbd></td><td>Duplicate selected frame(s)</td></tr>
                            <tr><td><kbd>Ctrl/Cmd</kbd> + <kbd>Z</kbd></td><td>Undo</td></tr>
                            <tr><td><kbd>Ctrl/Cmd</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd></td><td>Redo</td></tr>
                            <tr><td><kbd>Ctrl/Cmd</kbd> + <kbd>A</kbd></td><td>Select all timeline frames</td></tr>
                          </tbody>
                        </table>
                      </section>
                      <section class="bm-help-card">
                        <h3 class="bm-section-title mb-2">About Brick-Motion</h3>
                        <dl class="bm-about-dl small mb-0">
                          <div class="bm-about-dl-row">
                            <dt>Version</dt>
                            <dd id="aboutReleaseVersion">…</dd>
                          </div>
                          <div class="bm-about-dl-row">
                            <dt>Project files</dt>
                            <dd id="aboutProjectFileFormat">…</dd>
                          </div>
                        </dl>
                        <p class="small text-secondary mb-0 mt-2">Stop-motion capture and timeline editing on your machine.</p>
                      </section>
                      <section class="bm-help-card">
                        <h3 class="bm-section-title mb-2">Sequences</h3>
                        <table class="table table-sm bm-help-shortcuts mb-0">
                          <tbody>
                            <tr><td><kbd>Ctrl/Cmd</kbd> + <kbd>Shift</kbd> + <kbd>N</kbd></td><td>New sequence</td></tr>
                            <tr><td><kbd>Ctrl/Cmd</kbd> + <kbd>Shift</kbd> + <kbd>D</kbd></td><td>Duplicate active sequence</td></tr>
                            <tr><td><kbd>F2</kbd></td><td>Rename active sequence</td></tr>
                            <tr><td><kbd>Ctrl/Cmd</kbd> + <kbd>Alt</kbd> + <kbd>←</kbd> / <kbd>→</kbd></td><td>Previous / Next sequence</td></tr>
                            <tr><td><kbd>Ctrl/Cmd</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd></td><td>Open sequence manager</td></tr>
                          </tbody>
                        </table>
                      </section>
                    </div>
                  </div>
                </aside>
              </div>

              <div class="col-auto w-100 border-top border-secondary bg-body p-2">
                <div class="d-flex flex-wrap justify-content-center gap-2 gap-md-3 bm-toolbar bm-toolbar-layout">
                  <div class="d-flex align-items-center flex-shrink-0 gap-1 bm-toolbar-transport" role="group" aria-label="Timeline transport">
                    <button
                      type="button"
                      class="btn btn-outline-secondary border-0"
                      data-action="reset"
                      data-bs-toggle="tooltip"
                      data-bs-placement="top"
                      data-bs-container="body"
                      data-bs-title="Go to first frame (or live if empty)"
                      aria-label="Reset playhead"
                    >
                      <i class="bi bi-chevron-bar-left"></i>
                    </button>
                    <button
                      type="button"
                      class="btn btn-outline-secondary border-0"
                      data-action="prev-frame"
                      data-bs-toggle="tooltip"
                      data-bs-placement="top"
                      data-bs-container="body"
                      data-bs-title="Previous frame"
                      aria-label="Previous frame"
                    >
                      <i class="bi bi-skip-backward-fill"></i>
                    </button>
                    <button
                      type="button"
                      class="btn btn-outline-secondary border-0"
                      data-action="toggle-playback"
                      data-bs-toggle="tooltip"
                      data-bs-placement="top"
                      data-bs-container="body"
                      data-bs-title="Play or pause timeline"
                      aria-label="Play or pause"
                    >
                      <i class="bi bi-play-fill" id="playPauseIcon"></i>
                    </button>
                    <button
                      type="button"
                      class="btn btn-outline-secondary border-0"
                      data-action="next-frame"
                      data-bs-toggle="tooltip"
                      data-bs-placement="top"
                      data-bs-container="body"
                      data-bs-title="Next frame"
                      aria-label="Next frame"
                    >
                      <i class="bi bi-skip-forward-fill"></i>
                    </button>
                    <button
                      type="button"
                      class="btn btn-outline-secondary border-0"
                      data-action="toggle-loop"
                      data-bs-toggle="tooltip"
                      data-bs-placement="top"
                      data-bs-container="body"
                      data-bs-title="Loop playback at the end of the timeline"
                      aria-label="Toggle loop"
                    >
                      <i class="bi bi-repeat"></i>
                    </button>
                  </div>
                  <span class="bm-toolbar-divider" aria-hidden="true"></span>
                  <div class="d-flex align-items-center gap-2 bm-toolbar-frame-actions ms-1 ms-md-2">
                    <div class="bm-onion-toggle" role="group" aria-label="Onion skin">
                      <input class="btn-check" type="checkbox" id="onionToggle" autocomplete="off" />
                      <label
                        class="btn btn-outline-secondary border-0"
                        for="onionToggle"
                        data-bs-toggle="tooltip"
                        data-bs-placement="top"
                        data-bs-container="body"
                        data-bs-title="Onion skin — overlay the previous captured frame on the live view (shortcut: O)."
                      >
                        <i class="bi bi-layers" aria-hidden="true"></i>
                        <span class="visually-hidden">Onion skin</span>
                      </label>
                    </div>
                    <button
                      type="button"
                      class="btn btn-primary bm-capture-button border-0"
                      data-action="capture-frame"
                      data-bs-toggle="tooltip"
                      data-bs-placement="top"
                      data-bs-container="body"
                      data-bs-title="Capture a new frame from the live camera"
                      aria-label="Capture frame"
                    >
                      <i class="bi bi-camera-fill"></i>
                    </button>
                    <button
                      type="button"
                      class="btn btn-outline-secondary border-0"
                      data-action="undo-frame"
                      data-bs-toggle="tooltip"
                      data-bs-placement="top"
                      data-bs-container="body"
                      data-bs-title="Undo frame action (Ctrl/Cmd+Z)"
                      aria-label="Undo frame action"
                    >
                      <i class="bi bi-arrow-counterclockwise"></i>
                    </button>
                    <button
                      type="button"
                      class="btn btn-outline-secondary border-0"
                      data-action="redo-frame"
                      data-bs-toggle="tooltip"
                      data-bs-placement="top"
                      data-bs-container="body"
                      data-bs-title="Redo frame action (Ctrl/Cmd+Shift+Z)"
                      aria-label="Redo frame action"
                    >
                      <i class="bi bi-arrow-clockwise"></i>
                    </button>
                    <button
                      type="button"
                      class="btn btn-outline-secondary border-0"
                      data-action="duplicate-frame"
                      data-bs-toggle="tooltip"
                      data-bs-placement="top"
                      data-bs-container="body"
                      data-bs-title="Duplicate current or selected frames (Ctrl+D / Cmd+D)"
                      aria-label="Duplicate frame"
                    >
                      <i class="bi bi-files"></i>
                    </button>
                    <button
                      type="button"
                      class="btn btn-outline-danger border-0"
                      data-action="delete-frame"
                      data-bs-toggle="tooltip"
                      data-bs-placement="top"
                      data-bs-container="body"
                      data-bs-title="Delete selected frames (multi-select on the timeline)"
                      aria-label="Delete frame"
                    >
                      <i class="bi bi-trash3"></i>
                    </button>
                  </div>
                  <span class="bm-toolbar-divider" aria-hidden="true"></span>

                  <div class="d-flex align-items-stretch flex-shrink-0 flex-wrap gap-2 gap-md-3 bm-toolbar-end">
                    <div
                      id="toolbarFocusSegment"
                      class="d-none d-flex align-items-stretch flex-shrink-0 gap-2 bm-toolbar-focus-segment"
                      aria-hidden="true"
                    >
                      <div class="d-flex align-items-center gap-1 bm-toolbar-focus-group bm-toolbar-focus-wrap" role="group" aria-label="Camera focus">
                        <button
                          type="button"
                          class="btn btn-sm bm-toolbar-focus-btn"
                          id="focusNear10"
                          data-focus-delta="-10"
                          disabled
                          aria-label="Focus ten steps toward near"
                          data-bs-toggle="tooltip"
                          data-bs-placement="top"
                          data-bs-container="body"
                          data-bs-title="Focus ten steps toward near (decrease position)"
                        >
                          <i class="bi bi-chevron-double-left" aria-hidden="true"></i>
                        </button>
                        <button
                          type="button"
                          class="btn btn-sm bm-toolbar-focus-btn"
                          id="focusNear1"
                          data-focus-delta="-1"
                          disabled
                          aria-label="Focus one step toward near"
                          data-bs-toggle="tooltip"
                          data-bs-placement="top"
                          data-bs-container="body"
                          data-bs-title="Focus one step toward near (decrease position)"
                        >
                          <i class="bi bi-chevron-left" aria-hidden="true"></i>
                        </button>
                        <button
                          type="button"
                          class="btn btn-sm bm-toolbar-focus-btn"
                          id="focusFar1"
                          data-focus-delta="1"
                          disabled
                          aria-label="Focus one step toward far"
                          data-bs-toggle="tooltip"
                          data-bs-placement="top"
                          data-bs-container="body"
                          data-bs-title="Focus one step toward far (increase position)"
                        >
                          <i class="bi bi-chevron-right" aria-hidden="true"></i>
                        </button>
                        <button
                          type="button"
                          class="btn btn-sm bm-toolbar-focus-btn"
                          id="focusFar10"
                          data-focus-delta="10"
                          disabled
                          aria-label="Focus ten steps toward far"
                          data-bs-toggle="tooltip"
                          data-bs-placement="top"
                          data-bs-container="body"
                          data-bs-title="Focus ten steps toward far (increase position)"
                        >
                          <i class="bi bi-chevron-double-right" aria-hidden="true"></i>
                        </button>
                      </div>
                      <span class="bm-toolbar-divider" aria-hidden="true"></span>
                    </div>
                    <div class="d-flex align-items-center gap-2 flex-nowrap">
                      <span
                        class="small text-secondary text-nowrap user-select-none bm-toolbar-playback-label d-none d-xl-inline"
                        data-bs-toggle="tooltip"
                        data-bs-placement="top"
                        data-bs-container="body"
                        data-bs-title="How the timeline advances when you play"
                      >Playback</span>
                      <div
                        class="btn-group btn-group-sm bm-playback-timing-group"
                        role="group"
                        aria-label="Playback mode"
                        id="playbackTimingGroup"
                      >
                        <input
                          type="radio"
                          class="btn-check"
                          name="playbackTimingMode"
                          id="playbackTimingRealtime"
                          value="wall_clock"
                          autocomplete="off"
                          ${session.project.uiState.playbackTimingMode === "wall_clock" ? "checked" : ""}
                        />
                        <label
                          class="btn btn-outline-secondary"
                          for="playbackTimingRealtime"
                          data-bs-toggle="tooltip"
                          data-bs-placement="top"
                          data-bs-container="body"
                          data-bs-title="Play at project FPS in real time. May skip frames to stay on schedule."
                        >Animation</label>
                        <input
                          type="radio"
                          class="btn-check"
                          name="playbackTimingMode"
                          id="playbackTimingPerFrame"
                          value="hold_after_decode"
                          autocomplete="off"
                          ${session.project.uiState.playbackTimingMode === "hold_after_decode" ? "checked" : ""}
                        />
                        <label
                          class="btn btn-outline-secondary"
                          for="playbackTimingPerFrame"
                          data-bs-toggle="tooltip"
                          data-bs-placement="top"
                          data-bs-container="body"
                          data-bs-title="Hold each frame after decode (~1/fps per frame). Best for reviewing every frame."
                        >Per Frame</label>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div class="col-auto bm-timeline border-top border-secondary bg-black p-2">
                <div class="bm-timeline-grid">
                  <div id="timelineScrollTrack" class="bm-timeline-scroll bm-timeline-scroll-track">
                    <div id="timelineTrack" class="d-flex gap-2 flex-nowrap bm-timeline-row">
                      ${buildTimelineInitialTrackHtml(frameCount(session))}
                    </div>
                  </div>
                  <div id="timelineScrollScale" class="bm-timeline-scroll bm-timeline-scroll-scale">
                    <div id="timelineScale" class="d-flex gap-2 flex-nowrap bm-timeline-row"></div>
                  </div>
                  <div class="bm-timeline-live-column">
                    <button type="button" id="timelineLiveButton" class="btn btn-sm bm-timeline-live-fill btn-primary" data-frame-index="live">Live</button>
                  </div>
                </div>
                <div class="d-flex align-items-center justify-content-between gap-3 pt-1 px-1">
                  <div id="workspaceStatus" class="small text-secondary text-truncate">Ready.</div>
                  <div id="workspaceMeta" class="small text-secondary text-end flex-shrink-0"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

    </div>
  </main>
`;
