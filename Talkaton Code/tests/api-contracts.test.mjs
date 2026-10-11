import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const originalConsoleInfo = console.info;
const originalConsoleError = console.error;
console.info = () => {};
console.error = () => {};
test.after(() => {
  console.info = originalConsoleInfo;
  console.error = originalConsoleError;
});

async function importSource(relativePath) {
  const { readFile } = await import("node:fs/promises");
  let source = await readFile(new URL(relativePath, root), "utf8");
  for (const dependency of ["_guest-guard", "_ollama"]) {
    if (source.includes(`./${dependency}.js`)) {
      const dependencySource = await readFile(new URL(`api/${dependency}.js`, root), "utf8");
      source = source.replace(`./${dependency}.js`, `data:text/javascript;base64,${Buffer.from(dependencySource).toString("base64")}`);
    }
  }
  const encoded = Buffer.from(source).toString("base64");
  return import(`data:text/javascript;base64,${encoded}#${Date.now()}-${Math.random()}`);
}

function createResponse() {
  const listeners = new Map();
  return {
    body: undefined,
    chunks: [],
    headers: new Map(),
    headersSent: false,
    statusCode: 200,
    writableEnded: false,
    on(event, listener) {
      listeners.set(event, listener);
      return this;
    },
    once(event, listener) {
      listeners.set(event, listener);
      return this;
    },
    off(event) {
      listeners.delete(event);
      return this;
    },
    setHeader(name, value) {
      this.headers.set(String(name).toLowerCase(), value);
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      this.headersSent = true;
      this.writableEnded = true;
      return body;
    },
    flushHeaders() {
      this.headersSent = true;
    },
    write(chunk) {
      this.headersSent = true;
      this.chunks.push(Buffer.from(chunk));
      return true;
    },
    end(chunk) {
      if (chunk) this.chunks.push(Buffer.from(chunk));
      this.writableEnded = true;
      return this;
    }
  };
}

test("chat API streams a valid OpenRouter response", async () => {
  process.env.OPENROUTER_API_KEY = "sk-or-v1-abcdefghijklmnop";
  let upstreamRequest;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes("/auth/v1/user")) return Response.json({ id: "owner-test", email: "kantertal1@gmail.com" });
    if (String(url).includes("/rpc/consume_guest_usage")) {
      return new Response(JSON.stringify({ allowed: true, used: 1, remaining: 24 }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    upstreamRequest = { url: String(url), options };
    return new Response("data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n\ndata: [DONE]\n\n", {
      status: 200,
      headers: { "content-type": "text/event-stream" }
    });
  };

  const { default: handler } = await importSource("api/chat.js");
  const response = createResponse();
  await handler({
    method: "POST",
    headers: {
      authorization: "Bearer owner-session",
      origin: "https://talkaton.org",
      "user-agent": "Mozilla/5.0 Test Browser",
      "x-forwarded-for": "203.0.113.10"
    },
    body: {
      message: "Say hello",
      model: "openai/gpt-5.4-nano",
      plan: "guest",
      timeZone: "America/New_York"
    }
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
  assert.equal(response.headers.get("x-talkaton-plan"), "owner");
  assert.equal(response.headers.get("x-talkaton-usage-limit"), "unlimited");
  assert.equal(response.headers.get("x-talkaton-usage-remaining"), "unlimited");
  assert.equal(response.writableEnded, true);
  assert.match(Buffer.concat(response.chunks).toString(), /Hello/);
  assert.equal(upstreamRequest.url, "https://openrouter.ai/api/v1/chat/completions");
  const requestBody = JSON.parse(upstreamRequest.options.body);
  assert.equal(requestBody.stream, true);
  assert.equal(requestBody.model, "openai/gpt-5.4-nano");
});

test("paid chat continues on Ollama after the premium-model allowance is used", async () => {
  const environmentKeys = [
    "OPENROUTER_API_KEY",
    "OLLAMA_API_KEY",
    "OLLAMA_BASE_URL",
    "OLLAMA_FALLBACK_MODEL",
    "STRIPE_SECRET_KEY",
    "STRIPE_PRICE_PLUS",
    "STRIPE_PRICE_PRO",
    "STRIPE_PRICE_MAX",
    "NODE_ENV",
    "VERCEL_ENV"
  ];
  const previous = Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]));
  Object.assign(process.env, {
    OPENROUTER_API_KEY: "sk-or-v1-abcdefghijklmnop",
    OLLAMA_API_KEY: "ollama-test-key",
    OLLAMA_BASE_URL: "https://ollama.com/api",
    OLLAMA_FALLBACK_MODEL: "gemma3:12b",
    STRIPE_SECRET_KEY: "sk_live_ollamafallbacktest",
    STRIPE_PRICE_PLUS: "price_PlusOllama123",
    STRIPE_PRICE_PRO: "price_ProOllama123",
    STRIPE_PRICE_MAX: "price_MaxOllama123",
    NODE_ENV: "production",
    VERCEL_ENV: "production"
  });

  let ollamaRequest;
  let openRouterCalled = false;
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith("/auth/v1/user")) {
      return new Response(JSON.stringify({
        id: "00000000-0000-4000-8000-000000000099",
        email: "ollama-paid-test@example.com",
        email_confirmed_at: "2026-09-07T12:00:00Z"
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (target.includes("/rest/v1/beta_requests")) {
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }
    if (target.startsWith("https://api.stripe.com/v1/customers?")) {
      return new Response(JSON.stringify({ data: [{ id: "cus_ollama_paid" }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (target.startsWith("https://api.stripe.com/v1/subscriptions?")) {
      return new Response(JSON.stringify({
        data: [{
          status: "active",
          items: { data: [{ price: { id: "price_PlusOllama123" } }] }
        }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (target.includes("/rpc/consume_guest_usage")) {
      return new Response(JSON.stringify({ allowed: false, used: 1500, remaining: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (target === "https://ollama.com/api/chat") {
      ollamaRequest = options;
      return new Response(
        '{"model":"gemma3:12b","message":{"role":"assistant","content":"Backup "},"done":false}\n' +
        '{"model":"gemma3:12b","message":{"role":"assistant","content":"answer"},"done":true}\n',
        { status: 200, headers: { "content-type": "application/x-ndjson" } }
      );
    }
    if (target === "https://openrouter.ai/api/v1/chat/completions") {
      openRouterCalled = true;
    }
    throw new Error(`Unexpected paid fallback request: ${target}`);
  };

  try {
    const { default: handler } = await importSource("api/chat.js");
    const response = createResponse();
    await handler({
      method: "POST",
      headers: {
        authorization: "Bearer paid-session",
        origin: "https://talkaton.org",
        "user-agent": "Mozilla/5.0 Test Browser",
        "x-forwarded-for": "203.0.113.99"
      },
      body: {
        message: "Keep helping me",
        model: "openai/gpt-5.4",
        plan: "plus",
        timeZone: "America/New_York"
      }
    }, response);

    const output = Buffer.concat(response.chunks).toString();
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers.get("x-talkaton-plan"), "plus");
    assert.equal(response.headers.get("x-talkaton-usage-limit"), "1500");
    assert.equal(response.headers.get("x-talkaton-usage-remaining"), "0");
    assert.equal(response.headers.get("x-talkaton-provider"), "ollama");
    assert.equal(response.headers.get("x-talkaton-model"), "ollama/gemma3:12b");
    assert.equal(response.headers.get("x-talkaton-fallback"), "paid-plan-overflow");
    assert.equal(openRouterCalled, false);
    assert.equal(ollamaRequest.headers.Authorization, "Bearer ollama-test-key");
    assert.equal(JSON.parse(ollamaRequest.body).model, "gemma3:12b");
    assert.match(output, /Backup/);
    assert.match(output, /answer/);
    assert.match(output, /ollama\/gemma3:12b/);
    assert.match(output, /data: \[DONE\]/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("chat API gives Codeaton its own generated assistant identity", async () => {
  process.env.OPENROUTER_API_KEY = "sk-or-v1-abcdefghijklmnop";
  let upstreamBody;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes("/auth/v1/user")) return Response.json({ id: "owner-test", email: "kantertal1@gmail.com" });
    if (String(url).includes("/rpc/consume_guest_usage")) {
      return new Response(JSON.stringify({ allowed: true, used: 1, remaining: 24 }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    upstreamBody = JSON.parse(options.body);
    return new Response("data: {\"choices\":[{\"delta\":{\"content\":\"Hey! What are you working on?\"}}]}\n\ndata: [DONE]\n\n", {
      status: 200,
      headers: { "content-type": "text/event-stream" }
    });
  };

  const { default: handler } = await importSource("api/chat.js");
  const response = createResponse();
  await handler({
    method: "POST",
    headers: {
      authorization: "Bearer owner-session",
      origin: "https://talkaton.org",
      "user-agent": "Mozilla/5.0 Test Browser",
      "x-forwarded-for": "203.0.113.11"
    },
    body: {
      message: "User message:\nhi\n\nRespond directly and naturally as Codeaton.",
      model: "openai/gpt-5.4-nano",
      plan: "guest",
      timeZone: "America/New_York",
      agent: {
        name: "Codeaton",
        instructions: "Chat naturally. Greetings must receive a generated reply.",
        tools: ["files"],
        knowledge: []
      }
    }
  }, response);

  assert.equal(response.statusCode, 200);
  assert.match(upstreamBody.messages[0].content, /^You are Codeaton, an AI assistant running on Talkaton\./);
  assert.match(Buffer.concat(response.chunks).toString(), /What are you working on/);
});

test("chat API normalizes structured streaming content and ignores provider comments", async () => {
  process.env.OPENROUTER_API_KEY = "sk-or-v1-abcdefghijklmnop";
  globalThis.fetch = async url => {
    if (String(url).includes("/auth/v1/user")) return Response.json({ id: "owner-test", email: "kantertal1@gmail.com" });
    if (String(url).includes("/rpc/consume_guest_usage")) {
      return new Response(JSON.stringify({ allowed: true, used: 1, remaining: 24 }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(
      ": OPENROUTER PROCESSING\n\n" +
      "data: {\"model\":\"openai/gpt-5.4-nano\",\"choices\":[{\"delta\":{\"content\":[{\"type\":\"text\",\"text\":\"Structured answer\"}]}}]}\n\n" +
      "data: [DONE]\n\n",
      { status: 200, headers: { "content-type": "text/event-stream" } }
    );
  };

  const { default: handler } = await importSource("api/chat.js");
  const response = createResponse();
  await handler({
    method: "POST",
    headers: {
      authorization: "Bearer owner-session",
      origin: "https://talkaton.org",
      "user-agent": "Mozilla/5.0 Test Browser",
      "x-forwarded-for": "203.0.113.12"
    },
    body: { message: "Explain this", model: "openai/gpt-5.4-nano" }
  }, response);

  const output = Buffer.concat(response.chunks).toString();
  assert.match(output, /Structured answer/);
  assert.match(output, /data: \[DONE\]/);
  assert.doesNotMatch(output, /OPENROUTER PROCESSING/);
});

test("chat API converts a non-streaming provider reply into the streaming contract", async () => {
  process.env.OPENROUTER_API_KEY = "sk-or-v1-abcdefghijklmnop";
  globalThis.fetch = async url => {
    if (String(url).includes("/auth/v1/user")) return Response.json({ id: "owner-test", email: "kantertal1@gmail.com" });
    if (String(url).includes("/rpc/consume_guest_usage")) {
      return new Response(JSON.stringify({ allowed: true, used: 1, remaining: 24 }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(JSON.stringify({
      model: "openai/gpt-5.4-nano",
      choices: [{ message: { content: "Recovered JSON answer" } }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const { default: handler } = await importSource("api/chat.js");
  const response = createResponse();
  await handler({
    method: "POST",
    headers: {
      authorization: "Bearer owner-session",
      origin: "https://talkaton.org",
      "user-agent": "Mozilla/5.0 Test Browser",
      "x-forwarded-for": "203.0.113.13"
    },
    body: { message: "Recover this", model: "openai/gpt-5.4-nano" }
  }, response);

  const output = Buffer.concat(response.chunks).toString();
  assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
  assert.match(output, /Recovered JSON answer/);
  assert.match(output, /data: \[DONE\]/);
});

test("chat API reports a missing OpenRouter key clearly", async () => {
  const previousUsageSecret = process.env.GUEST_USAGE_SECRET;
  delete process.env.OPENROUTER_API_KEY;
  process.env.GUEST_USAGE_SECRET = "missing-openrouter-key-test-secret";
  globalThis.fetch = async url => {
    if (String(url).includes("/auth/v1/user")) return Response.json({ id: "owner-test", email: "kantertal1@gmail.com" });
    if (String(url).includes("/rpc/consume_guest_usage")) {
      return new Response(JSON.stringify({ allowed: true, used: 1, remaining: 74 }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    throw new Error(`Missing-key test made an unexpected request: ${url}`);
  };
  try {
    const { default: handler } = await importSource("api/chat.js");
    const response = createResponse();
    await handler({
      method: "POST",
      headers: {
        authorization: "Bearer owner-session",
        "user-agent": "Mozilla/5.0 Test Browser",
        "x-forwarded-for": "203.0.113.14"
      },
      body: { message: "Hello" }
    }, response);

    assert.equal(response.statusCode, 500);
    assert.equal(response.body.code, "OPENROUTER_KEY_MISSING");
  } finally {
    if (previousUsageSecret === undefined) delete process.env.GUEST_USAGE_SECRET;
    else process.env.GUEST_USAGE_SECRET = previousUsageSecret;
  }
});

test("search API grounds an OpenRouter answer in Tavily results", async () => {
  process.env.TAVILY_API_KEY = "test-tavily-key";
  process.env.OPENROUTER_API_KEY = "sk-or-v1-abcdefghijklmnop";
  let searchRequest;
  let synthesisRequest;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes("/auth/v1/user")) return Response.json({ id: "owner-test", email: "kantertal1@gmail.com" });
    const target = String(url);
    if (target.includes("/rpc/consume_guest_usage")) {
      return new Response(JSON.stringify({ allowed: true, used: 1, remaining: 4 }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (target === "https://openrouter.ai/api/v1/chat/completions") {
      synthesisRequest = { url: target, options };
      return new Response(JSON.stringify({
        model: "openai/gpt-5.4-nano",
        choices: [{ message: { content: "Talkaton is online and provides AI chat [1]." } }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    searchRequest = { url: String(url), options };
    return new Response(JSON.stringify({
      answer: "Talkaton is online.",
      results: [{ title: "Talkaton", url: "https://talkaton.org", content: "AI chat" }]
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  const { default: handler } = await importSource("api/search.js");
  const response = createResponse();
  await handler({
    method: "POST",
    headers: {
      authorization: "Bearer owner-session",
      "user-agent": "Mozilla/5.0 Test Browser",
      "x-forwarded-for": "203.0.113.10"
    },
    body: { query: "Talkaton" }
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.answer, "Talkaton is online and provides AI chat [1].");
  assert.equal(response.body.answerProvider, "openrouter+tavily");
  assert.deepEqual(response.body.usage, {
    plan: "owner",
    feature: "searches",
    limit: null,
    remaining: null
  });
  assert.equal(response.body.results.length, 1);
  assert.equal(searchRequest.url, "https://api.tavily.com/search");
  assert.equal(JSON.parse(searchRequest.options.body).api_key, "test-tavily-key");
  assert.equal(synthesisRequest.url, "https://openrouter.ai/api/v1/chat/completions");
  const synthesisBody = JSON.parse(synthesisRequest.options.body);
  assert.match(synthesisBody.messages[1].content, /Tavily evidence/);
  assert.match(synthesisBody.messages[1].content, /https:\/\/talkaton\.org/);
});

test("image API rejects an empty prompt without spending an API request", async () => {
  process.env.OPENAI_API_KEY = "test-openai-key";
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("fetch should not be called");
  };

  const { default: handler } = await importSource("api/image.js");
  const response = createResponse();
  await handler({ method: "POST", body: { prompt: "  " } }, response);

  assert.equal(response.statusCode, 400);
  assert.equal(called, false);
});

test("image API pairs generated pixels with Ollama commentary", async () => {
  process.env.OPENAI_API_KEY = "test-openai-key";
  process.env.OPENROUTER_API_KEY = "sk-or-v1-abcdefghijklmnop";
  process.env.OLLAMA_API_KEY = "test-ollama-key";
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    requests.push({ url: target, options });
    if (target.endsWith("/auth/v1/user")) {
      return new Response(JSON.stringify({
        id: "00000000-0000-4000-8000-000000000014",
        email: "image-user@example.com",
        email_confirmed_at: "2026-08-27T12:00:00Z"
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (target.includes("/rest/v1/beta_requests")) {
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }
    if (target.includes("/rpc/consume_guest_usage")) {
      return new Response(JSON.stringify({ allowed: true, used: 1, remaining: 19 }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (target === "https://api.openai.com/v1/images/generations") {
      return new Response(JSON.stringify({
        data: [{ b64_json: "dGVzdA==" }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (target === "https://ollama.com/api/chat") {
      return new Response(JSON.stringify({
        model: "openai/gpt-5.4-nano",
        message: { content: "Here’s the quiet library scene you asked for." }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected image API request: ${target}`);
  };

  const { default: handler } = await importSource("api/image.js");
  const response = createResponse();
  await handler({
    method: "POST",
    headers: {
      authorization: "Bearer confirmed-free-session",
      origin: "https://talkaton.org",
      "user-agent": "Mozilla/5.0 Test Browser",
      "x-forwarded-for": "203.0.113.14"
    },
    body: { prompt: "A quiet library at night" }
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.commentary, "Here’s the quiet library scene you asked for.");
  assert.equal(response.body.commentary_provider, "ollama");
  assert.deepEqual(response.body.usage, {
    plan: "free",
    feature: "images",
    limit: 20,
    remaining: 19
  });
  assert.equal(response.body.image.b64_json, "dGVzdA==");
  assert.ok(requests.some(request => request.url === "https://api.openai.com/v1/images/generations"));
  assert.ok(requests.some(request => request.url === "https://ollama.com/api/chat"));
});

test("guest APIs enforce a server-side daily limit", async () => {
  process.env.TAVILY_API_KEY = "test-tavily-key";
  globalThis.fetch = async url => {
    if (String(url).includes("/rpc/consume_guest_usage")) {
      return new Response(JSON.stringify({ allowed: false, used: 5, remaining: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    throw new Error("upstream API should not be called");
  };

  const { default: handler } = await importSource("api/search.js");
  const response = createResponse();
  await handler({
    method: "POST",
    headers: {
      "user-agent": "Mozilla/5.0 Test Browser",
      "x-forwarded-for": "203.0.113.10"
    },
    body: { query: "Talkaton" }
  }, response);

  assert.equal(response.statusCode, 429);
  assert.equal(response.body.code, "GUEST_LIMIT_REACHED");
});

test("automated bot traffic is blocked before an upstream request", async () => {
  process.env.TAVILY_API_KEY = "test-tavily-key";
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("fetch should not be called");
  };

  const { default: handler } = await importSource("api/search.js");
  const response = createResponse();
  await handler({
    method: "POST",
    headers: {
      "user-agent": "Googlebot/2.1",
      "x-forwarded-for": "203.0.113.11"
    },
    body: { query: "Talkaton" }
  }, response);

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.code, "AUTOMATED_TRAFFIC_BLOCKED");
  assert.equal(called, false);
});

test("voice API transcribes recorded browser audio through OpenAI", async () => {
  process.env.OPENAI_API_KEY = "test-openai-key";
  let upstreamRequest;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes("/rpc/consume_guest_usage")) {
      return new Response(JSON.stringify({ allowed: true, used: 1, remaining: 24 }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    upstreamRequest = { url: String(url), options };
    return new Response(JSON.stringify({
      text: "Hello Talkaton",
      languages: [{ code: "en" }]
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  const { default: handler } = await importSource("api/transcribe.js");
  const response = createResponse();
  await handler({
    method: "POST",
    headers: {
      "content-type": "audio/webm;codecs=opus",
      "x-audio-language": "en-US",
      "user-agent": "Mozilla/5.0 Test Browser",
      "x-forwarded-for": "203.0.113.12"
    },
    body: Buffer.alloc(1024, 1)
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.text, "Hello Talkaton");
  assert.equal(upstreamRequest.url, "https://api.openai.com/v1/audio/transcriptions");
  assert.equal(upstreamRequest.options.body.get("model"), "gpt-transcribe");
  assert.equal(upstreamRequest.options.body.get("languages[]"), "en");
  assert.equal(upstreamRequest.options.body.get("file").type, "audio/webm");
});

test("Beta status requires a session and grants owner access", async () => {
  const { default: handler } = await importSource("api/beta-status.js");

  const anonymousResponse = createResponse();
  await handler({ method: "GET", headers: {} }, anonymousResponse);
  assert.equal(anonymousResponse.statusCode, 401);

  globalThis.fetch = async url => {
    if (String(url).includes("/auth/v1/user")) {
      return new Response(JSON.stringify({
        id: "00000000-0000-4000-8000-000000000001",
        email: "kantertal1@gmail.com",
        email_confirmed_at: "2026-08-01T12:00:00Z"
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  };

  const ownerResponse = createResponse();
  await handler({
    method: "GET",
    headers: { authorization: "Bearer test-session" }
  }, ownerResponse);

  assert.equal(ownerResponse.statusCode, 200);
  assert.equal(ownerResponse.body.approved, true);
  assert.equal(ownerResponse.body.devApproved, true);
  assert.equal(ownerResponse.body.role, "owner");

  globalThis.fetch = async url => {
    if (String(url).includes("/auth/v1/user")) {
      return new Response(JSON.stringify({
        id: "00000000-0000-4000-8000-000000000002",
        email: "donotuseunlessyouaretalkanter@gmail.com",
        email_confirmed_at: "2026-08-01T12:00:00Z"
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  };

  const alternateOwnerResponse = createResponse();
  await handler({
    method: "GET",
    headers: { authorization: "Bearer alternate-owner-session" }
  }, alternateOwnerResponse);

  assert.equal(alternateOwnerResponse.statusCode, 200);
  assert.equal(alternateOwnerResponse.body.approved, true);
  assert.equal(alternateOwnerResponse.body.devApproved, true);
  assert.equal(alternateOwnerResponse.body.role, "owner_alt");
});

test("alternate owner account receives unlimited server-side access", async () => {
  globalThis.fetch = async url => {
    assert.match(String(url), /\/auth\/v1\/user$/);
    return new Response(JSON.stringify({
      id: "00000000-0000-4000-8000-000000000002",
      email: "donotuseunlessyouaretalkanter@gmail.com",
      email_confirmed_at: "2026-08-01T12:00:00Z"
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const { getAccountAccess } = await importSource("api/_guest-guard.js");
  const access = await getAccountAccess({
    headers: { authorization: "Bearer alternate-owner-session" }
  });

  assert.equal(access.plan, "owner_alt");
  assert.equal(access.role, "owner_alt");
  assert.equal(access.unlimited, true);
  assert.equal(access.allModels, true);
  assert.equal(access.limits.messages, Infinity);
  assert.equal(access.limits.images, Infinity);
  assert.equal(access.limits.searches, Infinity);
  assert.equal(access.limits.voice, Infinity);
});

test("subscription checkout stays on the billing domain and requires a confirmed account", async () => {
  const [checkout, portal, subscriptionApp, chatApp] = await Promise.all([
    readFile(new URL("api/billing-checkout.js", root), "utf8"),
    readFile(new URL("api/billing-portal.js", root), "utf8"),
    readFile(new URL("subscriptions/app.js", root), "utf8"),
    readFile(new URL("chat/app.js", root), "utf8")
  ]);

  assert.match(checkout, /email_confirmed_at/);
  assert.match(portal, /email_confirmed_at/);
  assert.match(checkout, /integration_identifier/);
  assert.match(checkout, /price\?\.livemode === true/);
  assert.match(checkout, /getStripeMode\(secret\) !== "live"/);
  assert.doesNotMatch(checkout, /payment_method_types/);
  assert.match(portal, /getStripeMode\(secret\) !== "live"/);
  assert.match(checkout, /\$\{origin\}\/\?billing=success/);
  assert.match(checkout, /\$\{origin\}\/\?billing=cancelled/);
  assert.match(subscriptionApp, /signInWithPassword/);
  assert.match(subscriptionApp, /signInWithOtp/);
  assert.match(subscriptionApp, /email_confirmed_at/);
  assert.match(subscriptionApp, /https:\/\/subscriptions\.talkaton\.org/);
  assert.match(chatApp, /function createAuthEmailRedirect[\s\S]*new URL\("https:\/\/talkaton\.org\/chat\/"\)/);
  assert.doesNotMatch(chatApp, /new URL\("https:\/\/subscriptions\.talkaton\.org/);
});

test("production subscription checkout rejects sandbox keys and creates verified live sessions", async () => {
  const previous = Object.fromEntries([
    "STRIPE_SECRET_KEY",
    "STRIPE_PRICE_PLUS",
    "STRIPE_PRICE_PRO",
    "STRIPE_PRICE_MAX",
    "NODE_ENV",
    "VERCEL_ENV",
    "ALLOW_STRIPE_TEST_MODE"
  ].map(key => [key, process.env[key]]));

  Object.assign(process.env, {
    STRIPE_PRICE_PLUS: "price_LivePlus123",
    STRIPE_PRICE_PRO: "price_LivePro123",
    STRIPE_PRICE_MAX: "price_LiveMax123",
    NODE_ENV: "production",
    VERCEL_ENV: "production",
    ALLOW_STRIPE_TEST_MODE: "true"
  });

  try {
    process.env.STRIPE_SECRET_KEY = "sk_test_sandbox_key";
    globalThis.fetch = async url => {
      if (String(url).includes("/auth/v1/user")) {
        return new Response(JSON.stringify({
          id: "00000000-0000-4000-8000-000000000010",
          email: "subscriber@example.com",
          email_confirmed_at: "2026-08-13T12:00:00Z"
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (String(url).includes("/rest/v1/beta_requests")) {
        return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`Sandbox checkout made an unexpected request: ${url}`);
    };

    const sandboxModule = await importSource("api/billing-checkout.js");
    const sandboxResponse = createResponse();
    await sandboxModule.default({
      method: "POST",
      headers: { authorization: "Bearer confirmed-session" },
      body: { plan: "plus" }
    }, sandboxResponse);
    assert.equal(sandboxResponse.statusCode, 503);
    assert.equal(sandboxResponse.body.code, "LIVE_BILLING_NOT_CONFIGURED");

    process.env.STRIPE_SECRET_KEY = "rk_live_restricted_key";
    let checkoutRequest;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("/auth/v1/user")) {
        return new Response(JSON.stringify({
          id: "00000000-0000-4000-8000-000000000010",
          email: "subscriber@example.com",
          email_confirmed_at: "2026-08-13T12:00:00Z"
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (target.includes("/rest/v1/beta_requests")) {
        return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
      }
      if (target.includes("/v1/customers?")) {
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (target.endsWith("/v1/prices/price_LivePlus123")) {
        return new Response(JSON.stringify({
          id: "price_LivePlus123",
          active: true,
          livemode: true,
          currency: "usd",
          unit_amount: 1000,
          type: "recurring",
          recurring: { interval: "month", interval_count: 1 }
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (target.endsWith("/v1/checkout/sessions")) {
        checkoutRequest = options;
        return new Response(JSON.stringify({
          id: "cs_live_verified",
          url: "https://checkout.stripe.com/c/pay/cs_live_verified"
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected live checkout request: ${target}`);
    };

    const liveModule = await importSource("api/billing-checkout.js");
    const liveResponse = createResponse();
    await liveModule.default({
      method: "POST",
      headers: { authorization: "Bearer confirmed-session" },
      body: { plan: "plus" }
    }, liveResponse);

    assert.equal(liveResponse.statusCode, 200);
    assert.equal(liveResponse.body.testMode, false);
    assert.match(liveResponse.body.url, /cs_live_/);
    assert.equal(checkoutRequest.headers["Stripe-Version"], "2026-06-24.dahlia");
    assert.match(checkoutRequest.headers["Idempotency-Key"], /^talkaton_checkout_/);
    const checkoutBody = new URLSearchParams(checkoutRequest.body);
    assert.equal(checkoutBody.get("mode"), "subscription");
    assert.equal(checkoutBody.get("line_items[0][price]"), "price_LivePlus123");
    assert.match(checkoutBody.get("integration_identifier"), /^talkaton_[a-z]{8}$/);
    assert.equal(checkoutBody.has("payment_method_types[0]"), false);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("Realtime voice exchanges SDP server-side without exposing the OpenAI key", async () => {
  const [realtimeApi, realtimeClient, nativeVoice] = await Promise.all([
    readFile(new URL("api/realtime-session.js", root), "utf8"),
    readFile(new URL("chat/realtime-voice.js", root), "utf8"),
    readFile(new URL("modules/native-voice.js", root), "utf8")
  ]);

  assert.match(realtimeApi, /https:\/\/api\.openai\.com\/v1\/realtime\/calls/);
  assert.match(realtimeApi, /process\.env\.OPENAI_API_KEY/);
  assert.match(realtimeApi, /server_vad/);
  assert.match(nativeVoice, /getUserMedia/);
  assert.match(realtimeClient, /NativeVoiceSession/);
  assert.doesNotMatch(realtimeClient, /OPENAI_API_KEY/);
  assert.doesNotMatch(nativeVoice, /OPENAI_API_KEY/);
});
