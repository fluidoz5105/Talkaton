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
const menuPopover = document.querySelector("#menu-popover");
const siteMark = document.querySelector("#site-mark");
const toast = document.querySelector("#toast");

let state = { activeTabId: null, platform: "", tabs: [] };
let editingAddress = false;
let toastTimer = null;

function send(type, extra = {}) {
  window.feather.action({ type, ...extra });
}

function activeTab() {
  return state.tabs.find(tab => tab.id === state.activeTabId) || null;
}

function tabElement(tab) {
  const element = document.createElement("div");
  element.className = `tab${tab.id === state.activeTabId ? " active" : ""}${tab.loading ? " loading" : ""}${tab.crashed ? " crashed" : ""}`;
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
  element.addEventListener("pointerdown", () => send("activate-tab", { tabId: tab.id }));
  element.addEventListener("auxclick", event => {
    if (event.button === 1) send("close-tab", { tabId: tab.id });
  });
  return element;
}

function render(nextState) {
  if (!nextState) return;
  state = nextState;
  document.body.className = `platform-${state.platform}`;
  tabsElement.replaceChildren(...state.tabs.map(tabElement));

  const active = activeTab();
  if (!active) return;
  if (!editingAddress) omnibox.value = active.url;
  backButton.disabled = !active.canGoBack;
  forwardButton.disabled = !active.canGoForward;
  reloadButton.classList.toggle("is-loading", active.loading);
  reloadButton.title = active.loading ? "Stop" : "Reload";
  reloadButton.setAttribute("aria-label", active.loading ? "Stop loading" : "Reload");
  siteMark.classList.toggle("secure", active.url.startsWith("https://"));
}

function focusOmnibox() {
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
menuButton.addEventListener("click", event => {
  event.stopPropagation();
  menuPopover.hidden = !menuPopover.hidden;
});
menuPopover.addEventListener("click", event => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  send(button.dataset.action);
  menuPopover.hidden = true;
});
document.addEventListener("pointerdown", event => {
  if (!menuPopover.hidden && !menuPopover.contains(event.target)) menuPopover.hidden = true;
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && document.activeElement === omnibox) {
    omnibox.blur();
    send("focus-page");
  }
});

window.feather.onState(render);
window.feather.onFocusOmnibox(focusOmnibox);
window.feather.onNotice(showNotice);
window.feather.getState().then(render);
