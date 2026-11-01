const COOKIE_PREFIX = "talkaton_auth_";
const COOKIE_CHUNK_SIZE = 2_800;
const MAX_COOKIE_CHUNKS = 18;
const COOKIE_LIFETIME_SECONDS = 60 * 60 * 24 * 365;

export function createSharedAuthStorage() {
  const seedFromCookie = readCookie(`${COOKIE_PREFIX}seed`);
  return {
    getItem(key) {
      const cookieName = getCookieName(key);
      const countValue = readCookie(`${cookieName}_count`);
      const cookieBelongsToThisSession = !seedFromCookie || readCookie(`${COOKIE_PREFIX}seed`) === seedFromCookie;
      const chunkCount = Number(countValue);
      if (cookieBelongsToThisSession && Number.isInteger(chunkCount) && chunkCount > 0 && chunkCount <= MAX_COOKIE_CHUNKS) {
        const encoded = Array.from({ length: chunkCount }, (_, index) => readCookie(`${cookieName}_${index}`)).join("");
        if (encoded) {
          try {
            return decodeURIComponent(encoded);
          } catch {
            clearCookieChunks(cookieName, chunkCount);
          }
        }
      }

      // A shared zero marker prevents a stale local session from returning
      // on another Talkaton subdomain after the user signs out.
      if (countValue === "0") {
        safeLocalStorageRemove(key);
        return null;
      }

      const legacyValue = safeLocalStorageGet(key);
      if (legacyValue) this.setItem(key, legacyValue);
      return legacyValue;
    },

    setItem(key, value) {
      const serialized = String(value ?? "");
      const cookieName = getCookieName(key);
      const encoded = encodeURIComponent(serialized);
      const chunks = encoded.match(new RegExp(`.{1,${COOKIE_CHUNK_SIZE}}`, "g")) || [""];
      if (chunks.length > MAX_COOKIE_CHUNKS) {
        safeLocalStorageSet(key, serialized);
        return;
      }

      clearCookieChunks(cookieName, MAX_COOKIE_CHUNKS);
      chunks.forEach((chunk, index) => writeCookie(`${cookieName}_${index}`, chunk));
      writeCookie(`${cookieName}_count`, String(chunks.length));
      if (!readCookie(`${COOKIE_PREFIX}seed`)) writeCookie(`${COOKIE_PREFIX}seed`, createSessionSeed());
      safeLocalStorageSet(key, serialized);
    },

    removeItem(key) {
      const cookieName = getCookieName(key);
      clearCookieChunks(cookieName, MAX_COOKIE_CHUNKS);
      writeCookie(`${cookieName}_count`, "0");
      safeLocalStorageRemove(key);
    }
  };
}

function getCookieName(key) {
  return `${COOKIE_PREFIX}${String(key).replace(/[^a-z0-9_-]/gi, "_")}`;
}

function readCookie(name) {
  if (typeof document === "undefined") return "";
  const prefix = `${name}=`;
  const item = String(document.cookie || "").split("; ").find(value => value.startsWith(prefix));
  return item ? item.slice(prefix.length) : "";
}

function writeCookie(name, value, { remove = false } = {}) {
  if (typeof document === "undefined") return;
  const secure = globalThis.location?.protocol === "https:" ? "; Secure" : "";
  const sharedDomain = isTalkatonHost(globalThis.location?.hostname) ? "; Domain=.talkaton.org" : "";
  const maxAge = remove ? 0 : COOKIE_LIFETIME_SECONDS;
  document.cookie = `${name}=${value}; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}${sharedDomain}`;
}

function clearCookieChunks(cookieName, count) {
  for (let index = 0; index < Math.min(count, MAX_COOKIE_CHUNKS); index += 1) {
    writeCookie(`${cookieName}_${index}`, "", { remove: true });
  }
}

function isTalkatonHost(hostname = "") {
  return hostname === "talkaton.org" || hostname.endsWith(".talkaton.org");
}

function createSessionSeed() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function safeLocalStorageGet(key) {
  try {
    return globalThis.localStorage?.getItem(key) || null;
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key, value) {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Shared cookies remain the source of truth when local storage is unavailable.
  }
}

function safeLocalStorageRemove(key) {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    // Ignore browser storage restrictions during sign-out.
  }
}
