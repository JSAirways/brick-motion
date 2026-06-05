import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell } from "electron";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { CameraService } from "./camera/cameraService";
import { getActiveCameraBackendLabel } from "./camera/createCameraBackend";
import { buildAppMenuTemplate } from "./menuCommands";
import { resolveFramePathsInsideProject, resolveSafePathInsideProject } from "./pathUtils";
import { createRecentProjectsService } from "./recentProjects";
import {
  requireCaptureMode,
  requireNonEmptyString,
  requireNumber,
  requireRecord,
  requireString
} from "./ipc/guards";
import { parseAndValidateProject, validateCreateProjectPayload } from "../src/shared/validateProject";
import type { CaptureMode, FrameRecord, ProjectFile } from "../src/shared/types/project";
import { APP_NAME, buildAppInfo, formatReleaseVersionLabel, formatWindowTitle } from "../src/shared/appInfo";
import { sanitizeExportPrefix } from "../src/shared/sanitize";
import { reconcileProjectFramesOnDisk, writeCapturedFrameBuffers } from "./frameAssets";

const PROJECT_FILE_NAME = "project.json";

let cameraService: CameraService | null = null;

const getCameraService = (): CameraService => {
  if (!cameraService) {
    cameraService = new CameraService();
    cameraService.setStatusListener((event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.webContents.send("camera:status", event);
        }
      }
    });
    cameraService.setDevicesChangedListener((event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.webContents.send("camera:devices-changed", event);
        }
      }
    });
    cameraService.ensureDeviceWatch();
    console.info(`[camera] active backend: ${getActiveCameraBackendLabel()}`);
  }
  return cameraService;
};

const ensureDir = async (dirPath: string): Promise<void> => {
  await fs.mkdir(dirPath, { recursive: true });
};

const toPosixPath = (value: string): string => value.replace(/\\/g, "/");

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryableRenameError = (error: unknown): boolean => {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EPERM" || code === "EBUSY" || code === "ENOENT";
};

const writeJsonAtomic = async (filePath: string, payload: unknown): Promise<void> => {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  const tmpPath = path.join(
    dir,
    `${path.basename(filePath)}.${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2)}.tmp`
  );
  await fs.writeFile(tmpPath, JSON.stringify(payload, null, 2), "utf8");

  const maxAttempts = 6;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await fs.rename(tmpPath, filePath);
      return;
    } catch (error) {
      lastError = error;
      if (!isRetryableRenameError(error) || attempt === maxAttempts) {
        break;
      }
      await sleep(40 * attempt);
    }
  }

  try {
    // Fallback for sync/lock edge cases: replace by copy.
    await fs.copyFile(tmpPath, filePath);
  } catch {
    throw lastError ?? new Error("Unable to save project file.");
  } finally {
    await removeIfExists(tmpPath);
  }
};

const recentProjects = createRecentProjectsService({ ensureDir, writeJsonAtomic });

const removeIfExists = async (filePath: string): Promise<void> => {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw error;
    }
  }
};

const parseDataUrl = (dataUrl: string): { buffer: Buffer; extension: "jpg" | "png" } => {
  const match = /^data:image\/(jpeg|png);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    throw new Error("Unsupported image data format.");
  }

  const [, format, payload] = match;
  return {
    buffer: Buffer.from(payload, "base64"),
    extension: format === "jpeg" ? "jpg" : "png"
  };
};

const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const getUniquePath = async (basePath: string): Promise<string> => {
  if (!(await pathExists(basePath))) {
    return basePath;
  }
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${basePath}-${index}`;
    if (!(await pathExists(candidate))) {
      return candidate;
    }
  }
  throw new Error("Could not find an available export folder name.");
};

const clearDirectoryContents = async (dirPath: string): Promise<void> => {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  await Promise.all(
    entries.map((entry) => fs.rm(path.join(dirPath, entry.name), { recursive: true, force: true }))
  );
};

const sequenceFolderName = (title: string): string => {
  const trimmed = title.trim();
  const sanitized = trimmed
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "");
  return sanitized || "Sequence";
};

const moveDirectory = async (source: string, destination: string): Promise<void> => {
  try {
    await fs.rename(source, destination);
    return;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EXDEV") {
      throw error;
    }
  }
  await fs.cp(source, destination, { recursive: true, force: false, errorOnExist: true });
  await fs.rm(source, { recursive: true, force: true });
};

const getRendererIndexPath = (): string => {
  // In packaged apps app.getAppPath() points at app.asar root.
  return path.join(app.getAppPath(), "dist-renderer", "index.html");
};

const getWindowIconPath = (): string => {
  const base = path.join(app.getAppPath(), "public", "assets");
  if (process.platform === "win32") {
    return path.join(base, "logo.ico");
  }
  return path.join(base, "logo.jpg");
};


const createMainWindow = (): BrowserWindow => {
  const isMac = process.platform === "darwin";
  const logoPath = getWindowIconPath();
  const logoImage = nativeImage.createFromPath(logoPath);
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: formatWindowTitle(buildAppInfo(app.getVersion())),
    icon: logoImage.isEmpty() ? undefined : logoImage,
    autoHideMenuBar: !isMac,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  if (process.env.ELECTRON_START_URL) {
    void window.loadURL(process.env.ELECTRON_START_URL);
    window.webContents.openDevTools({ mode: "detach" });
  } else {
    void window.loadFile(getRendererIndexPath());
  }

  if (!isMac) {
    window.setMenuBarVisibility(false);
  }

  return window;
};

ipcMain.handle("app:get-info", () => buildAppInfo(app.getVersion()));

ipcMain.handle("dialog:pick-directory", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"]
  });

  return result.canceled ? null : result.filePaths[0] ?? null;
});

ipcMain.handle("menu:set-visible", (event, visible: unknown) => {
  const nextVisible = Boolean(visible);
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) {
    return { ok: false };
  }
  window.setAutoHideMenuBar(!nextVisible);
  window.setMenuBarVisibility(nextVisible);
  return { ok: true };
});

ipcMain.handle("window:exit-fullscreen", (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) {
    return { ok: false, wasFullscreen: false };
  }
  const wasFullscreen = window.isFullScreen();
  if (wasFullscreen) {
    window.setFullScreen(false);
  }
  return { ok: true, wasFullscreen };
});

ipcMain.handle("file:open-path", async (_event, targetPath: unknown) => {
  const p = requireNonEmptyString(targetPath, "Path is required.");
  const result = await shell.openPath(p);
  if (result) {
    throw new Error(result);
  }
  return { ok: true };
});

ipcMain.handle("project:create", async (_event, payload: unknown) => {
  const project = validateCreateProjectPayload(payload);
  if (!project) {
    throw new Error("Invalid create-project payload.");
  }

  const projectRoot = project.sourcePath;
  const framesPreviewDir = path.join(projectRoot, "frames", "preview-jpeg");
  const framesTimelineThumbDir = path.join(projectRoot, "frames", "timeline-thumb");
  const framesSourceJpegDir = path.join(projectRoot, "frames", "source-jpeg");
  const exportsDir = path.join(projectRoot, "exports");
  const cacheThumbsDir = path.join(projectRoot, "cache", "thumbs");

  await ensureDir(framesPreviewDir);
  await ensureDir(framesTimelineThumbDir);
  await ensureDir(framesSourceJpegDir);
  if (project.captureMode === "png") {
    await ensureDir(path.join(projectRoot, "frames", "source-png"));
  }
  await ensureDir(exportsDir);
  await ensureDir(cacheThumbsDir);

  const now = new Date().toISOString();
  const defaultSequenceId = "sequence_1";
  const projectFile = {
    appVersion: 1,
    projectTitle: project.title,
    captureMode: project.captureMode,
    fps: project.fps,
    sourcePath: project.sourcePath,
    frameIdOrder: [] as string[],
    sequenceOrder: [defaultSequenceId] as string[],
    sequencesById: {
      [defaultSequenceId]: {
        id: defaultSequenceId,
        title: "Sequence 1",
        frameIdOrder: [] as string[],
        createdAt: now,
        updatedAt: now
      }
    },
    activeSequenceId: defaultSequenceId,
    framesById: {} as Record<string, unknown>,
    cameraProfile: {
      deviceId: null,
      deviceLabel: null,
      zoomSliderMax: null,
      supportedControls: {},
      values: {}
    },
    uiState: {
      onionEnabled: false,
      onionOpacity: 0.45,
      loopEnabled: false,
      timelinePosition: "live",
      playbackTimingMode: "hold_after_decode",
      showPlaybackFpsOverlay: false
    },
    createdAt: now,
    updatedAt: now
  };

  const projectFilePath = path.join(projectRoot, PROJECT_FILE_NAME);
  await writeJsonAtomic(projectFilePath, projectFile);
  await recentProjects.addRecentProjectPath(projectRoot);

  return {
    projectRoot,
    projectFilePath,
    project: projectFile
  };
});

ipcMain.handle("project:open", async (_event, projectDirectory: unknown) => {
  const projectRoot = String(projectDirectory ?? "");
  const projectFilePath = path.join(projectRoot, PROJECT_FILE_NAME);
  const raw = await fs.readFile(projectFilePath, "utf8");
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new Error("Project file is not valid JSON.");
  }
  const validated = parseAndValidateProject(parsedJson);
  if (!validated.ok) {
    throw new Error(validated.error);
  }
  const { project: reconciled, removed, thumbsRepaired, missingAssets } = await reconcileProjectFramesOnDisk(
    projectRoot,
    validated.project
  );
  if (removed > 0 || thumbsRepaired > 0) {
    await writeJsonAtomic(projectFilePath, reconciled);
  }
  await recentProjects.addRecentProjectPath(projectRoot);

  return {
    projectRoot,
    projectFilePath,
    project: reconciled,
    missingFramesRemoved: removed,
    missingFrameAssetsRemoved: missingAssets,
    timelineThumbsRepaired: thumbsRepaired
  };
});

ipcMain.handle("project:save", async (_event, payload: unknown) => {
  const body = requireRecord(payload, "Invalid save payload.");
  const projectRoot = requireNonEmptyString(body.projectRoot, "Invalid save payload.");
  const validated = parseAndValidateProject(body.project);
  if (!validated.ok) {
    throw new Error(validated.error);
  }
  const projectFilePath = path.join(projectRoot, PROJECT_FILE_NAME);
  await writeJsonAtomic(projectFilePath, validated.project);
  await recentProjects.addRecentProjectPath(projectRoot);
  return { ok: true };
});

ipcMain.handle("project:relocate-root", async (_event, payload: unknown) => {
  const body = requireRecord(payload, "Invalid relocate payload.");
  const validated = parseAndValidateProject(body.project);
  if (!validated.ok) {
    throw new Error(validated.error);
  }
  const currentRoot = path.resolve(requireNonEmptyString(body.projectRoot, "Project folders are required."));
  const nextRoot = path.resolve(requireNonEmptyString(body.nextProjectRoot, "Project folders are required."));
  if (!currentRoot || !nextRoot) {
    throw new Error("Project folders are required.");
  }
  if (currentRoot === nextRoot) {
    throw new Error("Project is already using that folder.");
  }
  if (nextRoot.startsWith(`${currentRoot}${path.sep}`)) {
    throw new Error("Cannot move project into a nested folder of itself.");
  }
  if (currentRoot.startsWith(`${nextRoot}${path.sep}`)) {
    throw new Error("Cannot move project into one of its parent folders.");
  }
  if (await pathExists(nextRoot)) {
    throw new Error("Target project folder already exists. Pick a new or empty folder path.");
  }

  await ensureDir(path.dirname(nextRoot));
  await moveDirectory(currentRoot, nextRoot);

  const updatedProject = {
    ...validated.project,
    sourcePath: nextRoot,
    updatedAt: new Date().toISOString()
  };

  const updatedFilePath = path.join(nextRoot, PROJECT_FILE_NAME);
  await writeJsonAtomic(updatedFilePath, updatedProject);
  await recentProjects.addRecentProjectPath(nextRoot);

  return {
    projectRoot: nextRoot,
    projectFilePath: updatedFilePath,
    project: updatedProject
  };
});

ipcMain.handle("project:list-recent", async () => recentProjects.listRecentProjects());

ipcMain.handle("frame:capture-from-paths", async (_event, payload: unknown) => {
  const body = requireRecord(payload, "Invalid frame capture-from-paths payload.");
  const projectRoot = requireNonEmptyString(body.projectRoot, "Invalid frame capture-from-paths payload.");
  const frameId = requireNonEmptyString(body.frameId, "Invalid frame capture-from-paths payload.");
  const sequenceIndex = Math.trunc(requireNumber(body.sequenceIndex, "Invalid frame capture-from-paths payload."));
  const previewPath = requireNonEmptyString(body.previewPath, "Invalid frame capture-from-paths payload.");
  const sourcePath = requireNonEmptyString(body.sourcePath, "Invalid frame capture-from-paths payload.");
  const previewAbs = resolveSafePathInsideProject(projectRoot, previewPath);
  const sourceAbs = resolveSafePathInsideProject(projectRoot, sourcePath);
  const previewBuffer = await fs.readFile(previewAbs);
  const sourceBuffer = await fs.readFile(sourceAbs);
  const sourceExtension = path.extname(sourceAbs).toLowerCase() === ".png" ? "png" : "jpg";
  const frame = await writeCapturedFrameBuffers({
    projectRoot,
    frameId,
    sequenceIndex,
    previewBuffer,
    sourceBuffer,
    sourceExtension
  });
  return { frame };
});

ipcMain.handle("frame:capture", async (_event, payload: unknown) => {
  const body = requireRecord(payload, "Invalid frame capture payload.");
  const projectRoot = requireNonEmptyString(body.projectRoot, "Invalid frame capture payload.");
  const frameId = requireNonEmptyString(body.frameId, "Invalid frame capture payload.");
  const sequenceIndex = Math.trunc(requireNumber(body.sequenceIndex, "Invalid frame capture payload."));
  const preview = parseDataUrl(requireString(body.previewDataUrl, "Invalid frame capture payload."));
  const source = parseDataUrl(requireString(body.sourceDataUrl, "Invalid frame capture payload."));
  const frame = await writeCapturedFrameBuffers({
    projectRoot,
    frameId,
    sequenceIndex,
    previewBuffer: preview.buffer,
    sourceBuffer: source.buffer,
    sourceExtension: source.extension
  });

  return { frame };
});

ipcMain.handle("camera:list-devices", async (_event, payload: unknown) => {
  const body = requireRecord(payload, "Invalid camera list payload.");
  return getCameraService().listDevices();
});

ipcMain.handle("camera:open", async (event, payload: unknown) => {
  const body = requireRecord(payload, "Invalid camera open payload.");
  const deviceId = requireNonEmptyString(body.deviceId, "Camera deviceId is required.");
  getCameraService().setPreviewTarget(event.sender);
  try {
    await getCameraService().open(deviceId);
  } catch (error) {
    const backend = getActiveCameraBackendLabel();
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[camera:${backend}] open failed:`, detail);
    throw new Error(detail.includes(`[${backend}]`) ? detail : `[${backend}] ${detail}`);
  }
});

ipcMain.handle("camera:close", async () => {
  await getCameraService().close();
});

ipcMain.handle("camera:get-capabilities", async (_event, payload: unknown) => {
  if (payload !== undefined) {
    requireRecord(payload, "Invalid camera capabilities payload.");
  }
  return getCameraService().getCapabilities();
});

ipcMain.handle("camera:get-controls", async (_event, payload: unknown) => {
  if (payload !== undefined) {
    requireRecord(payload, "Invalid camera controls payload.");
  }
  return getCameraService().getControls();
});

ipcMain.handle("camera:set-controls", async (_event, payload: unknown) => {
  const body = requireRecord(payload, "Invalid camera set-controls payload.");
  const partial = requireRecord(body.partial, "Invalid camera set-controls payload.");
  await getCameraService().setControls(partial);
});

ipcMain.handle("camera:capture-live", async (_event, payload: unknown) => {
  const body = requireRecord(payload, "Invalid camera capture payload.");
  const projectRoot = requireNonEmptyString(body.projectRoot, "Invalid camera capture payload.");
  const frameId = requireNonEmptyString(body.frameId, "Invalid camera capture payload.");
  const sequenceIndex = Math.trunc(requireNumber(body.sequenceIndex, "Invalid camera capture payload."));
  const captureMode = requireCaptureMode(body.captureMode);
  const grabbed = await getCameraService().grabFrame(captureMode);
  if (!grabbed) {
    throw new Error(
      "Camera capture failed: stream not ready (choose a device, wait for preview, or check that the native addon is built for Electron)."
    );
  }
  const sourceExtension: "jpg" | "png" = captureMode === "png" ? "png" : "jpg";
  if (sourceExtension === "png" && !grabbed.sourceIsPng) {
    throw new Error("Camera returned JPEG but project expects PNG source.");
  }
  if (sourceExtension === "jpg" && grabbed.sourceIsPng) {
    throw new Error("Camera returned PNG but project expects JPEG source.");
  }
  const frame = await writeCapturedFrameBuffers({
    projectRoot,
    frameId,
    sequenceIndex,
    previewBuffer: grabbed.preview,
    sourceBuffer: grabbed.source,
    sourceExtension
  });
  return { frame };
});

ipcMain.handle("frame:delete", async (_event, payload: unknown) => {
  const body = requireRecord(payload, "Invalid frame delete payload.");
  const projectRoot = requireNonEmptyString(body.projectRoot, "Invalid frame delete payload.");
  const previewPath = requireNonEmptyString(body.previewPath, "Invalid frame delete payload.");
  const sourcePath = requireNonEmptyString(body.sourcePath, "Invalid frame delete payload.");
  const thumbPath = typeof body.thumbPath === "string" && body.thumbPath.trim().length > 0 ? body.thumbPath : null;

  const { previewAbs, sourceAbs, thumbAbs } = resolveFramePathsInsideProject(projectRoot, {
    previewPath,
    sourcePath,
    thumbPath
  });
  await removeIfExists(previewAbs);
  await removeIfExists(sourceAbs);
  if (thumbAbs) {
    await removeIfExists(thumbAbs);
  }

  return { ok: true };
});

ipcMain.handle("frame:delete-undoable", async (_event, payload: unknown) => {
  const body = requireRecord(payload, "Invalid undoable frame delete payload.");
  const projectRoot = requireNonEmptyString(body.projectRoot, "Invalid undoable frame delete payload.");
  const undoToken = requireNonEmptyString(body.undoToken, "Invalid undoable frame delete payload.");
  const frameId = requireNonEmptyString(body.frameId, "Invalid undoable frame delete payload.");
  const previewPath = requireNonEmptyString(body.previewPath, "Invalid undoable frame delete payload.");
  const sourcePath = requireNonEmptyString(body.sourcePath, "Invalid undoable frame delete payload.");
  const thumbPath = typeof body.thumbPath === "string" && body.thumbPath.trim().length > 0 ? body.thumbPath : null;
  const pending = path.join(projectRoot, "cache", "undo-delete", undoToken);
  await fs.rm(pending, { recursive: true, force: true });
  await ensureDir(pending);

  const { previewAbs, sourceAbs, thumbAbs } = resolveFramePathsInsideProject(projectRoot, {
    previewPath,
    sourcePath,
    thumbPath
  });
  const extP = path.extname(previewPath) || ".jpg";
  const extS = path.extname(sourcePath) || ".jpg";
  const trashP = path.join(pending, `${frameId}_preview${extP}`);
  const trashS = path.join(pending, `${frameId}_source${extS}`);

  await fs.rename(previewAbs, trashP);
  await fs.rename(sourceAbs, trashS);
  let trashT: string | null = null;
  if (thumbAbs) {
    trashT = path.join(pending, `${frameId}_thumb.jpg`);
    try {
      await fs.rename(thumbAbs, trashT);
    } catch {
      await removeIfExists(thumbAbs);
    }
  }

  await fs.writeFile(
    path.join(pending, "meta.json"),
    JSON.stringify({
      frameId,
      previewPath,
      sourcePath,
      timelineThumbPath: thumbPath
    }),
    "utf8"
  );

  return { ok: true };
});

ipcMain.handle("frame:restore-undo-delete", async (_event, projectRoot: unknown) => {
  const body = requireRecord(projectRoot, "Invalid restore undo payload.");
  const root = requireNonEmptyString(body.projectRoot, "Invalid restore undo payload.");
  const undoToken = requireNonEmptyString(body.undoToken, "Invalid restore undo payload.");
  const pending = path.join(root, "cache", "undo-delete", undoToken);
  const metaPath = path.join(pending, "meta.json");
  let raw: string;
  try {
    raw = await fs.readFile(metaPath, "utf8");
  } catch {
    throw new Error("Nothing to undo.");
  }
  const meta = JSON.parse(raw) as {
    frameId: string;
    previewPath: string;
    sourcePath: string;
    timelineThumbPath?: string | null;
  };
  const extP = path.extname(meta.previewPath) || ".jpg";
  const extS = path.extname(meta.sourcePath) || ".jpg";
  const trashP = path.join(pending, `${meta.frameId}_preview${extP}`);
  const trashS = path.join(pending, `${meta.frameId}_source${extS}`);
  const trashT = path.join(pending, `${meta.frameId}_thumb.jpg`);

  const previewAbs = resolveSafePathInsideProject(root, meta.previewPath);
  const sourceAbs = resolveSafePathInsideProject(root, meta.sourcePath);
  await ensureDir(path.dirname(previewAbs));
  await ensureDir(path.dirname(sourceAbs));
  await fs.rename(trashP, previewAbs);
  await fs.rename(trashS, sourceAbs);
  if (meta.timelineThumbPath) {
    const thumbAbs = resolveSafePathInsideProject(root, meta.timelineThumbPath);
    await ensureDir(path.dirname(thumbAbs));
    try {
      await fs.rename(trashT, thumbAbs);
    } catch {
      /* Thumb may have been missing if older undo session */
    }
  }
  await fs.rm(pending, { recursive: true, force: true });
  return { ok: true };
});

ipcMain.handle("file:read-data-url", async (_event, payload: unknown) => {
  const body = requireRecord(payload, "Invalid file read payload.");
  const projectRoot = requireNonEmptyString(body.projectRoot, "Invalid file read payload.");
  const relativePath = requireNonEmptyString(body.relativePath, "Invalid file read payload.");
  const absolutePath = resolveSafePathInsideProject(projectRoot, relativePath);
  const buffer = await fs.readFile(absolutePath);
  const extension = path.extname(absolutePath).toLowerCase();
  const mimeType =
    extension === ".png" ? "image/png" : extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : "application/octet-stream";

  return `data:${mimeType};base64,${buffer.toString("base64")}`;
});

ipcMain.handle("file:read-buffer", async (_event, payload: unknown) => {
  const body = requireRecord(payload, "Invalid file read payload.");
  const projectRoot = requireNonEmptyString(body.projectRoot, "Invalid file read payload.");
  const relativePath = requireNonEmptyString(body.relativePath, "Invalid file read payload.");
  const absolutePath = resolveSafePathInsideProject(projectRoot, relativePath);
  const buffer = await fs.readFile(absolutePath);
  return buffer;
});

ipcMain.handle("project:export-sequence-advanced", async (_event, payload: unknown) => {
  const body = requireRecord(payload, "Invalid export payload.");
  const projectRoot = requireNonEmptyString(body.projectRoot, "Invalid export payload.");
  const sequenceExports = Array.isArray(body.sequenceExports)
    ? body.sequenceExports
        .filter((item): item is { sequenceId: string; title: string; frameIdOrder: string[] } =>
          !!item &&
          typeof item === "object" &&
          typeof (item as { sequenceId?: unknown }).sequenceId === "string" &&
          typeof (item as { title?: unknown }).title === "string" &&
          Array.isArray((item as { frameIdOrder?: unknown }).frameIdOrder)
        )
        .map((item) => ({
          sequenceId: item.sequenceId,
          title: item.title,
          frameIdOrder: item.frameIdOrder.filter((id): id is string => typeof id === "string")
        }))
    : [];
  if (sequenceExports.length === 0) {
    throw new Error("No sequences selected for export.");
  }
  const framesById = requireRecord(body.framesById, "Invalid export payload.");

  const destinationMode = body.destinationMode ?? "project_default";
  const customRoot = String(body.customExportRoot ?? "").trim();
  if (destinationMode === "custom" && !customRoot) {
    throw new Error("Choose a custom export folder first.");
  }
  const exportRoot =
    destinationMode === "custom"
      ? path.resolve(customRoot)
      : path.join(projectRoot, "exports");
  await ensureDir(exportRoot);
  let targetDir = destinationMode === "custom" ? exportRoot : path.join(exportRoot, "sequence");
  const action = body.conflictAction ?? "replace";
  if (await pathExists(targetDir)) {
    if (action === "replace") {
      await fs.rm(targetDir, { recursive: true, force: true });
    } else if (action === "keep_both") {
      targetDir = await getUniquePath(targetDir);
    }
  }
  await ensureDir(targetDir);
  // Replace mode clears any leftovers from removed frames before writing current export.
  if (action === "replace") {
    await clearDirectoryContents(targetDir);
  }
  const filePrefix = sanitizeExportPrefix(String(body.frameFilePrefix ?? "")) || "frame_";

  const exportMulti = sequenceExports.length > 1;
  let exportedCount = 0;
  for (const sequence of sequenceExports) {
    const sequenceTargetDir = exportMulti
      ? path.join(targetDir, sequenceFolderName(sequence.title))
      : targetDir;
    if (exportMulti) {
      if (await pathExists(sequenceTargetDir)) {
        if (action === "replace") {
          await fs.rm(sequenceTargetDir, { recursive: true, force: true });
        }
      }
      await ensureDir(sequenceTargetDir);
      if (action === "replace") {
        await clearDirectoryContents(sequenceTargetDir);
      }
    }
    for (let index = 0; index < sequence.frameIdOrder.length; index += 1) {
      const frameId = sequence.frameIdOrder[index];
      const frame = framesById[frameId];
      const sourcePath =
        frame && typeof frame === "object" && !Array.isArray(frame) && typeof (frame as { sourcePath?: unknown }).sourcePath === "string"
          ? (frame as { sourcePath: string }).sourcePath
          : "";
      if (!sourcePath.trim()) {
        continue;
      }
      const sourceAbsolute = resolveSafePathInsideProject(projectRoot, sourcePath);
      const extension = path.extname(sourcePath).toLowerCase() || ".jpg";
      const targetFile = path.join(sequenceTargetDir, `${filePrefix}${String(index + 1).padStart(6, "0")}${extension}`);
      await fs.copyFile(sourceAbsolute, targetFile);
      exportedCount += 1;
    }
  }

  return {
    status: "ok",
    exportDir: targetDir,
    exportedCount
  } as const;
});

app.whenReady().then(() => {
  const appInfo = buildAppInfo(app.getVersion());
  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: formatReleaseVersionLabel(appInfo.semver),
    copyright: "Copyright © 2026 Jonan Steiner",
    authors: ["Jonan Steiner"],
    website: "https://jonan.space"
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      buildAppMenuTemplate({
        isMac: process.platform === "darwin",
        isDev: Boolean(process.env.ELECTRON_START_URL),
        appName: app.name
      })
    )
  );
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

let quitCleanupInFlight = false;
app.on("before-quit", (event) => {
  if (quitCleanupInFlight) {
    return;
  }
  quitCleanupInFlight = true;
  event.preventDefault();
  getCameraService()
    .dispose()
    .catch(() => {
      /* best effort */
    })
    .finally(() => {
      app.quit();
    });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
