const status = document.getElementById("codeInstallStatus");
const primary = document.getElementById("installCodeatonBtn");
const isWindows = /Windows/i.test(navigator.userAgent);
const isMac = /Macintosh|Mac OS X/i.test(navigator.userAgent);

if (isWindows) {
  primary.href = "/downloads/installers/Codeaton-1.0.0-windows-x64-setup.exe";
  primary.download = "Codeaton-1.0.0-windows-x64-setup.exe";
  primary.firstChild.textContent = "Download for Windows ";
  status.textContent = "Windows detected · downloading a real 64-bit .exe installer.";
} else if (isMac) {
  status.textContent = "macOS detected · downloading a Universal .dmg for Apple Silicon or Intel.";
} else {
  status.textContent = "Choose the macOS .dmg or Windows .exe below.";
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/codeaton/sw.js", { scope: "/codeaton/" }).catch(() => {});
