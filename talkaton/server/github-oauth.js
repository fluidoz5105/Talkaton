import {
  ApiError,
  authenticateUser,
  expectSupabaseJson,
  prepareApiRequest,
  sendApiError,
  supabaseServiceFetch
} from "./_platform-auth.js";
import {
  createOAuthState,
  githubApiRequest,
  githubOAuthConfig,
  hashOAuthState,
  sanitizeReturnPath,
  sealGitHubToken
} from "./_github.js";

const COOKIE_NAME = "talkaton_github_oauth";

export default async function handler(req, res) {
  try {
    if (!prepareApiRequest(req, res, ["GET", "DELETE"])) return;
    const action = String(req.query?.action || "status").trim().toLowerCase();
    if (req.method === "DELETE") return await disconnect(req, res);
    if (action === "authorize") return await authorize(req, res);
    if (action === "callback") return await callback(req, res);
    if (action === "status") return await status(req, res);
    throw new ApiError(400, "Unknown GitHub OAuth action.", "INVALID_ACTION");
  } catch (error) {
    return sendApiError(res, error, "GitHub connection request failed.");
  }
}

async function authorize(req, res) {
  const { user } = await authenticateUser(req);
  const config = githubOAuthConfig();
  const { state, stateHash } = createOAuthState();
  const returnPath = sanitizeReturnPath(req.query?.returnPath);
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();

  const response = await supabaseServiceFetch("/rest/v1/github_oauth_states?on_conflict=user_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      state_hash: stateHash,
      user_id: user.id,
      return_path: returnPath,
      expires_at: expiresAt,
      consumed_at: null,
      created_at: new Date().toISOString()
    })
  });
  if (!response.ok) await expectSupabaseJson(response, "GitHub connection could not be started.");

  const query = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: "repo read:user user:email",
    state,
    allow_signup: "true"
  });
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=${state}; Path=/api/github-oauth; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  return res.status(200).json({ authorizationUrl: `https://github.com/login/oauth/authorize?${query}` });
}

async function callback(req, res) {
  const state = String(req.query?.state || "").trim();
  const code = String(req.query?.code || "").trim();
  const cookieState = readCookie(req, COOKIE_NAME);
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(state) || !/^[A-Za-z0-9_-]{10,200}$/.test(code) || cookieState !== state) {
    throw new ApiError(400, "GitHub returned an invalid or expired authorization request.", "OAUTH_STATE_INVALID");
  }

  const stateQuery = new URLSearchParams({
    state_hash: `eq.${hashOAuthState(state)}`,
    consumed_at: "is.null",
    expires_at: `gt.${new Date().toISOString()}`,
    select: "id,user_id,return_path",
    limit: "1"
  });
  const stateResponse = await supabaseServiceFetch(`/rest/v1/github_oauth_states?${stateQuery}`);
  const states = await expectSupabaseJson(stateResponse, "GitHub authorization could not be verified.");
  const oauthState = Array.isArray(states) ? states[0] : null;
  if (!oauthState?.id) throw new ApiError(400, "GitHub authorization expired. Start again.", "OAUTH_STATE_INVALID");

  const config = githubOAuthConfig();
  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
      state
    })
  });
  const tokenData = await tokenResponse.json().catch(() => null);
  if (!tokenResponse.ok || !tokenData?.access_token) {
    throw new ApiError(502, "GitHub did not issue an access token.", "GITHUB_TOKEN_EXCHANGE_FAILED");
  }

  const profile = await githubApiRequest("/user", tokenData.access_token);
  const grantedScopes = String(tokenData.scope || "")
    .split(",")
    .map(scope => scope.trim())
    .filter(Boolean);
  const connectionResponse = await supabaseServiceFetch("/rest/v1/github_connections?on_conflict=user_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      user_id: oauthState.user_id,
      github_user_id: String(profile.id),
      github_login: profile.login,
      avatar_url: profile.avatar_url || null,
      encrypted_access_token: sealGitHubToken(tokenData.access_token),
      granted_scopes: grantedScopes,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
  });
  if (!connectionResponse.ok) await expectSupabaseJson(connectionResponse, "GitHub connection could not be saved.");

  await supabaseServiceFetch(`/rest/v1/github_oauth_states?id=eq.${oauthState.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ consumed_at: new Date().toISOString() })
  });

  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/api/github-oauth; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  res.status(302).setHeader("Location", `https://talkaton.org${sanitizeReturnPath(oauthState.return_path)}`);
  return res.end();
}

async function status(req, res) {
  const { user } = await authenticateUser(req);
  const query = new URLSearchParams({
    user_id: `eq.${user.id}`,
    select: "github_login,avatar_url,granted_scopes,connected_at,updated_at",
    limit: "1"
  });
  const response = await supabaseServiceFetch(`/rest/v1/github_connections?${query}`);
  const records = await expectSupabaseJson(response, "GitHub status could not be loaded.");
  const connection = Array.isArray(records) ? records[0] : null;
  return res.status(200).json({ connected: Boolean(connection), connection: connection || null });
}

async function disconnect(req, res) {
  const { user } = await authenticateUser(req);
  const response = await supabaseServiceFetch(`/rest/v1/github_connections?user_id=eq.${user.id}`, {
    method: "DELETE",
    headers: { Prefer: "return=representation" }
  });
  const records = await expectSupabaseJson(response, "GitHub could not be disconnected.");
  return res.status(200).json({ disconnected: Array.isArray(records) && records.length > 0 });
}

function readCookie(req, name) {
  const cookies = String(req?.headers?.cookie || "").split(";");
  for (const item of cookies) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === name) {
      try {
        return decodeURIComponent(item.slice(separator + 1).trim());
      } catch {
        return "";
      }
    }
  }
  return "";
}
