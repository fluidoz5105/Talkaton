const DOWNLOADS = Object.freeze({
  mac: {
    href: "/downloads/installers/Talkaton-1.0.0-mac-universal.dmg",
    fileName: "Talkaton-1.0.0-mac-universal.dmg",
    label: "Download for Mac",
    status: "Universal DMG for Apple Silicon and Intel Macs."
  },
  windows: {
    href: "/downloads/installers/Talkaton-1.0.0-windows-x64-setup.exe",
    fileName: "Talkaton-1.0.0-windows-x64-setup.exe",
    label: "Download for Windows",
    status: "64-bit EXE installer for Windows 10 or newer."
  }
});

const platform = detectPlatform();
const selected = DOWNLOADS[platform];
const recommended = document.getElementById("recommendedDownloadBtn");
const bottom = document.getElementById("bottomDownloadBtn");
const status = document.getElementById("installStatus");

document.querySelector(`[data-platform-card="${platform}"]`)?.classList.add("recommended");
configureDownload(recommended, selected);
configureDownload(bottom, selected);
recommended.querySelector("strong").textContent = selected.label;
status.textContent = selected.status;

for (const link of document.querySelectorAll("[data-download-platform], #recommendedDownloadBtn, #bottomDownloadBtn")) {
  link.addEventListener("click", () => {
    const targetPlatform = link.dataset.downloadPlatform || platform;
    status.textContent = `${DOWNLOADS[targetPlatform].label} started. Check your Downloads folder.`;
  });
}

function configureDownload(link, download) {
  link.href = download.href;
  link.download = download.fileName;
}

function detectPlatform() {
  const value = `${navigator.userAgentData?.platform || ""} ${navigator.platform || ""} ${navigator.userAgent || ""}`;
  return /windows|win32|win64/i.test(value) ? "windows" : "mac";
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/talkatondesktop/sw.js", { scope: "/" }).catch(() => {});
}
