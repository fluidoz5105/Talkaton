import { usesOllama, generateOllamaText } from "./_ollama.js";
import { enforceGuestUsage, GuestUsageError } from "./_guest-guard.js";

const IMAGE_MODEL = "gpt-image-1-mini";
const COMMENTARY_MODEL = "openai/gpt-5.4-nano";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const controller = new AbortController();
  let timedOut = false;
  let clientDisconnected = false;

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 60000);

  const handleClientDisconnect = () => {
    if (res.writableEnded) return;
    clientDisconnected = true;
    controller.abort();
  };
  res.once("close", handleClientDisconnect);

  try {
    const prompt = String(req.body?.prompt || "").trim();

    if (!prompt) {
      clearTimeout(timeout);
      return res.status(400).json({
        error: "Image prompt is required."
      });
    }

    const usage = await enforceGuestUsage(req, "images");

    const outputFormat = "webp";
    const response = await fetch(
      "https://api.openai.com/v1/images/generations",
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${getOpenAIApiKey()}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: IMAGE_MODEL,
          prompt,
          size: "1024x1024",
          quality: "low",
          output_format: outputFormat,
          output_compression: 65
        })
      }
    );

    const responseText = await response.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      return res.status(500).json({
        error: "OpenAI returned invalid JSON.",
        response: responseText
      });
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error:
          data?.error?.message ||
          `OpenAI request failed (${response.status})`,
        details: data
      });
    }

    if (!Array.isArray(data.data) || data.data.length === 0) {
      return res.status(500).json({
        error: "No image was returned.",
        details: data
      });
    }

    const image = data.data[0];
    const commentary = await createImageCommentary(prompt, req.headers?.origin, controller.signal, usage.access);

    return res.status(200).json({
      success: true,
      image: {
        ...image,
        output_format: outputFormat,
        mime_type: `image/${outputFormat}`
      },
      provider: "openai",
      model: IMAGE_MODEL,
      commentary: commentary.text,
      commentary_provider: commentary.provider,
      commentary_model: commentary.model,
      usage: serializeUsage(usage, "images")
    });
  } catch (err) {
    if (err instanceof GuestUsageError) {
      return res.status(err.status).json({
        error: err.message,
        code: err.code
      });
    }

    if (err.name === "AbortError") {
      if (clientDisconnected) return;
      return res.status(504).json({
        error: timedOut ? "Image generation timed out." : "Image generation was canceled."
      });
    }

    console.error(err);

    return res.status(500).json({
      error: err.message || "Unknown server error."
    });
  } finally {
    clearTimeout(timeout);
    res.off("close", handleClientDisconnect);
  }
}

function serializeUsage(usage, feature) {
  const limit = usage?.access?.limits?.[feature];
  return {
    plan: usage?.access?.plan || "guest",
    feature,
    limit: Number.isFinite(limit) ? limit : null,
    remaining: Number.isFinite(usage?.remaining) ? usage.remaining : null
  };
}

function getOpenAIApiKey() {
  const key = process.env.OPENAI_API_KEY?.trim();

  if (!key) {
    throw new Error("OPENAI_API_KEY is missing.");
  }

  return key.startsWith("Bearer ")
    ? key.slice(7)
    : key;
}

async function createImageCommentary(prompt, origin, signal, access) {
  if (usesOllama(access)) {
    try {
      return await generateOllamaText([
        { role: "system", content: "Write one short sentence accompanying the generated image. Do not claim to visually inspect it." },
        { role: "user", content: String(prompt).slice(0, 2000) }
      ], signal);
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      return { text: "Your image is ready.", provider: "talkaton", model: "" };
    }
  }
  const key = String(process.env.OPENROUTER_API_KEY || "").trim().replace(/^Bearer\s+/i, "");
  const fallback = "Your image is ready.";

  if (!key) {
    return { text: fallback, provider: "talkaton", model: "" };
  }

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": normalizeOrigin(origin),
        "X-Title": "Talkaton Image Studio"
      },
      body: JSON.stringify({
        model: COMMENTARY_MODEL,
        stream: false,
        messages: [
          {
            role: "system",
            content: "You are Talkaton. Write one short, natural sentence to accompany a newly generated image. Speak directly to the user. Do not repeat the full prompt, do not say 'Created from', and do not claim you visually inspected details that were not in the prompt."
          },
          {
            role: "user",
            content: `The image was generated for this request: ${String(prompt).slice(0, 2000)}`
          }
        ]
      })
    });

    if (!response.ok) {
      console.warn("OpenRouter image commentary failed", response.status);
      return { text: fallback, provider: "talkaton", model: "" };
    }

    const data = await response.json();
    const text = extractOpenRouterText(data).trim();
    return text
      ? { text, provider: "openrouter", model: data.model || COMMENTARY_MODEL }
      : { text: fallback, provider: "talkaton", model: "" };
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    console.warn("OpenRouter image commentary unavailable", error?.message || error);
    return { text: fallback, provider: "talkaton", model: "" };
  }
}

function extractOpenRouterText(data) {
  const content = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.delta?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map(part => {
    if (typeof part === "string") return part;
    return typeof part?.text === "string" ? part.text : "";
  }).join("");
}

function normalizeOrigin(value) {
  try {
    const url = new URL(String(value || "https://talkaton.org"));
    return `${url.protocol}//${url.host}`;
  } catch {
    return "https://talkaton.org";
  }
}
