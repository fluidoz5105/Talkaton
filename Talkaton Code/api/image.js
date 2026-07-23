export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const abortController = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abortController.abort();
  });

  try {
    const { prompt } = req.body || {};
    const apiKey = getOpenAIApiKey();

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Image prompt is required." });
    }

    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) {
      return res.status(400).json({ error: "Image prompt is required." });
    }
    if (normalizedPrompt.length > 32_000) {
      return res.status(400).json({ error: "Image prompt is too long." });
    }

    const headers = new Headers();
    headers.set("Authorization", `Bearer ${apiKey}`);
    headers.set("Content-Type", "application/json");

    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers,
      signal: abortController.signal,
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt: normalizedPrompt,
        size: "1024x1024"
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || "Image generation failed."
      });
    }

    res.status(200).json(data);

  } catch (error) {
    if (error?.name === "AbortError") {
      if (!res.writableEnded) res.end();
      return;
    }
    console.error("Talkaton image generation error:", error?.stack || error);
    res.status(500).json({ error: error.message || "Image generation failed" });
  }
}

function getOpenAIApiKey() {
  const rawKey = process.env.OPENAI_API_KEY;
  if (typeof rawKey !== "string" || !rawKey.trim()) {
    throw new Error("Missing OPENAI_API_KEY. Add it to your deployment environment variables.");
  }

  const apiKey = rawKey.trim();
  if (/^Bearer(?:\s|$)/i.test(apiKey)) {
    throw new Error("OPENAI_API_KEY must not include the Bearer prefix.");
  }
  if (!apiKey.startsWith("sk-") || /[\u0000-\u001f\u007f]/.test(apiKey)) {
    throw new Error("OPENAI_API_KEY is malformed.");
  }
  return apiKey;
}
