import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

async function importSource(relativePath) {
  let source = await readFile(new URL(relativePath, root), "utf8");
  for (const dependency of ["_guest-guard", "_ollama"]) {
    if (source.includes(`./${dependency}.js`)) {
      const dependencySource = await readFile(new URL(`server/${dependency}.js`, root), "utf8");
      source = source.replace(`./${dependency}.js`, `data:text/javascript;base64,${Buffer.from(dependencySource).toString("base64")}`);
    }
  }
  const encoded = Buffer.from(source).toString("base64");
  return import(`data:text/javascript;base64,${encoded}`);
}

let storedState = "";
globalThis.localStorage = {
  getItem() {
    return storedState || null;
  },
  setItem(_key, value) {
    storedState = value;
  }
};

const storage = await importSource("modules/storage.js");
const generatedImage = `data:image/webp;base64,${"a".repeat(1_500_000)}`;
const state = {
  chats: [{
    id: "chat-1",
    title: "Saved image",
    messages: [{ id: "message-1", generatedImage }]
  }],
  memory: [],
  settings: {}
};

storage.saveStoredState(state);
assert.equal(JSON.parse(storedState).chats[0].messages[0].generatedImage, generatedImage);
assert.equal(storage.serializeForCloud(state).chats[0].messages[0].generatedImage, generatedImage);

const incognitoState = {
  chats: [
    { id: "saved-chat", title: "Saved", messages: [] },
    { id: "private-chat", title: "Private", incognito: true, messages: [{ content: "never save this" }] }
  ],
  currentChatId: "private-chat",
  memory: [],
  settings: {}
};
storage.saveStoredState(incognitoState);
assert.deepEqual(JSON.parse(storedState).chats.map(chat => chat.id), ["saved-chat"]);
assert.equal(JSON.parse(storedState).currentChatId, "saved-chat");
assert.deepEqual(storage.serializeForCloud(incognitoState).chats.map(chat => chat.id), ["saved-chat"]);

process.env.OPENAI_API_KEY = "test-key";
let imageRequestBody;
globalThis.fetch = async (url, options) => {
  if (String(url).includes("/auth/v1/user")) {
    return {
      ok: true,
      status: 200,
      async json() {
        return { id: "test-user", email: "free@example.com", app_metadata: {} };
      }
    };
  }
  if (String(url).includes("/rest/v1/beta_requests")) {
    return {
      ok: true,
      status: 200,
      async json() {
        return [];
      }
    };
  }
  if (String(url).includes("/rpc/consume_guest_usage")) {
    return {
      ok: true,
      status: 200,
      async json() {
        return { allowed: true, used: 1, remaining: 4 };
      }
    };
  }
  imageRequestBody = JSON.parse(options.body);
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({ data: [{ b64_json: "image-bytes" }] });
    }
  };
};

const { default: imageHandler } = await importSource("server/image.js");
const response = {
  writableEnded: false,
  once() {},
  off() {},
  setHeader() {},
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    this.writableEnded = true;
    return body;
  }
};

await imageHandler({
  method: "POST",
  headers: {
    authorization: "Bearer test-session",
    "user-agent": "Mozilla/5.0 Test Browser",
    "x-forwarded-for": "203.0.113.10"
  },
  body: { prompt: "A test image" }
}, response);
assert.equal(response.statusCode, 200);
assert.equal(imageRequestBody.output_format, "webp");
assert.equal(imageRequestBody.output_compression, 65);
assert.equal(response.body.image.mime_type, "image/webp");

const appSource = await readFile(new URL("chat/app.js", root), "utf8");
const subscriptionsPageSource = await readFile(new URL("subscriptions/index.html", root), "utf8");
const subscriptionsAppSource = await readFile(new URL("subscriptions/app.js", root), "utf8");
const renameStart = appSource.indexOf('case "rename":');
const renameEnd = appSource.indexOf('case "delete":', renameStart);
const renameSource = appSource.slice(renameStart, renameEnd);
assert.match(renameSource, /candidate\.id === chat\.id/);
assert.match(renameSource, /title: nextTitle/);
assert.doesNotMatch(renameSource, /createChat\(/);
assert.match(appSource, /state\.chats = dedupeChatsById\(state\.chats\)/);
assert.match(appSource, /async function downloadResource/);
assert.match(appSource, /Download image ↓/);
assert.match(appSource, /function getGeneratedImageExtension\(source\)/);
assert.match(appSource, /supabase\.auth\.resend\(\{/);
assert.match(appSource, /type: "signup"/);
assert.match(appSource, /startResendConfirmationCooldown/);
assert.match(appSource, /isUnconfirmedEmailError\(error\)/);
assert.match(appSource, /resendConfirmationEmail\(\{ emailOverride: email, automatic: true \}\)/);
assert.match(appSource, /let loginConfirmationPending = false/);
assert.match(appSource, /supabase\.auth\.signInWithPassword\(\{/);
assert.match(appSource, /supabase\.auth\.signInWithOtp\(\{/);
assert.match(appSource, /shouldCreateUser: false/);
assert.match(appSource, /createAuthEmailRedirect\("login"\)/);
assert.match(appSource, /login-confirmed/);
assert.match(appSource, /signup-confirmed/);
assert.match(appSource, /signupConfirmationPending \|\| loginConfirmationPending/);
assert.match(appSource, /"kantertal1@gmail\.com": \{[\s\S]*tier: "owner"/);
assert.match(appSource, /"donotuseunlessyouaretalkanter@gmail\.com": \{[\s\S]*tier: "owner_alt"[\s\S]*label: "Owner Alt Acount"/);
assert.match(appSource, /"supportaton@gmail\.com": \{[\s\S]*tier: "support"/);
assert.match(appSource, /tier === "owner" \|\| tier === "owner_alt" \|\| tier === "support"/);
assert.match(appSource, /DAILY_LIMITS:[\s\S]*guest: 75[\s\S]*free: 250[\s\S]*plus: 1500[\s\S]*pro: 5000[\s\S]*max: 10000/);
assert.match(appSource, /BETA_DAILY_LIMITS:[\s\S]*messages: 750[\s\S]*images: 60[\s\S]*searches: 200/);
assert.match(appSource, /IMAGE_DAILY_LIMITS:[\s\S]*guest: 0[\s\S]*free: 20[\s\S]*plus: 75[\s\S]*pro: 250[\s\S]*max: 500/);
assert.match(appSource, /SEARCH_DAILY_LIMITS:[\s\S]*guest: 25[\s\S]*free: 75[\s\S]*plus: 300[\s\S]*pro: 1000[\s\S]*max: 2500/);
assert.match(appSource, /window\.location\.assign\("https:\/\/subscriptions\.talkaton\.org"\)/);
assert.match(subscriptionsPageSource, /1,500<\/strong> premium-model messages per day/);
assert.match(subscriptionsPageSource, /5,000<\/strong> premium-model messages per day/);
assert.match(subscriptionsPageSource, /10,000<\/strong> premium-model messages per day/);
assert.match(subscriptionsPageSource, /Unlimited chat after that with Ollama backup/);
assert.match(appSource, /PAID_TIERS\.has\(getUserTier\(\)\) \|\| state\.dailyMessageCount < getDailyLimit\(\)/);
assert.match(appSource, /messages continue with the Ollama backup/);
assert.match(subscriptionsAppSource, /emailRedirectTo: `\$\{CONFIG\.BILLING_ORIGIN\}\//);
assert.match(subscriptionsAppSource, /\/api\/billing-checkout/);
assert.match(subscriptionsAppSource, /\/api\/billing-portal/);
assert.match(appSource, /actionButton\("Compare model", "compare"\)/);
assert.match(appSource, /function compareMessageWithAnotherModel\(message\)/);
assert.match(appSource, /function sendModelComparison\(\)/);
assert.match(appSource, /comparisonLabel: `1 of 2/);
assert.match(appSource, /comparisonLabel: `2 of 2/);
assert.match(appSource, /historyOverride/);
assert.match(appSource, /model: requestModel/);
assert.match(appSource, /comparisonId: message\.comparisonId \|\| ""/);
assert.match(appSource, /\["guest", "free"\]\.includes\(tier\)/);
assert.match(appSource, /"~google\/gemini-flash-latest": "Gemini Flash \(1\.5 successor\)"/);
assert.match(appSource, /"microsoft\/phi-4": "Phi 4 \(3\.5 Mini successor\)"/);
assert.match(appSource, /"cohere\/command-r-08-2024": "Command R"/);
assert.match(appSource, /"qwen\/qwen-2\.5-72b-instruct": "Qwen 2\.5 72B"/);
assert.match(appSource, /function toggleIncognitoMode\(\)/);
assert.match(appSource, /await isLikelyPrivateBrowsing\(\)/);
assert.match(appSource, /function blockPrivateBrowsing\(\)/);
assert.match(appSource, /get_real_member_count/);
assert.doesNotMatch(appSource, /record_unique_visit/);
assert.match(appSource, /function createChatFolder\(\)/);
assert.match(appSource, /function shareChat\(chat\)/);
assert.match(appSource, /function importSharedChatFromUrl\(\)/);
assert.match(appSource, /async function importMemoryFile\(event\)/);
assert.match(appSource, /function parseImportedMemory\(text, fileName = ""\)/);
assert.match(appSource, /navigator\.mediaDevices\?\.getUserMedia/);
assert.match(appSource, /async function sendVoiceTranscript\(\)/);
assert.match(appSource, /function beginVoiceConversation\(\)/);
assert.match(appSource, /function resumeLiveVoiceConversation\(delay = 350\)/);
assert.match(appSource, /voiceConversationActive && DOM\.voiceDialog\.open/);
assert.match(appSource, /await speakText\(reply\.content, \{ liveConversation: voiceConversationActive \}\)/);
assert.match(appSource, /getChat\(\)\?\.incognito/);
assert.match(appSource, /let devAccessApproved = false/);
assert.match(appSource, /isUnlimitedTier\(tier\) \|\| devAccessApproved/);
assert.match(appSource, /return "dev"/);
assert.match(appSource, /return "Owner"/);
assert.match(appSource, /return "Support"/);
assert.doesNotMatch(appSource, /Dev plan|unlimitedEmails/);

const chatHtmlSource = await readFile(new URL("chat/index.html", root), "utf8");
const faviconSource = await readFile(new URL("favicon.svg", root), "utf8");
const cacheBustedFaviconSource = await readFile(new URL("favicon-t-20260728.svg", root), "utf8");
assert.match(chatHtmlSource, /id="resendConfirmationBtn"/);
assert.match(chatHtmlSource, /Resend confirmation email/);
assert.match(chatHtmlSource, /id="compareBtn"/);
assert.match(chatHtmlSource, /id="compareModelSelect"/);
assert.match(chatHtmlSource, /Ask two models the same thing|Compare two AI models/);
assert.match(chatHtmlSource, /Speak naturally\. Talkaton sends each turn/);
assert.match(chatHtmlSource, /id="voiceAutoSend" type="checkbox" checked/);
assert.match(chatHtmlSource, /Start Live chat/);
assert.match(chatHtmlSource, /class="voiceStage"/);
assert.match(chatHtmlSource, /id="voiceEndBtn"/);
assert.match(chatHtmlSource, /Transcript and voice options/);
assert.match(chatHtmlSource, /id="voiceSelect"/);
assert.match(chatHtmlSource, /id="voicePermissionBtn"/);
assert.match(chatHtmlSource, /id="voiceStartBtn" type="button" disabled/);
assert.match(appSource, /function setupVoicePicker\(\)/);
assert.match(appSource, /speechSynthesis\.getVoices\(\)/);
assert.match(appSource, /state\.settings\.voiceURI = DOM\.voiceSelect\.value/);
assert.match(appSource, /applySelectedSpeechVoice\(utterance\)/);
console.log("PASS chosen system voice is remembered and used for live and read-aloud speech");
assert.match(appSource, /async function requestVoiceMicrophonePermission\(\)/);
assert.match(appSource, /getUserMedia\(\{ audio: true \}\)/);
assert.match(appSource, /Microphone allowed\. Press Start when you’re ready\./);
assert.match(appSource, /DOM\.voiceStartBtn\.disabled = !voiceMicrophonePermissionGranted/);
console.log("PASS microphone permission is granted separately before live listening starts");
assert.match(appSource, /async function startRecordedVoiceTurn/);
assert.match(appSource, /function monitorRecordedVoiceActivity/);
assert.match(appSource, /await transcribeRecordedVoice\(audio\)/);
assert.match(appSource, /fetch\("\/api\/transcribe"/);
assert.match(appSource, /Switching to Talkaton transcription/);
console.log("PASS Live chat records and transcribes turns without the browser speech network");
for (const id of [
  "chatFolderFilter",
  "newFolderBtn",
  "incognitoBtn",
  "memoryImportInput",
  "voiceDialog",
  "voiceCaption",
  "voiceEndBtn"
]) {
  assert.match(chatHtmlSource, new RegExp(`id="${id}"`));
}
assert.match(chatHtmlSource, /id="voiceTitle">Live chat/);
assert.match(chatHtmlSource, /id="voiceBtn"[\s\S]*?title="Live chat with Talkaton"/);
assert.doesNotMatch(chatHtmlSource, /liveChatBtn|popoverLiveChat|liveRoomDialog|liveRoomCodeInput|Join a room/);
assert.doesNotMatch(appSource, /liveRoomChannel|joinLiveRoom|shareLiveRoomInvite|sendLiveRoomMessage/);
console.log("PASS Live chat means Talkaton voice and user-to-user rooms are removed");
assert.match(faviconSource, /fill="#f43f46"/);
assert.match(faviconSource, /prefers-color-scheme: dark/);
  assert.match(
    faviconSource,
    /\.talkaton-letter \{ fill: #ffffff; \}[\s\S]*@media \(prefers-color-scheme: dark\)[\s\S]*\.talkaton-letter \{ fill: #111111; \}/
  );
assert.equal(cacheBustedFaviconSource, faviconSource);
for (const page of ["index.html", "chat/index.html", "beta/index.html", "beta/admin/index.html", "about/index.html", "404.html"]) {
  const source = await readFile(new URL(page, root), "utf8");
  assert.match(source, /href="\/favicon-t-20260728\.svg"/);
}

const betaSource = await readFile(new URL("beta/app.js", root), "utf8");
const betaHtmlSource = await readFile(new URL("beta/index.html", root), "utf8");
const localSupabaseSource = await readFile(new URL("vendor/supabase-2.57.4.min.js", root), "utf8");
assert.match(betaSource, /fetch\("\/api\/beta-status"/);
assert.match(betaSource, /href: "\/chat\?beta=1"/);
assert.match(betaSource, /\.from\("beta_requests"\)\.insert\(payload\)/);
assert.match(betaSource, /loadMyRequests/);
assert.match(
  betaSource,
  /\.from\("beta_requests"\)[\s\S]*?\.select\("id, feature_key, title, details, status, admin_note, reviewed_at, access_expires_at, created_at"\)[\s\S]*?\.eq\("user_id", currentSession\.user\.id\)/
);
assert.match(betaSource, /existing_model:[\s\S]*featureKey: "model_access"/);
assert.match(betaSource, /new_model:[\s\S]*featureKey: "custom"/);
assert.match(betaSource, /new_mode:[\s\S]*titlePrefix: "New mode"/);
assert.match(betaSource, /dev_access:[\s\S]*featureKey: "dev_access"/);
assert.match(betaSource, /Confirmed Talkaton accounts can request Dev Access without first joining Beta/);
assert.match(betaSource, /const isDevAccessRequest = typeInput\.value === "dev_access"/);
assert.match(betaSource, /if \(!currentSession\?\.user\)/);
assert.match(betaSource, /supabase\.rpc\("submit_dev_access_request"/);
assert.match(betaSource, /devAccessOption\.hidden = false/);
assert.match(betaSource, /devAccessOption\.disabled = !currentSession\?\.user/);
assert.match(betaSource, /submitButton\.disabled = !user/);
assert.match(betaSource, /result\.devApproved === true/);
assert.match(betaSource, /storedTitle/);
assert.match(betaHtmlSource, /value="existing_model"/);
assert.match(betaHtmlSource, /value="new_model"/);
assert.match(betaHtmlSource, /value="new_mode"/);
assert.match(betaHtmlSource, /value="new_tool"/);
assert.match(betaHtmlSource, /id="devAccessOption" value="dev_access">Dev Access/);
assert.match(betaHtmlSource, /confirmed Talkaton account can request time-limited Dev Access/);
assert.match(betaHtmlSource, /All 12 models/);
assert.match(betaHtmlSource, /<dt>Models<\/dt><dd>12<\/dd>/);
assert.match(betaHtmlSource, /Be first to use what Talkaton builds next/);
assert.match(betaHtmlSource, /src="\/vendor\/supabase-2\.57\.4\.min\.js"/);
assert.match(betaSource, /globalThis\.supabase\?\.createClient/);
assert.doesNotMatch(betaSource, /esm\.sh\/@supabase\/supabase-js/);
assert.match(betaSource, /REVIEWER_EMAILS[\s\S]*donotuseunlessyouaretalkanter@gmail\.com/);
assert.match(localSupabaseSource, /e\.supabase=t\(\)/);

const adminSource = await readFile(new URL("beta/admin/app.js", root), "utf8");
const adminHtmlSource = await readFile(new URL("beta/admin/index.html", root), "utf8");
assert.match(adminSource, /SUPPORT_EMAIL = "supportaton@gmail\.com"/);
assert.match(adminSource, /OWNER_EMAIL = "kantertal1@gmail\.com"/);
assert.match(adminSource, /OWNER_ALT_EMAIL = "donotuseunlessyouaretalkanter@gmail\.com"/);
assert.match(adminSource, /email === OWNER_EMAIL[\s\S]*"owner"[\s\S]*email === OWNER_ALT_EMAIL[\s\S]*"owner_alt"[\s\S]*email === SUPPORT_EMAIL[\s\S]*"support"/);
assert.match(adminSource, /\.from\("beta_requests"\)/);
assert.match(adminSource, /\.update\(\{/);
assert.match(adminSource, /request\.status !== "pending"/);
assert.match(adminSource, /function renderReviewedRequests\(\)/);
assert.match(adminSource, /function createReviewedRequestCard\(request\)/);
assert.match(adminSource, /renderReviewedList\("approved", approvedList\)/);
assert.match(adminSource, /renderReviewedList\("declined", declinedList\)/);
assert.match(adminSource, /Object\.assign\(request, \{/);
assert.match(adminSource, /No pending requests\. You’re all caught up\./);
assert.doesNotMatch(adminSource, /adminStatusFilter/);
assert.doesNotMatch(adminHtmlSource, /id="adminStatusFilter"/);
assert.match(adminHtmlSource, /Approved or declined items disappear from this inbox immediately/);
assert.match(adminHtmlSource, /id="adminApprovedArchive"/);
assert.match(adminHtmlSource, /id="adminDeclinedArchive"/);
assert.match(adminHtmlSource, /id="adminApprovedCount"/);
assert.match(adminHtmlSource, /id="adminDeclinedCount"/);
assert.match(adminSource, /data-review-status/);
assert.match(adminSource, /function calculateAccessExpiration\(card\)/);
assert.match(adminSource, /\["seconds", "Seconds"\]/);
assert.match(adminSource, /\["minutes", "Minutes"\]/);
assert.match(adminSource, /seconds: 1_000/);
assert.match(adminSource, /minutes: 60_000/);
assert.match(adminSource, /access_expires_at: accessExpiresAt/);
assert.match(adminSource, /How long should trusted Beta access last/);
assert.match(adminHtmlSource, /src="\/vendor\/supabase-2\.57\.4\.min\.js"/);
assert.doesNotMatch(adminSource, /esm\.sh\/@supabase\/supabase-js/);

const schemaSource = await readFile(new URL("supabase/beta_requests.sql", root), "utf8");
const ownerApprovalSource = await readFile(new URL("supabase/owner_approval.sql", root), "utf8");
const ownerAltApprovalSource = await readFile(new URL("supabase/owner_alt_approval.sql", root), "utf8");
const codeatonHistorySource = await readFile(new URL("supabase/codeaton_chat_history.sql", root), "utf8");
const trustedBetaMigrationSource = await readFile(new URL("supabase/beta_access_duration.sql", root), "utf8");
const openDevMigrationSource = await readFile(new URL("supabase/open_dev_access_requests.sql", root), "utf8");
const accountOnlyDevMigrationSource = await readFile(new URL("supabase/account-only-dev-access.sql", root), "utf8");
const personalRequestHistoryMigrationSource = await readFile(new URL("supabase/personal-beta-request-history.sql", root), "utf8");
const guestUsageMigrationSource = await readFile(new URL("supabase/member-counter-and-guest-usage.sql", root), "utf8");
assert.match(schemaSource, /alter table public\.beta_requests enable row level security/);
assert.match(schemaSource, /Support and owner can review requests/);
assert.match(schemaSource, /supportaton@gmail\.com/);
assert.match(schemaSource, /kantertal1@gmail\.com/);
assert.match(schemaSource, /status = 'pending'/);
assert.match(ownerApprovalSource, /kantertal1@gmail\.com/);
assert.match(ownerApprovalSource, /donotuseunlessyouaretalkanter@gmail\.com/);
assert.match(ownerApprovalSource, /Support and owner can review requests/);
assert.match(ownerAltApprovalSource, /donotuseunlessyouaretalkanter@gmail\.com/);
assert.match(ownerAltApprovalSource, /function public\.is_talkaton_reviewer/);
assert.match(ownerAltApprovalSource, /email_confirmed_at is not null/);
assert.match(codeatonHistorySource, /create table if not exists public\.codeaton_chats/);
assert.match(codeatonHistorySource, /messages jsonb not null/);
assert.match(codeatonHistorySource, /auth\.uid\(\) = user_id/);
assert.match(codeatonHistorySource, /enable row level security/);
assert.match(trustedBetaMigrationSource, /add column if not exists access_expires_at timestamptz/);
assert.match(trustedBetaMigrationSource, /'dev_access'/);
assert.match(trustedBetaMigrationSource, /access_expires_at is null/);
assert.match(trustedBetaMigrationSource, /function public\.has_active_beta_access/);
assert.doesNotMatch(trustedBetaMigrationSource, /feature_key <> 'dev_access'/);
assert.match(openDevMigrationSource, /alter column user_id drop not null/);
assert.match(openDevMigrationSource, /function public\.submit_dev_access_request/);
assert.match(openDevMigrationSource, /revoke execute on function public\.submit_dev_access_request[\s\S]*from anon/);
assert.match(openDevMigrationSource, /grant execute on function public\.submit_dev_access_request[\s\S]*to authenticated/);
assert.match(openDevMigrationSource, /status = 'pending'/);
assert.match(openDevMigrationSource, /A Dev Access request for this email is already pending/);
assert.match(openDevMigrationSource, /auth\.uid\(\) = user_id[\s\S]*lower\(coalesce\(auth\.jwt\(\) ->> 'email'/);
assert.match(accountOnlyDevMigrationSource, /if auth\.uid\(\) is null/);
assert.match(accountOnlyDevMigrationSource, /Log in to a confirmed Talkaton account/);
assert.match(accountOnlyDevMigrationSource, /where user_id = auth\.uid\(\)/);
assert.match(accountOnlyDevMigrationSource, /revoke execute on function public\.submit_dev_access_request[\s\S]*from anon/);
assert.match(accountOnlyDevMigrationSource, /grant execute on function public\.submit_dev_access_request[\s\S]*to authenticated/);
assert.match(personalRequestHistoryMigrationSource, /set user_id = account\.id/);
assert.match(personalRequestHistoryMigrationSource, /using \(auth\.uid\(\) = user_id\)/);
assert.doesNotMatch(personalRequestHistoryMigrationSource, /auth\.jwt\(\) ->> 'email'/);
assert.match(guestUsageMigrationSource, /function public\.consume_guest_usage/);
assert.match(guestUsageMigrationSource, /primary key \(guest_key, usage_date, feature\)/);
assert.match(guestUsageMigrationSource, /function public\.get_real_member_count/);
assert.match(guestUsageMigrationSource, /email_confirmed_at is not null/);
assert.match(guestUsageMigrationSource, /not coalesce\(is_anonymous, false\)/);

const guestGuardSource = await readFile(new URL("server/_guest-guard.js", root), "utf8");
assert.match(guestGuardSource, /createHmac\("sha256"/);
assert.match(guestGuardSource, /x-vercel-forwarded-for/);
assert.match(guestGuardSource, /AUTOMATED_TRAFFIC_BLOCKED/);

const betaStatusSource = await readFile(new URL("server/beta-status.js", root), "utf8");
const chatApiSource = await readFile(new URL("server/chat.js", root), "utf8");
const transcribeApiSource = await readFile(new URL("server/transcribe.js", root), "utf8");
const billingStatusSource = await readFile(new URL("server/billing-status.js", root), "utf8");
const billingCheckoutSource = await readFile(new URL("server/billing-checkout.js", root), "utf8");
const billingPortalSource = await readFile(new URL("server/billing-portal.js", root), "utf8");
assert.doesNotMatch(appSource, /esm\.sh\/@supabase\/supabase-js/);
assert.match(betaStatusSource, /rest\/v1\/beta_requests/);
assert.match(betaStatusSource, /grant\.feature_key === "beta_lab"/);
assert.match(betaStatusSource, /\["kantertal1@gmail\.com", "owner"\]/);
assert.match(betaStatusSource, /\["donotuseunlessyouaretalkanter@gmail\.com", "owner_alt"\]/);
assert.match(betaStatusSource, /\["supportaton@gmail\.com", "support"\]/);
assert.match(betaStatusSource, /devApproved/);
assert.match(betaStatusSource, /const devApproved = Boolean\(role\) \|\| Boolean\(devGrant\)/);
assert.match(betaStatusSource, /getApprovedRequests\(authorization, user\?\.id\)/);
assert.match(betaStatusSource, /url\.searchParams\.set\("user_id", `eq\.\$\{userId\}`\)/);
assert.match(betaStatusSource, /function isGrantActive\(grant\)/);
assert.match(betaStatusSource, /betaExpiresAt/);
assert.match(chatApiSource, /hasApprovedBetaRequest/);
assert.match(chatApiSource, /feature_key", "eq\.beta_lab"/);
assert.match(chatApiSource, /plan === "owner"/);
assert.match(chatApiSource, /plan === "owner_alt"/);
assert.match(chatApiSource, /plan === "support"/);
assert.match(chatApiSource, /ACCOUNT_ROLES\.has\(email\)/);
assert.doesNotMatch(chatApiSource, /Current mode:/);
assert.doesNotMatch(chatApiSource, /Beta Lab behavior:/);
assert.match(chatApiSource, /FREE_MODELS\.has\(requestedModel\) \|\| betaAccessApproved/);
assert.match(chatApiSource, /access_expires_at/);
assert.match(chatApiSource, /plan === "dev"/);
assert.match(chatApiSource, /~google\/gemini-flash-latest/);
assert.match(chatApiSource, /microsoft\/phi-4/);
assert.match(chatApiSource, /cohere\/command-r-08-2024/);
assert.match(chatApiSource, /qwen\/qwen-2\.5-72b-instruct/);
assert.match(transcribeApiSource, /api\.openai\.com\/v1\/audio\/transcriptions/);
assert.match(transcribeApiSource, /form\.append\("model", "gpt-transcribe"\)/);
assert.match(transcribeApiSource, /bodyParser: false/);
assert.match(transcribeApiSource, /MAX_AUDIO_BYTES = 10 \* 1024 \* 1024/);
assert.match(billingStatusSource, /getAccountAccess/);
assert.match(billingCheckoutSource, /mode", "subscription"/);
assert.match(billingCheckoutSource, /client_reference_id/);
assert.match(billingCheckoutSource, /https:\/\/subscriptions\.talkaton\.org/);
assert.match(billingPortalSource, /billing_portal\/sessions/);
assert.match(billingPortalSource, /https:\/\/subscriptions\.talkaton\.org/);
assert.doesNotMatch(guestGuardSource, /price_1U00CxBHAYaritUYS4idTqRU/);
assert.doesNotMatch(guestGuardSource, /price_1U00IoBHAYaritUY0AIDOTvp/);
assert.doesNotMatch(guestGuardSource, /price_1U00KoBHAYaritUYCLYp3xIr/);
assert.match(guestGuardSource, /STRIPE_PRICE_\$\{plan\.toUpperCase\(\)\}/);
assert.match(guestGuardSource, /mode === "live"/);
assert.match(guestGuardSource, /PLAN_LIMITS/);
assert.match(guestGuardSource, /plus:[\s\S]*messages: 1500[\s\S]*pro:[\s\S]*messages: 5000[\s\S]*max:[\s\S]*messages: 10000/);
assert.match(guestUsageMigrationSource, /'voice'/);
assert.match(guestUsageMigrationSource, /p_limit > 10000/);

console.log("PASS generated images survive local persistence");
console.log("PASS generated images remain in cloud serialization");
console.log("PASS incognito chats never enter local or cloud persistence");
console.log("PASS image API returns compressed WebP data");
console.log("PASS rename preserves the existing chat ID");
console.log("PASS generated images include a format-correct download");
console.log("PASS unconfirmed accounts can request another confirmation email");
console.log("PASS an unconfirmed login automatically requests a new confirmation email");
console.log("PASS owner and support roles are unlimited and replace the old dev label");
console.log("PASS owner and support roles receive server-verified Beta Lab access");
console.log("PASS Beta page checks and launches approved access");
console.log("PASS requests cover existing models, new models, new modes, tools, and custom features");
console.log("PASS response modes are removed from the chat prompt");
console.log("PASS users can submit and review their own custom requests");
console.log("PASS owner and support inbox can approve a specific request");
console.log("PASS row-level security restricts the full queue to owner and support");
console.log("PASS Beta members receive all models, higher limits, and instant model compare");
console.log("PASS trusted Beta and Dev Access expire automatically");
console.log("PASS Dev Access requires a confirmed account but not Beta approval");
console.log("PASS declined or approved Dev requests do not block a later request");
console.log("PASS Dev Access requests are tied to the authenticated account");
console.log("PASS Owner and Support choose a custom access duration");
console.log("PASS approved Beta Lab requests unlock server authorization");
console.log("PASS every login requires an emailed confirmation link");
console.log("PASS folders, private sharing, and memory import are wired");
console.log("PASS voice chat handles microphone permission, transcripts, sending, and spoken replies");
console.log("PASS live voice automatically sends, speaks, and resumes listening");
console.log("PASS private browser sessions are blocked and guest limits are enforced server-side");
console.log("PASS joined counter counts unique confirmed non-bot accounts");
console.log("PASS approval inbox keeps separate Approved and Declined archives");
