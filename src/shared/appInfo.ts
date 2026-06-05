/** Display name for menus, About, and window title. */
export const APP_NAME = "Brick-Motion";

/** `project.json` schema version — bump only with migration code. */
export const PROJECT_FILE_SCHEMA_VERSION = 1 as const;

export type AppInfo = {
  name: typeof APP_NAME;
  /** Semver from package.json / Electron `app.getVersion()`. */
  semver: string;
  projectFileSchemaVersion: typeof PROJECT_FILE_SCHEMA_VERSION;
};

export const buildAppInfo = (semver: string): AppInfo => ({
  name: APP_NAME,
  semver: semver.trim() || "0.0.0",
  projectFileSchemaVersion: PROJECT_FILE_SCHEMA_VERSION
});

/** Primary user-facing label (Dragonframe / Resolve style). */
export const formatReleaseVersionLabel = (semver: string): string => `Version ${semver.trim() || "0.0.0"}`;

export const formatWindowTitle = (info: AppInfo): string => `${info.name} ${info.semver}`;

export type AboutVersionLines = {
  release: string;
  projectFileFormat: string;
};

export const formatAboutVersionLines = (info: AppInfo): AboutVersionLines => ({
  release: formatReleaseVersionLabel(info.semver),
  projectFileFormat: `Project file format version ${info.projectFileSchemaVersion}`
});
