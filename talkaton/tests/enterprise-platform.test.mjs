import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

function sourceUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}#${Date.now()}-${Math.random()}`;
}

async function loadModules() {
  const platformSource = await readFile(new URL("server/_platform-auth.js", root), "utf8");
  const platformUrl = sourceUrl(platformSource);
  const keySource = (await readFile(new URL("server/_developer-keys.js", root), "utf8"))
    .replace("./_platform-auth.js", platformUrl);
  const keyUrl = sourceUrl(keySource);
  const githubSource = (await readFile(new URL("server/_github.js", root), "utf8"))
    .replace("./_platform-auth.js", platformUrl);
  const githubUrl = sourceUrl(githubSource);
  return { platformUrl, keyUrl, githubUrl };
}

async function loadEndpoint(relativePath, replacements) {
  let source = await readFile(new URL(relativePath, root), "utf8");
  for (const [specifier, url] of Object.entries(replacements)) source = source.replace(specifier, url);
  return import(sourceUrl(source));
}

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    headers: new Map(),
    ended: false,
    setHeader(name, value) {
      this.headers.set(String(name).toLowerCase(), value);
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      this.ended = true;
      return value;
    },
    end() {
      this.ended = true;
      return this;
    }
  };
}

test("developer keys are random, scoped, and reduced to one-way hashes", async () => {
  process.env.TALKATON_API_KEY_PEPPER = "test-pepper-with-at-least-thirty-two-characters";
  const { keyUrl } = await loadModules();
  const keys = await import(keyUrl);
  const first = keys.createDeveloperKey();
  const second = keys.createDeveloperKey();

  assert.match(first.rawKey, /^tk_live_[A-Za-z0-9_-]{40,60}$/);
  assert.match(first.hash, /^[0-9a-f]{64}$/);
  assert.notEqual(first.rawKey, second.rawKey);
  assert.equal(keys.hashDeveloperKey(first.rawKey), first.hash);
  assert.deepEqual(keys.normalizeKeyScopes(["chat:write", "chat:write", "agents:read"]), [
    "agents:read",
    "chat:write"
  ]);
  assert.throws(() => keys.normalizeKeyScopes(["admin:everything"]), /invalid/i);
});

test("GitHub access tokens are authenticated-encrypted before database storage", async () => {
  process.env.GITHUB_TOKEN_ENCRYPTION_KEY = "test-encryption-material-with-at-least-thirty-two-characters";
  process.env.GITHUB_OAUTH_STATE_SECRET = "test-state-secret-with-at-least-thirty-two-characters";
  const { githubUrl } = await loadModules();
  const github = await import(githubUrl);
  const token = "gho_example-token-that-must-never-be-stored-as-plain-text";
  const sealed = github.sealGitHubToken(token);

  assert.match(sealed, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.doesNotMatch(sealed, /gho_example/);
  assert.equal(github.openGitHubToken(sealed), token);
  assert.match(github.hashOAuthState("one-time-state"), /^[0-9a-f]{64}$/);
  const replacement = sealed.endsWith("A") ? "B" : "A";
  assert.throws(() => github.openGitHubToken(`${sealed.slice(0, -1)}${replacement}`), /unreadable/i);
});

test("developer key endpoint requires a confirmed bearer account and never lists hashes", async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-value";
  process.env.TALKATON_API_KEY_PEPPER = "test-pepper-with-at-least-thirty-two-characters";
  const { platformUrl, keyUrl } = await loadModules();
  const { default: handler } = await loadEndpoint("server/developer-keys.js", {
    "./_platform-auth.js": platformUrl,
    "./_developer-keys.js": keyUrl
  });

  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith("/auth/v1/user")) {
      return new Response(JSON.stringify({
        id: "00000000-0000-4000-8000-000000000101",
        email: "developer@example.com",
        email_confirmed_at: "2026-08-01T12:00:00Z"
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify([{
      id: "00000000-0000-4000-8000-000000000102",
      name: "CI",
      key_prefix: "tk_live_example",
      scopes: ["chat:write"]
    }]), { status: 200, headers: { "content-type": "application/json" } });
  };

  const response = createResponse();
  await handler({
    method: "GET",
    headers: { authorization: "Bearer confirmed-session", origin: "https://talkaton.org" },
    query: {}
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.keys.length, 1);
  assert.equal("key_hash" in response.body.keys[0], false);
  assert.match(requests[1].url, /select=id%2Cname%2Ckey_prefix/);
  assert.doesNotMatch(requests[1].url, /key_hash/);
});

test("developer and GitHub endpoints reject untrusted origins and unsafe proposal paths", async () => {
  const { platformUrl, keyUrl, githubUrl } = await loadModules();
  const { default: keyHandler } = await loadEndpoint("server/developer-keys.js", {
    "./_platform-auth.js": platformUrl,
    "./_developer-keys.js": keyUrl
  });
  let response = createResponse();
  await keyHandler({ method: "GET", headers: { origin: "https://evil.example" }, query: {} }, response);
  assert.equal(response.statusCode, 403);
  assert.equal(response.body.code, "ORIGIN_NOT_ALLOWED");

  const { default: pullRequestHandler } = await loadEndpoint("server/github.js", {
    "./_platform-auth.js": platformUrl,
    "./_github.js": githubUrl
  });
  globalThis.fetch = async url => {
    if (String(url).endsWith("/auth/v1/user")) {
      return new Response(JSON.stringify({
        id: "00000000-0000-4000-8000-000000000103",
        email: "developer@example.com",
        email_confirmed_at: "2026-08-01T12:00:00Z"
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error("No GitHub or database request should happen for invalid input.");
  };
  response = createResponse();
  await pullRequestHandler({
    method: "POST",
    headers: { authorization: "Bearer confirmed-session", origin: "https://talkaton.org" },
    query: { action: "pull-request" },
    body: {
      owner: "talkaton",
      repo: "web",
      base: "main",
      branch: "talkaton/proposal",
      title: "Safe proposal",
      description: "A bounded proposal",
      files: [{ path: "../outside.txt", content: "blocked" }]
    }
  }, response);
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, "VALIDATION_FAILED");
});

test("enterprise migration enables RLS and keeps credentials server-only", async () => {
  const sql = await readFile(new URL("supabase/enterprise-workspaces-and-developer-platform.sql", root), "utf8");
  assert.match(sql, /create type public\.workspace_role as enum \('admin', 'editor', 'viewer'\)/);
  assert.match(sql, /alter table public\.workspace_members enable row level security/);
  assert.match(sql, /create policy "Members view shared chats"/);
  assert.match(sql, /create policy "Editors upload workspace files"/);
  assert.match(sql, /key_hash text not null unique/);
  assert.match(sql, /revoke all on public\.developer_api_keys from anon, authenticated/);
  assert.match(sql, /encrypted_access_token text not null/);
  assert.match(sql, /revoke all on public\.github_connections from anon, authenticated/);
  assert.doesNotMatch(sql, /GITHUB_OAUTH_CLIENT_SECRET\s*=/);
});
