import type { CaptureMode } from "../../../shared/types/project";
import { reportCaughtError } from "../userFeedback";
import { resolveCameraSelectValueToId } from "../../utils/cameraDeviceSelect";
import { buildRelocatedProjectRoot, parseExportSequenceForm, parseProjectSettingsForm } from "./forms";
import type { WorkspaceContext } from "./context";

export const bindWorkspaceSidePanelActions = (ctx: WorkspaceContext): void => {
  const {
    refs,
    sanitizeFrameFilePrefix,
    getCurrentSession,
    setCurrentSession,
    setStatus,
    draw,
    clearFrameHistory,
    populateCameraDevices,
    initCamera,
    isCameraDeviceChangeSuppressed,
    syncExportPathUi,
    saveProject
  } = ctx;

  refs.refreshCamerasButton?.addEventListener("click", async () => {
    const cameras = await populateCameraDevices();
    const session = getCurrentSession();
    if (session) {
      session.project.cameraProfile.values = {};
    }
    const fromSelect = resolveCameraSelectValueToId(refs.cameraDeviceSelect?.value ?? "", cameras);
    const fromProject =
      typeof session?.project.cameraProfile.deviceId === "string" ? session.project.cameraProfile.deviceId : null;
    await initCamera(fromSelect ?? fromProject, { forceReopen: true });
    setStatus("Devices refreshed and camera settings reset to defaults.");
  });

  refs.cameraDeviceSelect?.addEventListener("change", () => {
    if (isCameraDeviceChangeSuppressed()) {
      return;
    }
    void initCamera(refs.cameraDeviceSelect?.value || null, { forceReopen: true });
  });

  refs.projectSettingsForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const session = getCurrentSession();
    if (!session || !refs.projectSettingsForm) {
      return;
    }
    const parsed = parseProjectSettingsForm(refs.projectSettingsForm, {
      captureMode: session.project.captureMode,
      fps: session.project.fps
    });
    if (!parsed.title) {
      return;
    }
    session.project.projectTitle = parsed.title;
    session.project.captureMode = parsed.captureMode as CaptureMode;
    session.project.fps = parsed.fps;
    session.project.uiState.showPlaybackFpsOverlay = parsed.showPlaybackFpsOverlay;
    await saveProject();
    setStatus("Project settings saved.");
    draw();
  });

  refs.changeProjectFolderButton?.addEventListener("click", async () => {
    const session = getCurrentSession();
    if (!session) {
      return;
    }
    const picked = await window.brickMotion.pickDirectory();
    if (!picked) {
      setStatus("Project folder change canceled.");
      return;
    }
    const currentRoot = session.projectRoot;
    const nextRoot = buildRelocatedProjectRoot(picked, currentRoot);
    if (nextRoot === currentRoot) {
      setStatus("Project already uses that folder.");
      return;
    }
    setStatus("Moving project folder...");
    try {
      const movedSession = await window.brickMotion.relocateProjectRoot({
        projectRoot: currentRoot,
        nextProjectRoot: nextRoot,
        project: session.project
      });
      setCurrentSession(movedSession);
      clearFrameHistory();
      setStatus(`Project folder moved to ${movedSession.projectRoot}.`);
      draw();
    } catch (error) {
      reportCaughtError(error, "Could not move project folder.");
      setStatus("Project folder change failed.");
    }
  });

  refs.exportPathModeDefault?.addEventListener("change", syncExportPathUi);
  refs.exportPathModeCustom?.addEventListener("change", syncExportPathUi);
  refs.exportConflictReplace?.addEventListener("change", syncExportPathUi);
  refs.exportConflictKeepBoth?.addEventListener("change", syncExportPathUi);
  refs.exportScopeActive?.addEventListener("change", syncExportPathUi);
  refs.exportScopeSelected?.addEventListener("change", syncExportPathUi);
  refs.exportScopeAll?.addEventListener("change", syncExportPathUi);
  refs.customExportPathInput?.addEventListener("input", syncExportPathUi);
  refs.exportFramePrefixInput?.addEventListener("input", syncExportPathUi);

  refs.pickExportPathButton?.addEventListener("click", async () => {
    const picked = await window.brickMotion.pickDirectory();
    if (picked && refs.customExportPathInput) {
      refs.customExportPathInput.value = picked;
      syncExportPathUi();
    }
  });

  refs.exportSequenceForm?.addEventListener("submit", async (event) => {
    const session = getCurrentSession();
    if (!session || !refs.exportSequenceForm) {
      return;
    }
    event.preventDefault();
    const activeSequence = session.project.sequencesById[session.project.activeSequenceId];
    if (!activeSequence) {
      setStatus("No active sequence.");
      return;
    }
    if (activeSequence.frameIdOrder.length === 0) {
      setStatus("Nothing to export: no captured frames yet.");
      return;
    }
    const { destinationMode, customExportRoot, conflictAction, frameFilePrefix, exportScope, selectedSequenceIds } = parseExportSequenceForm(
      refs.exportSequenceForm,
      sanitizeFrameFilePrefix
    );
    let sequenceIds: string[] = [];
    if (exportScope === "active") {
      sequenceIds = [session.project.activeSequenceId];
    } else if (exportScope === "all") {
      sequenceIds = [...session.project.sequenceOrder];
    } else {
      sequenceIds = selectedSequenceIds.filter((id) => session.project.sequencesById[id]);
    }
    if (sequenceIds.length === 0) {
      setStatus("Select at least one sequence to export.");
      return;
    }
    const sequenceExports = sequenceIds
      .map((id) => session.project.sequencesById[id])
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .map((sequence) => ({
        sequenceId: sequence.id,
        title: sequence.title,
        frameIdOrder: [...sequence.frameIdOrder]
      }));
    if (sequenceExports.every((row) => row.frameIdOrder.length === 0)) {
      setStatus("Selected sequences do not contain frames.");
      return;
    }
    if (destinationMode === "custom" && !customExportRoot) {
      setStatus("Choose a custom export folder first.");
      return;
    }
    setStatus("Exporting image sequence...");
    try {
      const result = await window.brickMotion.exportSequenceAdvanced({
        projectRoot: session.projectRoot,
        sequenceExports,
        framesById: session.project.framesById,
        destinationMode,
        customExportRoot: destinationMode === "custom" ? customExportRoot : null,
        conflictAction,
        frameFilePrefix
      });
      if (result.status === "ok") {
        setStatus(`Exported ${result.exportedCount} frames to ${result.exportDir}.`);
        if (refs.openExportAfterDone?.checked) {
          void window.brickMotion.openPath(result.exportDir).catch(() => {});
        }
      } else {
        setStatus("Export canceled.");
      }
    } catch (error) {
      reportCaughtError(error, "Could not export sequence.");
      setStatus("Export failed.");
    }
  });
};
