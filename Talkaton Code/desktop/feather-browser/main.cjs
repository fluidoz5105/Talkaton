"use strict";

const { app, BrowserWindow, Menu, WebContentsView, dialog, ipcMain, session, shell } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { isExternalUrl, isWebUrl, toNavigableUrl } = require("./shared.cjs");

const APP_NAME = "Feather Browser";
const CHROME_HEIGHT = 104;
const MAX_PANEL_HEIGHT = 390;
const MAX_LIVE_TABS = 12;
const NEW_TAB_FILE = path.join(__dirname, "newtab.html");
const OFFLINE_FILE = path.join(__dirname, "offline.html");
const SMOKE_TEST = process.argv.includes("--smoke-test");
const SMOKE_EXPECT_EXTENSION = process.argv.includes("--expect-extension");
const SMOKE_DOWNLOAD_URL = process.argv.find(value => value.startsWith("--smoke-download-url="))?.split("=").slice(1).join("=") || "";
const SMOKE_OFFLINE_URL = process.argv.find(value => value.startsWith("--smoke-offline-url="))?.split("=").slice(1).join("=") || "";

app.setName(APP_NAME);
app.commandLine.appendSwitch("disk-cache-size", String(64 * 1024 * 1024));
app.commandLine.appendSwitch("media-cache-size", String(32 * 1024 * 1024));

let mainWindow = null;
let tabs = [];
let activeTabId = null;
let nextTabId = 1;
let closedUrls = [];
let panelInset = 0;
let downloads = [];
let nextDownloadId = 1;
let extensionRecords = [];
let statePublishTimer = null;

function currentTab() {
  return tabs.find(tab => tab.id === activeTabId) || null;
}

function displayUrl(tab) {
  if (tab.failedUrl) return tab.failedUrl;
  const url = tab.view.webContents.getURL();
  return !url || url.startsWith("file:") ? "" : url;
}

function publicDownloads() {
  return downloads.map(({ item: _item, savePath, ...download }) => ({ ...download, hasPath: Boolean(savePath) }));
}

function publicExtensions() {
  return extensionRecords.map(({ id, name, version }) => ({ id, name, version }));
}

function publicState() {
  return {
    activeTabId,
    platform: process.platform,
    downloads: publicDownloads(),
    extensions: publicExtensions(),
    tabs: tabs.map(tab => {
      const contents = tab.view.webContents;
      return {
        id: tab.id,
        title: tab.title || "New tab",
        url: displayUrl(tab),
        loading: tab.loading,
        canGoBack: contents.navigationHistory.canGoBack(),
        canGoForward: contents.navigationHistory.canGoForward(),
        crashed: Boolean(tab.crashed),
        offline: Boolean(tab.offline)
      };
    })
  };
}

function publishState() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoadingMainFrame()) return;
  mainWindow.webContents.send("browser:state", publicState());
}

function scheduleStatePublish() {
  if (statePublishTimer) return;
  statePublishTimer = setTimeout(() => {
    statePublishTimer = null;
    publishState();
  }, 120);
}

function notify(message) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("browser:notice", String(message));
}

function setTabBounds(tab) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const [width, height] = mainWindow.getContentSize();
  const top = CHROME_HEIGHT + panelInset;
  tab.view.setBounds({ x: 0, y: top, width, height: Math.max(0, height - top) });
}

function layoutTabs() {
  for (const tab of tabs) setTabBounds(tab);
}

function pageTitle(tab, title) {
  const trimmed = String(title || "").trim();
  tab.title = trimmed && trimmed !== "newtab.html" ? trimmed : "New tab";
}

function loadTab(tab, rawUrl) {
  const contents = tab.view.webContents;
  tab.crashed = false;
  tab.offline = false;
  tab.failedUrl = null;
  if (!rawUrl) return contents.loadFile(NEW_TAB_FILE).catch(() => {});

  const url = toNavigableUrl(rawUrl);
  if (!url) return Promise.resolve();
  return contents.loadURL(url).catch(() => {});
}

function configureTab(tab) {
  const contents = tab.view.webContents;

  contents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) createTab(url, true);
    else if (isExternalUrl(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  contents.on("will-navigate", (event, url) => {
    if (isWebUrl(url)) return;
    event.preventDefault();
    if (isExternalUrl(url)) shell.openExternal(url);
  });
  contents.on("page-title-updated", (_event, title) => {
    if (tab.offline) return;
    pageTitle(tab, title);
    publishState();
  });
  contents.on("did-start-loading", () => {
    tab.loading = true;
    publishState();
  });
  contents.on("did-stop-loading", () => {
    tab.loading = false;
    publishState();
  });
  contents.on("did-navigate", publishState);
  contents.on("did-navigate-in-page", publishState);
  contents.on("did-start-navigation", (_event, details) => {
    if (!details.isMainFrame || !isWebUrl(details.url)) return;
    tab.offline = false;
    tab.failedUrl = null;
    publishState();
  });
  contents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 || !isWebUrl(validatedUrl)) return;
    tab.loading = false;
    tab.offline = true;
    tab.failedUrl = validatedUrl;
    tab.title = "Site unavailable";
    contents.loadFile(OFFLINE_FILE, {
      query: { url: validatedUrl, code: String(errorCode), reason: errorDescription }
    }).catch(() => {});
    publishState();
  });
  contents.on("render-process-gone", () => {
    tab.loading = false;
    tab.crashed = true;
    tab.title = "Tab crashed";
    publishState();
  });
  contents.on("before-input-event", (event, input) => handleShortcut(event, input));
}

function createTab(rawUrl = "", activate = true, insertAt = tabs.length) {
  if (tabs.length >= MAX_LIVE_TABS) {
    notify(`${APP_NAME} keeps at most ${MAX_LIVE_TABS} live tabs.`);
    return null;
  }

  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: true,
      safeDialogs: true,
      backgroundThrottling: true
    }
  });
  view.setBackgroundColor("#ffffff");

  const tab = { id: nextTabId++, view, title: "New tab", loading: false, crashed: false, offline: false, failedUrl: null };
  tabs.splice(Math.max(0, Math.min(insertAt, tabs.length)), 0, tab);
  mainWindow.contentView.addChildView(view);
  configureTab(tab);
  setTabBounds(tab);

  if (activate) activateTab(tab.id);
  else view.setVisible(false);
  loadTab(tab, rawUrl);
  publishState();
  return tab;
}

function activateTab(tabId) {
  const target = tabs.find(tab => tab.id === Number(tabId));
  if (!target) return;
  activeTabId = target.id;
  for (const tab of tabs) tab.view.setVisible(tab === target);
  setTabBounds(target);
  target.view.webContents.focus();
  publishState();
}

function closeTab(tabId = activeTabId) {
  const index = tabs.findIndex(tab => tab.id === Number(tabId));
  if (index < 0) return;

  const [tab] = tabs.splice(index, 1);
  const url = displayUrl(tab);
  if (url) closedUrls = [url, ...closedUrls].slice(0, 10);
  mainWindow.contentView.removeChildView(tab.view);
  tab.view.webContents.close();

  if (!tabs.length) {
    createTab();
    return;
  }
  if (tab.id === activeTabId) activateTab(tabs[Math.min(index, tabs.length - 1)].id);
  else publishState();
}

function moveTab(tabId, direction) {
  const index = tabs.findIndex(tab => tab.id === Number(tabId));
  const nextIndex = Math.max(0, Math.min(tabs.length - 1, index + Math.sign(direction)));
  if (index < 0 || index === nextIndex) return;
  const [tab] = tabs.splice(index, 1);
  tabs.splice(nextIndex, 0, tab);
  publishState();
}

function cycleTab(direction) {
  if (tabs.length < 2) return;
  const index = tabs.findIndex(tab => tab.id === activeTabId);
  activateTab(tabs[(index + direction + tabs.length) % tabs.length].id);
}

function reopenClosedTab() {
  const url = closedUrls.shift();
  if (url) createTab(url);
}

function navigateActive(rawUrl) {
  const tab = currentTab();
  if (!tab) return;
  const url = toNavigableUrl(rawUrl);
  if (url) tab.view.webContents.loadURL(url).catch(() => {});
}

function focusOmnibox() {
  mainWindow?.webContents.send("browser:focus-omnibox");
}

function downloadById(downloadId) {
  return downloads.find(download => download.id === Number(downloadId)) || null;
}

function updateDownload(record, item) {
  record.state = item.getState();
  record.receivedBytes = item.getReceivedBytes();
  record.totalBytes = item.getTotalBytes();
  record.percent = record.totalBytes > 0 ? Math.min(100, Math.round((record.receivedBytes / record.totalBytes) * 100)) : 0;
  record.speed = item.getCurrentBytesPerSecond();
  record.paused = item.isPaused();
  record.savePath = item.getSavePath() || record.savePath;
  scheduleStatePublish();
}

function configureDownloads(browserSession) {
  browserSession.on("will-download", (_event, item) => {
    const record = {
      id: nextDownloadId++,
      item,
      filename: item.getFilename(),
      url: item.getURL(),
      state: "progressing",
      receivedBytes: 0,
      totalBytes: item.getTotalBytes(),
      percent: 0,
      speed: 0,
      paused: false,
      savePath: "",
      startedAt: Date.now()
    };

    if (SMOKE_TEST) item.setSavePath(path.join(app.getPath("temp"), `feather-smoke-${process.pid}-${record.filename}`));
    else {
      item.setSaveDialogOptions({
        title: `Download ${record.filename}`,
        buttonLabel: "Download",
        defaultPath: path.join(app.getPath("downloads"), record.filename)
      });
    }
    downloads = [record, ...downloads].slice(0, 50);
    publishState();

    item.on("updated", () => updateDownload(record, item));
    item.once("done", (_downloadEvent, state) => {
      updateDownload(record, item);
      record.state = state;
      record.speed = 0;
      record.paused = false;
      record.savePath = item.getSavePath() || record.savePath;
      record.item = null;
      publishState();
      if (state === "completed") notify(`${record.filename} finished downloading.`);
      if (SMOKE_TEST && record.savePath) fs.unlink(record.savePath).catch(() => {});
    });
  });
}

async function runDownloadAction(action) {
  if (action.type === "open-downloads-folder") {
    const error = await shell.openPath(app.getPath("downloads"));
    if (error) notify(error);
    return;
  }
  if (action.type === "clear-downloads") {
    downloads = downloads.filter(download => download.state === "progressing");
    publishState();
    return;
  }

  const record = downloadById(action.downloadId);
  if (!record) return;
  if (action.type === "toggle-download" && record.item) {
    if (record.item.isPaused() && record.item.canResume()) record.item.resume();
    else if (!record.item.isPaused()) record.item.pause();
    updateDownload(record, record.item);
  } else if (action.type === "cancel-download" && record.item) {
    record.item.cancel();
  } else if (action.type === "open-download" && record.state === "completed" && record.savePath) {
    const error = await shell.openPath(record.savePath);
    if (error) notify(error);
  } else if (action.type === "reveal-download" && record.savePath) {
    shell.showItemInFolder(record.savePath);
  }
}

function extensionSettingsPath() {
  return path.join(app.getPath("userData"), "extensions.json");
}

async function saveExtensionSettings() {
  const payload = JSON.stringify({ paths: extensionRecords.map(extension => extension.path) }, null, 2);
  await fs.writeFile(extensionSettingsPath(), payload, "utf8");
}

async function loadExtensionPath(extensionPath) {
  const loaded = await session.defaultSession.extensions.loadExtension(extensionPath, { allowFileAccess: false });
  return { id: loaded.id, name: loaded.name, version: loaded.version, path: extensionPath };
}

async function restoreExtensions() {
  let storedPaths = [];
  try {
    const stored = JSON.parse(await fs.readFile(extensionSettingsPath(), "utf8"));
    if (Array.isArray(stored.paths)) storedPaths = stored.paths.filter(value => typeof value === "string");
  } catch (error) {
    if (error?.code !== "ENOENT") console.warn("Could not read extension settings:", error.message);
  }

  for (const extensionPath of storedPaths) {
    try {
      extensionRecords.push(await loadExtensionPath(extensionPath));
    } catch (error) {
      console.warn(`Could not restore extension at ${extensionPath}:`, error.message);
    }
  }
  if (extensionRecords.length !== storedPaths.length) await saveExtensionSettings();
}

async function installUnpackedExtension() {
  if (!mainWindow) return;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Install unpacked Chromium extension",
    buttonLabel: "Install Extension",
    message: "Choose the folder that contains manifest.json.",
    properties: ["openDirectory", "dontAddToRecent"]
  });
  if (result.canceled || !result.filePaths[0]) return;

  const extensionPath = result.filePaths[0];
  if (extensionRecords.some(extension => extension.path === extensionPath)) {
    notify("That extension is already installed.");
    return;
  }

  try {
    await fs.access(path.join(extensionPath, "manifest.json"));
    const extension = await loadExtensionPath(extensionPath);
    extensionRecords.push(extension);
    await saveExtensionSettings();
    publishState();
    notify(`${extension.name} installed. Reload open pages to apply it.`);
  } catch (error) {
    await dialog.showMessageBox(mainWindow, {
      type: "error",
      title: "Extension could not be installed",
      message: "Choose an unpacked Chromium extension folder containing a valid manifest.json.",
      detail: error.message
    });
  }
}

async function removeExtension(extensionId) {
  const index = extensionRecords.findIndex(extension => extension.id === String(extensionId));
  if (index < 0) return;
  const [extension] = extensionRecords.splice(index, 1);
  session.defaultSession.extensions.removeExtension(extension.id);
  await saveExtensionSettings();
  publishState();
  notify(`${extension.name} removed.`);
}

function setPanelInset(value) {
  const next = Math.max(0, Math.min(MAX_PANEL_HEIGHT, Number(value) || 0));
  if (next === panelInset) return;
  panelInset = next;
  layoutTabs();
}

function handleShortcut(event, input) {
  if (input.type !== "keyDown") return;
  const command = process.platform === "darwin" ? input.meta : input.control;
  const key = String(input.key || "").toLowerCase();
  let handled = true;

  if (command && key === "l") focusOmnibox();
  else if (command && input.shift && key === "t") reopenClosedTab();
  else if (command && key === "t") createTab();
  else if (command && key === "w") closeTab();
  else if (command && key === "r") currentTab()?.view.webContents.reload();
  else if (input.control && key === "tab") cycleTab(input.shift ? -1 : 1);
  else if (input.alt && key === "left") currentTab()?.view.webContents.navigationHistory.goBack();
  else if (input.alt && key === "right") currentTab()?.view.webContents.navigationHistory.goForward();
  else handled = false;

  if (handled) event.preventDefault();
}

function handleAction(action) {
  if (!action || typeof action.type !== "string") return;
  const tab = currentTab();

  switch (action.type) {
    case "new-tab": createTab(); break;
    case "activate-tab": activateTab(action.tabId); break;
    case "close-tab": closeTab(action.tabId); break;
    case "move-tab": moveTab(action.tabId, action.direction); break;
    case "navigate": navigateActive(action.value); break;
    case "back": if (tab?.view.webContents.navigationHistory.canGoBack()) tab.view.webContents.navigationHistory.goBack(); break;
    case "forward": if (tab?.view.webContents.navigationHistory.canGoForward()) tab.view.webContents.navigationHistory.goForward(); break;
    case "reload": if (tab?.failedUrl) loadTab(tab, tab.failedUrl); else tab?.view.webContents.reload(); break;
    case "stop": tab?.view.webContents.stop(); break;
    case "home": loadTab(tab, ""); break;
    case "reopen-tab": reopenClosedTab(); break;
    case "focus-page": tab?.view.webContents.focus(); break;
    case "set-panel-inset": setPanelInset(action.height); break;
    case "install-extension": installUnpackedExtension().catch(error => notify(error.message)); break;
    case "remove-extension": removeExtension(action.extensionId).catch(error => notify(error.message)); break;
    case "toggle-download":
    case "cancel-download":
    case "open-download":
    case "reveal-download":
    case "clear-downloads":
    case "open-downloads-folder": runDownloadAction(action).catch(error => notify(error.message)); break;
    default: break;
  }
}

function installMenu() {
  const template = [
    ...(process.platform === "darwin" ? [{
      label: APP_NAME,
      submenu: [{ role: "about" }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { type: "separator" }, { role: "quit" }]
    }] : []),
    { label: "File", submenu: [
      { label: "New Tab", accelerator: "CmdOrCtrl+T", click: () => createTab() },
      { label: "Reopen Closed Tab", accelerator: "CmdOrCtrl+Shift+T", click: reopenClosedTab },
      { type: "separator" },
      { label: "Close Tab", accelerator: "CmdOrCtrl+W", click: () => closeTab() }
    ] },
    { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: "View", submenu: [{ role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }] },
    { label: "Tools", submenu: [
      { label: "Open Downloads Folder", click: () => runDownloadAction({ type: "open-downloads-folder" }) },
      { label: "Install Unpacked Extension…", click: installUnpackedExtension }
    ] },
    { label: "Window", submenu: [{ role: "minimize" }, { role: "close" }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function configureSession() {
  const lowRiskPermissions = new Set(["clipboard-sanitized-write", "fullscreen"]);
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(lowRiskPermissions.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_contents, permission) => lowRiskPermissions.has(permission));
  configureDownloads(session.defaultSession);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 520,
    show: false,
    backgroundColor: "#f5f7f6",
    title: APP_NAME,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    autoHideMenuBar: process.platform !== "darwin",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.webContents.on("before-input-event", (event, input) => handleShortcut(event, input));
  mainWindow.webContents.on("did-finish-load", () => {
    publishState();
    if (!SMOKE_TEST) return;
    if (SMOKE_DOWNLOAD_URL) currentTab()?.view.webContents.downloadURL(SMOKE_DOWNLOAD_URL);
    if (SMOKE_OFFLINE_URL) loadTab(currentTab(), SMOKE_OFFLINE_URL);
    const deadline = Date.now() + 10_000;
    const checkSmokeState = () => {
      const state = publicState();
      const initialized = state.tabs.length === 1 && state.activeTabId === state.tabs[0]?.id;
      const extensionReady = !SMOKE_EXPECT_EXTENSION || state.extensions.length > 0;
      const downloadReady = !SMOKE_DOWNLOAD_URL || state.downloads.some(download => download.state === "completed");
      const offlineReady = !SMOKE_OFFLINE_URL || state.tabs[0]?.offline;
      const downloadFailed = state.downloads.some(download => download.state === "cancelled" || download.state === "interrupted");
      if ((!downloadReady || !offlineReady) && !downloadFailed && Date.now() < deadline) {
        setTimeout(checkSmokeState, 100);
        return;
      }
      const passed = initialized && extensionReady && downloadReady && offlineReady && !downloadFailed;
      console.log(`FEATHER_SMOKE_${passed ? "OK" : "FAILED"}`);
      app.exit(passed ? 0 : 1);
    };
    setTimeout(checkSmokeState, 300);
  });
  mainWindow.on("resize", layoutTabs);
  mainWindow.on("maximize", layoutTabs);
  mainWindow.on("unmaximize", layoutTabs);
  mainWindow.on("closed", () => {
    for (const tab of tabs) {
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    }
    mainWindow = null;
    tabs = [];
    activeTabId = null;
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  createTab();
}

ipcMain.handle("browser:get-state", event => {
  if (event.sender !== mainWindow?.webContents) return null;
  return publicState();
});
ipcMain.on("browser:action", (event, action) => {
  if (event.sender === mainWindow?.webContents) handleAction(action);
});

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.whenReady().then(async () => {
    configureSession();
    await restoreExtensions();
    installMenu();
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
