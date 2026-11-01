import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("every chat JavaScript DOM reference exists in the page", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("chat/index.html", root), "utf8"),
    readFile(new URL("chat/app.js", root), "utf8")
  ]);

  const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  const referencedIds = new Set([...app.matchAll(/\bbyId\("([^"]+)"\)/g)].map(match => match[1]));
  const missingIds = [...referencedIds].filter(id => !htmlIds.has(id));

  assert.deepEqual(missingIds, []);
});

test("all local chat imports and page assets exist", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("chat/index.html", root), "utf8"),
    readFile(new URL("chat/app.js", root), "utf8")
  ]);

  const assetPaths = new Set();
  for (const match of html.matchAll(/(?:href|src)="(\/[^"#?]+)(?:[?#][^"]*)?"/g)) {
    assetPaths.add(match[1]);
  }
  for (const match of app.matchAll(/(?:from\s+|import\()\s*["'](\.\.\/[^"'?]+)(?:\?[^"']*)?["']/g)) {
    assetPaths.add(`/chat/${match[1]}`);
  }

  const missing = [];
  for (const rawPath of assetPaths) {
    const normalizedPath = rawPath
      .replace(/^\/chat\/\.\.\//, "")
      .replace(/^\//, "");
    const normalized = new URL(normalizedPath, root);
    try {
      await access(normalized);
    } catch {
      missing.push(rawPath);
    }
  }

  assert.deepEqual(missing, []);
});

test("Studio initializes reliably and exposes its active-agent state", async () => {
  const [html, productivity] = await Promise.all([
    readFile(new URL("chat/index.html", root), "utf8"),
    readFile(new URL("chat/productivity.js", root), "utf8")
  ]);

  assert.match(html, /id="studioNavHint">Ready</);
  assert.match(html, /productivity\.js\?v=20260826-studio2/);
  assert.match(productivity, /talkaton:host-ready/);
  assert.match(productivity, /if \(initialized\) return/);
  assert.match(productivity, /activeAgent \? "Active" : "Ready"/);
  assert.match(productivity, /getActiveAgent/);
});

test("dialogs are centered and constrained on small screens", async () => {
  const css = await readFile(new URL("style.css", root), "utf8");
  const dialogRule = css.match(/\.dialog\s*\{([\s\S]*?)\}/)?.[1] || "";

  assert.match(dialogRule, /margin:\s*auto/);
  assert.match(dialogRule, /width:\s*min\(94vw,\s*620px\)/);
  assert.match(dialogRule, /max-height:\s*min\(86vh,\s*760px\)/);
});

test("voice conversation uses an immersive full-screen stage", async () => {
  const css = await readFile(new URL("style.css", root), "utf8");
  const voiceDialogRule = css.match(/\.voiceDialog\s*\{([\s\S]*?)\}/)?.[1] || "";

  assert.match(voiceDialogRule, /width:\s*100vw/);
  assert.match(voiceDialogRule, /height:\s*100dvh/);
  assert.match(css, /\.voiceOrb[\s\S]*width:\s*clamp\(190px,\s*24vw,\s*300px\)/);
  assert.match(css, /\.voiceDock[\s\S]*border-radius:\s*999px/);
});

test("About navigation always returns to the chat route", async () => {
  const html = await readFile(new URL("about/index.html", root), "utf8");
  assert.match(html, /class="aboutBackLink"\s+href="\/chat"/);
});

test("every HTML page uses the cache-busted adaptive favicon", async () => {
  const pages = [
    "index.html",
    "chat/index.html",
    "about/index.html",
    "beta/index.html",
    "beta/admin/index.html",
    "codeaton/index.html",
    "codeaton/app/index.html",
    "talkatondesktop/index.html",
    "404.html"
  ];

  for (const page of pages) {
    const html = await readFile(new URL(page, root), "utf8");
    assert.match(html, /href="\/favicon-t-20260728\.svg"/);
  }
});

test("public pages expose useful search metadata", async () => {
  const pages = [
    ["index.html", "https://talkaton.org/"],
    ["chat/index.html", "https://talkaton.org/chat"],
    ["about/index.html", "https://talkaton.org/about"],
    ["beta/index.html", "https://talkaton.org/beta"],
    ["codeaton/index.html", "https://talkaton.org/codeaton"],
    ["talkatondesktop/index.html", "https://talkaton.org/talkatondesktop"]
  ];

  for (const [page, canonicalUrl] of pages) {
    const html = await readFile(new URL(page, root), "utf8");
    const description = html.match(/<meta name="description" content="([^"]+)"/i)?.[1] || "";

    assert.ok(description.length >= 50, `${page} needs a useful search description`);
    assert.match(html, new RegExp(`<link rel="canonical" href="${canonicalUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
    assert.match(html, /<meta name="robots" content="index,follow/);
  }
});

test("Codeaton ships a complete local-first workspace", async () => {
  const [html, app, manifest, worker] = await Promise.all([
    readFile(new URL("codeaton/app/index.html", root), "utf8"),
    readFile(new URL("codeaton/app/app.js", root), "utf8"),
    readFile(new URL("codeaton/manifest.webmanifest", root), "utf8"),
    readFile(new URL("codeaton/sw.js", root), "utf8")
  ]);
  const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  const referencedIds = new Set([...app.matchAll(/\$\("([^"]+)"\)/g)].map(match => match[1]));
  assert.deepEqual([...referencedIds].filter(id => !htmlIds.has(id)), []);

  assert.match(app, /showDirectoryPicker/);
  assert.match(app, /createWritable/);
  assert.match(app, /Review AI change|openDiffReview/);
  assert.match(html, /Model Relay/);
  assert.match(html, /id="missionType"/);
  assert.match(html, /id="missionScope"/);
  assert.match(html, /id="missionDraft"/);
  assert.match(html, /id="missionProof"/);
  assert.match(html, /id="challengeChangeBtn"/);
  assert.match(app, /async function challengeProposal/);
  assert.match(app, /skeptical second model/);
  assert.match(app, /function updateProofRail/);
  assert.match(app, /fetch\("\/api\/chat"/);
  assert.match(app, /text\/event-stream/);
  assert.match(app, /function handleAgentInputKeydown/);
  assert.match(app, /event\.key !== "Enter" \|\| event\.shiftKey \|\| event\.isComposing/);
  assert.match(html, /Enter to send/);
  assert.match(html, /OpenRouter \+ Tavily \+ image generation/);
  assert.match(html, /id="codeatonWebBtn"/);
  assert.match(html, /id="codeatonImageBtn"/);
  assert.match(app, /fetch\("\/api\/search"/);
  assert.match(app, /fetch\("\/api\/image"/);
  assert.match(app, /function renderSearchSources/);
  assert.match(app, /function renderGeneratedImage/);
  assert.match(app, /function renderImageGenerationProgress/);
  assert.match(app, /payload\.commentary/);
  assert.match(app, /conversational AI assistant/);
  assert.match(html, /<option value="chat">Chat<\/option>/);
  assert.match(app, /: "chat"/);
  assert.match(app, /function isCasualConversation/);
  assert.match(app, /Respond directly and naturally as Codeaton/);
  assert.match(app, /Greetings and casual messages should receive a warm, concise, genuinely generated reply/);
  assert.doesNotMatch(app, /Open a source file first, or choose Explain/);
  assert.doesNotMatch(app, /briefly redirect unrelated general-chat requests to Talkaton/);
  assert.match(html, /id="chatHistoryList"/);
  assert.match(html, /Previous chats/);
  assert.match(app, /function persistActiveChat/);
  assert.match(app, /function loadChatSession/);
  assert.match(app, /codeaton-chat-history-v1:/);
  assert.match(app, /\.from\("codeaton_chats"\)/);
  assert.match(app, /queueStreamingHistorySave/);
  assert.match(app, /fetch\("\/api\/billing-status"/);
  assert.match(app, /applyChatUsageHeaders/);
  assert.match(app, /function hasPaidMessageFallback/);
  assert.match(app, /Ollama backup active/);
  assert.match(html, /id="usageMessages"/);
  assert.match(html, /id="usageSearches"/);
  assert.match(html, /id="usageImages"/);
  assert.doesNotMatch(app, /Created from:/);
  assert.match(app, /function extractStreamText/);
  assert.match(html, /GPT-5\.4 · Plus\/Beta quality/);
  assert.match(app, /Nothing has been saved|Nothing is written to disk/);
  assert.doesNotMatch(app, /child_process|execSync|eval\s*\(/);
  assert.equal(JSON.parse(manifest).start_url, "/codeaton/app");
  assert.match(worker, /pathname\.startsWith\("\/codeaton"\)/);
});

test("image generation renders a visual progress state and natural AI commentary", async () => {
  const [chatApp, codeatonApp, css, codeatonCss] = await Promise.all([
    readFile(new URL("chat/app.js", root), "utf8"),
    readFile(new URL("codeaton/app/app.js", root), "utf8"),
    readFile(new URL("style.css", root), "utf8"),
    readFile(new URL("codeaton/app/style.css", root), "utf8")
  ]);

  assert.match(chatApp, /function createImageGenerationProgress/);
  assert.match(chatApp, /getImageResponseText/);
  assert.match(chatApp, /commentary_provider === "openrouter"/);
  assert.match(css, /\.imageGenerationProgress/);
  assert.match(css, /imageGenerationShimmer/);
  assert.match(codeatonCss, /\.codeatonImageProgress/);
  assert.match(codeatonCss, /codeatonImageShimmer/);
  assert.doesNotMatch(chatApp, /Created from:/);
  assert.doesNotMatch(codeatonApp, /Created from:/);
});

test("account gateway provides polished email and Google sign-in without bypassing confirmation", async () => {
  const [html, app, css] = await Promise.all([
    readFile(new URL("chat/index.html", root), "utf8"),
    readFile(new URL("chat/app.js", root), "utf8"),
    readFile(new URL("style.css", root), "utf8")
  ]);
  assert.match(html, /id="authGoogleBtn"/);
  assert.match(html, /id="authProviderSection"[^>]*hidden/);
  assert.match(html, /Continue with Google/);
  assert.match(html, /Sign in to continue/);
  assert.match(app, /signInWithOAuth\(\{/);
  assert.match(app, /provider:\s*"google"/);
  assert.match(app, /skipBrowserRedirect:\s*true/);
  assert.match(app, /window\.location\.assign\(data\.url\)/);
  assert.match(app, /signInWithPassword/);
  assert.match(app, /signInWithOtp/);
  assert.match(app, /createSharedAuthStorage/);
  assert.doesNotMatch(html, /id="modeSelect"/);
  assert.doesNotMatch(app, /mode:\s*state\.mode/);
  assert.match(css, /\.authDialog\[open\][\s\S]*place-items:\s*center/);
  assert.match(css, /\.authPanel[\s\S]*width:\s*min\(100%,\s*580px\)/);
  assert.match(css, /\.authGoogleBtn[\s\S]*border-radius:\s*16px/);
  assert.match(css, /\.authGoogleBtn:hover:not\(:disabled\)/);
  assert.match(css, /\.authInputWrap input[\s\S]*min-height:\s*64px/);
  assert.doesNotMatch(app, /Opening Google/);
});

test("subscription sign-in shares the Talkaton session and supports branded Google ID-token auth", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("subscriptions/index.html", root), "utf8"),
    readFile(new URL("subscriptions/app.js", root), "utf8")
  ]);
  assert.match(html, /id="authGoogleBtn"/);
  assert.match(app, /createSharedAuthStorage/);
  assert.match(app, /signInWithOAuth/);
  assert.match(app, /provider:\s*"google"/);
  assert.match(app, /skipBrowserRedirect:\s*true/);
  assert.match(app, /window\.location\.assign\(data\.url\)/);
});

test("desktop and Codeaton download routes include installable manifests and source packages", async () => {
  const assets = [
    "codeaton/index.html",
    "codeaton/style.css",
    "codeaton/install.js",
    "codeaton/manifest.webmanifest",
    "codeaton/sw.js",
    "codeaton/icon-192.png",
    "codeaton/icon-512.png",
    "codeaton/og.png",
    "talkatondesktop/index.html",
    "talkatondesktop/style.css",
    "talkatondesktop/app.js",
    "talkatondesktop/manifest.webmanifest",
    "talkatondesktop/sw.js",
    "talkatondesktop/icon-192.png",
    "talkatondesktop/icon-512.png",
    "downloads/installers/Talkaton-1.0.0-mac-universal.dmg",
    "downloads/installers/Talkaton-1.0.0-windows-x64-setup.exe",
    "downloads/installers/Codeaton-1.0.0-mac-universal.dmg",
    "downloads/installers/Codeaton-1.0.0-windows-x64-setup.exe",
    "downloads/codeaton-source.zip",
    "downloads/talkaton-desktop-source.zip"
  ];
  for (const asset of assets) await access(new URL(asset, root));

  const desktopManifest = JSON.parse(await readFile(new URL("talkatondesktop/manifest.webmanifest", root), "utf8"));
  const codeatonManifest = JSON.parse(await readFile(new URL("codeaton/manifest.webmanifest", root), "utf8"));
  assert.equal(desktopManifest.start_url, "/chat?desktop=1");
  assert.equal(desktopManifest.scope, "/");
  assert.ok(desktopManifest.icons.some(icon => icon.sizes === "512x512"));
  assert.ok(codeatonManifest.icons.some(icon => icon.sizes === "512x512"));

  const desktopPage = await readFile(new URL("talkatondesktop/index.html", root), "utf8");
  assert.match(desktopPage, /Talkaton-1\.0\.0-mac-universal\.dmg/);
  assert.match(desktopPage, /Talkaton-1\.0\.0-windows-x64-setup\.exe/);
  assert.doesNotMatch(desktopPage, /beforeinstallprompt|Add to Dock/);

  const codeatonPage = await readFile(new URL("codeaton/index.html", root), "utf8");
  assert.match(codeatonPage, /Codeaton-1\.0\.0-mac-universal\.dmg/);
  assert.match(codeatonPage, /Codeaton-1\.0\.0-windows-x64-setup\.exe/);
  assert.match(codeatonPage, /Tavily research/);
  assert.match(codeatonPage, /Image Studio/);
  assert.doesNotMatch(codeatonPage, /Use Chrome or Edge to install|beforeinstallprompt|Add to Dock/);

  const [talkatonMacBuilder, codeatonMacBuilder, polishedDmgBuilder] = await Promise.all([
    readFile(new URL("scripts/build-mac-installer.sh", root), "utf8"),
    readFile(new URL("scripts/build-codeaton-mac-installer.sh", root), "utf8"),
    readFile(new URL("scripts/create-polished-dmg.sh", root), "utf8")
  ]);
  assert.match(talkatonMacBuilder, /create-polished-dmg\.sh/);
  assert.match(codeatonMacBuilder, /create-polished-dmg\.sh/);
  assert.match(polishedDmgBuilder, /"background": "\$BACKGROUND_FILE"/);
  assert.match(polishedDmgBuilder, /"x": 160, "y": 220/);
  assert.match(polishedDmgBuilder, /"x": 480, "y": 220/);
  assert.match(polishedDmgBuilder, /shasum -a 256 -c/);

  const [chatApp, codeatonApp, vercel] = await Promise.all([
    readFile(new URL("chat/app.js", root), "utf8"),
    readFile(new URL("codeaton/app/app.js", root), "utf8"),
    readFile(new URL("vercel.json", root), "utf8")
  ]);
  assert.match(chatApp, /document\.body\.append\(link\)/);
  assert.match(chatApp, /async function downloadResource/);
  assert.match(codeatonApp, /document\.body\.append\(anchor\)/);
  assert.match(vercel, /filename=\\"codeaton-source\.zip\\"/);
  assert.match(vercel, /filename=\\"talkaton-desktop-source\.zip\\"/);
  assert.match(vercel, /filename=\\"Codeaton-1\.0\.0-mac-universal\.dmg\\"/);
  assert.match(vercel, /filename=\\"Codeaton-1\.0\.0-windows-x64-setup\.exe\\"/);
});

test("approval inbox navigation is hidden until a confirmed reviewer session", async () => {
  const [betaHtml, betaApp, adminApp] = await Promise.all([
    readFile(new URL("beta/index.html", root), "utf8"),
    readFile(new URL("beta/app.js", root), "utf8"),
    readFile(new URL("beta/admin/app.js", root), "utf8")
  ]);
  assert.match(betaHtml, /id="approvalInboxLink"[^>]*hidden/);
  assert.match(betaApp, /REVIEWER_EMAILS/);
  assert.match(betaApp, /email_confirmed_at/);
  assert.match(adminApp, /email_confirmed_at/);
});
