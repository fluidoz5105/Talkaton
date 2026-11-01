import { createHash, randomBytes } from "node:crypto";
import {
  clearSubscriptionCache,
  getAccountAccess,
  getStripeMode,
  getStripePriceId,
  getStripeSecretKey,
  isStripeBillingConfigured
} from "./_guest-guard.js";

const ALLOWED_PLANS = new Set(["plus", "pro", "max"]);
const PLAN_PRICES = Object.freeze({ plus: 1_000, pro: 3_000, max: 5_000 });
const STRIPE_API_VERSION = "2026-06-24.dahlia";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const access = await getAccountAccess(req, { forceRefresh: true });
  if (!access.authenticated || !access.user?.email) {
    return res.status(401).json({ error: "Log in to a confirmed Talkaton account before choosing a plan." });
  }
  if (!access.user.email_confirmed_at) {
    return res.status(403).json({ error: "Confirm your email address before choosing a plan." });
  }
  if (access.paid) {
    return res.status(409).json({
      error: "This account already has a subscription. Use Manage subscription to change or cancel it.",
      code: "SUBSCRIPTION_EXISTS"
    });
  }

  const plan = String(req.body?.plan || "").trim().toLowerCase();
  if (!ALLOWED_PLANS.has(plan)) {
    return res.status(400).json({ error: "Choose Plus, Pro, or Max." });
  }

  const secret = getStripeSecretKey();
  const priceId = getStripePriceId(plan);
  if (!isStripeBillingConfigured() || getStripeMode(secret) !== "live" || !priceId) {
    return res.status(503).json({
      error: "Talkaton live checkout is not configured yet.",
      code: "LIVE_BILLING_NOT_CONFIGURED"
    });
  }

  const origin = getBillingOrigin(req);
  try {
    await verifyLiveMonthlyPrice(priceId, plan, secret);
    const existingCustomer = await findExistingCustomer(access.user, secret);
    const form = new URLSearchParams();
    form.set("mode", "subscription");
    form.set("line_items[0][price]", priceId);
    form.set("line_items[0][quantity]", "1");
    if (existingCustomer?.id) form.set("customer", existingCustomer.id);
    else form.set("customer_email", access.user.email);
    form.set("success_url", `${origin}/?billing=success&session_id={CHECKOUT_SESSION_ID}`);
    form.set("cancel_url", `${origin}/?billing=cancelled`);
    form.set("allow_promotion_codes", "true");
    form.set("billing_address_collection", "auto");
    form.set("client_reference_id", access.user.id);
    form.set("integration_identifier", createIntegrationIdentifier());
    form.set("metadata[talkaton_user_id]", access.user.id);
    form.set("metadata[talkaton_plan]", plan);
    form.set("subscription_data[metadata][talkaton_user_id]", access.user.id);
    form.set("subscription_data[metadata][talkaton_plan]", plan);

    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      signal: AbortSignal.timeout(12_000),
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": createCheckoutIdempotencyKey(access.user.id, plan),
        "Stripe-Version": STRIPE_API_VERSION
      },
      body: form
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.url) {
      return res.status(response.status || 502).json({
        error: data?.error?.message || "Stripe could not start checkout."
      });
    }

    clearSubscriptionCache(access.user.email);
    return res.status(200).json({ url: data.url, testMode: false });
  } catch (error) {
    console.error("Stripe checkout failed:", error);
    return res.status(502).json({
      error: "Stripe live checkout is temporarily unavailable.",
      code: "CHECKOUT_UNAVAILABLE"
    });
  }
}

async function findExistingCustomer(user, secret) {
  const customers = await stripeRequest(
    `/v1/customers?email=${encodeURIComponent(user.email)}&limit=10`,
    secret
  );
  return (customers?.data || []).find(customer => customer?.metadata?.talkaton_user_id === user.id)
    || customers?.data?.[0]
    || null;
}

async function verifyLiveMonthlyPrice(priceId, plan, secret) {
  const price = await stripeRequest(`/v1/prices/${encodeURIComponent(priceId)}`, secret);
  const valid = price?.active === true
    && price?.livemode === true
    && price?.currency === "usd"
    && price?.unit_amount === PLAN_PRICES[plan]
    && price?.type === "recurring"
    && price?.recurring?.interval === "month"
    && price?.recurring?.interval_count === 1;
  if (!valid) throw new Error(`The configured ${plan} price is not the expected live monthly price.`);
}

async function stripeRequest(path, secret) {
  const response = await fetch(`https://api.stripe.com${path}`, {
    signal: AbortSignal.timeout(10_000),
    headers: {
      Authorization: `Bearer ${secret}`,
      "Stripe-Version": STRIPE_API_VERSION
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Stripe request failed (${response.status}).`);
  return data;
}

function createIntegrationIdentifier() {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  const suffix = [...randomBytes(8)].map(byte => letters[byte % letters.length]).join("");
  return `talkaton_${suffix}`;
}

function createCheckoutIdempotencyKey(userId, plan) {
  const fiveMinuteWindow = Math.floor(Date.now() / 300_000);
  return `talkaton_checkout_${createHash("sha256")
    .update(`${userId}:${plan}:${fiveMinuteWindow}`)
    .digest("hex")}`;
}

function getBillingOrigin(req) {
  const configured = String(process.env.PUBLIC_BILLING_URL || "https://subscriptions.talkaton.org").trim();
  if (/^https:\/\/subscriptions\.talkaton\.org$/i.test(configured)) return configured;
  const requestOrigin = String(req?.headers?.origin || "").trim();
  if (/^https:\/\/subscriptions\.talkaton\.org$/i.test(requestOrigin)) return requestOrigin;
  return "https://subscriptions.talkaton.org";
}
