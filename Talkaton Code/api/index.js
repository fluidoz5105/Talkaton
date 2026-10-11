// Keep one Vercel function while preserving every existing API URL.
export const config = { api: { bodyParser: false } };
const routes = {
  "auth-email": () => import("../server/auth-email.js"),
  "beta-status": () => import("../server/beta-status.js"),
  "billing-checkout": () => import("../server/billing-checkout.js"),
  "billing-portal": () => import("../server/billing-portal.js"),
  "billing-status": () => import("../server/billing-status.js"),
  "chat": () => import("../server/chat.js"),
  "developer-keys": () => import("../server/developer-keys.js"),
  "github": () => import("../server/github.js"),
  "github-oauth": () => import("../server/github-oauth.js"),
  "image": () => import("../server/image.js"),
  "realtime-session": () => import("../server/realtime-session.js"),
  "search": () => import("../server/search.js"),
  "transcribe": () => import("../server/transcribe.js"),
};
export default async function handler(req, res) {
  const route = req.query?.endpoint;
  if (typeof route !== "string" || !Object.hasOwn(routes, route)) {
    return res.status(404).json({ error: "API route not found." });
  }
  // Signed hooks and audio uploads must receive the original request bytes.
  if (!["auth-email", "transcribe"].includes(route) && ["POST", "PUT", "PATCH"].includes(req.method)) {
    try {
      if (req.body === undefined) {
        const chunks = [];
        let length = 0;
        for await (const chunk of req) {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          length += bytes.length;
          if (length > 4 * 1024 * 1024) return res.status(413).json({ error: "Request body is too large." });
          chunks.push(bytes);
        }
        const raw = Buffer.concat(chunks).toString("utf8");
        req.body = String(req.headers["content-type"] || "").includes("application/json") ? JSON.parse(raw || "{}") : raw;
      }
    } catch {
      return res.status(400).json({ error: "Invalid request body." });
    }
  }
  const { default: endpoint } = await routes[route]();
  return endpoint(req, res);
}
