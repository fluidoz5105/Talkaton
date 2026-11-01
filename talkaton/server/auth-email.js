import { createHmac, createHash, timingSafeEqual } from "node:crypto";

// Read the signed bytes before accessing req.body (Vercel's lazy JSON parser).
export const config = { api: { bodyParser: false } };
const MAX_BODY = 64 * 1024;
const ACTIONS = {
  signup: "Confirm your Talkaton account",
  magiclink: "Sign in to Talkaton",
  recovery: "Reset your Talkaton password",
  invite: "Join Talkaton",
  email_change: "Confirm your email change",
  reauthentication: "Confirm your Talkaton identity"
};

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  const secret = process.env.SEND_EMAIL_HOOK_SECRET?.trim();
  if (!key || !from || !secret) return res.status(503).json({ error: "Email delivery is not configured." });
  try {
    const raw = await readRawBody(req);
    if (!verifySignature(raw, req.headers, secret)) return res.status(401).json({ error: "Invalid hook signature." });
    let payload;
    try { payload = JSON.parse(raw); } catch { return res.status(400).json({ error: "Invalid payload." }); }
    let emails;
    try { emails = buildAuthEmails(payload); } catch { return res.status(400).json({ error: "Invalid email request." }); }
    for (let index = 0; index < emails.length; index++) {
      const id = createHash("sha256").update(`${req.headers["webhook-id"]}:${index}`).digest("hex");
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(4000),
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `auth-${id}` },
        body: JSON.stringify({ from, ...emails[index] })
      });
      if (!response.ok) return res.status(502).json({ error: "Email delivery failed. Please try again." });
    }
    return res.status(200).json({});
  } catch (error) {
    // Never log payloads, tokens, provider bodies, or credentials.
    return res.status(error?.code === "BODY_TOO_LARGE" ? 413 : 502).json({ error: "Email delivery could not complete." });
  }
}

async function readRawBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > MAX_BODY) throw Object.assign(new Error("Body too large"), { code: "BODY_TOO_LARGE" });
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function verifySignature(raw, headers, secret, now = Date.now()) {
  const id = headers["webhook-id"];
  const timestamp = headers["webhook-timestamp"];
  const signature = headers["webhook-signature"];
  if (typeof id !== "string" || typeof timestamp !== "string" || typeof signature !== "string") return false;
  if (!/^\d+$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const decoded = Buffer.from(secret.replace(/^v1,/, "").replace(/^whsec_/, ""), "base64");
  if (decoded.length < 16) return false;
  const expected = createHmac("sha256", decoded).update(`${id}.${timestamp}.${raw}`).digest();
  return signature.split(/\s+/).some(value => {
    const [version, encoded] = value.split(",");
    if (version !== "v1" || !encoded) return false;
    const actual = Buffer.from(encoded, "base64");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
}

export function buildAuthEmails({ user, email_data: data }) {
  const action = data?.email_action_type;
  if (!Object.hasOwn(ACTIONS, action)) throw new Error("Unknown action");
  const project = new URL(process.env.SUPABASE_URL || "https://cxulgeojkjnskdyoktkj.supabase.co");
  if (project.protocol !== "https:" || project.username || project.password) throw new Error("Invalid project URL");
  const redirect = new URL(data.redirect_to || "https://talkaton.org/chat");
  const allowed = new Set(["https://talkaton.org", "https://www.talkaton.org", "https://subscriptions.talkaton.org"]);
  if (!allowed.has(redirect.origin) || redirect.username || redirect.password) throw new Error("Invalid redirect");
  const recipients = action === "email_change"
    ? [
        ...(data.token_hash_new ? [{ to: user.email, hash: data.token_hash_new, token: data.token }] : []),
        { to: user.new_email, hash: data.token_hash, token: data.token_new || data.token }
      ]
    : [{ to: user?.email, hash: data.token_hash, token: data.token }];
  return recipients.map(({ to, hash, token }) => {
    if (typeof to !== "string" || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(to)) throw new Error("Invalid recipient");
    let text;
    if (action === "reauthentication") {
      if (!/^\d{6,10}$/.test(token)) throw new Error("Invalid token");
      text = `${ACTIONS[action]}\n\nYour confirmation code is ${token}.`;
    } else {
      if (typeof hash !== "string" || !/^[a-zA-Z0-9_-]{1,256}$/.test(hash)) throw new Error("Invalid token hash");
      const link = new URL("/auth/v1/verify", project);
      link.searchParams.set("token", hash);
      link.searchParams.set("type", action);
      link.searchParams.set("redirect_to", redirect.href);
      text = `${ACTIONS[action]}\n\nContinue securely: ${link.href}`;
    }
    return { to: [to], subject: ACTIONS[action], text: `${text}\n\nIf you did not request this email, you can ignore it.` };
  });
}
