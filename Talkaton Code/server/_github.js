import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import {
  ApiError,
  expectSupabaseJson,
  requireString,
  supabaseServiceFetch
} from "./_platform-auth.js";

const GITHUB_API = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";

export function githubOAuthConfig() {
  const clientId = requireEnvironment("GITHUB_OAUTH_CLIENT_ID");
  const clientSecret = requireEnvironment("GITHUB_OAUTH_CLIENT_SECRET");
  const redirectUri = String(
    process.env.GITHUB_OAUTH_REDIRECT_URI
      || "https://talkaton.org/api/github-oauth?action=callback"
  ).trim();
  if (!/^https:\/\/(?:www\.)?talkaton\.org\/api\/github-oauth\?action=callback$/i.test(redirectUri)
    && !(process.env.NODE_ENV !== "production" && /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\//.test(redirectUri))) {
    throw new ApiError(503, "GitHub OAuth redirect configuration is invalid.", "GITHUB_NOT_CONFIGURED");
  }
  return { clientId, clientSecret, redirectUri };
}

export function createOAuthState() {
  const state = randomBytes(32).toString("base64url");
  return { state, stateHash: hashOAuthState(state) };
}

export function hashOAuthState(state) {
  return createHmac("sha256", requireEnvironment("GITHUB_OAUTH_STATE_SECRET"))
    .update(String(state))
    .digest("hex");
}

export function sealGitHubToken(token) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(token), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function openGitHubToken(value) {
  const [version, ivValue, tagValue, ciphertextValue] = String(value || "").split(".");
  if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue) {
    throw new ApiError(503, "The saved GitHub connection is unreadable.", "GITHUB_CONNECTION_INVALID");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(ivValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64url")),
      decipher.final()
    ]).toString("utf8");
  } catch {
    throw new ApiError(503, "The saved GitHub connection is unreadable.", "GITHUB_CONNECTION_INVALID");
  }
}

export async function getGitHubConnection(userId) {
  const query = new URLSearchParams({
    user_id: `eq.${userId}`,
    select: "user_id,github_user_id,github_login,avatar_url,granted_scopes,encrypted_access_token,connected_at,updated_at",
    limit: "1"
  });
  const response = await supabaseServiceFetch(`/rest/v1/github_connections?${query}`);
  const records = await expectSupabaseJson(response, "GitHub connection could not be loaded.");
  const connection = Array.isArray(records) ? records[0] : null;
  if (!connection?.encrypted_access_token) {
    throw new ApiError(409, "Connect GitHub before using repository features.", "GITHUB_NOT_CONNECTED");
  }
  return { ...connection, accessToken: openGitHubToken(connection.encrypted_access_token) };
}

export async function githubApiRequest(path, accessToken, options = {}) {
  if (!String(path).startsWith("/")) throw new ApiError(500, "Invalid GitHub API path.");
  let response;
  try {
    response = await fetch(`${GITHUB_API}${path}`, {
      ...options,
      signal: options.signal || AbortSignal.timeout(15_000),
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "Talkaton-GitHub-Sync",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
      }
    });
  } catch {
    throw new ApiError(502, "GitHub is temporarily unreachable.", "GITHUB_UNAVAILABLE");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const status = response.status === 401 ? 409 : response.status === 404 ? 404 : 502;
    const message = response.status === 401
      ? "Reconnect GitHub to continue."
      : typeof data?.message === "string"
        ? `GitHub: ${data.message}`
        : "GitHub could not complete the request.";
    throw new ApiError(status, message, "GITHUB_REQUEST_FAILED");
  }
  return data;
}

export function validateRepositoryPart(value, label) {
  return requireString(value, label, {
    min: 1,
    max: 100,
    pattern: /^[A-Za-z0-9_.-]+$/
  });
}

export function sanitizeReturnPath(value) {
  const path = String(value || "/chat?github=connected").trim();
  if (!/^\/[A-Za-z0-9/_?=&.-]{1,300}$/.test(path) || path.startsWith("//")) {
    return "/chat?github=connected";
  }
  return path;
}

function getEncryptionKey() {
  return createHash("sha256")
    .update(requireEnvironment("GITHUB_TOKEN_ENCRYPTION_KEY"))
    .digest();
}

function requireEnvironment(name) {
  const value = String(process.env[name] || "").trim();
  if (value.length < (name === "GITHUB_OAUTH_CLIENT_ID" ? 8 : 32)) {
    throw new ApiError(503, "GitHub integration is not configured.", "GITHUB_NOT_CONFIGURED");
  }
  return value;
}
