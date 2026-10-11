const DEFAULT_SUPABASE_URL = "https://cxulgeojkjnskdyoktkj.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY = "sb_publishable_GgxtfIaIamzZFY_jMU4_Cw_V8NKm475";
const TRUSTED_ORIGINS = new Set([
  "https://talkaton.org",
  "https://www.talkaton.org",
  "https://subscriptions.talkaton.org"
]);

export class ApiError extends Error {
  constructor(status, message, code = "REQUEST_FAILED") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function prepareApiRequest(req, res, methods) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Vary", "Origin");
  res.setHeader("X-Content-Type-Options", "nosniff");

  const origin = String(req?.headers?.origin || "").trim();
  if (origin) {
    const localDevelopment = process.env.NODE_ENV !== "production"
      && /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(origin);
    if (!TRUSTED_ORIGINS.has(origin) && !localDevelopment) {
      throw new ApiError(403, "This origin is not allowed.", "ORIGIN_NOT_ALLOWED");
    }
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }

  const allowed = [...new Set(methods.map(method => method.toUpperCase()))];
  res.setHeader("Allow", allowed.join(", "));
  res.setHeader("Access-Control-Allow-Methods", [...allowed, "OPTIONS"].join(", "));
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Talkaton-API-Key");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return false;
  }
  if (!allowed.includes(String(req.method || "").toUpperCase())) {
    throw new ApiError(405, "Method not allowed.", "METHOD_NOT_ALLOWED");
  }
  return true;
}

export async function authenticateUser(req) {
  const authorization = getAuthorization(req);
  if (!/^Bearer\s+\S+$/i.test(authorization)) {
    throw new ApiError(401, "Log in to a confirmed Talkaton account.", "AUTH_REQUIRED");
  }

  let response;
  try {
    response = await fetch(`${getSupabaseUrl()}/auth/v1/user`, {
      signal: AbortSignal.timeout(8_000),
      headers: {
        apikey: getSupabaseAnonKey(),
        Authorization: authorization
      }
    });
  } catch {
    throw new ApiError(503, "Account verification is temporarily unavailable.", "AUTH_UNAVAILABLE");
  }
  if (!response.ok) {
    throw new ApiError(401, "Your session is invalid or expired.", "SESSION_INVALID");
  }

  const user = await response.json().catch(() => null);
  if (!user?.id || !isUuid(user.id) || !user?.email_confirmed_at) {
    throw new ApiError(403, "Confirm your email before using developer features.", "EMAIL_NOT_CONFIRMED");
  }
  return { user, authorization };
}

export async function readJsonBody(req, { maxBytes = 2_500_000 } = {}) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    let serialized;
    try {
      serialized = JSON.stringify(req.body);
    } catch {
      throw new ApiError(400, "Request body must be valid JSON.", "INVALID_JSON");
    }
    if (Buffer.byteLength(serialized, "utf8") > maxBytes) {
      throw new ApiError(413, "Request body is too large.", "BODY_TOO_LARGE");
    }
    return req.body;
  }
  const raw = Buffer.isBuffer(req.body)
    ? req.body.toString("utf8")
    : typeof req.body === "string"
      ? req.body
      : "";
  if (Buffer.byteLength(raw, "utf8") > maxBytes) {
    throw new ApiError(413, "Request body is too large.", "BODY_TOO_LARGE");
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new ApiError(400, "Request body must be valid JSON.", "INVALID_JSON");
  }
}

export async function supabaseServiceFetch(path, options = {}) {
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) {
    throw new ApiError(503, "Secure database access is not configured.", "DATABASE_NOT_CONFIGURED");
  }
  const response = await fetch(`${getSupabaseUrl()}${path}`, {
    ...options,
    signal: options.signal || AbortSignal.timeout(10_000),
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  return response;
}

export async function expectSupabaseJson(response, fallbackMessage) {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    console.error("Supabase service request failed:", response.status, data?.code || "unknown");
    throw new ApiError(
      response.status >= 500 ? 503 : 400,
      fallbackMessage,
      "DATABASE_REQUEST_FAILED"
    );
  }
  return data;
}

export function sendApiError(res, error, fallback = "The request could not be completed.") {
  const status = error instanceof ApiError ? error.status : 500;
  const code = error instanceof ApiError ? error.code : "INTERNAL_ERROR";
  if (!(error instanceof ApiError)) console.error(fallback, error);
  const message = error instanceof ApiError ? error.message : fallback;
  return res.status(status).json({ error: message, code });
}

export function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

export function requireString(value, name, { min = 1, max = 200, pattern = null } = {}) {
  const normalized = String(value ?? "").trim();
  if (normalized.length < min || normalized.length > max || (pattern && !pattern.test(normalized))) {
    throw new ApiError(400, `${name} is invalid.`, "VALIDATION_FAILED");
  }
  return normalized;
}

export function getSupabaseUrl() {
  return String(process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/$/, "");
}

function getSupabaseAnonKey() {
  return String(process.env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY).trim();
}

function getAuthorization(req) {
  return typeof req?.headers?.authorization === "string"
    ? req.headers.authorization
    : typeof req?.headers?.Authorization === "string"
      ? req.headers.Authorization
      : "";
}
