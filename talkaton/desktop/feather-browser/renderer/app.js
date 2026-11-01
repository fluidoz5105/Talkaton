"use strict";

const tabsElement = document.querySelector("#tabs");
const omnibox = document.querySelector("#omnibox");
const omniboxForm = document.querySelector("#omnibox-form");
const backButton = document.querySelector("#back");
const forwardButton = document.querySelector("#forward");
const reloadButton = document.querySelector("#reload");
const homeButton = document.querySelector("#home");
const newTabButton = document.querySelector("#new-tab");
const menuButton = document.querySelector("#menu");
const downloadsButton = document.querySelector("#downloads");
const extensionsButton = document.querySelector("#extensions");
const downloadBadge = document.querySelector("#download-badge");
const downloadList = document.querySelector("#download-list");
const downloadEmpty = document.querySelector("#download-empty");
const extensionList = document.querySelector("#extension-list");
const extensionEmpty = document.querySelector("#extension-empty");
const clearDownloadsButton = document.querySelector("#clear-downloads");
const siteMark = document.querySelector("#site-mark");
const toast = document.querySelector("#toast");

const panels = {
  menu: document.querySelector("#menu-popover"),
  downloads: document.querySelector("#downloads-panel"),
  extensions: document.querySelector("#extensions-panel")
};
const panelHeights = { menu: 235, downloads: 390, extensions: 390 };

let state = { activeTabId: null, platform: "", tabs: [], downloads: [], extensions: [] };
let editingAddress = false;
let openPanelName = null;
let toastTimer = null;

function send(type, extra = {}) {
  window.feather.action({ type, ...extra });
}

function activeTab() {
  return state.tabs.find(tab => tab.id === state.activeTabId) || null;
}

function closePanels() {
  for (const panel of Object.values(panels)) panel.hidden = true;
  openPanelName = null;
  send("set-panel-inset", { height: 0 });
}

function togglePanel(name, forceOpen = false) {
  if (!panels[name]) return;
  if (openPanelName === name && !forceOpen) {
    closePanels();
    return;
  }
  for (const [panelName, panel] of Object.entries(panels)) panel.hidden = panelName !== name;
  openPanelName = name;
  send("set-panel-inset", { height: panelHeights[name] });
}

function tabElement(tab) {
  const element = document.createElement("div");
  element.className = `tab${tab.id === state.activeTabId ? " active" : ""}${tab.loading ? " loading" : ""}${tab.crashed ? " crashed" : ""}${tab.offline ? " offline" : ""}`;
  element.setAttribute("role", "tab");
  element.setAttribute("aria-selected", String(tab.id === state.activeTabId));
  element.dataset.tabId = String(tab.id);
  element.title = tab.title;

  const mark = document.createElement("span");
  mark.className = "tab-mark";
  mark.setAttribute("aria-hidden", "true");

  const title = document.createElement("span");
  title.className = "tab-title";
  title.textContent = tab.title;

  const close = document.createElement("button");
  close.className = "tab-close";
  close.type = "button";
  close.setAttribute("aria-label", `Close ${tab.title}`);
  close.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="m2.5 2.5 7 7m0-7-7 7"/></svg>';
  close.addEventListener("click", event => {
    event.stopPropagation();
    send("close-tab", { tabId: tab.id });
  });

  element.append(mark, title, close);
  element.addEventListener("pointerdown", () => {
    closePanels();
    send("activate-tab", { tabId: tab.id });
  });
  element.addEventListener("auxclick", event => {
    if (event.button === 1) send("close-tab", { tabId: tab.id });
  });
  return element;
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && size >= 1024; index += 1) {
    size /= 1024;
    unit = units[index];
  }
  return `${size >= 10 ? size.toFixed(0) : size.toFixed(1)} ${unit}`;
}

function rowButton(label, action, extra, danger = false) {
  const button = document.createElement("button");
  button.className = `row-button${danger ? " danger" : ""}`;
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", () => send(action, extra));
  return button;
}

function downloadElement(download) {
  const row = document.createElement("div");
  row.className = "download-row";

  const icon = document.createElement("div");
  icon.className = "row-icon";
  const extension = download.filename.includes(".") ? download.filename.split(".").pop() : "file";
  icon.textContent = String(extension).slice(0, 4);

  const copy = document.createElement("div");
  copy.className = "row-copy";
  const title = document.createElement("div");
  title.className = "row-title";
  title.textContent = download.filename;
  const subtitle = document.createElement("div");
  subtitle.className = "row-subtitle";

  if (download.state === "progressing") {
    const total = download.totalBytes ? ` of ${formatBytes(download.totalBytes)}` : "";
    const speed = download.speed ? ` · ${formatBytes(download.speed)}/s` : "";
    subtitle.textContent = download.paused ? `Paused at ${formatBytes(download.receivedBytes)}` : `${formatBytes(download.receivedBytes)}${total}${speed}`;
    const track = document.createElement("div");
    track.className = "progress-track";
    const bar = document.createElement("div");
    bar.className = "progress-bar";
    bar.style.width = `${download.totalBytes ? download.percent : 12}%`;
    track.append(bar);
    copy.append(title, subtitle, track);
  } else {
    const labels = { completed: "Finished", cancelled: "Cancelled", interrupted: "Interrupted" };
    subtitle.textContent = `${labels[download.state] || download.state}${download.totalBytes ? ` · ${formatBytes(download.totalBytes)}` : ""}`;
    copy.append(title, subtitle);
  }

  const actions = document.createElement("div");
  actions.className = "row-actions";
  if (download.state === "progressing") {
    actions.append(
      rowButton(download.paused ? "Resume" : "Pause", "toggle-download", { downloadId: download.id }),
      rowButton("Cancel", "cancel-download", { downloadId: download.id }, true)
    );
  } else if (download.state === "completed") {
    actions.append(rowButton("Open", "open-download", { downloadId: download.id }));
    if (download.hasPath) actions.append(rowButton("Show", "reveal-download", { downloadId: download.id }));
  } else if (download.hasPath) {
    actions.append(rowButton("Show", "reveal-download", { downloadId: download.id }));
  }

  row.append(icon, copy, actions);
  return row;
}

function extensionElement(extension) {
  const row = document.createElement("div");
  row.className = "extension-row";
  const icon = document.createElement("div");
  icon.className = "row-icon";
  icon.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7.5 4.5V3.3a2.2 2.2 0 1 1 4.4 0v1.2h3.6v3.6h1.2a2.2 2.2 0 1 1 0 4.4h-1.2v3h-4v1.2a2.2 2.2 0 1 1-4.4 0v-1.2H4.5v-3.6H3.3a2.2 2.2 0 1 1 0-4.4h1.2v-3z"/></svg>';
  const copy = document.createElement("div");
  copy.className = "row-copy";
  const title = document.createElement("div");
  title.className = "row-title";
  title.textContent = extension.name;
  const subtitle = document.createElement("div");
  subtitle.className = "row-subtitle";
  subtitle.textContent = `Version ${extension.version}`;
  copy.append(title, subtitle);
  const actions = document.createElement("div");
  actions.className = "row-actions";
  actions.append(rowButton("Remove", "remove-extension", { extensionId: extension.id }, true));
  row.append(icon, copy, actions);
  return row;
}

function render(nextState) {
  if (!nextState) return;
  state = nextState;
  document.body.className = `platform-${state.platform}`;
  tabsElement.replaceChildren(...state.tabs.map(tabElement));
  tabsElement.querySelector(".tab.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });

  downloadList.replaceChildren(...state.downloads.map(downloadElement));
  downloadEmpty.hidden = state.downloads.length > 0;
  downloadList.hidden = state.downloads.length === 0;
  clearDownloadsButton.disabled = !state.downloads.some(download => download.state !== "progressing");
  downloadBadge.hidden = !state.downloads.some(download => download.state === "progressing");

  extensionList.replaceChildren(...state.extensions.map(extensionElement));
  extensionEmpty.hidden = state.extensions.length > 0;
  extensionList.hidden = state.extensions.length === 0;

  const active = activeTab();
  if (!active) return;
  if (!editingAddress) omnibox.value = active.url;
  backButton.disabled = !active.canGoBack;
  forwardButton.disabled = !active.canGoForward;
  reloadButton.classList.toggle("is-loading", active.loading);
  reloadButton.title = active.loading ? "Stop" : active.offline ? "Try again" : "Reload";
  reloadButton.setAttribute("aria-label", reloadButton.title);
  siteMark.classList.toggle("secure", active.url.startsWith("https://") && !active.offline);
  siteMark.classList.toggle("offline", active.offline);
}

function focusOmnibox() {
  closePanels();
  omnibox.focus();
  omnibox.select();
}

function showNotice(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3200);
}

omniboxForm.addEventListener("submit", event => {
  event.preventDefault();
  closePanels();
  send("navigate", { value: omnibox.value });
  editingAddress = false;
  omnibox.blur();
  send("focus-page");
});
omnibox.addEventListener("focus", () => {
  editingAddress = true;
  omnibox.select();
});
omnibox.addEventListener("blur", () => {
  editingAddress = false;
  const active = activeTab();
  if (active) omnibox.value = active.url;
});

backButton.addEventListener("click", () => send("back"));
forwardButton.addEventListener("click", () => send("forward"));
reloadButton.addEventListener("click", () => send(activeTab()?.loading ? "stop" : "reload"));
homeButton.addEventListener("click", () => send("home"));
newTabButton.addEventListener("click", () => send("new-tab"));
menuButton.addEventListener("click", event => { event.stopPropagation(); togglePanel("menu"); });
downloadsButton.addEventListener("click", event => { event.stopPropagation(); togglePanel("downloads"); });
extensionsButton.addEventListener("click", event => { event.stopPropagation(); togglePanel("extensions"); });
clearDownloadsButton.addEventListener("click", () => send("clear-downloads"));

for (const panel of Object.values(panels)) {
  panel.addEventListener("click", event => {
    const openButton = event.target.closest("[data-open-panel]");
    if (openButton) {
      togglePanel(openButton.dataset.openPanel, true);
      return;
    }
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "install-extension") closePanels();
    send(action);
    if (panels.menu.contains(button)) closePanels();
  });
}

document.addEventListener("pointerdown", event => {
  if (!openPanelName) return;
  const clickedPanel = panels[openPanelName]?.contains(event.target);
  const clickedTrigger = event.target.closest("#menu, #downloads, #extensions");
  if (!clickedPanel && !clickedTrigger) closePanels();
});
document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  if (openPanelName) closePanels();
  else if (document.activeElement === omnibox) {
    omnibox.blur();
    send("focus-page");
  }
});

window.feather.onState(render);
window.feather.onFocusOmnibox(focusOmnibox);
window.feather.onNotice(showNotice);
window.feather.getState().then(render);
