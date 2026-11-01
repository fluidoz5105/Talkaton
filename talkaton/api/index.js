import route0 from "../server/auth-email.js";
import route1 from "../server/beta-status.js";
import route2 from "../server/billing-checkout.js";
import route3 from "../server/billing-portal.js";
import route4 from "../server/billing-status.js";
import route5 from "../server/chat.js";
import route6 from "../server/developer-keys.js";
import route7 from "../server/github.js";
import route8 from "../server/github-oauth.js";
import route9 from "../server/image.js";
import route10 from "../server/realtime-session.js";
import route11 from "../server/search.js";
import route12 from "../server/transcribe.js";
// Keep one Vercel function while preserving every existing API URL.
export const config = { api: { bodyParser: false } };
const routes = {
  "auth-email": route0,
  "beta-status": route1,
  "billing-checkout": route2,
  "billing-portal": route3,
  "billing-status": route4,
  "chat": route5,
  "developer-keys": route6,
  "github": route7,
  "github-oauth": route8,
  "image": route9,
  "realtime-session": route10,
  "search": route11,
  "transcribe": route12,
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
  const endpoint = routes[route];
  return endpoint(req, res);
}
