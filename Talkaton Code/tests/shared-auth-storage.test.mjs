import assert from "node:assert/strict";
import test from "node:test";
import { createSharedAuthStorage } from "../modules/shared-auth-storage.js";

function installBrowserStorage() {
  const cookies = new Map();
  const localValues = new Map();
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { protocol: "https:", hostname: "talkaton.org" }
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      get cookie() {
        return [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
      },
      set cookie(input) {
        const [pair, ...attributes] = String(input).split("; ");
        const separator = pair.indexOf("=");
        const name = pair.slice(0, separator);
        const value = pair.slice(separator + 1);
        const removed = attributes.some(attribute => attribute.trim().toLowerCase() === "max-age=0");
        if (removed) cookies.delete(name);
        else cookies.set(name, value);
      }
    }
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: key => localValues.get(key) || null,
      setItem: (key, value) => localValues.set(key, String(value)),
      removeItem: key => localValues.delete(key)
    }
  });
  return { cookies, localValues };
}

test("shared auth storage chunks sessions into talkaton.org cookies", () => {
  const { cookies } = installBrowserStorage();
  const storage = createSharedAuthStorage();
  const session = JSON.stringify({ access_token: "a".repeat(6_000), refresh_token: "refresh" });
  storage.setItem("sb-project-auth-token", session);
  assert.equal(storage.getItem("sb-project-auth-token"), session);
  assert.ok([...cookies.keys()].some(name => name.endsWith("_count")));
  assert.ok([...cookies.keys()].filter(name => /_\d+$/.test(name)).length > 1);
});

test("shared sign-out marker prevents a legacy session from returning", () => {
  const { localValues } = installBrowserStorage();
  const storage = createSharedAuthStorage();
  storage.setItem("sb-project-auth-token", "signed-in");
  storage.removeItem("sb-project-auth-token");
  localValues.set("sb-project-auth-token", "stale-session-from-another-tab");
  assert.equal(storage.getItem("sb-project-auth-token"), null);
  assert.equal(localValues.has("sb-project-auth-token"), false);
});
