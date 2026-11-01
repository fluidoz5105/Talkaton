const CHROMIUM_PRIVATE_QUOTA = 120 * 1024 * 1024;

export async function isLikelyPrivateBrowsing() {
  if (navigator.webdriver) return false;
  if (!storageRoundTripWorks(localStorage) || !storageRoundTripWorks(sessionStorage)) return true;
  if (!(await indexedDbWorks())) return true;

  const userAgent = navigator.userAgent || "";
  const isChromium = /\b(?:Chrome|Chromium|CriOS|Edg|OPR)\//.test(userAgent)
    && !/\bFirefox\//.test(userAgent);
  if (!isChromium) return false;

  if (typeof window.webkitRequestFileSystem === "function") {
    const fileSystemBlocked = await new Promise(resolve => {
      window.webkitRequestFileSystem(
        window.TEMPORARY,
        1,
        () => resolve(false),
        () => resolve(true)
      );
    });
    if (fileSystemBlocked) return true;
  }

  try {
    const { quota } = await navigator.storage.estimate();
    if (Number.isFinite(quota) && quota > 0 && quota < CHROMIUM_PRIVATE_QUOTA) return true;

    const heapLimit = Number(performance?.memory?.jsHeapSizeLimit);
    if (
      Number.isFinite(quota)
      && Number.isFinite(heapLimit)
      && heapLimit > 0
      && quota < heapLimit * 1.5
    ) {
      return true;
    }
  } catch {}

  return false;
}

function storageRoundTripWorks(storage) {
  const key = `talkaton-private-check-${Date.now()}-${Math.random()}`;
  try {
    storage.setItem(key, "1");
    const stored = storage.getItem(key) === "1";
    storage.removeItem(key);
    return stored;
  } catch {
    return false;
  }
}

function indexedDbWorks() {
  if (!globalThis.indexedDB) return Promise.resolve(false);
  const databaseName = `talkaton-private-check-${Date.now()}-${Math.random()}`;

  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    try {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("probe");
      };
      request.onerror = () => finish(false);
      request.onblocked = () => finish(false);
      request.onsuccess = () => {
        request.result.close();
        indexedDB.deleteDatabase(databaseName);
        finish(true);
      };
      setTimeout(() => finish(false), 1800);
    } catch {
      finish(false);
    }
  });
}
