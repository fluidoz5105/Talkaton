import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ApiError, expectSupabaseJson, supabaseServiceFetch } from "./_platform-auth.js";

export const DEVELOPER_KEY_SCOPES = Object.freeze([
  "agents:read",
  "agents:write",
  "chat:read",
  "chat:write",
  "files:read",
  "files:write",
  "workspace:read",
  "workspace:write"
]);

const SCOPE_SET = new Set(DEVELOPER_KEY_SCOPES);

export function normalizeKeyScopes(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > DEVELOPER_KEY_SCOPES.length) {
    throw new ApiError(400, "Choose at least one valid API scope.", "INVALID_SCOPES");
  }
  const scopes = [...new Set(value.map(scope => String(scope || "").trim().toLowerCase()))].sort();
  if (scopes.some(scope => !SCOPE_SET.has(scope))) {
    throw new ApiError(400, "One or more API scopes are invalid.", "INVALID_SCOPES");
  }
  return scopes;
}

export function createDeveloperKey() {
  const secret = randomBytes(32).toString("base64url");
  const rawKey = `tk_live_${secret}`;
  return {
    rawKey,
    prefix: rawKey.slice(0, 16),
    hash: hashDeveloperKey(rawKey)
  };
}

export function hashDeveloperKey(rawKey) {
  const pepper = getKeyPepper();
  return createHmac("sha256", pepper).update(String(rawKey)).digest("hex");
}

export async function authenticateDeveloperKey(req, requiredScope) {
  const rawKey = String(req?.headers?.["x-talkaton-api-key"] || "").trim();
  if (!/^tk_live_[A-Za-z0-9_-]{40,60}$/.test(rawKey)) {
    throw new ApiError(401, "A valid Talkaton API key is required.", "API_KEY_REQUIRED");
  }
  if (requiredScope && !SCOPE_SET.has(requiredScope)) {
    throw new ApiError(500, "The endpoint has an invalid scope configuration.", "INVALID_REQUIRED_SCOPE");
  }

  const response = await supabaseServiceFetch("/rest/v1/rpc/platform_authenticate_developer_api_key", {
    method: "POST",
    body: JSON.stringify({
      p_key_hash: hashDeveloperKey(rawKey),
      p_required_scope: requiredScope || null
    })
  });
  const records = await expectSupabaseJson(response, "API key verification failed.");
  const key = Array.isArray(records) ? records[0] : records;
  if (!key?.key_id) {
    throw new ApiError(401, "This API key is invalid, expired, revoked, or missing the required scope.", "API_KEY_INVALID");
  }
  return key;
}

export function safeTokenEquals(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

function getKeyPepper() {
  const pepper = String(process.env.TALKATON_API_KEY_PEPPER || "").trim();
  if (pepper.length < 32) {
    throw new ApiError(503, "API-key signing is not configured.", "API_KEYS_NOT_CONFIGURED");
  }
  return pepper;
}
