import { getAccountAccess } from "./_guest-guard.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const forceRefresh = String(req.query?.refresh || "") === "1";
  const access = await getAccountAccess(req, { forceRefresh });

  return res.status(200).json({
    authenticated: access.authenticated,
    plan: access.plan,
    role: access.role,
    paid: access.paid,
    unlimited: access.unlimited,
    allModels: access.allModels,
    betaApproved: access.betaApproved,
    devApproved: access.devApproved,
    subscriptionStatus: access.subscriptionStatus,
    billingConfigured: access.billingConfigured,
    testMode: access.testMode,
    limits: Object.fromEntries(
      Object.entries(access.limits).map(([feature, limit]) => [
        feature,
        Number.isFinite(limit) ? limit : null
      ])
    )
  });
}
