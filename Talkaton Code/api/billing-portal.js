import {
  getAccountAccess,
  getStripeMode,
  getStripePriceId,
  getStripeSecretKey,
  isStripeBillingConfigured
} from "./_guest-guard.js";

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "past_due"]);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const access = await getAccountAccess(req, { forceRefresh: true });
  if (!access.authenticated || !access.user?.email) {
    return res.status(401).json({ error: "Log in to manage your subscription." });
  }
  if (!access.user.email_confirmed_at) {
    return res.status(403).json({ error: "Confirm your email address before managing a subscription." });
  }

  const secret = getStripeSecretKey();
  if (!isStripeBillingConfigured() || getStripeMode(secret) !== "live") {
    return res.status(503).json({
      error: "Talkaton live billing is not configured yet.",
      code: "LIVE_BILLING_NOT_CONFIGURED"
    });
  }

  try {
    const customers = await stripeRequest(
      `/v1/customers?email=${encodeURIComponent(access.user.email)}&limit=10`,
      secret
    );
    const customer = await selectSubscriptionCustomer(customers?.data || [], secret);
    if (!customer?.id) {
      return res.status(404).json({ error: "No Stripe subscription was found for this account." });
    }

    const form = new URLSearchParams();
    form.set("customer", customer.id);
    form.set("return_url", "https://subscriptions.talkaton.org/?billing=returned");
    const portalConfiguration = String(process.env.STRIPE_PORTAL_CONFIGURATION_ID || "").trim();
    if (/^bpc_[A-Za-z0-9]+$/.test(portalConfiguration)) {
      form.set("configuration", portalConfiguration);
    }
    const session = await stripeRequest("/v1/billing_portal/sessions", secret, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form
    });
    if (!session?.url) throw new Error("Stripe returned no portal URL.");
    return res.status(200).json({ url: session.url, testMode: false });
  } catch (error) {
    console.error("Stripe billing portal failed:", error);
    return res.status(502).json({
      error: "Stripe live billing is temporarily unavailable.",
      code: "BILLING_PORTAL_UNAVAILABLE"
    });
  }
}

async function selectSubscriptionCustomer(customers, secret) {
  const configuredPrices = new Set(["plus", "pro", "max"].map(getStripePriceId).filter(Boolean));
  for (const customer of customers) {
    const subscriptions = await stripeRequest(
      `/v1/subscriptions?customer=${encodeURIComponent(customer.id)}&status=all&limit=100`,
      secret
    );
    const hasTalkatonSubscription = (subscriptions?.data || []).some(subscription =>
      ACTIVE_SUBSCRIPTION_STATUSES.has(subscription?.status)
      && subscription?.items?.data?.some(item => configuredPrices.has(item?.price?.id))
    );
    if (hasTalkatonSubscription) return customer;
  }
  return customers[0] || null;
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
