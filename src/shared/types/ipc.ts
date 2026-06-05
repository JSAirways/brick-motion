export type MenuCommandId =
  | "file:new-project"
  | "file:open-project"
  | "file:project-settings"
  | "file:export-sequence"
  | "file:close-project"
  | "sequence:new"
  | "sequence:duplicate"
  | "sequence:rename"
  | "sequence:delete"
  | "sequence:next"
  | "sequence:previous"
  | "sequence:open-manager"
  | "frame:capture"
  | "frame:duplicate"
  | "frame:delete"
  | "frame:undo"
  | "frame:redo"
  | "frame:jump-live"
  | "playback:toggle"
  | "playback:reverse"
  | "playback:stop"
  | "playback:toggle-loop"
  | "playback:prev-frame"
  | "playback:next-frame"
  | "playback:home"
  | "playback:end";

export interface MenuCommandEvent {
  id: MenuCommandId;
  payload: { projectPath?: string; source?: "menu" } | null;
}

export interface RecentProjectEntry {
  projectPath: string;
  projectTitle: string;
  captureMode: string | null;
  fps: number | null;
  frameCount: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}
