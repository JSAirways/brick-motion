import { app } from "electron";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseAndValidateProject } from "../src/shared/validateProject";
import type { RecentProjectEntry } from "../src/shared/types/ipc";

const PROJECT_FILE_NAME = "project.json";
const MAX_RECENT_PROJECTS = 12;
const RECENT_PROJECTS_STORE_FILE = "recent-projects.json";

const resolveRecentProjectRoot = (recentEntryPath: string): string | null => {
  const normalized = path.resolve(recentEntryPath);
  const basename = path.basename(normalized).toLowerCase();
  if (basename === PROJECT_FILE_NAME.toLowerCase()) {
    return path.dirname(normalized);
  }
  return normalized;
};

export const createRecentProjectsService = (params: {
  ensureDir: (dirPath: string) => Promise<void>;
  writeJsonAtomic: (filePath: string, payload: unknown) => Promise<void>;
}) => {
  const { ensureDir, writeJsonAtomic } = params;

  const getRecentProjectsStorePath = (): string => path.join(app.getPath("userData"), RECENT_PROJECTS_STORE_FILE);

  const readRecentProjectRoots = async (): Promise<string[]> => {
    const storePath = getRecentProjectsStorePath();
    try {
      const raw = await fs.readFile(storePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .filter((row): row is string => typeof row === "string" && row.trim().length > 0)
        .map((row) => path.resolve(row));
    } catch {
      return [];
    }
  };

  const writeRecentProjectRoots = async (rows: string[]): Promise<void> => {
    const storePath = getRecentProjectsStorePath();
    await ensureDir(path.dirname(storePath));
    await writeJsonAtomic(storePath, rows.slice(0, MAX_RECENT_PROJECTS));
  };

  const addRecentProjectPath = async (projectPath: string): Promise<void> => {
    const projectRoot = path.resolve(projectPath);
    const current = await readRecentProjectRoots();
    const next = [projectRoot, ...current.filter((row) => path.resolve(row) !== projectRoot)];
    await writeRecentProjectRoots(next);
    const projectFilePath = path.join(projectRoot, PROJECT_FILE_NAME);
    app.addRecentDocument(projectFilePath);
  };

  const readRecentProjectEntry = async (projectRoot: string): Promise<RecentProjectEntry | null> => {
    const projectFilePath = path.join(projectRoot, PROJECT_FILE_NAME);
    let raw: string;
    try {
      raw = await fs.readFile(projectFilePath, "utf8");
    } catch {
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    const validated = parseAndValidateProject(parsed);
    if (!validated.ok) {
      return null;
    }
    const project = validated.project;
    const totalFrameCount = Object.values(project.sequencesById).reduce((sum, sequence) => {
      return sum + sequence.frameIdOrder.length;
    }, 0);
    return {
      projectPath: projectRoot,
      projectTitle: project.projectTitle,
      captureMode: project.captureMode ?? null,
      fps: project.fps ?? null,
      frameCount: totalFrameCount,
      createdAt: project.createdAt ?? null,
      updatedAt: project.updatedAt ?? null
    };
  };

  const listRecentProjects = async (): Promise<RecentProjectEntry[]> => {
    const storedRoots = await readRecentProjectRoots();
    const osRoots = app
      .getRecentDocuments()
      .map((entry) => resolveRecentProjectRoot(entry))
      .filter((entry): entry is string => Boolean(entry));
    const recentProjectRoots = [...storedRoots, ...osRoots]
      .map((entry) => path.resolve(entry))
      .filter((entry, index, rows) => rows.indexOf(entry) === index)
      .slice(0, MAX_RECENT_PROJECTS);
    const rows = await Promise.all(recentProjectRoots.map((projectRoot) => readRecentProjectEntry(projectRoot)));
    return rows.filter((row): row is RecentProjectEntry => row !== null);
  };

  return {
    addRecentProjectPath,
    listRecentProjects
  };
};
