import { desktopMenuChannels, type DesktopMenuChannel } from "@harness/shared";
import { app, Menu, type BrowserWindow, type MenuItemConstructorOptions } from "electron";

/** Channels emitted by this module — kept in sync with `@harness/shared` desktopMenuChannels. */
export const mainProcessMenuChannels = desktopMenuChannels;

export function buildAppMenu(getWindow: () => BrowserWindow | null): void {
  const isMac = process.platform === "darwin";

  const send = (channel: DesktopMenuChannel): void => {
    const w = getWindow();
    if (w) w.webContents.send(channel);
  };

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              {
                label: "Preferences…",
                accelerator: "Cmd+,",
                click: () => send("menu:preferences"),
              },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "New Agent",
          accelerator: "CmdOrCtrl+N",
          click: () => send("menu:new-agent"),
        },
        {
          label: "Open Workspace…",
          accelerator: "CmdOrCtrl+O",
          click: () => send("menu:open-workspace"),
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Toggle Code Pane",
          accelerator: "CmdOrCtrl+J",
          click: () => send("menu:toggle-code-pane"),
        },
        { type: "separator" },
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: isMac
        ? [
            { role: "minimize" },
            { role: "zoom" },
            { type: "separator" },
            { role: "front" },
          ]
        : [{ role: "minimize" }, { role: "close" }],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
