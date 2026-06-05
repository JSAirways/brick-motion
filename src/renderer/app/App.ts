import { Tooltip } from "bootstrap";
import type { CaptureMode, FrameRecord, ProjectFile, ProjectSession } from "../../shared/types/project";
import type { MenuCommandEvent, RecentProjectEntry } from "../../shared/types/ipc";
import { HISTORY_STACK_LIMIT, HistoryManager } from "./capture-workspace/history";
import type { HistoryCommand } from "./capture-workspace/history";
import { renderCameraControlsInner } from "./cameraControls";
import { createMenuCommandDispatcher } from "./menuDispatch";
import { invalidateFrameImageCaches } from "./frameImageCache";
import { createProjectImageLoader } from "./projectImages";
import { applyAppVersionLabels } from "./applyAppVersionLabels";
import { bindNewProjectRoute, bindStartRoute } from "./routeBindings";
import {
  reopenPendingWorkspacePanel,
  renderNewProjectRoute,
  renderStartRoute,
  renderWorkspaceRoute
} from "./routeRender";
import { reportCaughtError, reportInfo, setUserNotifier } from "./userFeedback";
import { bindWorkspaceSidePanelActions } from "./capture-workspace/sidepanels";
import { populateCameraDeviceSelect } from "./capture-workspace/camera";
import { createCameraRuntime } from "./capture-workspace/cameraRuntime";
import { createCameraController } from "./capture-workspace/cameraController";
import type { CameraPhase } from "./capture-workspace/cameraPolicy";
import { createLivePreviewView } from "./capture-workspace/livePreviewView";
import { createFrameDisplay } from "./capture-workspace/frameDisplay";
import { createPlaybackController } from "./capture-workspace/playbackController";
import { createWorkspaceMenuCommandHandler } from "./capture-workspace/menuCommands";
import { bindWorkspaceKeyboardShortcuts } from "./capture-workspace/shortcuts";
import {
  bindTimelineFrameButtonClick,
  bindTimelineFrameButtonClicks,
  bindTimelineDragPan,
  bindTimelineScrollSync,
  jumpToLive,
  jumpToEndOrLive,
  jumpToHomeOrLive,
  stepTimelineByKeyboardButtons
} from "./capture-workspace/timeline";
import { createTimelineThumbLazyLoader } from "./capture-workspace/timelineThumbs";
import {
  buildTimelineFrameButtonHtml,
  buildTimelineScaleCellHtml,
  buildTimelineScaleHtml,
  buildTimelineTrackHtml,
  sanitizeTimelineSelection,
  TIMELINE_EMPTY_PLACEHOLDER_HTML
} from "./capture-workspace/timelineRender";
import { captureModeLabel } from "../utils/captureModeLabel";
import { ipcInvokeErrorMessage } from "../utils/ipcErrorMessage";
import { escapeHtml } from "../utils/htmlEscape";
import { sanitizeExportPrefix } from "../../shared/sanitize";
import { clampFocusLong, toFocusLong } from "../utils/focusLong";

type Route = "start" | "new-project" | "workspace";

interface AppState {
  route: Route;
  loading: boolean;
  currentSession: ProjectSession | null;
  recentProjects: RecentProjectEntry[];
}

interface DeleteSingleCommandPayload {
  frameId: string;
  frame: FrameRecord;
  insertIndex: number;
  undoToken: string;
}

interface DuplicateFramesCommandPayload {
  insertAt: number;
  frames: Array<{
    frameId: string;
    previewDataUrl: string;
    sourceDataUrl: string;
  }>;
}

interface CaptureFrameCommandPayload {
  frameId: string;
  insertIndex: number;
  captureMode: CaptureMode;
}

interface DeleteMultiCommandPayload {
  frames: Array<{
    frameId: string;
    insertIndex: number;
    previewDataUrl: string;
    sourceDataUrl: string;
  }>;
}

type WorkspaceUiSettingKey = "onionEnabled" | "loopEnabled" | "playbackTimingMode";

const initialState: AppState = {
  route: "start",
  loading: false,
  currentSession: null,
  recentProjects: []
};

const withOverlay = (loading: boolean): string =>
  loading
    ? `<div class="bm-loading-overlay"><div class="spinner-border text-light" role="status"></div></div>`
    : "";

export const renderApp = (root: HTMLDivElement): void => {
  const state: AppState = { ...initialState };
  let handleWorkspaceMenuCommand: ((event: MenuCommandEvent) => void) | null = null;
  let workspaceKeydownAbort: AbortController | null = null;
  const cameraRuntime = createCameraRuntime({
    closeCamera: () => window.brickMotion.cameraClose(),
    onResetRetryCounter: () => {}
  });
  const cameraPreviewUi: {
    el: HTMLImageElement | null;
    view: ReturnType<typeof createLivePreviewView> | null;
  } = { el: null, view: null };
  let liveCaptureInFlight = false;
  let pendingOffcanvasPanelId: string | null = null;
  let playhead: "live" | number = "live";
  let loopPlayback = false;
  const historyManager = new HistoryManager(HISTORY_STACK_LIMIT);
  const { clearImageBlobCache, revokeImageBlobCacheKey, getImageObjectUrl } = createProjectImageLoader((error) => {
    reportCaughtError(error, "Could not load image file.");
  });

  let stopPlayback: () => void = () => {};
  let startPlayback: (direction: "forward" | "reverse") => void = () => {};
  let isPlaybackActive = (): boolean => false;
  let disposeCameraSession: () => Promise<void> = async () => {
    cameraRuntime.stopStream();
  };
  let workspaceCameraController: ReturnType<typeof createCameraController> | null = null;

  const stopStream = (): void => {
    void disposeCameraSession();
  };

  const clearGlobalOffcanvasArtifacts = (): void => {
    const body = document.body;
    body.classList.remove("offcanvas-open");
    body.style.removeProperty("padding-right");
    body.removeAttribute("data-bs-padding-right");
    document.querySelectorAll(".offcanvas-backdrop").forEach((node) => {
      node.remove();
    });
  };

  const saveProject = async (): Promise<void> => {
    if (!state.currentSession) {
      return;
    }
    const activeId = state.currentSession.project.activeSequenceId;
    const active = state.currentSession.project.sequencesById[activeId];
    if (active) {
      active.frameIdOrder = [...state.currentSession.project.frameIdOrder];
      active.updatedAt = new Date().toISOString();
    }
    state.currentSession.project.updatedAt = new Date().toISOString();
    try {
      await window.brickMotion.saveProject(state.currentSession.projectRoot, state.currentSession.project);
    } catch (error) {
      reportCaughtError(error, "Could not save project.");
      throw error;
    }
  };

  // Keep explicit local signatures so editor type caches cannot drift from preload/global updates.
  const deleteFrameFilesUndoableWithToken = (payload: {
    projectRoot: string;
    undoToken: string;
    frameId: string;
    previewPath: string;
    sourcePath: string;
    thumbPath?: string | null;
  }): Promise<{ ok: boolean }> =>
    (
      window.brickMotion.deleteFrameFilesUndoable as unknown as (row: {
        projectRoot: string;
        undoToken: string;
        frameId: string;
        previewPath: string;
        sourcePath: string;
        thumbPath?: string | null;
      }) => Promise<{ ok: boolean }>
    )(payload);

  const restoreUndoDeleteWithToken = (payload: {
    projectRoot: string;
    undoToken: string;
  }): Promise<{ ok: boolean }> =>
    (
      window.brickMotion.restoreUndoDelete as unknown as (row: {
        projectRoot: string;
        undoToken: string;
      }) => Promise<{ ok: boolean }>
    )(payload);

  const rebuildSequenceIndexes = (project: ProjectFile): void => {
    project.frameIdOrder.forEach((frameId, index) => {
      const frame = project.framesById[frameId];
      if (frame) {
        frame.sequenceIndex = index;
      }
    });
  };

  const activateSequence = (sequenceId: string): void => {
    if (!state.currentSession) {
      return;
    }
    const sequence = state.currentSession.project.sequencesById[sequenceId];
    if (!sequence) {
      return;
    }
    state.currentSession.project.activeSequenceId = sequenceId;
    state.currentSession.project.frameIdOrder = [...sequence.frameIdOrder];
    rebuildSequenceIndexes(state.currentSession.project);
    clearFrameHistory();
  };

  const ensureSessionSequenceState = (session: ProjectSession): void => {
    const project = session.project;
    if (!project.sequenceOrder.length) {
      const now = new Date().toISOString();
      const fallbackId = "sequence_1";
      project.sequenceOrder = [fallbackId];
      project.sequencesById[fallbackId] = {
        id: fallbackId,
        title: "Sequence 1",
        frameIdOrder: [],
        createdAt: now,
        updatedAt: now
      };
      project.activeSequenceId = fallbackId;
    }
    if (!project.sequencesById[project.activeSequenceId]) {
      project.activeSequenceId = project.sequenceOrder[0] as string;
    }
    const active = project.sequencesById[project.activeSequenceId];
    project.frameIdOrder = [...(active?.frameIdOrder ?? [])];
    rebuildSequenceIndexes(project);
  };

  const captureSequenceSnapshot = (): {
    sequenceOrder: string[];
    activeSequenceId: string;
    sequencesById: ProjectFile["sequencesById"];
    frameIdOrder: string[];
  } | null => {
    if (!state.currentSession) {
      return null;
    }
    const project = state.currentSession.project;
    return {
      sequenceOrder: [...project.sequenceOrder],
      activeSequenceId: project.activeSequenceId,
      sequencesById: structuredClone(project.sequencesById),
      frameIdOrder: [...project.frameIdOrder]
    };
  };

  const applySequenceSnapshot = (snapshot: NonNullable<ReturnType<typeof captureSequenceSnapshot>>): void => {
    if (!state.currentSession) {
      return;
    }
    state.currentSession.project.sequenceOrder = [...snapshot.sequenceOrder];
    state.currentSession.project.activeSequenceId = snapshot.activeSequenceId;
    state.currentSession.project.sequencesById = structuredClone(snapshot.sequencesById);
    state.currentSession.project.frameIdOrder = [...snapshot.frameIdOrder];
    rebuildSequenceIndexes(state.currentSession.project);
  };

  const clearFrameHistory = (): void => {
    historyManager.clear();
  };

  const setLoading = (loading: boolean): void => {
    state.loading = loading;
    draw();
  };

  const openProject = async (projectPath: string): Promise<void> => {
    stopStream();
    setLoading(true);
    try {
      clearFrameHistory();
      state.currentSession = await window.brickMotion.openProject(projectPath);
      ensureSessionSequenceState(state.currentSession);
      const dropped = state.currentSession.missingFramesRemoved ?? 0;
      if (dropped > 0) {
        reportInfo(
          `Healed project: removed ${dropped} frame${dropped === 1 ? "" : "s"} from the timeline because image files were missing on disk.`
        );
      }
      const thumbsRepaired = state.currentSession.timelineThumbsRepaired ?? 0;
      if (thumbsRepaired > 0) {
        reportInfo(
          `Healed project: rebuilt ${thumbsRepaired} timeline thumbnail${thumbsRepaired === 1 ? "" : "s"} from preview JPEGs.`
        );
      }
      state.route = "workspace";
    } catch (error) {
      reportCaughtError(error, "Could not open project.");
    } finally {
      await refreshRecentProjects();
      setLoading(false);
      draw();
    }
  };

  const refreshRecentProjects = async (): Promise<void> => {
    try {
      state.recentProjects = await window.brickMotion.listRecentProjects();
    } catch {
      state.recentProjects = [];
    }
  };

  const createProject = async (payload: {
    title: string;
    fps: number;
    captureMode: CaptureMode;
    sourcePath: string;
  }): Promise<void> => {
    stopStream();
    setLoading(true);
    try {
      clearFrameHistory();
      state.currentSession = await window.brickMotion.createProject(payload);
      ensureSessionSequenceState(state.currentSession);
      state.route = "workspace";
    } catch (error) {
      reportCaughtError(error, "Could not create project.");
    } finally {
      await refreshRecentProjects();
      setLoading(false);
      draw();
    }
  };

  const dispatchMenuCommand = createMenuCommandDispatcher({
    getRoute: () => state.route,
    setRoute: (route) => {
      state.route = route;
    },
    draw: () => draw(),
    root,
    openProject,
    dispatchWorkspaceMenuCommand: (event) => {
      handleWorkspaceMenuCommand?.(event);
    }
  });

  const draw = (): void => {
    stopPlayback();
    if (state.route !== "workspace") {
      stopStream();
    }
    clearImageBlobCache();
    clearGlobalOffcanvasArtifacts();
    handleWorkspaceMenuCommand = null;

    const shouldShowMenu = state.route !== "start";
    void window.brickMotion.setMenuVisibility(shouldShowMenu).catch(() => {});

    if (state.route === "start") {
      renderStartRoute({
        root,
        recentProjects: state.recentProjects,
        loading: state.loading,
        withOverlay,
        bind: bindStartScreen
      });
      return;
    }

    if (state.route === "new-project") {
      renderNewProjectRoute({
        root,
        loading: state.loading,
        withOverlay,
        bind: bindNewProjectForm
      });
      return;
    }

    if (!state.currentSession) {
      state.route = "start";
      draw();
      return;
    }

    renderWorkspaceRoute({
      root,
      session: state.currentSession,
      loading: state.loading,
      withOverlay,
      bind: bindWorkspace
    });
    pendingOffcanvasPanelId = reopenPendingWorkspacePanel(root, pendingOffcanvasPanelId);
  };

  const bindStartScreen = (): void =>
    bindStartRoute({
      root,
      draw,
      setRoute: (route) => {
        state.route = route;
      },
      openProject
    });

  const bindNewProjectForm = (): void =>
    bindNewProjectRoute({
      root,
      draw,
      setRoute: (route) => {
        state.route = route;
      },
      createProject
    });

  const bindWorkspace = (): void => {
    applyAppVersionLabels(root);
    if (!state.currentSession) {
      return;
    }
    const session = state.currentSession;
    const cameraPhaseRef: { getPhase: () => CameraPhase } = {
      getPhase: () => workspaceCameraController?.getPhase() ?? "idle"
    };
    {
      const u = session.project.uiState;
      if (u.playbackTimingMode !== "hold_after_decode" && u.playbackTimingMode !== "wall_clock") {
        u.playbackTimingMode = "hold_after_decode";
      }
      if (typeof u.showPlaybackFpsOverlay !== "boolean") {
        u.showPlaybackFpsOverlay = false;
      }
    }
    const backButton = root.querySelector<HTMLButtonElement>("[data-action='back-to-start']");
    const onionToggle = root.querySelector<HTMLInputElement>("#onionToggle");
    const onionOpacity = root.querySelector<HTMLInputElement>("#onionOpacity");
    const onionOpacityOverlay = root.querySelector<HTMLElement>("#onionOpacityOverlay");
    const captureButton = root.querySelector<HTMLButtonElement>("[data-action='capture-frame']");
    const undoFrameButton = root.querySelector<HTMLButtonElement>("[data-action='undo-frame']");
    const redoFrameButton = root.querySelector<HTMLButtonElement>("[data-action='redo-frame']");
    const duplicateButton = root.querySelector<HTMLButtonElement>("[data-action='duplicate-frame']");
    const deleteButton = root.querySelector<HTMLButtonElement>("[data-action='delete-frame']");
    const prevFrameButton = root.querySelector<HTMLButtonElement>("[data-action='prev-frame']");
    const togglePlaybackButton = root.querySelector<HTMLButtonElement>("[data-action='toggle-playback']");
    const playPauseIcon = root.querySelector<HTMLElement>("#playPauseIcon");
    const nextFrameButton = root.querySelector<HTMLButtonElement>("[data-action='next-frame']");
    const resetButton = root.querySelector<HTMLButtonElement>("[data-action='reset']");
    const loopButton = root.querySelector<HTMLButtonElement>("[data-action='toggle-loop']");
    const timelineScale = root.querySelector<HTMLElement>("#timelineScale");
    const timelineScrollTrack = root.querySelector<HTMLElement>("#timelineScrollTrack");
    const timelineScrollScale = root.querySelector<HTMLElement>("#timelineScrollScale");
    const timelineTrack = root.querySelector<HTMLElement>("#timelineTrack");
    const timelineLiveButton = root.querySelector<HTMLButtonElement>("#timelineLiveButton");
    const timelineGrid = root.querySelector<HTMLElement>(".bm-timeline-grid");
    let frameSelection = new Set<number>();
    let lastTimelineAnchorIndex: number | null = null;
    const livePreviewEl = root.querySelector<HTMLImageElement>("#livePreview");
    const frameViewer = root.querySelector<HTMLImageElement>("#frameViewer");
    const onionViewer = root.querySelector<HTMLImageElement>("#onionViewer");
    const cameraStatus = root.querySelector<HTMLElement>("#cameraStatus");
    const cameraDeviceSelect = root.querySelector<HTMLSelectElement>("#cameraDeviceSelect");
    /** Replacing `<select>` options can fire `change` in Chromium and double-call `initCamera` / `camera:start`. */
    let suppressCameraDeviceChange = false;
    const refreshCamerasButton = root.querySelector<HTMLButtonElement>("[data-action='refresh-cameras']");
    const cameraControlsContainer = root.querySelector<HTMLElement>("#cameraControlsContainer");
    const projectSettingsForm = root.querySelector<HTMLFormElement>("#projectSettingsForm");
    const changeProjectFolderButton = root.querySelector<HTMLButtonElement>("[data-action='change-project-folder']");
    const createSequenceButton = root.querySelector<HTMLButtonElement>("#createSequenceButton");
    const sequenceSearchInput = root.querySelector<HTMLInputElement>("#sequenceSearchInput");
    const sequenceTileGrid = root.querySelector<HTMLElement>("#sequenceTileGrid");
    const sequencePanel = root.querySelector<HTMLElement>("#sequenceManagerPanel");
    const openSequencePanelButton = root.querySelector<HTMLButtonElement>("[data-action='open-sequence-panel']");
    const closeSequencePanelButton = root.querySelector<HTMLButtonElement>("[data-action='close-sequence-panel']");
    const projectSettingsPanel = root.querySelector<HTMLElement>("#projectSettingsPanel");
    const openProjectSettingsPanelButton = root.querySelector<HTMLButtonElement>("[data-action='open-project-settings-panel']");
    const closeProjectSettingsPanelButton = root.querySelector<HTMLButtonElement>("[data-action='close-project-settings-panel']");
    const exportPanel = root.querySelector<HTMLElement>("#exportPanel");
    const openExportPanelButton = root.querySelector<HTMLButtonElement>("[data-action='open-export-panel']");
    const closeExportPanelButton = root.querySelector<HTMLButtonElement>("[data-action='close-export-panel']");
    const cameraControlsPanel = root.querySelector<HTMLElement>("#cameraControlsPanel");
    const openCameraControlsPanelButton = root.querySelector<HTMLButtonElement>("[data-action='open-camera-controls-panel']");
    const closeCameraControlsPanelButton = root.querySelector<HTMLButtonElement>("[data-action='close-camera-controls-panel']");
    const helpPanel = root.querySelector<HTMLElement>("#helpPanel");
    const openHelpPanelButton = root.querySelector<HTMLButtonElement>("[data-action='open-help-panel']");
    const closeHelpPanelButton = root.querySelector<HTMLButtonElement>("[data-action='close-help-panel']");
    const exportSequenceForm = root.querySelector<HTMLFormElement>("#exportSequenceForm");
    const exportPathModeDefault = root.querySelector<HTMLInputElement>("#exportPathModeDefault");
    const exportPathModeCustom = root.querySelector<HTMLInputElement>("#exportPathModeCustom");
    const customExportPathGroup = root.querySelector<HTMLElement>("#customExportPathGroup");
    const customExportPathInput = root.querySelector<HTMLInputElement>("#customExportPathInput");
    const exportConflictReplace = root.querySelector<HTMLInputElement>("#exportConflictReplace");
    const exportConflictKeepBoth = root.querySelector<HTMLInputElement>("#exportConflictKeepBoth");
    const exportScopeActive = root.querySelector<HTMLInputElement>("#exportScopeActive");
    const exportScopeSelected = root.querySelector<HTMLInputElement>("#exportScopeSelected");
    const exportScopeAll = root.querySelector<HTMLInputElement>("#exportScopeAll");
    const exportSequenceSelectionList = root.querySelector<HTMLElement>("#exportSequenceSelectionList");
    const exportFramePrefixInput = root.querySelector<HTMLInputElement>("#exportFramePrefixInput");
    const exportFileNameExample = root.querySelector<HTMLElement>("#exportFileNameExample");
    const exportSummaryText = root.querySelector<HTMLElement>("#exportSummaryText");
    const sanitizeFrameFilePrefix = (raw: string): string => sanitizeExportPrefix(raw);

    const openExportAfterDone = root.querySelector<HTMLInputElement>("#openExportAfterDone");
    const pickExportPathButton = root.querySelector<HTMLButtonElement>("[data-action='pick-export-path']");
    const workspaceStatus = root.querySelector<HTMLElement>("#workspaceStatus");
    const workspaceMeta = root.querySelector<HTMLElement>("#workspaceMeta");
    const livePreview = root.querySelector<HTMLElement>(".bm-live-preview");
    const livePreviewLoadingEl = root.querySelector<HTMLElement>("#livePreviewLoading");
    const setLivePreviewLoading = (loading: boolean): void => {
      if (!livePreviewLoadingEl) {
        return;
      }
      livePreviewLoadingEl.classList.toggle("d-none", !loading);
      livePreviewLoadingEl.setAttribute("aria-busy", loading ? "true" : "false");
    };
    const livePreviewView = createLivePreviewView({
      getLivePreviewEl: () => root.querySelector<HTMLImageElement>("#livePreview"),
      getCameraStatusEl: () => root.querySelector<HTMLElement>("#cameraStatus"),
      setLivePreviewLoading
    });
    const playbackTimingRealtime = root.querySelector<HTMLInputElement>("#playbackTimingRealtime");
    const playbackTimingPerFrame = root.querySelector<HTMLInputElement>("#playbackTimingPerFrame");

    const initWorkspaceTooltips = (): void => {
      root.querySelectorAll<HTMLElement>('[data-bs-toggle="tooltip"]').forEach((el) => {
        Tooltip.getOrCreateInstance(el, { container: "body" });
      });
      const cameraControlsOpenBtn = root.querySelector<HTMLElement>("#cameraControlsOpenBtn");
      if (cameraControlsOpenBtn) {
        Tooltip.getOrCreateInstance(cameraControlsOpenBtn, {
          container: "body",
          placement: "left",
          title: "Open camera controls (exposure, zoom, focus)"
        });
      }
    };
    initWorkspaceTooltips();

    const syncPlaybackTimingToolbarUi = (): void => {
      if (!state.currentSession || !playbackTimingRealtime || !playbackTimingPerFrame) {
        return;
      }
      const wall = state.currentSession.project.uiState.playbackTimingMode === "wall_clock";
      playbackTimingRealtime.checked = wall;
      playbackTimingPerFrame.checked = !wall;
    };

    const setStatus = (message: string): void => {
      if (workspaceStatus) {
        workspaceStatus.textContent = message;
      }
    };

    setUserNotifier((message, kind) => {
      setStatus(kind === "error" ? `Error: ${message}` : message);
    });

    const formatSeconds = (totalSeconds: number): string => {
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = Math.floor(totalSeconds % 60);
      const centiseconds = Math.floor((totalSeconds - Math.floor(totalSeconds)) * 100);
      return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
    };

    const updateWorkspaceMeta = (): void => {
      if (!workspaceMeta || !state.currentSession) {
        return;
      }
      const project = state.currentSession.project;
      const frames = project.frameIdOrder.length;
      const activeSequence = project.sequencesById[project.activeSequenceId];
      const durationSeconds = frames / Math.max(1, project.fps);
      const playbackTimingLabel =
        project.uiState.playbackTimingMode === "wall_clock" ? "Animation playback" : "Per Frame playback";
      workspaceMeta.textContent = `${activeSequence?.title ?? "Sequence"} · ${captureModeLabel(project.captureMode)} · ${project.fps} fps · ${frames} frames · ${formatSeconds(durationSeconds)} · ${playbackTimingLabel}`;
    };

    const clearTimelineSelectionState = (): void => {
      frameSelection.clear();
      lastTimelineAnchorIndex = null;
    };

    const invalidateFrameCaches = (projectRoot: string, frame: FrameRecord): void => {
      invalidateFrameImageCaches(revokeImageBlobCacheKey, projectRoot, frame);
    };

    const applyFrameMutationUi = async (
      statusMessage: string,
      options?: { updateMeta?: boolean; deferSave?: boolean; timelineMode?: "full" | "append"; appendedIndex?: number }
    ): Promise<void> => {
      if (options?.deferSave) {
        void saveProject();
      } else {
        await saveProject();
      }
      setStatus(statusMessage);
      if (options?.updateMeta) {
        updateWorkspaceMeta();
      }
      if (options?.timelineMode === "append" && options.appendedIndex !== undefined && state.currentSession) {
        appendTimelineFrameAtIndex(state.currentSession.project, options.appendedIndex);
      } else {
        renderTimeline();
      }
      renderCurrentFrame();
    };

    const applyWorkspaceUiMutation = async (
      statusMessage: string,
      options: {
        updateOnion?: boolean;
        updateLoop?: boolean;
        updatePlaybackTiming?: boolean;
      }
    ): Promise<void> => {
      if (!state.currentSession) {
        return;
      }
      if (onionToggle) {
        onionToggle.checked = state.currentSession.project.uiState.onionEnabled;
      }
      onionOpacityOverlay?.classList.toggle("d-none", !state.currentSession.project.uiState.onionEnabled);
      if (options.updateOnion) {
        renderOnion();
      }
      if (options.updateLoop) {
        loopPlayback = state.currentSession.project.uiState.loopEnabled;
        syncLoopUi();
      }
      if (options.updatePlaybackTiming) {
        syncPlaybackTimingToolbarUi();
        updateWorkspaceMeta();
      }
      await scheduleWorkspaceUiStateSave();
      setStatus(statusMessage);
    };

    let workspaceUiSaveTimer: number | null = null;
    let workspaceUiPendingResolvers: Array<() => void> = [];
    let workspaceUiPendingRejectors: Array<(error: unknown) => void> = [];
    const scheduleWorkspaceUiStateSave = (): Promise<void> => {
      if (workspaceUiSaveTimer !== null) {
        window.clearTimeout(workspaceUiSaveTimer);
      }
      return new Promise<void>((resolve, reject) => {
        workspaceUiPendingResolvers.push(resolve);
        workspaceUiPendingRejectors.push(reject);
        workspaceUiSaveTimer = window.setTimeout(() => {
          workspaceUiSaveTimer = null;
          const resolvers = workspaceUiPendingResolvers;
          const rejectors = workspaceUiPendingRejectors;
          workspaceUiPendingResolvers = [];
          workspaceUiPendingRejectors = [];
          void saveProject()
            .then(() => {
              resolvers.forEach((fn) => fn());
            })
            .catch((error) => {
              rejectors.forEach((fn) => fn(error));
            });
        }, 220);
      });
    };

    const setTimelineScrollLeft = (value: number): void => {
      const v = Math.max(0, value);
      if (timelineScrollTrack) {
        timelineScrollTrack.scrollLeft = v;
      }
      if (timelineScrollScale) {
        timelineScrollScale.scrollLeft = v;
      }
    };

    const scrollTimelineIntoView = (): void => {
      if (!timelineScrollTrack || !timelineTrack) {
        return;
      }
      requestAnimationFrame(() => {
        if (playhead === "live") {
          const maxScroll = Math.max(0, timelineScrollTrack.scrollWidth - timelineScrollTrack.clientWidth);
          setTimelineScrollLeft(maxScroll);
          return;
        }
        const target = timelineTrack.querySelector<HTMLElement>(`button[data-frame-index="${playhead}"]`);
        if (!target) {
          return;
        }
        const margin = 8;
        const trackRect = timelineScrollTrack.getBoundingClientRect();
        const elRect = target.getBoundingClientRect();
        const elLeft = elRect.left - trackRect.left + timelineScrollTrack.scrollLeft;
        const elRight = elLeft + target.offsetWidth;
        const viewLeft = timelineScrollTrack.scrollLeft;
        const viewRight = viewLeft + timelineScrollTrack.clientWidth;
        if (elLeft < viewLeft + margin) {
          setTimelineScrollLeft(elLeft - margin);
        } else if (elRight > viewRight - margin) {
          setTimelineScrollLeft(elRight - timelineScrollTrack.clientWidth + margin);
        }
      });
    };

    const playbackStatsOverlay = root.querySelector<HTMLElement>("#playbackStatsOverlay");

    const scrollPlaybackThumbIntoViewIfNeeded = (): void => {
      if (!timelineScrollTrack || !timelineTrack) {
        return;
      }
      requestAnimationFrame(() => {
        if (playhead === "live") {
          const maxScroll = Math.max(0, timelineScrollTrack.scrollWidth - timelineScrollTrack.clientWidth);
          setTimelineScrollLeft(maxScroll);
          return;
        }
        const target = timelineTrack.querySelector<HTMLElement>(`button[data-frame-index="${playhead}"]`);
        if (!target) {
          return;
        }
        const margin = 8;
        const trackRect = timelineScrollTrack.getBoundingClientRect();
        const elRect = target.getBoundingClientRect();
        const elLeft = elRect.left - trackRect.left + timelineScrollTrack.scrollLeft;
        const elRight = elLeft + target.offsetWidth;
        const viewLeft = timelineScrollTrack.scrollLeft;
        const viewRight = viewLeft + timelineScrollTrack.clientWidth;
        if (elLeft >= viewLeft + margin && elRight <= viewRight - margin) {
          return;
        }
        if (elLeft < viewLeft + margin) {
          setTimelineScrollLeft(elLeft - margin);
        } else if (elRight > viewRight - margin) {
          setTimelineScrollLeft(elRight - timelineScrollTrack.clientWidth + margin);
        }
      });
    };

    const renderOnion = (): void => {
      if (!state.currentSession || !onionViewer || !onionToggle || !onionOpacity) {
        return;
      }
      const project = state.currentSession.project;
      if (!onionToggle.checked) {
        onionViewer.classList.add("d-none");
        return;
      }

      const previousIndex = playhead === "live" ? project.frameIdOrder.length - 1 : playhead - 1;
      if (previousIndex < 0 || !project.frameIdOrder[previousIndex]) {
        onionViewer.classList.add("d-none");
        return;
      }

      const frameId = project.frameIdOrder[previousIndex];
      const frame = project.framesById[frameId];
      if (!frame) {
        onionViewer.classList.add("d-none");
        return;
      }

      void getImageObjectUrl(state.currentSession, frame.previewPath)
        .then((src) => {
          onionViewer.src = src;
          onionViewer.style.opacity = onionOpacity.value;
          onionViewer.classList.remove("d-none");
        })
        .catch(() => {
          /* Error already reported in getImageObjectUrl */
        });
    };

    const { renderCurrentFrame: renderCurrentFrameInner, showFrameSource } = createFrameDisplay({
      frameViewer,
      livePreviewEl,
      setLivePreviewLoading,
      setCameraStatus: (message) => {
        if (!cameraStatus) {
          return;
        }
        cameraStatus.textContent = message;
      },
      getCameraPhase: () => cameraPhaseRef.getPhase(),
      getImageObjectUrl,
      renderOnion
    });
    const renderCurrentFrame = (): void => {
      renderCurrentFrameInner(state.currentSession, playhead);
    };

    let cameraProfileSaveTimer: number | null = null;
    const scheduleCameraProfileSave = (): void => {
      if (!state.currentSession) {
        return;
      }
      if (cameraProfileSaveTimer !== null) {
        window.clearTimeout(cameraProfileSaveTimer);
      }
      cameraProfileSaveTimer = window.setTimeout(() => {
        cameraProfileSaveTimer = null;
        void saveProject();
      }, 450);
    };

    const syncFocusOverlayUi = async (): Promise<void> => {
      const segment = root.querySelector<HTMLElement>("#toolbarFocusSegment");
      const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-focus-delta]"));
      if (!state.currentSession) {
        return;
      }
      if (!segment || buttons.length === 0) {
        return;
      }
      const setFocusToolbarVisible = (visible: boolean): void => {
        segment.classList.toggle("d-none", !visible);
        segment.setAttribute("aria-hidden", visible ? "false" : "true");
        buttons.forEach((b) => {
          b.disabled = !visible;
        });
      };
      try {
        const caps = await window.brickMotion.cameraGetCapabilities({});
        const cap = caps.focusDistance as { min?: number; max?: number } | undefined;
        const ok = Boolean(
          cap &&
            typeof cap.min === "number" &&
            typeof cap.max === "number" &&
            Number.isFinite(cap.min) &&
            Number.isFinite(cap.max)
        );
        setFocusToolbarVisible(ok);
      } catch {
        setFocusToolbarVisible(false);
      }
    };

    const adjustFocusByStepMultiplier = async (stepMultiplier: number): Promise<void> => {
      if (!state.currentSession || stepMultiplier === 0) {
        return;
      }
      const session = state.currentSession;
      let caps: Record<string, unknown>;
      try {
        caps = await window.brickMotion.cameraGetCapabilities({});
      } catch {
        return;
      }
      const cap = caps.focusDistance as { min?: number; max?: number; step?: number } | undefined;
      if (
        !cap ||
        typeof cap.min !== "number" ||
        typeof cap.max !== "number" ||
        !Number.isFinite(cap.min) ||
        !Number.isFinite(cap.max)
      ) {
        return;
      }
      let controls: Record<string, unknown>;
      try {
        controls = await window.brickMotion.cameraGetControls({});
      } catch {
        return;
      }
      const raw =
        controls.focusDistance ?? session.project.cameraProfile.values.focusDistance;
      const curInt = toFocusLong(raw, cap.min);
      const sign = stepMultiplier > 0 ? 1 : -1;
      const isCoarseStep = Math.abs(stepMultiplier) >= 10;
      /** Move by the device-reported minimum step so each click produces a visible change. */
      const unit = Math.max(1, toFocusLong(cap.step, 1));
      /**
       * Coarse button should feel like roughly +20 in UI terms, not 10x device step.
       * Convert target (~20) into a step-multiple so coarse clicks remain predictable across devices.
       */
      const coarseUnits = Math.max(2, Math.round(20 / unit));
      const delta = isCoarseStep ? coarseUnits * unit : unit;
      const nextInt = clampFocusLong(curInt + sign * delta, cap.min, cap.max);
      if (nextInt === curInt) {
        return;
      }
      try {
        await window.brickMotion.cameraSetControls({ partial: { focusDistance: nextInt } });
      } catch {
        return;
      }
      session.project.cameraProfile.values.focusDistance = nextInt;
      scheduleCameraProfileSave();
      renderCameraControls();
    };

    /** Prevent duplicate increments from overlapping focus events. */
    let focusAdjustInFlight = false;
    const runFocusAdjust = async (stepMultiplier: number): Promise<void> => {
      if (focusAdjustInFlight) {
        return;
      }
      focusAdjustInFlight = true;
      try {
        await adjustFocusByStepMultiplier(stepMultiplier);
      } finally {
        focusAdjustInFlight = false;
      }
    };

    const persistCameraProfileNow = (): void => {
      if (cameraProfileSaveTimer !== null) {
        window.clearTimeout(cameraProfileSaveTimer);
        cameraProfileSaveTimer = null;
      }
      void saveProject();
    };

    let cameraControlsRenderEpoch = 0;
    const renderCameraControls = (): void => {
      if (!cameraControlsContainer || !state.currentSession) {
        return;
      }
      const session = state.currentSession;
      const epoch = ++cameraControlsRenderEpoch;
      void renderCameraControlsInner({
        cameraControlsContainer,
        session,
        getCapabilities: () => window.brickMotion.cameraGetCapabilities({}),
        getControls: () => window.brickMotion.cameraGetControls({}),
        setControls: async (partial) => window.brickMotion.cameraSetControls({ partial }),
        saveProject: async () => {
          scheduleCameraProfileSave();
        },
        abortIfStale: () => cameraControlsRenderEpoch !== epoch
      });
    };

    const syncTimelineLiveUi = (): void => {
      if (!timelineLiveButton) {
        return;
      }
      const onLive = playhead === "live";
      timelineLiveButton.classList.toggle("btn-primary", onLive);
      timelineLiveButton.classList.toggle("btn-outline-primary", !onLive);
    };

    bindTimelineScrollSync(timelineScrollTrack, timelineScrollScale);
    bindTimelineDragPan({
      timelineGrid,
      timelineTrack,
      timelineLiveButton,
      getScrollLeft: () => timelineScrollTrack?.scrollLeft ?? timelineScrollScale?.scrollLeft ?? 0,
      setScrollLeft: setTimelineScrollLeft
    });

    let timelineRenderGen = 0;
    const timelineThumbLoader = createTimelineThumbLazyLoader({
      getImageObjectUrl,
      getRenderGeneration: () => timelineRenderGen
    });

    const handleTimelineFrameButtonClick = (event: MouseEvent, index: number): void => {
      stopPlayback();
      if (event.ctrlKey || event.metaKey) {
        if (frameSelection.has(index)) {
          frameSelection.delete(index);
        } else {
          frameSelection.add(index);
        }
        lastTimelineAnchorIndex = index;
        playhead = index;
      } else if (event.shiftKey && lastTimelineAnchorIndex !== null) {
        const a = Math.min(lastTimelineAnchorIndex, index);
        const b = Math.max(lastTimelineAnchorIndex, index);
        frameSelection.clear();
        for (let j = a; j <= b; j += 1) {
          frameSelection.add(j);
        }
        playhead = index;
      } else {
        frameSelection.clear();
        frameSelection.add(index);
        lastTimelineAnchorIndex = index;
        playhead = index;
      }
      renderCurrentFrame();
      renderTimeline();
    };

    const appendTimelineFrameAtIndex = (project: ProjectFile, index: number): void => {
      if (!timelineTrack) {
        return;
      }
      sanitizeTimelineSelection({ selection: frameSelection, frameCount: project.frameIdOrder.length });
      if (index === 0 && project.frameIdOrder.length === 1) {
        timelineRenderGen += 1;
        timelineTrack.innerHTML = buildTimelineFrameButtonHtml({
          project,
          index: 0,
          playhead,
          frameSelection,
          escapeHtml
        });
        if (timelineScale) {
          timelineScale.innerHTML = buildTimelineScaleCellHtml({
            index: 0,
            fps: project.fps,
            playhead,
            formatSeconds
          });
        }
        const firstBtn = timelineTrack.querySelector<HTMLButtonElement>("button[data-frame-index='0']");
        if (firstBtn) {
          bindTimelineFrameButtonClick(firstBtn, handleTimelineFrameButtonClick);
        }
      } else if (index > 0) {
        timelineTrack.insertAdjacentHTML(
          "beforeend",
          buildTimelineFrameButtonHtml({ project, index, playhead, frameSelection, escapeHtml })
        );
        if (timelineScale) {
          timelineScale.insertAdjacentHTML(
            "beforeend",
            buildTimelineScaleCellHtml({ index, fps: project.fps, playhead, formatSeconds })
          );
        }
        const btn = timelineTrack.querySelector<HTMLButtonElement>(`button[data-frame-index="${index}"]`);
        if (btn) {
          bindTimelineFrameButtonClick(btn, handleTimelineFrameButtonClick);
        }
      }
      updateWorkspaceMeta();
      syncTimelineLiveUi();
      scrollTimelineIntoView();
      const gen = timelineRenderGen;
      if (state.currentSession) {
        timelineThumbLoader.observeTrackButtons({
          timelineTrack,
          timelineScrollTrack,
          session: state.currentSession,
          renderGeneration: gen
        });
      }
    };

    const renderTimeline = (): void => {
      if (!state.currentSession || !timelineTrack) {
        return;
      }
      const project = state.currentSession.project;
      sanitizeTimelineSelection({ selection: frameSelection, frameCount: project.frameIdOrder.length });
      if (timelineScale) {
        timelineScale.innerHTML = buildTimelineScaleHtml({ project, playhead, formatSeconds });
      }
      updateWorkspaceMeta();

      timelineThumbLoader.disconnect();
      timelineThumbLoader.clearQueue();

      if (project.frameIdOrder.length === 0) {
        timelineRenderGen += 1;
        timelineTrack.innerHTML = TIMELINE_EMPTY_PLACEHOLDER_HTML;
        syncTimelineLiveUi();
        scrollTimelineIntoView();
        return;
      }

      const gen = (timelineRenderGen += 1);
      const session = state.currentSession;
      timelineTrack.innerHTML = buildTimelineTrackHtml({
        project,
        playhead,
        frameSelection,
        escapeHtml
      });
      bindTimelineFrameButtonClicks({
        timelineTrack,
        onFrameButtonClick: handleTimelineFrameButtonClick
      });
      syncTimelineLiveUi();
      scrollTimelineIntoView();
      timelineThumbLoader.observeTrackButtons({
        timelineTrack,
        timelineScrollTrack,
        session,
        renderGeneration: gen
      });
    };

    const updatePlaybackTimelineVisuals = (): void => {
      if (timelineTrack) {
        const ph = playhead;
        timelineTrack.querySelectorAll<HTMLButtonElement>("[data-frame-index]").forEach((btn) => {
          const i = Number(btn.dataset.frameIndex);
          const active = ph !== "live" && ph === i;
          btn.classList.toggle("bm-thumb-active", active);
        });
        if (timelineScale) {
          timelineScale.querySelectorAll<HTMLElement>(".bm-timeline-scale-cell").forEach((cell, i) => {
            const active = ph !== "live" && ph === i;
            cell.classList.toggle("text-primary", active);
            cell.classList.toggle("fw-bold", active);
            cell.classList.toggle("text-secondary", !active);
          });
        }
      }
      updateWorkspaceMeta();
      syncTimelineLiveUi();
      scrollPlaybackThumbIntoViewIfNeeded();
    };

    const stepTimelineByKeyboardLogic = (direction: -1 | 1): void => {
      stepTimelineByKeyboardButtons(root, direction);
    };

    const jumpToHome = (): void => {
      jumpToHomeOrLive({
        session,
        stopPlayback,
        syncPlaybackUi,
        setPlayhead: (next) => {
          playhead = next;
        },
        clearFrameSelection: () => {
          frameSelection.clear();
        },
        addFrameSelection: (index) => {
          frameSelection.add(index);
        },
        setTimelineAnchor: (next) => {
          lastTimelineAnchorIndex = next;
        },
        renderCurrentFrame,
        renderTimeline
      });
    };

    const jumpToEnd = (): void => {
      jumpToEndOrLive({
        session,
        stopPlayback,
        syncPlaybackUi,
        setPlayhead: (next) => {
          playhead = next;
        },
        clearFrameSelection: () => {
          frameSelection.clear();
        },
        addFrameSelection: (index) => {
          frameSelection.add(index);
        },
        setTimelineAnchor: (next) => {
          lastTimelineAnchorIndex = next;
        },
        renderCurrentFrame,
        renderTimeline
      });
    };

    const updateActiveSequenceTileAfterFrameChange = async (): Promise<void> => {
      if (!state.currentSession || !sequenceTileGrid) {
        return;
      }
      const project = state.currentSession.project;
      const activeSequence = project.sequencesById[project.activeSequenceId];
      if (!activeSequence) {
        return;
      }
      const card = sequenceTileGrid.querySelector<HTMLElement>(`[data-sequence-id="${activeSequence.id}"]`);
      const tile = card?.querySelector<HTMLElement>(".bm-sequence-tile");
      if (!card || !tile) {
        return;
      }
      const countLabel = tile.querySelector<HTMLElement>(".bm-sequence-frame-count");
      if (countLabel) {
        const count = activeSequence.frameIdOrder.length;
        countLabel.textContent = `${count} frame${count === 1 ? "" : "s"}`;
      }
      if (activeSequence.frameIdOrder.length === 0) {
        return;
      }
      const firstFrameId = activeSequence.frameIdOrder[0];
      const firstFrame = firstFrameId ? project.framesById[firstFrameId] : null;
      const firstThumb = firstFrame?.timelineThumbPath;
      if (!firstThumb) {
        return;
      }
      let img = tile.querySelector<HTMLImageElement>("img[data-image-path]");
      if (!img) {
        img = document.createElement("img");
        img.className = "bm-thumb-img";
        img.alt = "";
        img.width = 140;
        img.height = 79;
        img.decoding = "async";
        const empty = tile.querySelector(".bm-sequence-empty");
        if (empty) {
          empty.remove();
        }
        tile.insertBefore(img, tile.querySelector(".bm-thumb-label"));
      }
      img.dataset.imagePath = firstThumb;
      try {
        img.src = await getImageObjectUrl(state.currentSession, firstThumb);
      } catch {
        /* image loading errors are already reported by getImageObjectUrl */
      }
    };

    const createCaptureFrameCommand = (
      payload: CaptureFrameCommandPayload,
      options?: { precapturedFrame?: ProjectFile["framesById"][string] }
    ): HistoryCommand => {
      let appliedOnce = false;
      let redoPaths: { previewPath: string; sourcePath: string } | null = null;
      return {
        kind: "capture-frame",
        label: "Capture frame",
        context: {
          projectRoot: state.currentSession?.projectRoot ?? "",
          sequenceId: state.currentSession?.project.activeSequenceId
        },
        apply: async () => {
          if (!state.currentSession) {
            return;
          }
          const project = state.currentSession.project;
          let frame: ProjectFile["framesById"][string];
          const targetIndex = Math.max(0, Math.min(payload.insertIndex, project.frameIdOrder.length));
          if (!appliedOnce) {
            if (options?.precapturedFrame) {
              frame = options.precapturedFrame;
            } else {
              try {
                ({ frame } = await window.brickMotion.cameraCaptureLive({
                  projectRoot: state.currentSession.projectRoot,
                  frameId: payload.frameId,
                  sequenceIndex: targetIndex,
                  captureMode: payload.captureMode
                }));
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (!message.toLowerCase().includes("stream not ready")) {
                  throw error;
                }
                await initCamera(state.currentSession.project.cameraProfile.deviceId, { forceReopen: true });
                ({ frame } = await window.brickMotion.cameraCaptureLive({
                  projectRoot: state.currentSession.projectRoot,
                  frameId: payload.frameId,
                  sequenceIndex: targetIndex,
                  captureMode: payload.captureMode
                }));
              }
            }
            redoPaths = { previewPath: frame.previewPath, sourcePath: frame.sourcePath };
          } else {
            if (!redoPaths) {
              throw new Error("Capture redo payload missing frame paths.");
            }
            ({ frame } = await window.brickMotion.captureFrameFromPaths({
              projectRoot: state.currentSession.projectRoot,
              frameId: payload.frameId,
              sequenceIndex: targetIndex,
              previewPath: redoPaths.previewPath,
              sourcePath: redoPaths.sourcePath
            }));
          }
          project.frameIdOrder.splice(targetIndex, 0, payload.frameId);
          project.framesById[payload.frameId] = frame;
          rebuildSequenceIndexes(project);
          clearTimelineSelectionState();
          playhead = "live";
          const statusMessage = appliedOnce ? "Redid captured frame." : `Captured frame #${project.frameIdOrder.length}.`;
          await applyFrameMutationUi(statusMessage, {
            updateMeta: appliedOnce,
            deferSave: true,
            timelineMode: "append",
            appendedIndex: targetIndex
          });
          void updateActiveSequenceTileAfterFrameChange();
          appliedOnce = true;
        },
        revert: async () => {
          if (!state.currentSession) {
            return;
          }
          const project = state.currentSession.project;
          const frame = project.framesById[payload.frameId];
          if (!frame) {
            return;
          }
          await window.brickMotion.deleteFrameFiles({
            projectRoot: state.currentSession.projectRoot,
            previewPath: frame.previewPath,
            sourcePath: frame.sourcePath,
            thumbPath: frame.timelineThumbPath
          });
          invalidateFrameCaches(state.currentSession.projectRoot, frame);
          project.frameIdOrder = project.frameIdOrder.filter((id) => id !== payload.frameId);
          delete project.framesById[payload.frameId];
          rebuildSequenceIndexes(project);
          clearTimelineSelectionState();
          playhead = "live";
          await applyFrameMutationUi("Undid capture.", { updateMeta: true });
        }
      };
    };

    const captureFrame = async (): Promise<void> => {
      if (!state.currentSession || !livePreviewEl) {
        return;
      }
      if (liveCaptureInFlight) {
        return;
      }
      liveCaptureInFlight = true;
      if (captureButton) {
        captureButton.disabled = true;
      }
      const priorStatus =
        workspaceCameraController?.getPhase() === "live" ? "Live camera feed" : null;
      livePreviewView.setStatus("Capturing full-resolution frame…");
      const frameId = crypto.randomUUID();
      const insertIndex = state.currentSession.project.frameIdOrder.length;
      const captureMode = state.currentSession.project.captureMode;
      try {
        let precaptured: ProjectFile["framesById"][string];
        try {
          ({ frame: precaptured } = await window.brickMotion.cameraCaptureLive({
            projectRoot: state.currentSession.projectRoot,
            frameId,
            sequenceIndex: insertIndex,
            captureMode
          }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!message.toLowerCase().includes("stream not ready")) {
            throw error;
          }
          await initCamera(state.currentSession.project.cameraProfile.deviceId, { forceReopen: true });
          ({ frame: precaptured } = await window.brickMotion.cameraCaptureLive({
            projectRoot: state.currentSession.projectRoot,
            frameId,
            sequenceIndex: insertIndex,
            captureMode
          }));
        }
        liveCaptureInFlight = false;
        if (captureButton) {
          captureButton.disabled = false;
        }
        if (priorStatus && workspaceCameraController?.getPhase() === "live") {
          livePreviewView.setStatus(priorStatus);
        }
        const command = createCaptureFrameCommand(
          { frameId, insertIndex, captureMode },
          { precapturedFrame: precaptured }
        );
        await historyManager.execute(command);
      } catch (error) {
        reportCaughtError(error, "Could not capture frame.");
      } finally {
        liveCaptureInFlight = false;
        if (captureButton) {
          captureButton.disabled = false;
        }
        if (priorStatus && workspaceCameraController?.getPhase() === "live") {
          livePreviewView.setStatus(priorStatus);
        }
      }
    };

    const createDeleteSingleCommand = (payload: DeleteSingleCommandPayload): HistoryCommand => {
      let appliedOnce = false;
      return {
        kind: "delete-single",
        label: "Delete frame",
        context: {
          projectRoot: state.currentSession?.projectRoot ?? "",
          sequenceId: state.currentSession?.project.activeSequenceId
        },
        apply: async () => {
          if (!state.currentSession) {
            return;
          }
          const project = state.currentSession.project;
          const frame = project.framesById[payload.frameId];
          if (!frame) {
            return;
          }
          await deleteFrameFilesUndoableWithToken({
            projectRoot: state.currentSession.projectRoot,
            undoToken: payload.undoToken,
            frameId: payload.frameId,
            previewPath: frame.previewPath,
            sourcePath: frame.sourcePath,
            thumbPath: frame.timelineThumbPath
          });
          invalidateFrameCaches(state.currentSession.projectRoot, frame);
          project.frameIdOrder = project.frameIdOrder.filter((id) => id !== payload.frameId);
          delete project.framesById[payload.frameId];
          rebuildSequenceIndexes(project);
          clearTimelineSelectionState();
          playhead = payload.insertIndex >= project.frameIdOrder.length ? "live" : payload.insertIndex;
          const statusMessage = appliedOnce ? "Redid frame deletion." : "Frame deleted.";
          await applyFrameMutationUi(statusMessage, { updateMeta: appliedOnce });
          appliedOnce = true;
        },
        revert: async () => {
          if (!state.currentSession) {
            return;
          }
          const project = state.currentSession.project;
          await restoreUndoDeleteWithToken({
            projectRoot: state.currentSession.projectRoot,
            undoToken: payload.undoToken
          });
          project.framesById[payload.frameId] = { ...payload.frame };
          project.frameIdOrder.splice(payload.insertIndex, 0, payload.frameId);
          rebuildSequenceIndexes(project);
          clearTimelineSelectionState();
          playhead = payload.insertIndex;
          await applyFrameMutationUi("Restored deleted frame.", { updateMeta: true });
        }
      };
    };

    const createDeleteMultiCommand = (payload: DeleteMultiCommandPayload): HistoryCommand => {
      let appliedOnce = false;
      return {
        kind: "delete-multi",
        label: "Delete multiple frames",
        context: {
          projectRoot: state.currentSession?.projectRoot ?? "",
          sequenceId: state.currentSession?.project.activeSequenceId
        },
        apply: async () => {
          if (!state.currentSession) {
            return;
          }
          const project = state.currentSession.project;
          const sorted = [...payload.frames].sort((a, b) => b.insertIndex - a.insertIndex);
          for (const entry of sorted) {
            const frame = project.framesById[entry.frameId];
            if (!frame) {
              continue;
            }
            await window.brickMotion.deleteFrameFiles({
              projectRoot: state.currentSession.projectRoot,
              previewPath: frame.previewPath,
              sourcePath: frame.sourcePath,
              thumbPath: frame.timelineThumbPath
            });
            invalidateFrameCaches(state.currentSession.projectRoot, frame);
            project.frameIdOrder = project.frameIdOrder.filter((id) => id !== entry.frameId);
            delete project.framesById[entry.frameId];
          }
          rebuildSequenceIndexes(project);
          const firstDeleted = Math.min(...payload.frames.map((row) => row.insertIndex));
          clearTimelineSelectionState();
          if (project.frameIdOrder.length === 0) {
            playhead = "live";
          } else {
            playhead = Math.min(firstDeleted, project.frameIdOrder.length - 1);
          }
          const statusMessage = appliedOnce
            ? `Redid delete of ${payload.frames.length} frames.`
            : `Deleted ${payload.frames.length} frames.`;
          await applyFrameMutationUi(statusMessage, { updateMeta: appliedOnce });
          appliedOnce = true;
        },
        revert: async () => {
          if (!state.currentSession) {
            return;
          }
          const project = state.currentSession.project;
          const sorted = [...payload.frames].sort((a, b) => a.insertIndex - b.insertIndex);
          for (const entry of sorted) {
            const { frame } = await window.brickMotion.captureFrame({
              projectRoot: state.currentSession.projectRoot,
              frameId: entry.frameId,
              sequenceIndex: entry.insertIndex,
              previewDataUrl: entry.previewDataUrl,
              sourceDataUrl: entry.sourceDataUrl
            });
            project.framesById[entry.frameId] = frame;
            project.frameIdOrder.splice(entry.insertIndex, 0, entry.frameId);
          }
          rebuildSequenceIndexes(project);
          clearTimelineSelectionState();
          sorted.forEach((entry) => {
            const idx = project.frameIdOrder.indexOf(entry.frameId);
            if (idx >= 0) {
              frameSelection.add(idx);
            }
          });
          lastTimelineAnchorIndex = sorted.length ? sorted[sorted.length - 1]!.insertIndex : null;
          playhead = sorted.length ? sorted[0]!.insertIndex : "live";
          await applyFrameMutationUi(`Restored ${payload.frames.length} deleted frames.`, { updateMeta: true });
        }
      };
    };

    const createWorkspaceUiSettingCommand = (payload: {
      key: WorkspaceUiSettingKey;
      fromValue: boolean | ProjectFile["uiState"]["playbackTimingMode"];
      toValue: boolean | ProjectFile["uiState"]["playbackTimingMode"];
      label: string;
      coalesceKey: string;
      applyStatus: string;
      revertStatus: string;
    }): HistoryCommand => {
      const applyValue = async (
        value: boolean | ProjectFile["uiState"]["playbackTimingMode"],
        statusMessage: string
      ): Promise<void> => {
        if (!state.currentSession) {
          return;
        }
        if (payload.key === "playbackTimingMode") {
          state.currentSession.project.uiState.playbackTimingMode = value as ProjectFile["uiState"]["playbackTimingMode"];
          await applyWorkspaceUiMutation(statusMessage, { updatePlaybackTiming: true });
          return;
        }
        state.currentSession.project.uiState[payload.key] = value as boolean;
        await applyWorkspaceUiMutation(statusMessage, {
          updateOnion: payload.key === "onionEnabled",
          updateLoop: payload.key === "loopEnabled"
        });
      };
      const command: HistoryCommand & {
        _workspaceUiPayload: {
          key: WorkspaceUiSettingKey;
          fromValue: boolean | ProjectFile["uiState"]["playbackTimingMode"];
        };
      } = {
        kind: "workspace-ui-setting",
        label: payload.label,
        coalesceKey: payload.coalesceKey,
        coalesceWith: (previous) => {
          if (previous.kind !== "workspace-ui-setting") {
            return null;
          }
          const prevRow = previous as HistoryCommand & {
            _workspaceUiPayload?: {
              key: WorkspaceUiSettingKey;
              fromValue: boolean | ProjectFile["uiState"]["playbackTimingMode"];
            };
          };
          const prevPayload = prevRow._workspaceUiPayload;
          if (!prevPayload || prevPayload.key !== payload.key) {
            return null;
          }
          return createWorkspaceUiSettingCommand({
            ...payload,
            fromValue: prevPayload.fromValue
          });
        },
        context: {
          projectRoot: state.currentSession?.projectRoot ?? "",
          sequenceId: state.currentSession?.project.activeSequenceId
        },
        apply: async () => {
          await applyValue(payload.toValue, payload.applyStatus);
        },
        revert: async () => {
          await applyValue(payload.fromValue, payload.revertStatus);
        },
        _workspaceUiPayload: {
          key: payload.key,
          fromValue: payload.fromValue
        }
      };
      return command;
    };

    const createSequenceMutationCommand = (payload: {
      label: string;
      applyStatus: string;
      mutate: () => void;
    }): HistoryCommand | null => {
      const before = captureSequenceSnapshot();
      if (!before) {
        return null;
      }
      return {
        kind: "sequence-mutation",
        label: payload.label,
        context: {
          projectRoot: state.currentSession?.projectRoot ?? "",
          sequenceId: state.currentSession?.project.activeSequenceId
        },
        apply: async () => {
          payload.mutate();
          if (state.currentSession) {
            ensureSessionSequenceState(state.currentSession);
          }
          clearTimelineSelectionState();
          await saveProject();
          setStatus(payload.applyStatus);
          pendingOffcanvasPanelId = "sequenceManagerPanel";
          draw();
        },
        revert: async () => {
          applySequenceSnapshot(before);
          clearTimelineSelectionState();
          await saveProject();
          setStatus(`Undid: ${payload.applyStatus}`);
          pendingOffcanvasPanelId = "sequenceManagerPanel";
          draw();
        }
      };
    };

    const createDuplicateFramesCommand = (payload: DuplicateFramesCommandPayload): HistoryCommand => {
      let appliedOnce = false;
      return {
        kind: "duplicate",
        label: "Duplicate frame(s)",
        context: {
          projectRoot: state.currentSession?.projectRoot ?? "",
          sequenceId: state.currentSession?.project.activeSequenceId
        },
        apply: async () => {
          if (!state.currentSession) {
            return;
          }
          const project = state.currentSession.project;
          const captured: Array<{ frameId: string; frame: ProjectFile["framesById"][string] }> = [];
          for (let i = 0; i < payload.frames.length; i += 1) {
            const entry = payload.frames[i] as (typeof payload.frames)[number];
            const { frame } = await window.brickMotion.captureFrame({
              projectRoot: state.currentSession.projectRoot,
              frameId: entry.frameId,
              sequenceIndex: payload.insertAt + i,
              previewDataUrl: entry.previewDataUrl,
              sourceDataUrl: entry.sourceDataUrl
            });
            captured.push({ frameId: entry.frameId, frame });
          }
          project.frameIdOrder.splice(payload.insertAt, 0, ...captured.map((row) => row.frameId));
          captured.forEach(({ frameId, frame }) => {
            project.framesById[frameId] = frame;
          });
          rebuildSequenceIndexes(project);
          clearTimelineSelectionState();
          for (let i = 0; i < captured.length; i += 1) {
            frameSelection.add(payload.insertAt + i);
          }
          lastTimelineAnchorIndex = payload.insertAt + captured.length - 1;
          playhead = payload.insertAt;
          const statusMessage = appliedOnce
            ? payload.frames.length === 1
              ? "Redid duplicate frame."
              : `Redid duplicate of ${payload.frames.length} frames.`
            : payload.frames.length === 1
              ? "Duplicated 1 frame."
              : `Duplicated ${payload.frames.length} frames.`;
          await applyFrameMutationUi(statusMessage, { updateMeta: appliedOnce });
          appliedOnce = true;
        },
        revert: async () => {
          if (!state.currentSession) {
            return;
          }
          const project = state.currentSession.project;
          for (const entry of payload.frames) {
            const frame = project.framesById[entry.frameId];
            if (!frame) {
              continue;
            }
            await window.brickMotion.deleteFrameFiles({
              projectRoot: state.currentSession.projectRoot,
              previewPath: frame.previewPath,
              sourcePath: frame.sourcePath,
              thumbPath: frame.timelineThumbPath
            });
            invalidateFrameCaches(state.currentSession.projectRoot, frame);
            delete project.framesById[entry.frameId];
          }
          const duplicatedIds = new Set(payload.frames.map((row) => row.frameId));
          project.frameIdOrder = project.frameIdOrder.filter((id) => !duplicatedIds.has(id));
          rebuildSequenceIndexes(project);
          clearTimelineSelectionState();
          if (project.frameIdOrder.length === 0) {
            playhead = "live";
          } else {
            playhead = Math.max(0, Math.min(payload.insertAt - 1, project.frameIdOrder.length - 1));
          }
          const statusMessage =
            payload.frames.length === 1 ? "Undid duplicate frame." : `Undid duplicate of ${payload.frames.length} frames.`;
          await applyFrameMutationUi(statusMessage, { updateMeta: true });
        }
      };
    };

    const duplicateFrames = async (): Promise<void> => {
      if (!state.currentSession) {
        return;
      }
      const project = state.currentSession.project;
      if (project.frameIdOrder.length === 0) {
        return;
      }

      let sourceIndexes: number[];
      if (frameSelection.size > 1) {
        sourceIndexes = Array.from(frameSelection).sort((a, b) => a - b);
      } else if (frameSelection.size === 1) {
        sourceIndexes = [Array.from(frameSelection)[0] as number];
      } else {
        sourceIndexes = [playhead === "live" ? project.frameIdOrder.length - 1 : playhead];
      }

      sourceIndexes = [...new Set(sourceIndexes)].filter((i) => i >= 0 && i < project.frameIdOrder.length);
      if (sourceIndexes.length === 0) {
        return;
      }

      const insertAfter = Math.max(...sourceIndexes);
      const insertAt = insertAfter + 1;

      try {
        const duplicatedSources: Array<{
          frameId: string;
          previewDataUrl: string;
          sourceDataUrl: string;
        }> = [];
        for (let i = 0; i < sourceIndexes.length; i += 1) {
          const sourceIndex = sourceIndexes[i] as number;
          const sourceFrameId = project.frameIdOrder[sourceIndex];
          const sourceFrame = project.framesById[sourceFrameId];
          if (!sourceFrame) {
            continue;
          }
          const previewDataUrl = await window.brickMotion.readFileDataUrl(
            state.currentSession.projectRoot,
            sourceFrame.previewPath
          );
          const sourceDataUrl = await window.brickMotion.readFileDataUrl(
            state.currentSession.projectRoot,
            sourceFrame.sourcePath
          );
          const frameId = crypto.randomUUID();
          duplicatedSources.push({ frameId, previewDataUrl, sourceDataUrl });
        }

        if (duplicatedSources.length === 0) {
          return;
        }
        const command = createDuplicateFramesCommand({
          insertAt,
          frames: duplicatedSources.map(({ frameId, previewDataUrl, sourceDataUrl }) => ({
            frameId,
            previewDataUrl,
            sourceDataUrl
          }))
        });
        await historyManager.execute(command);
      } catch (error) {
        reportCaughtError(error, "Could not duplicate frame(s).");
      }
    };

    const deleteFrame = async (): Promise<void> => {
      if (!state.currentSession) {
        return;
      }
      const project = state.currentSession.project;
      if (project.frameIdOrder.length === 0) {
        return;
      }

      let indicesToDelete: number[];
      if (frameSelection.size > 1) {
        indicesToDelete = Array.from(frameSelection).sort((a, b) => b - a);
      } else if (frameSelection.size === 1) {
        indicesToDelete = [Array.from(frameSelection)[0] as number];
      } else {
        indicesToDelete = [playhead === "live" ? project.frameIdOrder.length - 1 : playhead];
      }

      indicesToDelete = [...new Set(indicesToDelete)].filter((i) => i >= 0 && i < project.frameIdOrder.length);
      if (indicesToDelete.length === 0) {
        return;
      }

      try {
        if (indicesToDelete.length === 1) {
          const targetIndex = indicesToDelete[0] as number;
          const frameId = project.frameIdOrder[targetIndex];
          const frame = project.framesById[frameId];
          if (!frame) {
            return;
          }
          const command = createDeleteSingleCommand({
            frameId,
            frame: { ...frame },
            insertIndex: targetIndex,
            undoToken: crypto.randomUUID()
          });
          await historyManager.execute(command);
        } else {
          const sortedAsc = [...indicesToDelete].sort((a, b) => a - b);
          const payloadFrames: DeleteMultiCommandPayload["frames"] = [];
          for (const targetIndex of sortedAsc) {
            if (targetIndex >= project.frameIdOrder.length) {
              continue;
            }
            const frameId = project.frameIdOrder[targetIndex];
            const frame = project.framesById[frameId];
            if (!frame) {
              continue;
            }
            const previewDataUrl = await window.brickMotion.readFileDataUrl(state.currentSession.projectRoot, frame.previewPath);
            const sourceDataUrl = await window.brickMotion.readFileDataUrl(state.currentSession.projectRoot, frame.sourcePath);
            payloadFrames.push({
              frameId,
              insertIndex: targetIndex,
              previewDataUrl,
              sourceDataUrl
            });
          }
          if (payloadFrames.length === 0) {
            return;
          }
          const command = createDeleteMultiCommand({ frames: payloadFrames });
          await historyManager.execute(command);
          return;
        }
      } catch (error) {
        reportCaughtError(error, "Could not delete frame.");
      }
    };

    const undoFrameAction = async (): Promise<void> => {
      if (!state.currentSession || !historyManager.hasUndo()) {
        if (state.currentSession) {
          setStatus("Nothing to undo.");
        }
        return;
      }
      try {
        const ok = await historyManager.undo((command) => command.context.projectRoot === state.currentSession?.projectRoot);
        if (!ok) {
          setStatus("Undo history was cleared after project context changed.");
        }
      } catch (error) {
        reportCaughtError(error, "Could not undo.");
      }
    };

    const redoFrameAction = async (): Promise<void> => {
      if (!state.currentSession || !historyManager.hasRedo()) {
        if (state.currentSession) {
          setStatus("Nothing to redo.");
        }
        return;
      }
      try {
        const ok = await historyManager.redo((command) => command.context.projectRoot === state.currentSession?.projectRoot);
        if (!ok) {
          setStatus("Redo history was cleared after project context changed.");
        }
      } catch (error) {
        reportCaughtError(error, "Could not redo.");
      }
    };

    const syncLoopUi = (): void => {
      if (!loopButton) {
        return;
      }
      loopButton.classList.toggle("btn-outline-secondary", !loopPlayback);
      loopButton.classList.toggle("btn-secondary", loopPlayback);
    };

    const syncPlaybackUi = (): void => {
      if (!togglePlaybackButton || !playPauseIcon) {
        return;
      }
      const isPlaying = isPlaybackActive();
      playPauseIcon.classList.toggle("bi-play-fill", !isPlaying);
      playPauseIcon.classList.toggle("bi-pause-fill", isPlaying);
      togglePlaybackButton.classList.toggle("btn-outline-secondary", !isPlaying);
      togglePlaybackButton.classList.toggle("btn-secondary", isPlaying);
      if (!isPlaying) {
        playbackStatsOverlay?.classList.add("d-none");
      }
    };

    const playbackController = createPlaybackController({
      getSession: () => state.currentSession,
      getPlayhead: () => playhead,
      setPlayhead: (next) => {
        playhead = next;
      },
      getLoopPlayback: () => loopPlayback,
      clearFrameSelection: () => {
        frameSelection.clear();
      },
      clearTimelineAnchor: () => {
        lastTimelineAnchorIndex = null;
      },
      updatePlaybackTimelineVisuals,
      renderCurrentFrame,
      syncPlaybackUi,
      showFrameSource,
      decodeShownFrame: async () => {
        if (frameViewer && typeof frameViewer.decode === "function") {
          await frameViewer.decode();
        }
      },
      renderOnion,
      getImageObjectUrl,
      setPlaybackStatsText: (text) => {
        if (!playbackStatsOverlay) {
          return;
        }
        playbackStatsOverlay.classList.remove("d-none");
        playbackStatsOverlay.textContent = text;
      },
      hidePlaybackStats: () => {
        playbackStatsOverlay?.classList.add("d-none");
      }
    });
    stopPlayback = (): void => {
      playbackController.stopPlayback();
    };
    startPlayback = (direction): void => {
      playbackController.startPlayback(direction);
    };
    isPlaybackActive = (): boolean => playbackController.isPlaybackActive();

    let lastKnownCameraDevices: Array<{ id: string; label: string }> = [];
    const populateCameraDevices = async (): Promise<Array<{ id: string; label: string }>> => {
      if (!state.currentSession) {
        return [];
      }
      const cameras = await populateCameraDeviceSelect({
        cameraDeviceSelect,
        selectedDeviceId: state.currentSession.project.cameraProfile.deviceId,
        setSuppressCameraDeviceChange: (next) => {
          suppressCameraDeviceChange = next;
        }
      });
      lastKnownCameraDevices = cameras;
      return cameras;
    };

    cameraPreviewUi.el = livePreviewEl;
    cameraPreviewUi.view = livePreviewView;
    if (!workspaceCameraController) {
      workspaceCameraController = createCameraController({
        cameraRuntime,
        getSession: () => state.currentSession,
        getPlayhead: () => playhead,
        getRoute: () => state.route,
        getLivePreviewEl: () => cameraPreviewUi.el,
        getLivePreviewView: () => cameraPreviewUi.view!,
        populateCameraDevices,
        getLastKnownCameraDevices: () => lastKnownCameraDevices,
        setLastKnownCameraDevices: (devices) => {
          lastKnownCameraDevices = devices;
        },
        renderCameraControls,
        persistCameraProfileNow,
        syncFocusOverlayUi: () => {
          void syncFocusOverlayUi();
        },
        reportCameraUnavailable: (detail) => {
          reportCaughtError(detail, "Camera unavailable.");
        }
      });
      disposeCameraSession = async () => {
        await workspaceCameraController?.dispose();
        workspaceCameraController = null;
      };
    }
    workspaceCameraController.setPreviewUi(livePreviewEl, livePreviewView);
    workspaceCameraController.ensureIpcSubscriptions();
    cameraPhaseRef.getPhase = () => workspaceCameraController!.getPhase();
    const initCamera = (
      preferredDeviceId?: string | null,
      options?: { forceReopen?: boolean }
    ): Promise<void> => workspaceCameraController!.initCamera(preferredDeviceId, options);
    // draw() rebuilds an empty <select>; repopulate even when preview stays live across redraws.
    void populateCameraDevices();
    const cameraPhase = workspaceCameraController.getPhase();
    if (cameraPhase === "live" || cameraPhase === "opening" || cameraPhase === "stalled") {
      workspaceCameraController.reattachPreviewSubscription();
    } else if (cameraPhase !== "disconnected") {
      void initCamera();
    }

    const sidePanels: HTMLElement[] = [sequencePanel, projectSettingsPanel, exportPanel, cameraControlsPanel, helpPanel].filter(
      (panel): panel is HTMLElement => Boolean(panel)
    );
    const setPanelOpenState = (panel: HTMLElement | null, open: boolean): void => {
      if (!panel) {
        return;
      }
      panel.classList.toggle("is-open", open);
      panel.setAttribute("aria-hidden", open ? "false" : "true");
    };
    const closeAllPanels = (): void => {
      sidePanels.forEach((panel) => setPanelOpenState(panel, false));
      applyWorkspaceShift();
    };
    const openOnlyPanel = (panel: HTMLElement | null): void => {
      sidePanels.forEach((row) => setPanelOpenState(row, row === panel));
      if (panel?.id === "cameraControlsPanel") {
        renderCameraControls();
        void syncFocusOverlayUi();
      }
      applyWorkspaceShift();
    };
    const isAnyPanelOpen = (): boolean => sidePanels.some((panel) => panel.classList.contains("is-open"));
    const applyWorkspaceShift = (): void => {
      livePreview?.classList.toggle("bm-live-preview-shifted", isAnyPanelOpen());
    };

    const computeResolvedExportPath = (): string | null => {
      if (!state.currentSession) {
        return null;
      }
      const customEnabled = exportPathModeCustom?.checked ?? false;
      if (customEnabled) {
        const rootPath = String(customExportPathInput?.value ?? "").trim();
        return rootPath || null;
      }
      return `${state.currentSession.projectRoot.replace(/[\\/]+$/, "")}\\exports\\sequence`;
    };

    const syncExportPathUi = (): void => {
      const customEnabled = exportPathModeCustom?.checked ?? false;
      customExportPathGroup?.classList.toggle("d-none", !customEnabled);
      if (customExportPathInput) {
        customExportPathInput.required = customEnabled;
      }
      if (exportSequenceSelectionList && state.currentSession) {
        const rows = state.currentSession.project.sequenceOrder
          .map((sequenceId) => {
            const sequence = state.currentSession?.project.sequencesById[sequenceId];
            if (!sequence) {
              return "";
            }
            const checked = sequenceId === state.currentSession?.project.activeSequenceId ? "checked" : "";
            return `<div class="form-check"><input class="form-check-input" type="checkbox" name="selectedSequence" value="${escapeHtml(
              sequenceId
            )}" id="exportSeq_${escapeHtml(sequenceId)}" ${checked}/><label class="form-check-label" for="exportSeq_${escapeHtml(
              sequenceId
            )}">${escapeHtml(sequence.title)} (${sequence.frameIdOrder.length})</label></div>`;
          })
          .join("");
        exportSequenceSelectionList.innerHTML = rows;
        exportSequenceSelectionList.classList.toggle("d-none", !(exportScopeSelected?.checked ?? false));
      }
      if (exportSummaryText && state.currentSession) {
        let total = state.currentSession.project.frameIdOrder.length;
        if (exportScopeAll?.checked) {
          total = state.currentSession.project.sequenceOrder.reduce((sum, sequenceId) => {
            const sequence = state.currentSession?.project.sequencesById[sequenceId];
            return sum + (sequence?.frameIdOrder.length ?? 0);
          }, 0);
        }
        const resolved = computeResolvedExportPath();
        const keepBoth = exportConflictKeepBoth?.checked ?? false;
        const destination = exportPathModeCustom?.checked ? "Custom Folder" : "Project Exports";
        if (!resolved) {
          exportSummaryText.textContent = "Choose destination folder.";
        } else if (keepBoth) {
          exportSummaryText.textContent = `Exporting ${total} frame${total === 1 ? "" : "s"} to ${destination} (new suffixed folder if needed).`;
        } else {
          exportSummaryText.textContent = `Exporting ${total} frame${total === 1 ? "" : "s"} to ${destination} (replacing existing files).`;
        }
      }
      if (exportFileNameExample) {
        const prefix = sanitizeFrameFilePrefix(String(exportFramePrefixInput?.value ?? "")) || "frame_";
        exportFileNameExample.textContent = `${prefix}000001.jpg`;
      }
    };

    const hydrateSequenceTileImages = (): void => {
      if (!state.currentSession || !sequenceTileGrid) {
        return;
      }
      sequenceTileGrid.querySelectorAll<HTMLImageElement>("img[data-image-path]").forEach((img) => {
        const relativePath = img.dataset.imagePath;
        if (!relativePath) {
          return;
        }
        void getImageObjectUrl(state.currentSession as ProjectSession, relativePath)
          .then((src) => {
            img.src = src;
          })
          .catch(() => {});
      });
    };

    openSequencePanelButton?.addEventListener("click", () => openOnlyPanel(sequencePanel));
    closeSequencePanelButton?.addEventListener("click", closeAllPanels);
    openProjectSettingsPanelButton?.addEventListener("click", () => openOnlyPanel(projectSettingsPanel));
    closeProjectSettingsPanelButton?.addEventListener("click", closeAllPanels);
    openExportPanelButton?.addEventListener("click", () => openOnlyPanel(exportPanel));
    closeExportPanelButton?.addEventListener("click", closeAllPanels);
    openCameraControlsPanelButton?.addEventListener("click", () => openOnlyPanel(cameraControlsPanel));
    closeCameraControlsPanelButton?.addEventListener("click", closeAllPanels);
    openHelpPanelButton?.addEventListener("click", () => openOnlyPanel(helpPanel));
    closeHelpPanelButton?.addEventListener("click", closeAllPanels);
    const toolbarFrameActions = root.querySelector<HTMLElement>(".bm-toolbar-frame-actions");
    root.addEventListener("click", (event) => {
      if (!isAnyPanelOpen()) {
        return;
      }
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      const clickedInsidePanel = sidePanels.some((panel) => panel.contains(target));
      const clickedOpenTrigger = [
        openSequencePanelButton,
        openProjectSettingsPanelButton,
        openExportPanelButton,
        openCameraControlsPanelButton,
        openHelpPanelButton
      ].some((button) => button?.contains(target));
      const cameraPanelOpen = cameraControlsPanel?.classList.contains("is-open") ?? false;
      const clickedCaptureWorkflow =
        cameraPanelOpen &&
        (captureButton?.contains(target) || toolbarFrameActions?.contains(target));
      if (clickedInsidePanel || clickedOpenTrigger || clickedCaptureWorkflow) {
        return;
      }
      closeAllPanels();
    });

    const onClick = (el: HTMLButtonElement | null, handler: () => void): void => {
      el?.addEventListener("click", handler);
    };
    const onClickAsync = (el: HTMLButtonElement | null, handler: () => Promise<void>): void => {
      el?.addEventListener("click", () => {
        void handler();
      });
    };

    onionToggle?.addEventListener("change", () => {
      if (!state.currentSession) {
        return;
      }
      const previous = state.currentSession.project.uiState.onionEnabled;
      const next = onionToggle.checked;
      if (previous === next) {
        onionOpacityOverlay?.classList.toggle("d-none", !next);
        renderOnion();
        return;
      }
      const command = createWorkspaceUiSettingCommand({
        key: "onionEnabled",
        fromValue: previous,
        toValue: next,
        label: "Toggle onion skin",
        coalesceKey: "workspace-ui:onion-enabled",
        applyStatus: next ? "Onion skin enabled." : "Onion skin disabled.",
        revertStatus: previous ? "Onion skin enabled." : "Onion skin disabled."
      });
      void historyManager.execute(command).catch((error) => {
        reportCaughtError(error, "Could not toggle onion skin.");
      });
    });
    onionOpacity?.addEventListener("input", renderOnion);
    onClickAsync(captureButton, captureFrame);
    onClickAsync(undoFrameButton, undoFrameAction);
    onClickAsync(redoFrameButton, redoFrameAction);
    onClickAsync(duplicateButton, duplicateFrames);
    onClickAsync(deleteButton, deleteFrame);
    const normalizeSequenceTitle = (value: string): string => value.trim().toLocaleLowerCase();

    const buildUniqueSequenceTitle = (baseTitle: string, options?: { excludeId?: string }): string => {
      if (!state.currentSession) {
        return baseTitle.trim();
      }
      const project = state.currentSession.project;
      const wanted = baseTitle.trim() || "Sequence";
      const used = new Set(
        project.sequenceOrder
          .filter((id) => id !== options?.excludeId)
          .map((id) => project.sequencesById[id])
          .filter((row): row is NonNullable<typeof row> => Boolean(row))
          .map((row) => normalizeSequenceTitle(row.title))
      );
      if (!used.has(normalizeSequenceTitle(wanted))) {
        return wanted;
      }
      let suffix = 2;
      while (suffix < 10000) {
        const candidate = `${wanted} (${suffix})`;
        if (!used.has(normalizeSequenceTitle(candidate))) {
          return candidate;
        }
        suffix += 1;
      }
      return `${wanted} (${Date.now()})`;
    };

    const buildDuplicateSequenceTitle = (sourceTitle: string): string => {
      const base = `${sourceTitle.trim() || "Sequence"} (copy)`;
      return buildUniqueSequenceTitle(base);
    };

    const createSequence = async (): Promise<void> => {
      if (!state.currentSession) {
        return;
      }
      const sequenceId = crypto.randomUUID();
      const title = buildUniqueSequenceTitle(`Sequence ${state.currentSession.project.sequenceOrder.length + 1}`);
      const command = createSequenceMutationCommand({
        label: "Create sequence",
        applyStatus: `Created sequence "${title}".`,
        mutate: () => {
          if (!state.currentSession) {
            return;
          }
          const now = new Date().toISOString();
          state.currentSession.project.sequenceOrder.push(sequenceId);
          state.currentSession.project.sequencesById[sequenceId] = {
            id: sequenceId,
            title,
            frameIdOrder: [],
            createdAt: now,
            updatedAt: now
          };
          activateSequence(sequenceId);
        }
      });
      if (command) {
        await historyManager.execute(command);
      }
    };
    const renameSequenceById = async (sequenceId: string): Promise<void> => {
      if (!state.currentSession || !sequenceTileGrid) {
        return;
      }
      const current = state.currentSession.project.sequencesById[sequenceId];
      if (!current) {
        return;
      }
      sequenceTileGrid.querySelectorAll<HTMLElement>("[data-sequence-edit-row]").forEach((row) => row.classList.add("d-none"));
      const row = sequenceTileGrid.querySelector<HTMLElement>(`[data-sequence-edit-row="${sequenceId}"]`);
      const input = sequenceTileGrid.querySelector<HTMLInputElement>(`[data-sequence-edit-input="${sequenceId}"]`);
      if (row && input) {
        row.classList.remove("d-none");
        input.value = current.title;
        input.focus();
        input.select();
      }
    };
    const duplicateSequenceById = async (sequenceId: string): Promise<void> => {
      if (!state.currentSession) {
        return;
      }
      const source = state.currentSession.project.sequencesById[sequenceId];
      if (!source) {
        return;
      }
      const copyId = crypto.randomUUID();
      const copyTitle = buildDuplicateSequenceTitle(source.title);
      const command = createSequenceMutationCommand({
        label: "Duplicate sequence",
        applyStatus: `Duplicated sequence "${source.title}" as "${copyTitle}".`,
        mutate: () => {
          if (!state.currentSession) {
            return;
          }
          const now = new Date().toISOString();
          state.currentSession.project.sequenceOrder.push(copyId);
          state.currentSession.project.sequencesById[copyId] = {
            id: copyId,
            title: copyTitle,
            frameIdOrder: [...source.frameIdOrder],
            createdAt: now,
            updatedAt: now
          };
          activateSequence(copyId);
        }
      });
      if (command) {
        await historyManager.execute(command);
      }
    };
    const deleteSequenceById = async (sequenceId: string): Promise<void> => {
      if (!state.currentSession) {
        return;
      }
      if (state.currentSession.project.sequenceOrder.length <= 1) {
        setStatus("Cannot delete the last sequence.");
        return;
      }
      const command = createSequenceMutationCommand({
        label: "Delete sequence",
        applyStatus: "Sequence deleted.",
        mutate: () => {
          if (!state.currentSession) {
            return;
          }
          state.currentSession.project.sequenceOrder = state.currentSession.project.sequenceOrder.filter((id) => id !== sequenceId);
          delete state.currentSession.project.sequencesById[sequenceId];
          if (state.currentSession.project.activeSequenceId === sequenceId) {
            activateSequence(state.currentSession.project.sequenceOrder[0] as string);
          }
        }
      });
      if (command) {
        await historyManager.execute(command);
      }
    };
    const activateSequenceById = async (sequenceId: string): Promise<void> => {
      if (!state.currentSession) {
        return;
      }
      activateSequence(sequenceId);
      await saveProject();
      pendingOffcanvasPanelId = "sequenceManagerPanel";
      draw();
    };
    const duplicateActiveSequence = async (): Promise<void> => {
      const activeId = state.currentSession?.project.activeSequenceId;
      if (!activeId) {
        return;
      }
      await duplicateSequenceById(activeId);
    };
    const renameActiveSequence = async (): Promise<void> => {
      const activeId = state.currentSession?.project.activeSequenceId;
      if (!activeId) {
        return;
      }
      pendingOffcanvasPanelId = "sequenceManagerPanel";
      draw();
      queueMicrotask(() => {
        root.querySelector<HTMLElement>(`[data-sequence-edit-row="${activeId}"]`)?.classList.remove("d-none");
        const input = root.querySelector<HTMLInputElement>(`[data-sequence-edit-input="${activeId}"]`);
        input?.focus();
        input?.select();
      });
    };
    const deleteActiveSequence = async (): Promise<void> => {
      const activeId = state.currentSession?.project.activeSequenceId;
      if (!activeId) {
        return;
      }
      await deleteSequenceById(activeId);
    };
    const activateSequenceByOffset = async (offset: -1 | 1): Promise<void> => {
      if (!state.currentSession) {
        return;
      }
      const order = state.currentSession.project.sequenceOrder;
      if (!order.length) {
        return;
      }
      const currentIdx = Math.max(0, order.indexOf(state.currentSession.project.activeSequenceId));
      const nextIdx = (currentIdx + offset + order.length) % order.length;
      await activateSequenceById(order[nextIdx] as string);
    };
    createSequenceButton?.addEventListener("click", () => {
      void createSequence().catch((error) => reportCaughtError(error, "Could not create sequence."));
    });
    sequenceSearchInput?.addEventListener("input", () => {
      const query = sequenceSearchInput.value.trim().toLowerCase();
      sequenceTileGrid?.querySelectorAll<HTMLElement>("[data-sequence-id]").forEach((card) => {
        const text = card.textContent?.toLowerCase() ?? "";
        card.classList.toggle("d-none", Boolean(query) && !text.includes(query));
      });
    });
    sequenceTileGrid?.querySelectorAll<HTMLButtonElement>("[data-sequence-open]").forEach((button) => {
      button.addEventListener("click", () => {
        const sequenceId = button.dataset.sequenceOpen;
        if (!sequenceId) {
          return;
        }
        void activateSequenceById(sequenceId).catch((error) => reportCaughtError(error, "Could not switch sequence."));
      });
    });
    sequenceTileGrid?.querySelectorAll<HTMLButtonElement>("[data-sequence-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const sequenceId = button.dataset.sequenceId;
        const action = button.dataset.sequenceAction;
        if (!state.currentSession || !sequenceId || !action) {
          return;
        }
        if (action === "rename") {
          void renameSequenceById(sequenceId);
          return;
        }
        if (action === "duplicate") {
          void duplicateSequenceById(sequenceId).catch((error) => reportCaughtError(error, "Could not duplicate sequence."));
          return;
        }
        if (action === "delete") {
          void deleteSequenceById(sequenceId).catch((error) => reportCaughtError(error, "Could not delete sequence."));
        }
      });
    });
    sequenceTileGrid?.querySelectorAll<HTMLFormElement>("[data-sequence-edit-row]").forEach((form) => {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const sequenceId = form.getAttribute("data-sequence-edit-row");
        if (!sequenceId || !state.currentSession) {
          return;
        }
        const input = form.querySelector<HTMLInputElement>("[data-sequence-edit-input]");
        const current = state.currentSession.project.sequencesById[sequenceId];
        const next = String(input?.value ?? "").trim();
        if (!current || !next || next === current.title) {
          form.classList.add("d-none");
          return;
        }
        const duplicateExists = state.currentSession.project.sequenceOrder.some((id) => {
          if (id === sequenceId) {
            return false;
          }
          const other = state.currentSession?.project.sequencesById[id];
          return Boolean(other && normalizeSequenceTitle(other.title) === normalizeSequenceTitle(next));
        });
        if (duplicateExists) {
          setStatus("Sequence title already exists. Choose a unique name.");
          input?.focus();
          input?.select();
          return;
        }
        const command = createSequenceMutationCommand({
          label: "Rename sequence",
          applyStatus: `Renamed sequence to "${next}".`,
          mutate: () => {
            const row = state.currentSession?.project.sequencesById[sequenceId];
            if (row) {
              row.title = next;
              row.updatedAt = new Date().toISOString();
            }
          }
        });
        form.classList.add("d-none");
        if (command) {
          void historyManager.execute(command).catch((error) => reportCaughtError(error, "Could not rename sequence."));
        }
      });
    });
    sequenceTileGrid?.querySelectorAll<HTMLButtonElement>("[data-sequence-edit-cancel]").forEach((button) => {
      button.addEventListener("click", () => {
        button.closest("[data-sequence-edit-row]")?.classList.add("d-none");
      });
    });
    hydrateSequenceTileImages();
    onClick(timelineLiveButton, () => {
      jumpToLive({
        stopPlayback,
        clearFrameSelection: () => {
          frameSelection.clear();
        },
        setTimelineAnchor: (next) => {
          lastTimelineAnchorIndex = next;
        },
        setPlayhead: (next) => {
          playhead = next;
        },
        renderCurrentFrame,
        renderTimeline
      });
    });
    onClick(prevFrameButton, () => {
      stepTimelineByKeyboardLogic(-1);
    });
    onClick(togglePlaybackButton, () => {
      if (!isPlaybackActive()) {
        startPlayback("forward");
      } else {
        stopPlayback();
        syncPlaybackUi();
      }
    });
    onClick(nextFrameButton, () => {
      stepTimelineByKeyboardLogic(1);
    });
    onClick(resetButton, () => {
      stopPlayback();
      syncPlaybackUi();
      frameSelection.clear();
      lastTimelineAnchorIndex = null;
      playhead = session.project.frameIdOrder.length > 0 ? 0 : "live";
      renderCurrentFrame();
      renderTimeline();
    });
    const toggleLoopPlayback = async (): Promise<void> => {
      if (!state.currentSession) {
        return;
      }
      const previous = state.currentSession.project.uiState.loopEnabled;
      const next = !previous;
      const command = createWorkspaceUiSettingCommand({
        key: "loopEnabled",
        fromValue: previous,
        toValue: next,
        label: "Toggle loop playback",
        coalesceKey: "workspace-ui:loop-enabled",
        applyStatus: next ? "Loop playback enabled." : "Loop playback disabled.",
        revertStatus: previous ? "Loop playback enabled." : "Loop playback disabled."
      });
      await historyManager.execute(command);
    };
    onClick(loopButton, () => {
      void toggleLoopPlayback().catch((error) => {
        reportCaughtError(error, "Could not toggle loop playback.");
      });
    });
    const onPlaybackTimingModeChange = (): void => {
      if (!state.currentSession || !playbackTimingRealtime) {
        return;
      }
      const previous = state.currentSession.project.uiState.playbackTimingMode;
      const next: ProjectFile["uiState"]["playbackTimingMode"] = playbackTimingRealtime.checked
        ? "wall_clock"
        : "hold_after_decode";
      if (previous === next) {
        return;
      }
      const command = createWorkspaceUiSettingCommand({
        key: "playbackTimingMode",
        fromValue: previous,
        toValue: next,
        label: "Change playback timing mode",
        coalesceKey: "workspace-ui:playback-timing-mode",
        applyStatus: next === "wall_clock" ? "Playback mode set to Animation playback." : "Playback mode set to Per Frame playback.",
        revertStatus:
          previous === "wall_clock" ? "Playback mode set to Animation playback." : "Playback mode set to Per Frame playback."
      });
      void historyManager.execute(command).catch((error) => {
        reportCaughtError(error, "Could not change playback mode.");
      });
    };
    playbackTimingRealtime?.addEventListener("change", onPlaybackTimingModeChange);
    playbackTimingPerFrame?.addEventListener("change", onPlaybackTimingModeChange);
    syncPlaybackTimingToolbarUi();

    root.querySelectorAll<HTMLButtonElement>("[data-focus-delta]").forEach((btn) => {
      const rawMult = btn.dataset.focusDelta ? Number(btn.dataset.focusDelta) : 0;
      if (!Number.isFinite(rawMult) || rawMult === 0) {
        return;
      }
      const mult = rawMult;
      btn.addEventListener("click", async () => {
        if (btn.disabled) {
          return;
        }
        await runFocusAdjust(mult);
      });
    });
    void syncFocusOverlayUi();
    bindWorkspaceSidePanelActions({
      refs: {
        refreshCamerasButton,
        cameraDeviceSelect,
        projectSettingsForm,
        changeProjectFolderButton,
        exportPathModeDefault,
        exportPathModeCustom,
        exportConflictReplace,
        exportConflictKeepBoth,
        exportScopeActive,
        exportScopeSelected,
        exportScopeAll,
        exportSequenceSelectionList,
        customExportPathInput,
        exportFramePrefixInput,
        pickExportPathButton,
        exportSequenceForm,
        openExportAfterDone
      },
      sanitizeFrameFilePrefix,
      getCurrentSession: () => state.currentSession,
      setCurrentSession: (next) => {
        state.currentSession = next;
      },
      setStatus,
      draw,
      clearFrameHistory,
      populateCameraDevices,
      initCamera,
      isCameraDeviceChangeSuppressed: () => suppressCameraDeviceChange,
      syncExportPathUi,
      saveProject
    });

    workspaceKeydownAbort = bindWorkspaceKeyboardShortcuts({
      root,
      previousAbort: workspaceKeydownAbort,
      getRoute: () => state.route,
      getSession: () => state.currentSession,
      getIsPlaybackActive: () => isPlaybackActive(),
      setPlayhead: (next) => {
        playhead = next;
      },
      clearFrameSelection: () => {
        frameSelection.clear();
      },
      setTimelineAnchor: (next) => {
        lastTimelineAnchorIndex = next;
      },
      addFrameSelection: (index) => {
        frameSelection.add(index);
      },
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
      onEscape: async () => {
        try {
          const result = await window.brickMotion.exitFullscreen();
          if (result.wasFullscreen) {
            return true;
          }
        } catch {
          // fall through to default Escape behavior
        }
        return false;
      }
    });

    onClickAsync(backButton, async () => {
      stopPlayback();
      stopStream();
      await refreshRecentProjects();
      state.route = "start";
      draw();
    });

    handleWorkspaceMenuCommand = createWorkspaceMenuCommandHandler({
      createSequence,
      duplicateActiveSequence,
      renameActiveSequence,
      deleteActiveSequence,
      activateNextSequence: async () => {
        await activateSequenceByOffset(1);
      },
      activatePreviousSequence: async () => {
        await activateSequenceByOffset(-1);
      },
      openSequenceManager: () => {
        root.querySelector<HTMLButtonElement>("[data-action='open-sequence-panel']")?.click();
      },
      captureFrame,
      duplicateFrames,
      deleteFrame,
      undoFrameAction,
      redoFrameAction,
      stopPlayback,
      startPlayback,
      syncPlaybackUi,
      toggleLoopPlaybackAction: async () => {
        await toggleLoopPlayback().catch((error) => {
          reportCaughtError(error, "Could not toggle loop playback.");
        });
      },
      stepTimelineByKeyboardLogic,
      jumpToHome,
      jumpToEnd,
      jumpToLive: () => {
        jumpToLive({
          stopPlayback,
          clearFrameSelection: () => {
            frameSelection.clear();
          },
          setTimelineAnchor: (next) => {
            lastTimelineAnchorIndex = next;
          },
          setPlayhead: (next) => {
            playhead = next;
          },
          renderCurrentFrame,
          renderTimeline
        });
      },
      getIsPlaybackActive: () => isPlaybackActive()
    });

    loopPlayback = session.project.uiState.loopEnabled;
    playhead = "live";
    syncLoopUi();
    syncPlaybackUi();
    renderTimeline();
    renderCurrentFrame();
    updateWorkspaceMeta();
    setStatus("Ready.");
    syncExportPathUi();
  };

  window.brickMotion.menuCommandSubscribe(dispatchMenuCommand);
  void refreshRecentProjects().finally(() => {
    draw();
  });
};
