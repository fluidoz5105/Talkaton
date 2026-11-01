const { app, BrowserWindow, Menu, session, shell } = require("electron");
const path = require("node:path");

const TALKATON_URL = "https://talkaton.org/chat?desktop=1";
const TALKATON_ORIGIN = "https://talkaton.org";
const TRUSTED_AUTH_HOSTS = new Set([
  "talkaton.org",
  "www.talkaton.org",
  "subscriptions.talkaton.org",
  "cxulgeojkjnskdyoktkj.supabase.co",
  "accounts.google.com",
  "accounts.youtube.com"
]);

let mainWindow = null;

function isSafeExternalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "mailto:";
  } catch {
    return false;
  }
}

function isTrustedNavigation(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (
      TRUSTED_AUTH_HOSTS.has(url.hostname)
      || url.hostname.endsWith(".google.com")
      || url.hostname.endsWith(".googleusercontent.com")
    );
  } catch {
    return false;
  }
}

function configurePermissions() {
  const allowedPermissions = new Set(["media", "notifications", "clipboard-sanitized-write"]);
  const isTalkatonRequest = value => {
    try {
      return new URL(value).origin === TALKATON_ORIGIN;
    } catch {
      return false;
    }
  };

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl = details.requestingUrl || webContents.getURL();
    callback(isTalkatonRequest(requestingUrl) && allowedPermissions.has(permission));
  });

  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => (
    isTalkatonRequest(requestingOrigin || webContents?.getURL() || "")
    && allowedPermissions.has(permission)
  ));
}

function installMenu() {
  const template = [
    ...(process.platform === "darwin" ? [{
      label: "Talkaton",
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { type: "separator" },
        { role: "quit" }
      ]
    }] : []),
    {
      label: "Edit",
      submenu: [
        { role: "undo" }, { role: "redo" }, { type: "separator" },
        { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }
      ]
    },
    {
      label: "View",
      submenu: [
        { role: "reload" }, { role: "forceReload" }, { type: "separator" },
        { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
        { type: "separator" }, { role: "togglefullscreen" }
      ]
    },
    { label: "Window", submenu: [{ role: "minimize" }, { role: "close" }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 620,
    show: false,
    backgroundColor: "#09090b",
    title: "Talkaton",
    autoHideMenuBar: process.platform !== "darwin",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: true,
      safeDialogs: true
    }
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isTrustedNavigation(url)) return;
    event.preventDefault();
    if (isSafeExternalUrl(url)) shell.openExternal(url);
  });
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, _description, validatedUrl, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 || !validatedUrl.startsWith("https://talkaton.org")) return;
    mainWindow?.loadFile(path.join(__dirname, "offline.html"));
  });
  mainWindow.webContents.setUserAgent(`${mainWindow.webContents.getUserAgent()} TalkatonDesktop/1.0.0`);
  mainWindow.on("closed", () => { mainWindow = null; });
  mainWindow.loadURL(TALKATON_URL);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(() => {
    configurePermissions();
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
