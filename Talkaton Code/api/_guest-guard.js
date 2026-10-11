import { createHmac } from "node:crypto";

// Kept as .js so Vercel bundles it with the JavaScript serverless functions.
const SUPABASE_URL = "https://cxulgeojkjnskdyoktkj.supabase.co";
const SUPABASE_KEY = "sb_publishable_GgxtfIaIamzZFY_jMU4_Cw_V8NKm475";
const BOT_USER_AGENT = /(bot|crawler|spider|slurp|headless|phantomjs|selenium|puppeteer|playwright|wget|curl|python-requests|httpclient)/i;
const ACCOUNT_ROLES = new Map([
  ["kantertal1@gmail.com", "owner"],
  ["donotuseunlessyouaretalkanter@gmail.com", "owner_alt"],
  ["supportaton@gmail.com", "support"]
]);
const PAID_PLANS = new Set(["plus", "pro", "max"]);
const SUBSCRIPTION_CACHE_MS = 30_000;
const subscriptionCache = new Map();

export const PLAN_LIMITS = Object.freeze({
  guest: Object.freeze({ messages: 75, images: 0, searches: 25, voice: 75 }),
  free: Object.freeze({ messages: 250, images: 20, searches: 75, voice: 250 }),
  beta: Object.freeze({ messages: 750, images: 60, searches: 200, voice: 750 }),
  plus: Object.freeze({ messages: 1500, images: 75, searches: 300, voice: 1500 }),
  pro: Object.freeze({ messages: 5000, images: 250, searches: 1000, voice: 5000 }),
  max: Object.freeze({ messages: 10000, images: 500, searches: 2500, voice: 10000 })
});

export class GuestUsageError extends Error {
  constructor(message, status = 429, code = "GUEST_LIMIT_REACHED") {
    super(message);
    this.name = "GuestUsageError";
    this.status = status;
    this.code = code;
  }
}

export async function getAccountAccess(req, { forceRefresh = false } = {}) {
  const authorization = getAuthorization(req);
  const user = await getAuthenticatedUser(authorization);
  if (!user) {
    return createAccessResult({ plan: "guest", billingConfigured: hasStripeConfiguration() });
  }

  const email = String(user.email || "").trim().toLowerCase();
  const role = ACCOUNT_ROLES.get(email) || null;
  if (role) {
    return createAccessResult({
      plan: role,
      role,
      user,
      betaApproved: true,
      devApproved: true,
      billingConfigured: hasStripeConfiguration()
    });
  }

  const grants = await getActiveGrants(authorization, user.id);
  const betaApproved = user?.app_metadata?.beta === true
    || user?.app_metadata?.beta_approved === true
    || getApprovedBetaEmails().has(email)
    || grants.some(grant => grant.feature_key === "beta_lab");
  const devApproved = grants.some(grant => grant.feature_key === "dev_access");

  if (devApproved) {
    return createAccessResult({
      plan: "dev",
      user,
      betaApproved,
      devApproved: true,
      billingConfigured: hasStripeConfiguration()
    });
  }

  const subscription = await getStripeSubscriptionPlan(email, { forceRefresh });
  return createAccessResult({
    plan: subscription.plan || "free",
    user,
    betaApproved,
    devApproved: false,
    subscriptionStatus: subscription.status || null,
    billingConfigured: hasStripeConfiguration()
  });
}

export async function enforceGuestUsage(req, feature, fallbackLimit) {
  if (!Object.prototype.hasOwnProperty.call(PLAN_LIMITS.guest, feature)) {
    throw new GuestUsageError("That usage feature is not configured.", 500, "USAGE_FEATURE_INVALID");
  }

  const access = await getAccountAccess(req);
  if (access.unlimited) {
    return { guest: false, allowed: true, remaining: null, access };
  }

  if (access.plan === "guest" && isAutomatedRequest(req)) {
    throw new GuestUsageError(
      "Automated traffic cannot use Talkaton guest access.",
      403,
      "AUTOMATED_TRAFFIC_BLOCKED"
    );
  }

  const configuredLimit = Number(access.limits?.[feature]);
  const limit = Number.isFinite(configuredLimit)
    ? configuredLimit
    : Number(fallbackLimit);

  if (!Number.isFinite(limit) || limit < 0) {
    throw new GuestUsageError("That plan limit is not configured.", 503, "USAGE_LIMIT_UNAVAILABLE");
  }

  if (limit === 0) {
    const message = feature === "images" && access.plan === "guest"
      ? "Image generation is available after you create a free Talkaton account."
      : `Your ${formatPlanName(access.plan)} plan does not include ${formatFeature(feature)}.`;
    throw new GuestUsageError(message, 403, "PLAN_FEATURE_UNAVAILABLE");
  }

  const secret = getUsageSecret();
  const identity = access.user?.id
    ? `user:${access.user.id}`
    : `guest:${createNetworkIdentity(req)}`;
  const usageKey = createHmac("sha256", secret)
    .update(identity)
    .digest("hex");

  let response;
  try {
    response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/consume_guest_usage`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        p_guest_key: usageKey,
        p_feature: feature,
        p_limit: limit
      })
    });
  } catch {
    throw new GuestUsageError(
      "Daily usage could not be verified. Please try again shortly.",
      503,
      "USAGE_LIMIT_UNAVAILABLE"
    );
  }

  if (!response.ok) {
    throw new GuestUsageError(
      "Daily usage could not be verified. Please try again shortly.",
      503,
      "USAGE_LIMIT_UNAVAILABLE"
    );
  }

  const result = await response.json();
  if (!result?.allowed) {
    const isGuest = access.plan === "guest";
    throw new GuestUsageError(
      `You've reached today's ${formatPlanName(access.plan)} ${formatFeature(feature)} limit. Upgrade or come back tomorrow.`,
      429,
      isGuest ? "GUEST_LIMIT_REACHED" : "PLAN_LIMIT_REACHED"
    );
  }

  return {
    guest: access.plan === "guest",
    allowed: true,
    used: Number(result.used) || 0,
    remaining: Math.max(0, Number(result.remaining) || 0),
    access
  };
}

export function getStripePriceId(plan) {
  if (!PAID_PLANS.has(plan)) return "";
  const envName = `STRIPE_PRICE_${plan.toUpperCase()}`;
  const priceId = String(process.env[envName] || "").trim();
  return /^price_[A-Za-z0-9]+$/.test(priceId) ? priceId : "";
}

export function getStripeSecretKey() {
  return String(process.env.STRIPE_SECRET_KEY || "").trim();
}

export function getStripeMode(secret = getStripeSecretKey()) {
  if (/^(?:sk|rk)_live_/.test(secret)) return "live";
  if (/^(?:sk|rk)_test_/.test(secret)) return "test";
  return "unconfigured";
}

export function isStripeBillingConfigured() {
  const mode = getStripeMode();
  const allPricesConfigured = [...PAID_PLANS].every(plan => Boolean(getStripePriceId(plan)));
  if (!allPricesConfigured) return false;
  if (mode === "live") return true;
  const production = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
  return mode === "test"
    && !production
    && process.env.ALLOW_STRIPE_TEST_MODE === "true";
}

export function clearSubscriptionCache(email = "") {
  const normalized = String(email).trim().toLowerCase();
  if (normalized) subscriptionCache.delete(normalized);
  else subscriptionCache.clear();
}

function createAccessResult({
  plan,
  role = null,
  user = null,
  betaApproved = false,
  devApproved = false,
  subscriptionStatus = null,
  billingConfigured = false
}) {
  const unlimited = plan === "owner" || plan === "owner_alt" || plan === "support" || plan === "dev";
  const baseLimits = unlimited
    ? { messages: Infinity, images: Infinity, searches: Infinity, voice: Infinity }
    : { ...(PLAN_LIMITS[plan] || PLAN_LIMITS.free) };
  const limits = betaApproved && !unlimited
    ? {
        messages: Math.max(baseLimits.messages, PLAN_LIMITS.beta.messages),
        images: Math.max(baseLimits.images, PLAN_LIMITS.beta.images),
        searches: Math.max(baseLimits.searches, PLAN_LIMITS.beta.searches),
        voice: Math.max(baseLimits.voice, PLAN_LIMITS.beta.voice)
      }
    : baseLimits;

  return {
    plan,
    role,
    user,
    authenticated: Boolean(user),
    unlimited,
    paid: PAID_PLANS.has(plan),
    allModels: unlimited || betaApproved || PAID_PLANS.has(plan),
    betaApproved,
    devApproved,
    subscriptionStatus,
    billingConfigured,
    testMode: getStripeMode() === "test",
    limits
  };
}

async function getAuthenticatedUser(authorization) {
  if (!/^Bearer\s+\S+$/i.test(authorization)) return null;
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: authorization
      }
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function getActiveGrants(authorization, userId) {
  if (!userId) return [];
  try {
    const url = new URL(`${SUPABASE_URL}/rest/v1/beta_requests`);
    url.searchParams.set("select", "feature_key,access_expires_at");
    url.searchParams.set("user_id", `eq.${userId}`);
    url.searchParams.set("status", "eq.approved");
    const response = await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: authorization
      }
    });
    if (!response.ok) return [];
    const rows = await response.json();
    if (!Array.isArray(rows)) return [];
    return rows.filter(grant => {
      if (!grant?.access_expires_at) return true;
      const expiresAt = new Date(grant.access_expires_at).getTime();
      return Number.isFinite(expiresAt) && expiresAt > Date.now();
    });
  } catch {
    return [];
  }
}

async function getStripeSubscriptionPlan(email, { forceRefresh = false } = {}) {
  const secret = getStripeSecretKey();
  if (!isStripeBillingConfigured() || !secret || !email) return { plan: null, status: null };

  const cached = subscriptionCache.get(email);
  if (!forceRefresh && cached && Date.now() - cached.cachedAt < SUBSCRIPTION_CACHE_MS) {
    return cached.value;
  }

  const pricePlans = new Map(
    [...PAID_PLANS].map(plan => [getStripePriceId(plan), plan]).filter(([priceId]) => priceId)
  );
  const planWeight = { plus: 1, pro: 2, max: 3 };
  let selected = { plan: null, status: null };

  try {
    const customers = await stripeRequest(`/v1/customers?email=${encodeURIComponent(email)}&limit=10`, secret);
    for (const customer of customers?.data || []) {
      const subscriptions = await stripeRequest(
        `/v1/subscriptions?customer=${encodeURIComponent(customer.id)}&status=all&limit=100`,
        secret
      );
      for (const subscription of subscriptions?.data || []) {
        if (!["active", "trialing"].includes(subscription.status)) continue;
        for (const item of subscription.items?.data || []) {
          const plan = pricePlans.get(item?.price?.id);
          if (plan && planWeight[plan] > (planWeight[selected.plan] || 0)) {
            selected = { plan, status: subscription.status };
          }
        }
      }
    }
  } catch (error) {
    console.error("Stripe subscription lookup failed:", error?.message || error);
  }

  subscriptionCache.set(email, { cachedAt: Date.now(), value: selected });
  return selected;
}

async function stripeRequest(path, secret, options = {}) {
  const response = await fetch(`https://api.stripe.com${path}`, {
    ...options,
    signal: options.signal || AbortSignal.timeout(10_000),
    headers: {
      Authorization: `Bearer ${secret}`,
      "Stripe-Version": "2026-06-24.dahlia",
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || `Stripe request failed (${response.status}).`);
  }
  return data;
}

function getAuthorization(req) {
  return typeof req?.headers?.authorization === "string"
    ? req.headers.authorization
    : typeof req?.headers?.Authorization === "string"
      ? req.headers.Authorization
      : "";
}

function hasStripeConfiguration() {
  return isStripeBillingConfigured();
}

function isAutomatedRequest(req) {
  const userAgent = String(req?.headers?.["user-agent"] || "");
  return !userAgent || BOT_USER_AGENT.test(userAgent);
}

function createNetworkIdentity(req) {
  const forwarded = String(
    req?.headers?.["x-vercel-forwarded-for"]
      || req?.headers?.["x-forwarded-for"]
      || req?.socket?.remoteAddress
      || "unknown"
  );
  const ip = forwarded.split(",")[0].trim();
  const userAgent = String(req?.headers?.["user-agent"] || "unknown").slice(0, 512);
  const language = String(req?.headers?.["accept-language"] || "").slice(0, 128);
  const platform = String(req?.headers?.["sec-ch-ua-platform"] || "").slice(0, 64);
  const mobile = String(req?.headers?.["sec-ch-ua-mobile"] || "").slice(0, 16);
  return `${ip}\n${userAgent}\n${language}\n${platform}\n${mobile}`;
}

function getApprovedBetaEmails() {
  return new Set(
    String(process.env.BETA_APPROVED_EMAILS || "")
      .split(/[\s,;]+/)
      .map(email => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

function formatPlanName(plan) {
  if (plan === "guest") return "Guest";
  if (plan === "free") return "Free";
  return `Talkaton ${String(plan || "").charAt(0).toUpperCase()}${String(plan || "").slice(1)}`;
}

function formatFeature(feature) {
  if (feature === "messages") return "message";
  if (feature === "images") return "image generation";
  if (feature === "voice") return "voice transcription";
  return "web search";
}

function getUsageSecret() {
  const secret = String(
    process.env.GUEST_USAGE_SECRET
      || process.env.OPENROUTER_API_KEY
      || process.env.OPENAI_API_KEY
      || process.env.TAVILY_API_KEY
      || ""
  ).trim();
  if (!secret) {
    throw new GuestUsageError(
      "Daily usage protection is not configured.",
      503,
      "USAGE_LIMIT_UNAVAILABLE"
    );
  }
  return secret;
}
