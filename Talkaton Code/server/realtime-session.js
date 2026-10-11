import { createHmac } from "node:crypto";
import { enforceGuestUsage, GuestUsageError } from "./_guest-guard.js";

const TRUSTED_ORIGINS = new Set(["https://talkaton.org", "https://www.talkaton.org"]);
const VOICES = new Set(["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar"]);
const MAX_SDP_BYTES = 128_000;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const origin = String(req.headers?.origin || "").trim();
  if (origin && !TRUSTED_ORIGINS.has(origin) && !isLocalOrigin(origin)) {
    return res.status(403).json({ error: "This origin is not allowed." });
  }

  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) return res.status(503).json({ error: "Live WebRTC voice is not configured yet." });

  const sdp = readSdp(req.body);
  if (!sdp || !/^v=0(?:\r?\n)/.test(sdp)) {
    return res.status(400).json({ error: "A valid WebRTC SDP offer is required." });
  }
  if (Buffer.byteLength(sdp, "utf8") > MAX_SDP_BYTES) {
    return res.status(413).json({ error: "The WebRTC offer is too large." });
  }

  try {
    const usage = await enforceGuestUsage(req, "voice", 75);
    if (["free", "guest"].includes(usage.access.plan)) {
      return res.status(403).json({ error: "Use recorded voice chat on this plan; replies use Ollama.", code: "OLLAMA_VOICE_REQUIRED" });
    }
    const requestedVoice = String(req.query?.voice || "marin").trim().toLowerCase();
    const voice = VOICES.has(requestedVoice) ? requestedVoice : "marin";
    const model = String(process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2.1").trim();
    const session = {
      type: "realtime",
      model,
      instructions: "You are Talkaton in a live voice conversation. Be natural, concise, helpful, and safe. Do not claim to have performed actions you did not perform.",
      audio: {
        input: {
          transcription: { model: "gpt-4o-mini-transcribe" },
          turn_detection: {
            type: "server_vad",
            create_response: true,
            interrupt_response: true
          }
        },
        output: { voice }
      }
    };
    const form = new FormData();
    form.set("sdp", sdp);
    form.set("session", JSON.stringify(session));
    const upstream = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "OpenAI-Safety-Identifier": safetyIdentifier(req, usage.access, apiKey)
      },
      body: form
    });
    const answer = await upstream.text();
    if (!upstream.ok) {
      let message = "The live voice session could not start.";
      try { message = JSON.parse(answer)?.error?.message || message; } catch {}
      return res.status(upstream.status >= 500 ? 502 : upstream.status).json({ error: message });
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/sdp");
    res.setHeader("X-Talkaton-Voice-Model", model);
    return res.end(answer);
  } catch (error) {
    if (error instanceof GuestUsageError) {
      return res.status(error.status || 429).json({ error: error.message, code: error.code });
    }
    console.error("Realtime voice session failed:", error);
    return res.status(502).json({ error: "Live voice is temporarily unavailable." });
  }
}

function readSdp(body) {
  if (typeof body === "string") return body;
  if (Buffer.isBuffer(body)) return body.toString("utf8");
  if (body && typeof body.sdp === "string") return body.sdp;
  return "";
}

function safetyIdentifier(req, access, secret) {
  const subject = access?.user?.id
    ? `user:${access.user.id}`
    : `guest:${req.headers?.["x-forwarded-for"] || req.socket?.remoteAddress || "unknown"}:${req.headers?.["user-agent"] || "unknown"}`;
  return `talkaton_${createHmac("sha256", secret).update(subject).digest("hex").slice(0, 40)}`;
}

function isLocalOrigin(origin) {
  return process.env.NODE_ENV !== "production" && /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(origin);
}
