import { usesOllama, getOllamaFallbackConfig, isOllamaFallbackConfigured, createOllamaHeaders, OllamaConfigurationError } from "./_ollama.js";
import { createHash } from "node:crypto";
import { enforceGuestUsage, getAccountAccess, GuestUsageError } from "./_guest-guard.js";

const MAX_HISTORY_MESSAGES = 18;
const MAX_MEMORY_ITEMS = 8;
const MAX_ATTACHMENTS = 10;
const MAX_EXTRACTED_TEXT = 260_000;
const OPENROUTER_KEY_PATTERN = /^sk-or-v1-[A-Za-z0-9_-]{16,}$/;
const DEFAULT_MODEL = "openai/gpt-5.4-nano";
const OPENROUTER_FALLBACK_STATUSES = new Set([402, 408, 429, 500, 502, 503, 504]);
const SUPABASE_URL = "https://cxulgeojkjnskdyoktkj.supabase.co";
const SUPABASE_KEY = "sb_publishable_GgxtfIaIamzZFY_jMU4_Cw_V8NKm475";
const ACCOUNT_ROLES = new Map([
  ["kantertal1@gmail.com", "owner"],
  ["donotuseunlessyouaretalkanter@gmail.com", "owner_alt"],
  ["supportaton@gmail.com", "support"]
]);
const SUPPORTED_MODELS = new Set([
  "openai/gpt-5.4",
  DEFAULT_MODEL,
  "openai/gpt-4.1-mini",
  "openai/gpt-5.4-mini",
  "anthropic/claude-3-haiku",
  "google/gemini-2.5-flash-lite",
  "~google/gemini-flash-latest",
  "microsoft/phi-4",
  "cohere/command-r-08-2024",
  "qwen/qwen-2.5-72b-instruct",
  "deepseek/deepseek-chat",
  "meta-llama/llama-3.1-8b-instruct",
  "mistralai/mistral-small-3.1-24b-instruct"
]);
const MODEL_ALIASES = new Map([
  ["google/gemini-pro", "google/gemini-2.5-flash-lite"],
  ["google/gemini-flash-1.5", "~google/gemini-flash-latest"],
  ["gemini-1.5-flash", "~google/gemini-flash-latest"],
  ["microsoft/phi-3.5-mini-128k-instruct", "microsoft/phi-4"],
  ["phi-3.5-mini", "microsoft/phi-4"],
  ["command-r", "cohere/command-r-08-2024"],
  ["qwen-2.5", "qwen/qwen-2.5-72b-instruct"]
]);
const FREE_MODELS = new Set([
  DEFAULT_MODEL,
  "deepseek/deepseek-chat",
  "meta-llama/llama-3.1-8b-instruct",
  "mistralai/mistral-small-3.1-24b-instruct"
]);

export default async function handler(req, res) {
  const requestId = getRequestId(req);
  const startedAt = Date.now();

  logInfo(requestId, "Request received", { method: req.method });

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const abortController = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abortController.abort();
  });

  try {
    const {
      message,
      model,
      plan,
      timeZone,
      history = [],
      memory = [],
      agent = null,
      attachments = []
    } = req.body || {};

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Message is required." });
    }

    const usageDecision = await resolveChatUsage(req);
    const usage = usageDecision.usage;
    const accountAccess = usage.access;
    const betaAccessApproved = accountAccess.betaApproved || await hasApprovedBetaAccess(req);
    const safeHistory = sanitizeHistory(history);
    const safeMemory = sanitizeMemory(memory);
    const safeAgent = sanitizeAgent(agent);
    const safeAttachments = sanitizeAttachments(attachments);
    const userContent = createUserContent(message, safeAttachments);
    const hasPdf = safeAttachments.some(attachment => attachment.kind === "pdf");
    const requestedModel = resolveModel(model);
    const selectedModel = FREE_MODELS.has(requestedModel) || betaAccessApproved || accountAccess.allModels
      ? requestedModel
      : DEFAULT_MODEL;
    const userTimeZone = resolveTimeZone(timeZone);
    const requestTime = new Date(startedAt);
    const systemPrompt = createSystemPrompt(accountAccess.plan || plan, safeMemory, requestTime, userTimeZone, safeAgent);
    const openRouterMessages = [
      { role: "system", content: systemPrompt },
      ...safeHistory,
      { role: "user", content: userContent }
    ];

    if (usesOllama(accountAccess) || model === "ollama/default" || usageDecision.fallbackReason) {
      return await streamOllamaFallback({
        res,
        requestId,
        usage,
        systemPrompt,
        history: safeHistory,
        message,
        attachments: safeAttachments,
        signal: abortController.signal,
        reason: usageDecision.fallbackReason || "",
        startedAt
      });
    }

    let apiKey;
    try {
      apiKey = getValidatedOpenRouterApiKey(requestId);
    } catch (error) {
      if (!accountAccess.paid || !isOllamaFallbackConfigured()) throw error;
      return await streamOllamaFallback({
        res,
        requestId,
        usage,
        systemPrompt,
        history: safeHistory,
        message,
        attachments: safeAttachments,
        signal: abortController.signal,
        reason: "primary-configuration",
        startedAt
      });
    }
    const openRouterHeaders = createOpenRouterHeaders(apiKey, req.headers.origin, requestId);

    logInfo(requestId, "Sending OpenRouter request", {
      requestedModel: typeof model === "string" ? model : "",
      model: selectedModel,
      timeZone: userTimeZone,
      historyMessages: safeHistory.length,
      memoryItems: safeMemory.length,
      attachments: safeAttachments.length
    });

    const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: openRouterHeaders,
      signal: abortController.signal,
      body: JSON.stringify({
        model: selectedModel,
        stream: true,
        messages: openRouterMessages,
        ...(hasPdf ? {
          plugins: [{
            id: "file-parser",
            pdf: { engine: "cloudflare-ai" }
          }]
        } : {})
      })
    });

    logInfo(requestId, "OpenRouter response received", {
      status: upstream.status,
      ok: upstream.ok,
      contentType: upstream.headers.get("content-type") || "",
      openRouterRequestId: upstream.headers.get("x-request-id") || "",
      elapsedMs: Date.now() - startedAt
    });

    if (!upstream.ok) {
      if (accountAccess.paid && OPENROUTER_FALLBACK_STATUSES.has(upstream.status)) {
        return await streamOllamaFallback({
          res,
          requestId,
          usage,
          systemPrompt,
          history: safeHistory,
          message,
          attachments: safeAttachments,
          signal: abortController.signal,
          reason: `openrouter-${upstream.status}`,
          startedAt
        });
      }
      const errorData = await readErrorBody(upstream);
      return res.status(upstream.status).json({
        error: errorData?.error?.message || errorData?.message || `Model request failed (${upstream.status}).`
      });
    }

    if (!upstream.body) {
      return res.status(502).json({ error: "The model returned an empty response." });
    }

    startEventStream(res, requestId, usage, {
      provider: "openrouter",
      model: selectedModel
    });
    const upstreamContentType = upstream.headers.get("content-type") || "";
    const streamResult = upstreamContentType.includes("text/event-stream")
      ? await relayOpenRouterStream(upstream.body, res)
      : await relayOpenRouterJson(upstream, res);

    logInfo(requestId, "OpenRouter stream completed", {
      streamedBytes: streamResult.bytes,
      emittedCharacters: streamResult.characters,
      upstreamCompleted: streamResult.completed,
      elapsedMs: Date.now() - startedAt
    });
    if (!streamResult.completed) writeSseData(res, "[DONE]");
    res.end();
  } catch (error) {
    if (error?.name === "AbortError") {
      logInfo(requestId, "Chat request aborted", {
        elapsedMs: Date.now() - startedAt
      });
      if (!res.writableEnded) res.end();
      return;
    }

    logError(requestId, "Chat request failed", error, {
      elapsedMs: Date.now() - startedAt,
      headersSent: res.headersSent
    });

    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: { message: "The response stream was interrupted." } })}\n\n`);
      res.write("data: [DONE]\n\n");
      return res.end();
    }

    if (error instanceof ChatConfigurationError || error instanceof OllamaConfigurationError) {
      return res.status(error.status || 500).json({
        error: error.message,
        code: error.code,
        requestId
      });
    }

    if (error instanceof GuestUsageError) {
      return res.status(error.status).json({
        error: error.message,
        code: error.code,
        requestId
      });
    }

    return res.status(500).json({
      error: "Chat failed. Please try again.",
      requestId
    });
  }
}

function startEventStream(res, requestId, usage, { provider = "openrouter", model = "", fallbackReason = "" } = {}) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("X-Request-Id", requestId);
  res.setHeader("X-Talkaton-Provider", provider);
  if (model) res.setHeader("X-Talkaton-Model", model);
  if (fallbackReason) res.setHeader("X-Talkaton-Fallback", fallbackReason);
  setUsageHeaders(res, usage, "messages");
  res.flushHeaders?.();
  res.write(": connected\n\n");
}

function setUsageHeaders(res, usage, feature) {
  const limit = usage?.access?.limits?.[feature];
  const remaining = usage?.remaining;
  res.setHeader("X-Talkaton-Plan", String(usage?.access?.plan || "guest"));
  res.setHeader("X-Talkaton-Usage-Feature", feature);
  res.setHeader("X-Talkaton-Usage-Limit", Number.isFinite(limit) ? String(limit) : "unlimited");
  res.setHeader("X-Talkaton-Usage-Remaining", Number.isFinite(remaining) ? String(remaining) : "unlimited");
}

async function resolveChatUsage(req) {
  try {
    return { usage: await enforceGuestUsage(req, "messages"), fallbackReason: "" };
  } catch (error) {
    if (!(error instanceof GuestUsageError) || error.code !== "PLAN_LIMIT_REACHED") throw error;
    const access = await getAccountAccess(req);
    if (!access.paid) throw error;
    return {
      usage: {
        guest: false,
        allowed: true,
        used: Number(access.limits?.messages) || 0,
        remaining: 0,
        access
      },
      fallbackReason: "paid-plan-overflow"
    };
  }
}

async function streamOllamaFallback({
  res,
  requestId,
  usage,
  systemPrompt,
  history,
  message,
  attachments,
  signal,
  reason,
  startedAt
}) {
  const config = getOllamaFallbackConfig();
  const modelLabel = `ollama/${config.model}`;
  const upstream = await fetch(`${config.baseUrl}/chat`, {
    method: "POST",
    headers: createOllamaHeaders(config.apiKey),
    signal,
    body: JSON.stringify({
      model: config.model,
      stream: true,
      think: false,
      messages: createOllamaMessages(systemPrompt, history, message, attachments)
    })
  });

  logInfo(requestId, "Ollama fallback response received", {
    status: upstream.status,
    ok: upstream.ok,
    model: config.model,
    reason,
    elapsedMs: Date.now() - startedAt
  });

  if (!upstream.ok) {
    const errorData = await readErrorBody(upstream);
    logError(
      requestId,
      "Ollama fallback failed",
      new Error(errorData?.error || errorData?.message || `HTTP ${upstream.status}`),
      { status: upstream.status, reason }
    );
    return res.status(502).json({
      error: "Ollama is temporarily unavailable. Please try again shortly.",
      code: "OLLAMA_FALLBACK_UNAVAILABLE",
      requestId
    });
  }

  if (!upstream.body) {
    return res.status(502).json({
      error: "Ollama returned an empty response.",
      code: "OLLAMA_FALLBACK_EMPTY",
      requestId
    });
  }

  startEventStream(res, requestId, usage, {
    provider: "ollama",
    model: modelLabel,
    fallbackReason: reason
  });
  const contentType = upstream.headers.get("content-type") || "";
  const streamResult = contentType.includes("application/json") && !contentType.includes("ndjson")
    ? await relayOllamaJson(upstream, res, modelLabel)
    : await relayOllamaStream(upstream.body, res, modelLabel);
  if (!streamResult.completed) writeSseData(res, "[DONE]");
  res.end();
}

function createOllamaMessages(systemPrompt, history, message, attachments) {
  return [
    { role: "system", content: systemPrompt },
    ...history.map(item => ({ role: item.role, content: item.content })),
    createOllamaUserMessage(message, attachments)
  ];
}

function createOllamaUserMessage(message, attachments) {
  const context = [];
  const images = [];
  for (const attachment of attachments) {
    if (attachment.kind === "image" && attachment.dataUrl) {
      const base64 = attachment.dataUrl.split(",", 2)[1] || "";
      if (base64) images.push(base64);
    }
    if (attachment.extractedText) {
      context.push(`--- Attached file: ${attachment.name} (${attachment.type}) ---\n${attachment.extractedText}`);
    } else if (attachment.kind !== "image") {
      context.push(`[Attached file: ${attachment.name}; no extracted text was available to Ollama.]`);
    }
  }
  return {
    role: "user",
    content: [message, ...context].join("\n\n"),
    ...(images.length ? { images } : {})
  };
}

async function relayOllamaStream(body, res, modelLabel) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let bytes = 0;
  let characters = 0;
  let completed = false;

  while (!completed) {
    const { done, value } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      break;
    }
    bytes += value.byteLength;
    buffer += decoder.decode(value, { stream: true });
    const parsed = consumeOllamaLines(buffer, res, modelLabel);
    buffer = parsed.remainder;
    characters += parsed.characters;
    completed = parsed.completed;
  }
  if (!completed && buffer.trim()) {
    const parsed = consumeOllamaLines(`${buffer}\n`, res, modelLabel);
    characters += parsed.characters;
    completed = parsed.completed;
  }
  return { bytes, characters, completed };
}

function consumeOllamaLines(source, res, modelLabel) {
  const lines = source.split(/\r?\n/);
  const remainder = lines.pop() || "";
  let characters = 0;
  let completed = false;
  for (const line of lines) {
    if (!line.trim()) continue;
    let payload;
    try {
      payload = JSON.parse(line);
    } catch {
      continue;
    }
    if (payload?.error) {
      writeSseData(res, JSON.stringify({ error: { message: "The Ollama backup stream was interrupted." } }));
      writeSseData(res, "[DONE]");
      completed = true;
      break;
    }
    const text = String(payload?.message?.content || payload?.response || "");
    if (text) {
      characters += text.length;
      writeSseData(res, JSON.stringify({
        model: modelLabel,
        choices: [{ delta: { content: text } }]
      }));
    }
    if (payload?.done) {
      writeSseData(res, "[DONE]");
      completed = true;
      break;
    }
  }
  return { remainder, characters, completed };
}

async function relayOllamaJson(upstream, res, modelLabel) {
  const raw = await upstream.text();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error("The Ollama backup returned an unreadable response.");
  }
  const text = String(payload?.message?.content || payload?.response || "");
  if (!text) throw new Error("The Ollama backup returned an empty response.");
  writeSseData(res, JSON.stringify({
    model: modelLabel,
    choices: [{ delta: { content: text } }]
  }));
  writeSseData(res, "[DONE]");
  return { bytes: Buffer.byteLength(raw), characters: text.length, completed: true };
}

async function relayOpenRouterStream(body, res) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let bytes = 0;
  let characters = 0;
  let completed = false;

  while (!completed) {
    const { done, value } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      break;
    }
    bytes += value.byteLength;
    buffer += decoder.decode(value, { stream: true });
    const parsed = consumeUpstreamEvents(buffer, res);
    buffer = parsed.remainder;
    characters += parsed.characters;
    completed = parsed.completed;
  }

  if (!completed && buffer.trim()) {
    const parsed = consumeUpstreamEvents(`${buffer}\n\n`, res);
    characters += parsed.characters;
    completed = parsed.completed;
  }

  return { bytes, characters, completed };
}

function consumeUpstreamEvents(source, res) {
  const events = source.split(/\r?\n\r?\n/);
  const remainder = events.pop() || "";
  let characters = 0;
  let completed = false;

  for (const event of events) {
    const data = event.split(/\r?\n/)
      .filter(line => line.startsWith("data:"))
      .map(line => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data) continue;
    if (data === "[DONE]") {
      writeSseData(res, "[DONE]");
      completed = true;
      break;
    }

    let payload;
    try {
      payload = JSON.parse(data);
    } catch {
      continue;
    }
    if (payload?.error) {
      const message = payload.error.message || payload.message || "The model stream failed.";
      writeSseData(res, JSON.stringify({ error: { message } }));
      writeSseData(res, "[DONE]");
      completed = true;
      break;
    }
    const text = extractAssistantText(payload);
    if (!text) continue;
    characters += text.length;
    writeSseData(res, JSON.stringify({
      id: payload.id,
      model: payload.model,
      choices: [{ delta: { content: text } }]
    }));
  }

  return { remainder, characters, completed };
}

async function relayOpenRouterJson(upstream, res) {
  const raw = await upstream.text();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error("The model returned an unreadable response.");
  }
  if (payload?.error) throw new Error(payload.error.message || payload.message || "The model request failed.");
  const text = extractAssistantText(payload);
  if (!text) throw new Error("The model returned an empty response.");
  writeSseData(res, JSON.stringify({
    id: payload.id,
    model: payload.model,
    choices: [{ delta: { content: text } }]
  }));
  writeSseData(res, "[DONE]");
  return { bytes: Buffer.byteLength(raw), characters: text.length, completed: true };
}

function extractAssistantText(payload) {
  const choice = payload?.choices?.[0];
  return extractText(choice?.delta?.content)
    || extractText(choice?.message?.content)
    || extractText(payload?.output_text)
    || extractText(payload?.response?.output_text);
}

function extractText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map(part => {
    if (typeof part === "string") return part;
    if (!part || typeof part !== "object") return "";
    if (["text", "output_text"].includes(part.type) && typeof part.text === "string") return part.text;
    return "";
  }).join("");
}

function writeSseData(res, data) {
  res.write(`data: ${data}\n\n`);
}

class ChatConfigurationError extends Error {
  constructor(message, code, cause, status = 500) {
    super(message, cause ? { cause } : undefined);
    this.name = "ChatConfigurationError";
    this.code = code;
    this.status = status;
  }
}

function getValidatedOpenRouterApiKey(requestId) {
  const rawKey = process.env.OPENROUTER_API_KEY;

  logInfo(requestId, "Validating OpenRouter API key", {
    configured: typeof rawKey === "string",
    valueType: typeof rawKey,
    rawLength: typeof rawKey === "string" ? rawKey.length : 0
  });

  if (typeof rawKey !== "string") {
    throw new ChatConfigurationError(
      "Missing OPENROUTER_API_KEY. Add it to your deployment environment variables.",
      "OPENROUTER_KEY_MISSING"
    );
  }

  const apiKey = rawKey.trim();
  if (!apiKey) {
    throw new ChatConfigurationError(
      "OPENROUTER_API_KEY is empty. Add a valid OpenRouter API key.",
      "OPENROUTER_KEY_EMPTY"
    );
  }

  if (/^Bearer(?:\s|$)/i.test(apiKey)) {
    throw new ChatConfigurationError(
      "OPENROUTER_API_KEY must contain only the key, without the Bearer prefix.",
      "OPENROUTER_KEY_HAS_BEARER_PREFIX"
    );
  }

  if (/[\u0000-\u001f\u007f]/.test(apiKey)) {
    throw new ChatConfigurationError(
      "OPENROUTER_API_KEY contains a line break or invalid control character.",
      "OPENROUTER_KEY_HAS_CONTROL_CHARACTERS"
    );
  }

  if (!OPENROUTER_KEY_PATTERN.test(apiKey)) {
    throw new ChatConfigurationError(
      "OPENROUTER_API_KEY is malformed. Expected a key beginning with sk-or-v1-.",
      "OPENROUTER_KEY_MALFORMED"
    );
  }

  logInfo(requestId, "OpenRouter API key validated", {
    normalizedWhitespace: apiKey.length !== rawKey.length,
    normalizedLength: apiKey.length,
    prefixValid: true,
    keyFingerprint: fingerprintSecret(apiKey)
  });

  return apiKey;
}

function createOpenRouterHeaders(apiKey, origin, requestId) {
  const authorizationValue = `Bearer ${apiKey}`;
  if (!/^[\x20-\x7e]+$/.test(authorizationValue)) {
    throw new ChatConfigurationError(
      "The OpenRouter Authorization header contains invalid characters.",
      "OPENROUTER_AUTHORIZATION_INVALID"
    );
  }

  const headers = new Headers();
  try {
    headers.set("Authorization", authorizationValue);
    headers.set("Content-Type", "application/json");
    headers.set("HTTP-Referer", getSafeReferer(origin));
    headers.set("X-Title", "Talkaton");
  } catch (error) {
    throw new ChatConfigurationError(
      "Failed to create valid OpenRouter request headers.",
      "OPENROUTER_HEADERS_INVALID",
      error
    );
  }

  logInfo(requestId, "OpenRouter Authorization header created", {
    scheme: "Bearer",
    headerLength: authorizationValue.length,
    headersInstance: "request-local"
  });

  return headers;
}

function getSafeReferer(origin) {
  if (typeof origin !== "string") return "https://talkaton.org";
  try {
    const url = new URL(origin);
    if (url.protocol === "https:" || url.hostname === "localhost") return url.origin;
  } catch {}
  return "https://talkaton.org";
}

function resolveModel(requestedModel) {
  if (typeof requestedModel !== "string") return DEFAULT_MODEL;
  const normalized = requestedModel.trim();
  const resolved = MODEL_ALIASES.get(normalized) || normalized;
  return SUPPORTED_MODELS.has(resolved) ? resolved : DEFAULT_MODEL;
}

function getRequestId(req) {
  const vercelId = req.headers?.["x-vercel-id"];
  if (typeof vercelId === "string" && vercelId) return vercelId;
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function fingerprintSecret(secret) {
  return createHash("sha256").update(secret).digest("hex").slice(0, 12);
}

function logInfo(requestId, event, details = {}) {
  console.info(`[api/chat][${requestId}] ${event}`, details);
}

function logError(requestId, event, error, details = {}) {
  console.error(
    `[api/chat][${requestId}] ${event}`,
    details,
    error?.stack || error
  );
}

function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter(item => item && ["user", "assistant"].includes(item.role) && typeof item.content === "string")
    .slice(-MAX_HISTORY_MESSAGES)
    .map(({ role, content }) => ({ role, content: content.slice(0, MAX_EXTRACTED_TEXT) }));
}

function sanitizeMemory(memory) {
  if (!Array.isArray(memory)) return [];
  return memory
    .slice(-MAX_MEMORY_ITEMS)
    .map(item => {
      if (typeof item === "string") return item.slice(0, 8_000);
      if (!item || typeof item !== "object") return "";
      return `User: ${String(item.user || "").slice(0, 4_000)}\nTalkaton: ${String(item.ai || "").slice(0, 4_000)}`;
    })
    .filter(Boolean);
}

function sanitizeAttachments(attachments) {
  if (!Array.isArray(attachments)) return [];
  return attachments.slice(0, MAX_ATTACHMENTS).map(attachment => ({
    name: String(attachment?.name || "attachment").slice(0, 180),
    type: String(attachment?.type || "application/octet-stream").slice(0, 120),
    kind: String(attachment?.kind || "file").slice(0, 32),
    dataUrl: typeof attachment?.dataUrl === "string" && attachment.dataUrl.startsWith("data:")
      ? attachment.dataUrl
      : "",
    extractedText: typeof attachment?.extractedText === "string"
      ? attachment.extractedText.slice(0, MAX_EXTRACTED_TEXT)
      : ""
  }));
}

function createUserContent(message, attachments) {
  if (!attachments.length) return message;

  const content = [{ type: "text", text: message }];

  for (const attachment of attachments) {
    if (attachment.kind === "image" && attachment.dataUrl) {
      content.push({
        type: "image_url",
        image_url: { url: attachment.dataUrl }
      });
      continue;
    }

    if (attachment.kind === "pdf" && attachment.dataUrl) {
      content.push({
        type: "file",
        file: {
          filename: attachment.name,
          file_data: attachment.dataUrl
        }
      });
      continue;
    }

    if (attachment.kind === "document" && attachment.dataUrl) {
      content.push({
        type: "file",
        file: {
          filename: attachment.name,
          file_data: attachment.dataUrl
        }
      });
      if (attachment.extractedText) {
        content.push({
          type: "text",
          text: `\n\nAttached file: ${attachment.name}. Use the attached document as context.`
        });
      }
      continue;
    }

    if (attachment.kind === "folder" && attachment.extractedText) {
      content.push({
        type: "text",
        text: `\n\n--- Attached folder: ${attachment.name} ---\n${attachment.extractedText}`
      });
      continue;
    }

    if (attachment.extractedText) {
      content.push({
        type: "text",
        text: `\n\n--- Attached file: ${attachment.name} (${attachment.type}) ---\n${attachment.extractedText}`
      });
      continue;
    }

    if (attachment.dataUrl) {
      content.push({
        type: "file",
        file: {
          filename: attachment.name,
          file_data: attachment.dataUrl
        }
      });
    }
  }

  return content;
}

function sanitizeAgent(agent) {
  if (!agent || typeof agent !== "object") return null;
  const name = typeof agent.name === "string" ? agent.name.trim().slice(0, 60) : "";
  const instructions = typeof agent.instructions === "string"
    ? agent.instructions.trim().slice(0, 12_000)
    : "";
  if (!name || !instructions) return null;

  const allowedTools = new Set(["web", "images", "files", "python", "canvas"]);
  const tools = Array.isArray(agent.tools)
    ? [...new Set(agent.tools.map(tool => String(tool || "").trim()).filter(tool => allowedTools.has(tool)))]
    : [];
  let remainingKnowledge = 80_000;
  const knowledge = Array.isArray(agent.knowledge)
    ? agent.knowledge.slice(0, 8).flatMap(item => {
      if (!item || typeof item !== "object" || remainingKnowledge <= 0) return [];
      const itemName = String(item.name || "Knowledge file").trim().slice(0, 120);
      const rawText = String(item.text || item.extractedText || "").trim();
      if (!rawText) return [];
      const text = rawText.slice(0, Math.min(remainingKnowledge, 24_000));
      remainingKnowledge -= text.length;
      return [{ name: itemName, text }];
    })
    : [];

  return { name, instructions, tools, knowledge };
}

function createSystemPrompt(plan, memory, requestTime, timeZone, agent = null) {
  const localDate = new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeZone
  }).format(requestTime);
  const localTime = new Intl.DateTimeFormat("en-US", {
    timeStyle: "long",
    timeZone
  }).format(requestTime);

  const assistantIdentity = agent
    ? `You are ${agent.name}, an AI assistant running on Talkaton.`
    : "You are Talkaton.";

  return `${assistantIdentity}

Product identity:
- Talkaton (talkaton.org) is a standalone, multi-model Web AI Dashboard.
- It aggregates AI models including GPT, Claude, Gemini, and DeepSeek.
- Its product features include multi-model switching, live tools, and memory dashboards.
- Never confuse Talkaton with "Talkatone," the unrelated VoIP calling app.
- Never describe Talkaton as a calling, phone, texting, or VoIP service.

Personality:
- smart
- funny
- helpful
- slightly chaotic
- witty but not corny

Be helpful first. Funny second.
Use Markdown when it makes the answer clearer. Use fenced code blocks with language names. Use LaTeX delimiters for math.

Capabilities:
- You have access to web search results when provided in the user's message (marked with "[Web search results for ...]").
- When search results are provided, summarize them naturally. Do not mention that results were "provided" — just answer as if you looked it up.
- You have access to generated images when provided (marked with "[Image generated for ...]"). Describe the image naturally and reference it in your response.

Current time:
- User timezone: ${timeZone}
- User local date: ${localDate}
- User local time: ${localTime}
- UTC timestamp: ${requestTime.toISOString()}
- Treat this request timestamp as the authoritative current moment. Interpret relative dates such as today, tomorrow, and yesterday in the user's timezone.
- Knowing the current time does not guarantee knowledge of events that happened after your training data. Be honest when live information would require search.

Current plan: ${describePlan(plan)}.
${memory.length ? `Useful memory:\n${memory.join("\n\n")}` : ""}
${agent ? `\nActive custom agent: ${agent.name}
Follow these user-authored agent instructions unless they conflict with safety, platform rules, or the user's current request:
${agent.instructions}
Enabled agent tools: ${agent.tools.length ? agent.tools.join(", ") : "none"}.
${agent.knowledge.length ? `Agent knowledge store:\n${agent.knowledge.map(item => `--- ${item.name} ---\n${item.text}`).join("\n\n")}` : ""}` : ""}`;
}

async function hasApprovedBetaAccess(req) {
  const authorization = typeof req.headers.authorization === "string"
    ? req.headers.authorization
    : "";
  if (!/^Bearer\s+\S+$/i.test(authorization)) return false;

  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: authorization
      }
    });
    if (!response.ok) return false;
    const user = await response.json();
    if (user?.app_metadata?.beta === true || user?.app_metadata?.beta_approved === true) return true;

    const email = String(user?.email || "").trim().toLowerCase();
    if (ACCOUNT_ROLES.has(email)) return true;
    if (email && getApprovedBetaEmails().has(email)) return true;
    return hasApprovedBetaRequest(authorization, user?.id);
  } catch {
    return false;
  }
}

async function hasApprovedBetaRequest(authorization, userId) {
  if (!userId) return false;
  try {
    const url = new URL(`${SUPABASE_URL}/rest/v1/beta_requests`);
    url.searchParams.set("select", "id,access_expires_at");
    url.searchParams.set("user_id", `eq.${userId}`);
    url.searchParams.set("feature_key", "eq.beta_lab");
    url.searchParams.set("status", "eq.approved");
    url.searchParams.set("limit", "1");
    let response = await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: authorization
      }
    });
    if (!response.ok) {
      url.searchParams.set("select", "id");
      response = await fetch(url, {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: authorization
        }
      });
    }
    if (!response.ok) return false;
    const data = await response.json();
    return Array.isArray(data) && data.some(grant => {
      if (!grant?.access_expires_at) return true;
      const expiresAt = new Date(grant.access_expires_at).getTime();
      return Number.isFinite(expiresAt) && expiresAt > Date.now();
    });
  } catch {
    return false;
  }
}

function getApprovedBetaEmails() {
  return new Set(
    String(process.env.BETA_APPROVED_EMAILS || "")
      .split(/[\s,;]+/)
      .map(email => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

function describePlan(plan) {
  if (plan === "owner") return "owner (unlimited access to all features and models)";
  if (plan === "owner_alt") return "alternate owner account (unlimited access to all features and models)";
  if (plan === "support") return "support (unlimited access to all features and models)";
  if (plan === "dev") return "trusted beta developer (unlimited messages, images, and web searches)";
  if (plan === "plus") return "Talkaton Plus (all 12 models with expanded daily messages, images, and web searches)";
  if (plan === "pro") return "Talkaton Pro (all 12 models with high daily messages, images, and web searches)";
  if (plan === "max") return "Talkaton Max (all 12 models with Talkaton's highest paid daily limits)";
  if (plan === "free") return "free (standard access with Ollama)";
  return "guest (limited access, Ollama)";
}

function resolveTimeZone(timeZone) {
  if (typeof timeZone !== "string" || timeZone.length > 100) return "UTC";
  const normalized = timeZone.trim();
  if (!normalized) return "UTC";

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized }).format();
    return normalized;
  } catch {
    return "UTC";
  }
}

async function readErrorBody(response) {
  try {
    return await response.json();
  } catch {
    return { message: await response.text().catch(() => "") };
  }
}
