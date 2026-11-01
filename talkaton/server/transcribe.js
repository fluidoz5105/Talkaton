import { enforceGuestUsage, GuestUsageError } from "./_guest-guard.js";

export const config = {
  api: { bodyParser: false }
};

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const SUPPORTED_AUDIO_TYPES = new Map([
  ["audio/webm", "webm"],
  ["audio/ogg", "ogg"],
  ["audio/mp4", "m4a"],
  ["audio/mpeg", "mp3"],
  ["audio/wav", "wav"],
  ["audio/x-wav", "wav"]
]);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
    if (!apiKey) {
      return res.status(500).json({
        error: "Voice transcription is not configured.",
        code: "OPENAI_KEY_MISSING"
      });
    }

    const contentType = String(req.headers?.["content-type"] || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    const extension = SUPPORTED_AUDIO_TYPES.get(contentType);
    if (!extension) {
      return res.status(415).json({ error: "Use WebM, OGG, M4A, MP3, or WAV audio." });
    }

    await enforceGuestUsage(req, "voice");
    const audio = await readAudioBody(req);
    if (audio.length < 256) {
      return res.status(400).json({ error: "The recording was empty. Try speaking again." });
    }

    const form = new FormData();
    form.append("file", new Blob([audio], { type: contentType }), `talkaton-voice.${extension}`);
    form.append("model", "gpt-transcribe");
    form.append("prompt", "A conversational message addressed to Talkaton.");
    const language = normalizeLanguage(req.headers?.["x-audio-language"]);
    if (language) form.append("languages[]", language);

    const upstream = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form
    });
    const data = await readJson(upstream);
    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: data?.error?.message || `Voice transcription failed (${upstream.status}).`
      });
    }

    const text = String(data?.text || "").trim();
    if (!text) {
      return res.status(422).json({ error: "No speech was detected. Try again a little closer to the microphone." });
    }

    return res.status(200).json({
      text,
      languages: Array.isArray(data?.languages) ? data.languages : []
    });
  } catch (error) {
    if (error instanceof GuestUsageError) {
      return res.status(error.status).json({
        error: error.message,
        code: error.code
      });
    }
    if (error instanceof AudioBodyError) {
      return res.status(error.status).json({ error: error.message });
    }
    return res.status(500).json({ error: "Voice transcription failed. Please try again." });
  }
}

class AudioBodyError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "AudioBodyError";
    this.status = status;
  }
}

async function readAudioBody(req) {
  if (Buffer.isBuffer(req.body)) return validateAudioSize(req.body);
  if (req.body instanceof Uint8Array) return validateAudioSize(Buffer.from(req.body));
  if (typeof req.body === "string") return validateAudioSize(Buffer.from(req.body));

  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_AUDIO_BYTES) {
      throw new AudioBodyError("Voice recordings must be 10 MB or smaller.", 413);
    }
    chunks.push(buffer);
  }
  return validateAudioSize(Buffer.concat(chunks));
}

function validateAudioSize(audio) {
  if (audio.length > MAX_AUDIO_BYTES) {
    throw new AudioBodyError("Voice recordings must be 10 MB or smaller.", 413);
  }
  return audio;
}

function normalizeLanguage(value) {
  const language = String(value || "").trim().toLowerCase().split("-")[0];
  return /^[a-z]{2,3}$/.test(language) ? language : "";
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}
