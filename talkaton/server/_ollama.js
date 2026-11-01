const DEFAULT_OLLAMA_FALLBACK_MODEL = "gemma4:31b";
const OLLAMA_CLOUD_URL = "https://ollama.com/api";
export class OllamaConfigurationError extends Error {
  constructor(message, code, cause, status = 503) { super(message); this.code = code; this.status = status; }
}
export function usesOllama(access) { return ["free", "guest"].includes(access?.plan); }

export function getOllamaFallbackConfig() {
  const apiKey = String(process.env.OLLAMA_API_KEY || "").trim();
  if (!apiKey) {
    throw new OllamaConfigurationError(
      "Ollama is not configured yet. Please try again later.",
      "OLLAMA_KEY_MISSING",
      null,
      503
    );
  }

  const rawBaseUrl = String(process.env.OLLAMA_BASE_URL || OLLAMA_CLOUD_URL).trim().replace(/\/+$/, "");
  let baseUrl;
  try {
    const parsed = new URL(rawBaseUrl);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    const localDevelopment = loopback && !process.env.VERCEL_ENV && process.env.NODE_ENV !== "production";
    if (parsed.username || parsed.password || parsed.search || parsed.hash || (loopback && !localDevelopment)) throw new Error("invalid URL");
    if (parsed.protocol !== "https:" && !(localDevelopment && parsed.protocol === "http:")) throw new Error("insecure");
    baseUrl = parsed.toString().replace(/\/+$/, "");
  } catch {
    throw new OllamaConfigurationError(
      "OLLAMA_BASE_URL must be an HTTPS Ollama API URL.",
      "OLLAMA_URL_INVALID",
      null,
      503
    );
  }

  const model = String(process.env.OLLAMA_FALLBACK_MODEL || DEFAULT_OLLAMA_FALLBACK_MODEL).trim();
  if (!/^[A-Za-z0-9._:/-]{1,120}$/.test(model)) {
    throw new OllamaConfigurationError(
      "OLLAMA_FALLBACK_MODEL is invalid.",
      "OLLAMA_MODEL_INVALID",
      null,
      503
    );
  }

  return { apiKey, baseUrl, model };
}

export function isOllamaFallbackConfigured() {
  return Boolean(String(process.env.OLLAMA_API_KEY || "").trim());
}

export function createOllamaHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
}

export async function generateOllamaText(messages, signal) {
  const config = getOllamaFallbackConfig();
  const response = await fetch(`${config.baseUrl}/chat`, {
    method: "POST", headers: createOllamaHeaders(config.apiKey), signal,
    body: JSON.stringify({ model: config.model, stream: false, think: false, messages })
  });
  if (!response.ok) throw new Error("Ollama is temporarily unavailable.");
  const data = await response.json();
  const text = String(data?.message?.content || "").trim();
  if (!text) throw new Error("Ollama returned an empty response.");
  return { text, model: `ollama/${config.model}`, provider: "ollama" };
}
