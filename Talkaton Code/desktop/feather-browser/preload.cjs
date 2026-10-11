"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("feather", {
  getState: () => ipcRenderer.invoke("browser:get-state"),
  action: action => ipcRenderer.send("browser:action", action),
  onState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("browser:state", listener);
    return () => ipcRenderer.removeListener("browser:state", listener);
  },
  onFocusOmnibox: callback => {
    const listener = () => callback();
    ipcRenderer.on("browser:focus-omnibox", listener);
    return () => ipcRenderer.removeListener("browser:focus-omnibox", listener);
  },
  onNotice: callback => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on("browser:notice", listener);
    return () => ipcRenderer.removeListener("browser:notice", listener);
  }
});
