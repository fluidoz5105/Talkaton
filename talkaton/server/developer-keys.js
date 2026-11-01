import {
  ApiError,
  authenticateUser,
  expectSupabaseJson,
  isUuid,
  prepareApiRequest,
  readJsonBody,
  requireString,
  sendApiError,
  supabaseServiceFetch
} from "./_platform-auth.js";
import { createDeveloperKey, DEVELOPER_KEY_SCOPES, normalizeKeyScopes } from "./_developer-keys.js";

export default async function handler(req, res) {
  try {
    if (!prepareApiRequest(req, res, ["GET", "POST", "DELETE"])) return;
    const { user } = await authenticateUser(req);

    if (req.method === "GET") return await listKeys(user.id, res);
    const body = await readJsonBody(req, { maxBytes: 20_000 });
    if (req.method === "DELETE") return await revokeKey(user.id, body, res);
    return await provisionOrRollKey(user.id, body, res);
  } catch (error) {
    return sendApiError(res, error, "Developer API key request failed.");
  }
}

async function listKeys(userId, res) {
  const query = new URLSearchParams({
    select: "id,name,key_prefix,scopes,workspace_id,last_used_at,expires_at,revoked_at,created_at,updated_at",
    owner_user_id: `eq.${userId}`,
    order: "created_at.desc",
    limit: "100"
  });
  const response = await supabaseServiceFetch(`/rest/v1/developer_api_keys?${query}`);
  const keys = await expectSupabaseJson(response, "API keys could not be loaded.");
  return res.status(200).json({ keys, availableScopes: DEVELOPER_KEY_SCOPES });
}

async function provisionOrRollKey(userId, body, res) {
  const action = String(body.action || "provision").trim().toLowerCase();
  if (!new Set(["provision", "roll"]).has(action)) {
    throw new ApiError(400, "Action must be provision or roll.", "INVALID_ACTION");
  }
  const name = requireString(body.name, "Key name", { min: 2, max: 80 });
  const scopes = normalizeKeyScopes(body.scopes);
  const workspaceId = body.workspaceId == null || body.workspaceId === ""
    ? null
    : String(body.workspaceId);
  if (workspaceId && !isUuid(workspaceId)) {
    throw new ApiError(400, "Workspace ID is invalid.", "VALIDATION_FAILED");
  }

  const expiresInDays = body.expiresInDays == null || body.expiresInDays === ""
    ? null
    : Number(body.expiresInDays);
  if (expiresInDays !== null && (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 365)) {
    throw new ApiError(400, "API keys may expire between 1 and 365 days from now.", "VALIDATION_FAILED");
  }

  const oldKeyId = action === "roll" ? String(body.keyId || "") : null;
  if (action === "roll" && !isUuid(oldKeyId)) {
    throw new ApiError(400, "Choose a valid key to roll.", "VALIDATION_FAILED");
  }

  const generated = createDeveloperKey();
  const rpc = action === "roll"
    ? "platform_roll_developer_api_key"
    : "platform_create_developer_api_key";
  const payload = {
    p_owner_user_id: userId,
    p_name: name,
    p_key_hash: generated.hash,
    p_key_prefix: generated.prefix,
    p_scopes: scopes,
    p_workspace_id: workspaceId,
    p_expires_at: expiresInDays === null
      ? null
      : new Date(Date.now() + expiresInDays * 86_400_000).toISOString()
  };
  if (action === "roll") payload.p_old_key_id = oldKeyId;

  const response = await supabaseServiceFetch(`/rest/v1/rpc/${rpc}`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
  const result = await expectSupabaseJson(response, "The API key could not be saved.");
  const record = Array.isArray(result) ? result[0] : result;
  if (!record?.id) throw new ApiError(503, "The API key could not be saved.", "DATABASE_REQUEST_FAILED");

  return res.status(action === "roll" ? 200 : 201).json({
    key: generated.rawKey,
    record,
    warning: "Copy this key now. Talkaton stores only its one-way hash and cannot show it again."
  });
}

async function revokeKey(userId, body, res) {
  const keyId = String(body.keyId || "");
  if (!isUuid(keyId)) throw new ApiError(400, "Key ID is invalid.", "VALIDATION_FAILED");

  const query = new URLSearchParams({
    id: `eq.${keyId}`,
    owner_user_id: `eq.${userId}`,
    revoked_at: "is.null",
    select: "id,revoked_at"
  });
  const response = await supabaseServiceFetch(`/rest/v1/developer_api_keys?${query}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ revoked_at: new Date().toISOString() })
  });
  const records = await expectSupabaseJson(response, "The API key could not be revoked.");
  if (!Array.isArray(records) || records.length !== 1) {
    throw new ApiError(404, "That active API key was not found.", "KEY_NOT_FOUND");
  }
  return res.status(200).json({ revoked: true, key: records[0] });
}
