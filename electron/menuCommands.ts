import { BrowserWindow } from "electron";
import type { MenuItemConstructorOptions, WebContents } from "electron";
import type { MenuCommandId } from "../src/shared/types/ipc";

type MenuPayload = { projectPath?: string; source?: "menu" };

export const sendMenuCommandToFocusedWindow = (commandId: MenuCommandId, payload?: MenuPayload): void => {
  const focused = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const targetWebContents: WebContents | undefined = focused?.webContents;
  if (!targetWebContents || targetWebContents.isDestroyed()) {
    return;
  }
  targetWebContents.send("menu:command", {
    id: commandId,
    payload: payload ?? null
  });
};

export const buildAppMenuTemplate = (params: {
  isMac: boolean;
  isDev: boolean;
  appName: string;
}): MenuItemConstructorOptions[] => {
  const { isMac, isDev, appName } = params;
  const send = (commandId: MenuCommandId, payload?: MenuPayload) =>
    sendMenuCommandToFocusedWindow(commandId, payload);

  const fileMenu: MenuItemConstructorOptions = {
    label: "Project",
    submenu: [
      { label: "New Project", accelerator: "CmdOrCtrl+N", click: () => send("file:new-project") },
      { label: "Open Project...", accelerator: "CmdOrCtrl+O", click: () => send("file:open-project") },
      { type: "separator" },
      { label: "Project Settings", accelerator: "CmdOrCtrl+,", click: () => send("file:project-settings") },
      { label: "Export...", accelerator: "CmdOrCtrl+E", click: () => send("file:export-sequence") },
      { label: "Back to Home", accelerator: "CmdOrCtrl+W", click: () => send("file:close-project") },
      { type: "separator" },
      isMac ? { role: "close" } : { role: "quit" }
    ]
  };
  const frameMenu: MenuItemConstructorOptions = {
    label: "Frame",
    submenu: [
      { label: "Capture Frame", accelerator: "C", click: () => send("frame:capture") },
      { label: "Duplicate Frame(s)", accelerator: "CmdOrCtrl+D", click: () => send("frame:duplicate") },
      { label: "Delete Frame(s)", accelerator: "Delete", click: () => send("frame:delete") },
      { type: "separator" },
      { label: "Undo", accelerator: "CmdOrCtrl+Z", click: () => send("frame:undo") },
      { label: "Redo", accelerator: "CmdOrCtrl+Shift+Z", click: () => send("frame:redo") },
      { type: "separator" },
      { label: "Jump to Live", click: () => send("frame:jump-live") }
    ]
  };
  const sequenceMenu: MenuItemConstructorOptions = {
    label: "Sequence",
    submenu: [
      { label: "New Sequence", accelerator: "CmdOrCtrl+Shift+N", click: () => send("sequence:new") },
      { label: "Duplicate Sequence", accelerator: "CmdOrCtrl+Shift+D", click: () => send("sequence:duplicate") },
      { label: "Rename Sequence", accelerator: "F2", click: () => send("sequence:rename") },
      { label: "Delete Sequence", accelerator: "CmdOrCtrl+Shift+Backspace", click: () => send("sequence:delete") },
      { type: "separator" },
      { label: "Previous Sequence", accelerator: "CmdOrCtrl+Alt+Left", click: () => send("sequence:previous") },
      { label: "Next Sequence", accelerator: "CmdOrCtrl+Alt+Right", click: () => send("sequence:next") },
      { type: "separator" },
      { label: "Open Sequence Manager", accelerator: "CmdOrCtrl+Shift+S", click: () => send("sequence:open-manager") }
    ]
  };
  const playbackMenu: MenuItemConstructorOptions = {
    label: "Playback",
    submenu: [
      { label: "Play/Pause", accelerator: "Space", click: () => send("playback:toggle") },
      { label: "Play Reverse", accelerator: "J", click: () => send("playback:reverse") },
      { label: "Stop", accelerator: "K", click: () => send("playback:stop") },
      { label: "Toggle Loop", click: () => send("playback:toggle-loop") },
      { type: "separator" },
      { label: "Previous Frame", accelerator: "Left", click: () => send("playback:prev-frame") },
      { label: "Next Frame", accelerator: "Right", click: () => send("playback:next-frame") },
      { label: "First Frame", accelerator: "Home", click: () => send("playback:home") },
      { label: "Last Frame", accelerator: "End", click: () => send("playback:end") }
    ]
  };
  const viewMenu: MenuItemConstructorOptions = {
    label: "View",
    submenu: [
      { role: "togglefullscreen" },
      ...(isDev
        ? ([
            { type: "separator" },
            { role: "reload" },
            { role: "forceReload" },
            { role: "toggleDevTools" }
          ] as MenuItemConstructorOptions[])
        : [])
    ]
  };
  const template: MenuItemConstructorOptions[] = [];
  if (isMac) {
    template.push({
      label: appName,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" }
      ]
    });
  }
  template.push(fileMenu, sequenceMenu, frameMenu, playbackMenu, viewMenu);
  if (isMac) {
    template.push({ role: "windowMenu" });
  }
  return template;
};
