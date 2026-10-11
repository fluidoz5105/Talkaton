import { createId, loadStoredState, saveStoredState, serializeForCloud, loadCloudData, saveCloudData } from "../modules/storage.js?v=20260729-private-guard1";
import { isLikelyPrivateBrowsing } from "../modules/private-browser.js?v=20260729-private-guard1";
import {
  ACCEPTED_FILE_LABEL,
  attachmentGlyph,
  formatFileSize,
  prepareFiles,
  prepareFolder
} from "../modules/uploads.js?v=20260729-collaboration1";
import { isMessageSubmitKey } from "../modules/keyboard.js?v=20260729-collaboration1";
import { createSharedAuthStorage } from "../modules/shared-auth-storage.js?v=20260813-shared-session1";

const CONFIG = {
  SUPABASE_URL: "https://cxulgeojkjnskdyoktkj.supabase.co",
  SUPABASE_KEY: "sb_publishable_GgxtfIaIamzZFY_jMU4_Cw_V8NKm475",
  CHAT_API: "/api/chat",
  SEARCH_API: "/api/search",
  IMAGE_API: "/api/image",
  MAX_MEMORY: 100,
  INITIAL_CHAT_BATCH: 30,
  CHAT_BATCH_SIZE: 25,
  ACCOUNT_ROLES: {
    "kantertal1@gmail.com": {
      tier: "owner",
      label: "Owner",
      description: "Full owner access · unlimited"
    },
    "donotuseunlessyouaretalkanter@gmail.com": {
      tier: "owner_alt",
      label: "Owner Alt Acount",
      description: "Alternate owner access · unlimited"
    },
    "supportaton@gmail.com": {
      tier: "support",
      label: "Support",
      description: "Support access · unlimited"
    }
  },
  DAILY_LIMITS: {
    guest: 75,
    free: 250,
    plus: 1500,
    pro: 5000,
    max: 10000
  },
  BETA_DAILY_LIMITS: {
    messages: 750,
    images: 60,
    searches: 200
  },
  IMAGE_DAILY_LIMITS: {
    guest: 0,
    free: 20,
    plus: 75,
    pro: 250,
    max: 500
  },
  SEARCH_DAILY_LIMITS: {
    guest: 25,
    free: 75,
    plus: 300,
    pro: 1000,
    max: 2500
  }
};

const MODEL_NAMES = {
  "ollama/default": "Ollama",
  "openai/gpt-5.4-nano": "GPT-5.4 Nano",
  "openai/gpt-4.1-mini": "GPT-4.1 Mini",
  "anthropic/claude-3-haiku": "Claude 3 Haiku",
  "google/gemini-2.5-flash-lite": "Gemini",
  "~google/gemini-flash-latest": "Gemini Flash (1.5 successor)",
  "microsoft/phi-4": "Phi 4 (3.5 Mini successor)",
  "cohere/command-r-08-2024": "Command R",
  "qwen/qwen-2.5-72b-instruct": "Qwen 2.5 72B",
  "deepseek/deepseek-chat": "DeepSeek Chat",
  "meta-llama/llama-3.1-8b-instruct": "Llama 3.1 8B",
  "mistralai/mistral-small-3.1-24b-instruct": "Mistral Small",
  "openai/gpt-5.4-mini": "GPT-5.4 Mini",
  "ollama/gemma3:12b": "Ollama Backup · Gemma 3 12B"
};

const PAID_TIERS = new Set(["plus", "pro", "max"]);



const MODEL_ALIASES = {
  "google/gemini-pro": "google/gemini-2.5-flash-lite",
  "google/gemini-flash-1.5": "~google/gemini-flash-latest",
  "gemini-1.5-flash": "~google/gemini-flash-latest",
  "microsoft/phi-3.5-mini-128k-instruct": "microsoft/phi-4",
  "phi-3.5-mini": "microsoft/phi-4",
  "command-r": "cohere/command-r-08-2024",
  "qwen-2.5": "qwen/qwen-2.5-72b-instruct"
};

const defaultState = {
  user: null,
  loggedIn: false,
  chats: [],
  currentChatId: null,
  memory: [],
  loading: false,
  model: "ollama/default",
  settings: {
    voice: true,
    markdown: true,
    memory: true,
    timestamps: false,
    autoScroll: true,
    theme: "system",
    speechRate: 1,
    voiceURI: "",
    chatFolders: [],
    activeFolderId: "all"
  },
  sidebarCollapsed: false,
  pendingAttachments: [],
  dailyMessageCount: 0,
  dailyMessageDate: null,
  dailyImageCount: 0,
  dailyImageDate: null,
  dailySearchCount: 0,
  dailySearchDate: null
};

let state = loadStoredState(defaultState);
state.pendingAttachments = [];
let abortController = null;
let markdownModulePromise = null;
let renderFrame = null;
let renderTimer = null;
let lastStreamingPaint = 0;
let textareaResizeFrame = null;
let chatSearchTimer = null;
let persistTimer = null;
let persistIdleHandle = null;
let visibleChatCount = CONFIG.INITIAL_CHAT_BATCH;
let userPausedScroll = false;
let lastChatScrollTop = 0;
let touchScrollY = null;
let dragDepth = 0;
let activePromptResolver = null;
let recognition = null;
let voiceFinalTranscript = "";
let voiceSending = false;
let voiceConversationActive = false;
let voiceMicrophonePermissionGranted = false;
let voiceRestartTimer = null;
let voiceSpeechResolver = null;
let voiceUseRecordedTranscription = false;
let voiceRecorder = null;
let voiceRecorderStream = null;
let voiceRecorderChunks = [];
let voiceRecorderCancelled = false;
let voiceAudioContext = null;
let voiceSilenceFrame = null;
let voiceRecorderTimeout = null;
let voiceRecordingStartedAt = 0;
let voiceLastSoundAt = 0;
let voiceSoundDetected = false;
let searchMode = false;
let compareMode = false;
let incognitoMode = false;
let authMode = "signIn";
let googleAuthEnabled = false;
let passwordRecoveryPending = false;
let signupConfirmationPending = false;
let loginConfirmationPending = false;
let resendConfirmationAvailableAt = 0;
let resendConfirmationTimer = null;
let showResendConfirmation = false;
let initialSessionResolved = false;
let pendingProfileAvatar = "";
let betaApproved = false;
let devAccessApproved = false;
let betaAccessExpiresAt = "";
let devAccessExpiresAt = "";
let betaModeRequested = false;
let subscriptionPlan = "free";
let billingStatus = {
  plan: "guest",
  paid: false,
  billingConfigured: false,
  testMode: false,
  subscriptionStatus: null
};

let supabasePromise = null;
let cloudSyncTimer = null;
let cloudSyncDueAt = 0;
let cloudSyncInFlight = false;
let cloudDirty = false;
let cloudRetryTimer = null;
let cloudPullInFlight = false;
let lastCloudUpdateSeen = "";
let lastMessageCheckpointAt = 0;
let localMutationVersion = 0;

const STREAM_PAINT_INTERVAL = 80;
const MESSAGE_CHECKPOINT_INTERVAL = 1500;
const CLOUD_SYNC_DELAY = 1000;
const CLOUD_PULL_INTERVAL = 5000;
const VOICE_SILENCE_MS = 1050;
const VOICE_WAIT_FOR_SPEECH_MS = 8500;
const VOICE_MAX_TURN_MS = 30_000;
const VOICE_ACTIVITY_THRESHOLD = 0.018;

const DOM = {
  app: byId("app"),
  main: byId("main"),
  sidebar: byId("sidebar"),
  sidebarBackdrop: byId("sidebarBackdrop"),
  sidebarCloseBtn: byId("sidebarCloseBtn"),
  sidebarCollapseBtn: byId("sidebarCollapseBtn"),
  menuBtn: byId("menuBtn"),
  chatArea: byId("chatArea"),
  chatViewport: byId("chatViewport"),
  input: byId("messageInput"),
  composer: byId("composer"),
  composerDock: byId("composerDock"),
  sendBtn: byId("sendBtn"),
  toolsBtn: byId("toolsBtn"),
  newChatBtn: byId("newChatBtn"),
  chatList: byId("chatList"),
  chatListSentinel: byId("chatListSentinel"),
  chatSearchInput: byId("chatSearchInput"),
  chatFolderFilter: byId("chatFolderFilter"),
  newFolderBtn: byId("newFolderBtn"),
  deleteFolderBtn: byId("deleteFolderBtn"),
  loginBtn: byId("loginBtn"),
  modelSelect: byId("modelSelect"),
  compareBtn: byId("compareBtn"),
  compareBar: byId("compareBar"),
  comparePrimaryName: byId("comparePrimaryName"),
  compareModelSelect: byId("compareModelSelect"),
  compareCloseBtn: byId("compareCloseBtn"),
  searchBtn: byId("searchBtn"),
  imageGenerateBtn: byId("imageGenerateBtn"),
  imageUploadBtn: byId("imageUploadBtn"),
  attachmentBtn: byId("attachmentBtn"),
  voiceBtn: byId("voiceBtn"),
  memoryBtn: byId("memoryBtn"),
  supportBtn: byId("supportBtn"),
  plansBtn: byId("plansBtn"),
  supportDialog: byId("supportDialog"),
  settingsBtn: byId("settingsBtn"),
  themeBtn: byId("themeBtn"),
  clearChatBtn: byId("clearChatBtn"),
  incognitoBtn: byId("incognitoBtn"),
  messageCounter: byId("messageCounter"),
  visitorCount: byId("visitorCount"),
  memoryCount: byId("memoryCount"),
  conversationTitle: byId("conversationTitle"),
  connectionStatus: byId("connectionStatus"),
  offlineBanner: byId("offlineBanner"),
  charCount: byId("charCount"),
  scrollBottomBtn: byId("scrollBottomBtn"),
  imageInput: byId("imageInput"),
  fileInput: byId("fileInput"),
  folderInput: byId("folderInput"),
  memoryImportInput: byId("memoryImportInput"),
  attachmentTray: byId("attachmentTray"),
  dropOverlay: byId("dropOverlay"),
  toastRegion: byId("toastRegion"),
  announcer: byId("announcer"),
  settingsDialog: byId("settingsDialog"),
  memoryDialog: byId("memoryDialog"),
  memoryContent: byId("memoryContent"),
  authDialog: byId("authDialog"),
  authForm: byId("authForm"),
  authEyebrow: byId("authEyebrow"),
  authTitle: byId("authTitle"),
  authIntro: byId("authIntro"),
  authGoogleBtn: byId("authGoogleBtn"),
  authProviderSection: byId("authProviderSection"),
  authSwitchText: byId("authSwitchText"),
  signInTab: byId("signInTab"),
  signUpTab: byId("signUpTab"),
  authEmail: byId("authEmail"),
  authPassword: byId("authPassword"),
  authConfirmPasswordField: byId("authConfirmPasswordField"),
  authConfirmPassword: byId("authConfirmPassword"),
  authError: byId("authError"),
  authSubmitBtn: byId("authSubmitBtn"),
  forgotPasswordBtn: byId("forgotPasswordBtn"),
  resendConfirmationBtn: byId("resendConfirmationBtn"),
  profileDialog: byId("profileDialog"),
  profileForm: byId("profileForm"),
  profileAvatarInitial: byId("profileAvatarInitial"),
  profileAvatarImage: byId("profileAvatarImage"),
  profileImageInput: byId("profileImageInput"),
  profileUploadBtn: byId("profileUploadBtn"),
  profileRemoveBtn: byId("profileRemoveBtn"),
  profileUsername: byId("profileUsername"),
  profileEmail: byId("profileEmail"),
  profileError: byId("profileError"),
  profileLogoutBtn: byId("profileLogoutBtn"),
  profileSaveBtn: byId("profileSaveBtn"),
  profileDashboard: byId("profileDashboard"),
  profilePlansBtn: byId("profilePlansBtn"),
  profileBillingBtn: byId("profileBillingBtn"),
  profilePreferencesBtn: byId("profilePreferencesBtn"),
  profilePasswordResetBtn: byId("profilePasswordResetBtn"),
  profileSyncBtn: byId("profileSyncBtn"),
  profileDownloadBtn: byId("profileDownloadBtn"),
  profileAccountStatus: byId("profileAccountStatus"),
  plansDialog: byId("plansDialog"),
  plansDialogStatus: byId("plansDialogStatus"),
  billingTestMode: byId("billingTestMode"),
  plansError: byId("plansError"),
  manageBillingBtn: byId("manageBillingBtn"),
  passwordResetDialog: byId("passwordResetDialog"),
  passwordResetForm: byId("passwordResetForm"),
  newPassword: byId("newPassword"),
  confirmPassword: byId("confirmPassword"),
  passwordResetError: byId("passwordResetError"),
  promptDialog: byId("promptDialog"),
  promptForm: byId("promptForm"),
  promptEyebrow: byId("promptEyebrow"),
  promptTitle: byId("promptTitle"),
  promptLabel: byId("promptLabel"),
  promptInput: byId("promptInput"),
  promptSubmitBtn: byId("promptSubmitBtn"),
  promptCancelBtn: byId("promptCancelBtn"),
  promptCancelX: byId("promptCancelX"),
  confirmDialog: byId("confirmDialog"),
  confirmForm: byId("confirmForm"),
  confirmEyebrow: byId("confirmEyebrow"),
  confirmTitle: byId("confirmTitle"),
  confirmMessage: byId("confirmMessage"),
  confirmSubmitBtn: byId("confirmSubmitBtn"),
  confirmCancelBtn: byId("confirmCancelBtn"),
  confirmCancelX: byId("confirmCancelX"),
  toolsPopover: byId("toolsPopover"),
  voiceDialog: byId("voiceDialog"),
  voiceOrb: byId("voiceOrb"),
  voiceLiveIndicator: byId("voiceLiveIndicator"),
  voiceModelName: byId("voiceModelName"),
  voiceSelect: byId("voiceSelect"),
  voiceStatus: byId("voiceStatus"),
  voiceCaption: byId("voiceCaption"),
  voiceTranscript: byId("voiceTranscript"),
  voiceAutoSend: byId("voiceAutoSend"),
  voiceSpeakReplies: byId("voiceSpeakReplies"),
  voicePermissionBtn: byId("voicePermissionBtn"),
  voiceStartBtn: byId("voiceStartBtn"),
  voiceSendBtn: byId("voiceSendBtn"),
  voiceEndBtn: byId("voiceEndBtn")
};

let appInitialized = false;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startApp, { once: true });
} else {
  startApp();
}

function startApp() {
  if (appInitialized) return;
  appInitialized = true;
  init().catch(error => {
    appInitialized = false;
    console.error("Talkaton failed to initialize:", error);
    document.body.classList.add("appInitFailed");
  });
}

async function init() {
  if (await isLikelyPrivateBrowsing()) {
    blockPrivateBrowsing();
    return;
  }

  normalizeState();
  importSharedChatFromUrl();
  bindEvents();
  refreshAuthProviderAvailability();
  setupVoicePicker();
  applyPreferences();
  updateShortcutLabels();
  updateNetworkStatus();
  updateViewportHeight();
  renderAttachmentTray();
  renderChats();
  renderMessages();
  updateStats();
  updateMessageCounter();
  updateComposerState();
  updateVisitorCounter();
  setupChatPagination();
  requestAnimationFrame(() => DOM.app.classList.add("appReady"));

  await restoreSession();
  await refreshBetaAccess();
  await refreshBillingAccess({ forceRefresh: hasSuccessfulBillingReturn() });
  syncCompareModelPicker();
  updateAccount();
  handleBillingReturn();
  handleRequestedAuthMode();
  handleRequestedBetaMode();

  const preloadMarkdown = () => loadMarkdown().catch(() => {});
  if ("requestIdleCallback" in window) window.requestIdleCallback(preloadMarkdown, { timeout: 2500 });
  else setTimeout(preloadMarkdown, 1200);
}

function blockPrivateBrowsing() {
  const blocker = document.createElement("main");
  blocker.className = "privateBrowsingBlocker";
  blocker.setAttribute("role", "alert");

  const mark = document.createElement("span");
  mark.className = "privateBrowsingMark";
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = "T";

  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "Private browsing blocked";

  const title = document.createElement("h1");
  title.textContent = "Open Talkaton in a normal browser window.";

  const detail = document.createElement("p");
  detail.textContent = "Private or incognito browser tabs are not supported because they can reset guest limits. Your normal window can still use Talkaton’s private Incognito chats.";

  blocker.append(mark, eyebrow, title, detail);
  DOM.app.setAttribute("inert", "");
  DOM.app.setAttribute("aria-hidden", "true");
  document.body.classList.add("privateBrowsingBlocked");
  document.body.append(blocker);
}

function getUserTier() {
  if (state.loggedIn && state.user?.email) {
    const role = getAccountRole(state.user.email);
    if (role) return role.tier;
    if (["plus", "pro", "max"].includes(subscriptionPlan)) return subscriptionPlan;
    return "free";
  }
  return "guest";
}

function getAccountRole(email = state.user?.email) {
  return CONFIG.ACCOUNT_ROLES[String(email || "").trim().toLowerCase()] || null;
}

function isUnlimitedTier(tier = getUserTier()) {
  return tier === "owner" || tier === "owner_alt" || tier === "support";
}

function canUseModel(model, tier = getUserTier()) {
  if (!MODEL_NAMES[model]) return false;
  if (["guest", "free"].includes(tier)) return model === "ollama/default";
  return true;
}

function getAvailableModels() {
  return Object.keys(MODEL_NAMES).filter(model => canUseModel(model));
}

function getRequestPlan() {
  if (devAccessApproved && !isUnlimitedTier()) return "dev";
  return getUserTier();
}

function getTierLabel(tier = getUserTier()) {
  if (tier === "owner") return "Owner";
  if (tier === "owner_alt") return "Owner Alt Acount";
  if (tier === "support") return "Support";
  if (tier === "plus") return "Talkaton Plus";
  if (tier === "pro") return "Talkaton Pro";
  if (tier === "max") return "Talkaton Max";
  if (tier === "free") return "Free plan";
  return "Guest plan";
}

function getTierDescription(tier = getUserTier()) {
  if (tier === "owner") return "Full owner access · unlimited";
  if (tier === "owner_alt") return "Alternate owner access · unlimited";
  if (tier === "support") return "Support access · unlimited";
  if (tier === "plus") return "1,500 premium messages/day · Ollama backup after";
  if (tier === "pro") return "5,000 premium messages/day · Ollama backup after";
  if (tier === "max") return "10,000 premium messages/day · Ollama backup after";
  if (tier === "free") return "Standard access";
  return "Limited access";
}

function getDailyLimit() {
  const tier = getUserTier();
  if (isUnlimitedTier(tier) || devAccessApproved) return Infinity;
  const baseLimit = CONFIG.DAILY_LIMITS[tier] ?? CONFIG.DAILY_LIMITS.free;
  return betaApproved ? Math.max(baseLimit, CONFIG.BETA_DAILY_LIMITS.messages) : baseLimit;
}

function resetDailyIfNewDay() {
  const today = new Date().toISOString().slice(0, 10);
  if (state.dailyMessageDate !== today) {
    state.dailyMessageDate = today;
    state.dailyMessageCount = 0;
    persist();
  }
}

function canSendMessage() {
  resetDailyIfNewDay();
  return PAID_TIERS.has(getUserTier()) || state.dailyMessageCount < getDailyLimit();
}

function incrementDailyCount() {
  resetDailyIfNewDay();
  state.dailyMessageCount += 1;
  persist();
  updateMessageCounter();
}

function getRemainingMessages() {
  resetDailyIfNewDay();
  const limit = getDailyLimit();
  if (!Number.isFinite(limit)) return "∞";
  return Math.max(0, limit - state.dailyMessageCount);
}

function getImageDailyLimit() {
  const tier = getUserTier();
  if (isUnlimitedTier(tier) || devAccessApproved) return Infinity;
  const baseLimit = CONFIG.IMAGE_DAILY_LIMITS[tier] ?? CONFIG.IMAGE_DAILY_LIMITS.free;
  return betaApproved ? Math.max(baseLimit, CONFIG.BETA_DAILY_LIMITS.images) : baseLimit;
}

function resetImageDailyIfNewDay() {
  const today = new Date().toISOString().slice(0, 10);
  if (state.dailyImageDate !== today) {
    state.dailyImageDate = today;
    state.dailyImageCount = 0;
    persist();
  }
}

function canGenerateImage() {
  resetImageDailyIfNewDay();
  return state.dailyImageCount < getImageDailyLimit();
}

function incrementImageDailyCount() {
  resetImageDailyIfNewDay();
  state.dailyImageCount += 1;
  persist();
}

function getRemainingImages() {
  resetImageDailyIfNewDay();
  const limit = getImageDailyLimit();
  if (!Number.isFinite(limit)) return "∞";
  return Math.max(0, limit - state.dailyImageCount);
}

function getSearchDailyLimit() {
  const tier = getUserTier();
  if (isUnlimitedTier(tier) || devAccessApproved) return Infinity;
  const baseLimit = CONFIG.SEARCH_DAILY_LIMITS[tier] ?? CONFIG.SEARCH_DAILY_LIMITS.free;
  return betaApproved ? Math.max(baseLimit, CONFIG.BETA_DAILY_LIMITS.searches) : baseLimit;
}

function resetSearchDailyIfNewDay() {
  const today = new Date().toISOString().slice(0, 10);
  if (state.dailySearchDate !== today) {
    state.dailySearchDate = today;
    state.dailySearchCount = 0;
    persist();
  }
}

function canSearch() {
  resetSearchDailyIfNewDay();
  return state.dailySearchCount < getSearchDailyLimit();
}

function incrementSearchDailyCount() {
  resetSearchDailyIfNewDay();
  state.dailySearchCount += 1;
  persist();
}

function getRemainingSearches() {
  resetSearchDailyIfNewDay();
  const limit = getSearchDailyLimit();
  if (!Number.isFinite(limit)) return "∞";
  return Math.max(0, limit - state.dailySearchCount);
}

function detectSearchIntent(text) {
  const lower = text.toLowerCase().trim();
  const patterns = [
    /^(?:search|look\s*up|find|google|web\s*search|search\s*for|look\s*for)\s+(.+)/i,
    /^(?:what(?:'s| is| are) the (?:latest|newest|most recent|current|top))\s+(.+)/i,
    /^(?:who (?:is|are|was|were))\s+(.+)/i,
    /^(?:when (?:did|was|is|will))\s+(.+)/i,
    /^(?:where (?:is|are|can|do|did))\s+(.+)/i,
    /^(?:how (?:to|do|did|can|is|are))\s+(.+)/i,
    /^(?:tell me about|give me (?:info|information|details) on|what do you know about)\s+(.+)/i,
    /^(?:news|update|current events|what(?:'s| is) happening)\s*(?:about|in|on|with)?\s*(.*)/i
  ];
  for (const pattern of patterns) {
    const match = lower.match(pattern);
    if (match) return match[1]?.trim() || text.trim();
  }
  return null;
}

function detectImageIntent(text) {
  const lower = text.toLowerCase().trim();
  const patterns = [
    /^(?:generate|create|make|draw|design|produce|build)\s+(?:an?\s+)?(?:image|picture|photo|illustration|artwork|drawing|pic)\s+(?:of|showing|with|featuring|depicting)?\s*(.+)/i,
    /^(?:image|picture|photo|illustration|artwork|drawing)\s+(?:of|showing|with|featuring|depicting)\s+(.+)/i,
    /^(?:can you|could you|please|would you)?\s*(?:generate|create|make|draw|design)\s+(?:an?\s+)?(?:image|picture|photo|illustration|artwork)\s+(?:of|showing|with|featuring|depicting)?\s*(.+)/i
  ];
  for (const pattern of patterns) {
    const match = lower.match(pattern);
    if (match) return match[1]?.trim() || text.trim();
  }
  return null;
}

function normalizeState() {
  state.loading = false;
  state.settings = { ...defaultState.settings, ...(state.settings || {}) };
  state.settings.chatFolders = Array.isArray(state.settings.chatFolders)
    ? state.settings.chatFolders
      .filter(folder => folder && typeof folder.name === "string")
      .map(folder => ({
        id: String(folder.id || createId("folder")),
        name: folder.name.trim().slice(0, 40) || "Folder",
        createdAt: Number(folder.createdAt || Date.now())
      }))
    : [];
  state.settings.activeFolderId = String(state.settings.activeFolderId || "all");
  if (
    !["all", "unfiled"].includes(state.settings.activeFolderId)
    && !state.settings.chatFolders.some(folder => folder.id === state.settings.activeFolderId)
  ) {
    state.settings.activeFolderId = "all";
  }
  state.model = MODEL_ALIASES[state.model] || state.model;
  if (!MODEL_NAMES[state.model]) state.model = defaultState.model;
  state.chats = (state.chats || []).map(chat => ({
    id: chat.id || createId("chat"),
    title: chat.title || "New chat",
    createdAt: chat.createdAt || Date.now(),
    updatedAt: chat.updatedAt || chat.createdAt || Date.now(),
    pinned: Boolean(chat.pinned),
    favorite: Boolean(chat.favorite),
    folderId: String(chat.folderId || ""),
    incognito: Boolean(chat.incognito),
    messages: Array.isArray(chat.messages)
      ? chat.messages.map(message => ({
        id: message.id || createId("message"),
        role: message.role === "user" ? "user" : "assistant",
        content: String(message.content || ""),
        timestamp: message.timestamp || Date.now(),
        model: message.model || (message.role === "assistant" ? state.model : undefined),
        status: message.status === "streaming" ? "stopped" : (message.status || "complete"),
        attachments: Array.isArray(message.attachments) ? message.attachments : [],
        generatedImage: message.generatedImage || "",
        imagePrompt: String(message.imagePrompt || "").slice(0, 4000),
        comparisonId: message.comparisonId || "",
        comparisonLabel: message.comparisonLabel || "",
        agentName: String(message.agentName || "").slice(0, 60)
      }))
      : []
  }));
  state.chats = dedupeChatsById(state.chats);
  incognitoMode = Boolean(getChat()?.incognito);

  if (!state.chats.length) {
    const chat = makeChat();
    state.chats = [chat];
    state.currentChatId = chat.id;
  }

  if (!state.chats.some(chat => chat.id === state.currentChatId)) {
    state.currentChatId = state.chats[0].id;
  }
}

function bindEvents() {
  DOM.composer.addEventListener("submit", handleComposerSubmit);
  DOM.toolsBtn.addEventListener("click", toggleToolsPopover);
  DOM.newChatBtn.addEventListener("click", createChat);
  DOM.loginBtn.addEventListener("click", handleAuth);
  DOM.searchBtn.addEventListener("click", toggleSearchMode);
  DOM.compareBtn.addEventListener("click", toggleCompareMode);
  DOM.compareCloseBtn.addEventListener("click", () => setCompareMode(false));
  DOM.compareModelSelect.addEventListener("change", validateCompareModel);
  DOM.imageGenerateBtn.addEventListener("click", generateImage);
  DOM.imageUploadBtn.addEventListener("click", () => DOM.imageInput.click());
  DOM.attachmentBtn.addEventListener("click", () => DOM.fileInput.click());
  DOM.voiceBtn.addEventListener("click", toggleVoiceInput);
  DOM.memoryBtn.addEventListener("click", openMemory);
  DOM.memoryContent.addEventListener("click", handleMemoryAction);
  DOM.plansBtn.addEventListener("click", openPlans);
  DOM.supportBtn.addEventListener("click", () => {
    const dialog = byId("supportDialog");
    if (dialog && !dialog.open) dialog.showModal();
  });
  DOM.settingsBtn.addEventListener("click", openSettings);
  DOM.themeBtn.addEventListener("click", cycleTheme);
  DOM.clearChatBtn.addEventListener("click", clearConversation);
  DOM.sidebarCollapseBtn.addEventListener("click", toggleSidebarCollapse);
  DOM.menuBtn.addEventListener("click", openMobileSidebar);
  DOM.sidebarCloseBtn.addEventListener("click", closeMobileSidebar);
  DOM.sidebarBackdrop.addEventListener("click", closeMobileSidebar);
  DOM.scrollBottomBtn.addEventListener("click", () => scrollBottom({ behavior: "smooth", force: true }));
  DOM.imageInput.addEventListener("change", event => addFiles(event.target.files));
  DOM.fileInput.addEventListener("change", event => addFiles(event.target.files));
  DOM.folderInput.addEventListener("change", event => addFolder(event.target.files));
  DOM.chatSearchInput.addEventListener("input", scheduleChatSearchRender);
  DOM.chatFolderFilter.addEventListener("change", event => {
    state.settings.activeFolderId = event.target.value;
    persist();
    renderChats();
  });
  DOM.newFolderBtn.addEventListener("click", createChatFolder);
  DOM.deleteFolderBtn.addEventListener("click", deleteSelectedChatFolder);
  DOM.incognitoBtn.addEventListener("click", toggleIncognitoMode);
  byId("popoverIncognito").addEventListener("click", () => {
    hideToolsPopover();
    toggleIncognitoMode();
  });
  DOM.memoryImportInput.addEventListener("change", importMemoryFile);
  DOM.voiceTranscript.addEventListener("input", () => {
    updateVoiceControls();
    DOM.voiceCaption.textContent = DOM.voiceTranscript.value.trim() || "Tap Start, then just talk.";
  });
  DOM.voiceOrb.addEventListener("click", toggleVoiceRecognition);
  DOM.voiceSelect.addEventListener("change", () => {
    state.settings.voiceURI = DOM.voiceSelect.value;
    persist();
  });
  DOM.voicePermissionBtn.addEventListener("click", requestVoiceMicrophonePermission);
  DOM.voiceStartBtn.addEventListener("click", toggleVoiceRecognition);
  DOM.voiceSendBtn.addEventListener("click", sendVoiceTranscript);
  DOM.voiceEndBtn.addEventListener("click", () => DOM.voiceDialog.close());
  DOM.voiceAutoSend.addEventListener("change", () => {
    if (!DOM.voiceAutoSend.checked && voiceConversationActive) endVoiceConversation();
    updateVoiceControls();
  });
  DOM.voiceDialog.addEventListener("close", () => endVoiceConversation({ updateStatus: false }));

  DOM.input.addEventListener("input", () => {
    scheduleTextareaResize();
    updateComposerState();
  });
  DOM.input.addEventListener("keydown", handleComposerKeydown);
  DOM.modelSelect.addEventListener("change", event => {
    const tier = getUserTier();
    if (!canUseModel(event.target.value, tier)) {
      event.target.value = state.model;
      toast("Free and Guest accounts use Ollama.", "error");
      return;
    }
    state.model = event.target.value;
    syncCompareModelPicker();
    persist();
  });

  DOM.chatViewport.addEventListener("scroll", handleChatScroll, { passive: true });
  DOM.chatViewport.addEventListener("wheel", handleChatWheel, { passive: true });
  DOM.chatViewport.addEventListener("touchstart", handleChatTouchStart, { passive: true });
  DOM.chatViewport.addEventListener("touchmove", handleChatTouchMove, { passive: true });
  DOM.chatViewport.addEventListener("touchend", clearChatTouch, { passive: true });
  DOM.chatViewport.addEventListener("touchcancel", clearChatTouch, { passive: true });
  DOM.chatArea.addEventListener("click", handleChatAction);
  DOM.chatList.addEventListener("click", handleChatListAction);
  DOM.attachmentTray.addEventListener("click", handleAttachmentAction);

  document.addEventListener("keydown", handleGlobalShortcut);
  document.addEventListener("click", addRipple, { capture: true });
  document.addEventListener("click", handleDocumentClick);
  document.querySelectorAll("[data-close-dialog]").forEach(button => {
    button.addEventListener("click", () => closeDialog(byId(button.dataset.closeDialog)));
  });

  byId("popoverImageUpload").addEventListener("click", () => {
    hideToolsPopover();
    DOM.imageInput.click();
  });
  byId("popoverFileUpload").addEventListener("click", () => {
    hideToolsPopover();
    DOM.fileInput.click();
  });
  byId("popoverFolderUpload").addEventListener("click", () => {
    hideToolsPopover();
    DOM.folderInput.click();
  });
  byId("popoverWebSearch").addEventListener("click", () => {
    hideToolsPopover();
    toggleSearchMode();
  });
  byId("generateImageBtn").addEventListener("click", () => {
    hideToolsPopover();
    generateImage();
  });
  if (supportsNativePopover()) {
    DOM.toolsPopover.addEventListener("toggle", updateToolsButtonState);
  }

  DOM.settingsDialog.addEventListener("close", saveSettingsFromDialog);
  byId("themeSelect").addEventListener("change", saveSettingsFromDialog);
  byId("timestampsToggle").addEventListener("change", saveSettingsFromDialog);
  byId("autoScrollToggle").addEventListener("change", saveSettingsFromDialog);
  byId("memoryToggle").addEventListener("change", saveSettingsFromDialog);
  byId("markdownToggle").addEventListener("change", saveSettingsFromDialog);
  byId("voiceOutputToggle").addEventListener("change", saveSettingsFromDialog);
  byId("speechRateInput").addEventListener("input", saveSettingsFromDialog);

  DOM.authForm.addEventListener("submit", submitAuth);
  DOM.authGoogleBtn.addEventListener("click", startGoogleRedirectSignIn);
  DOM.authDialog.addEventListener("close", resetClosedAuthDialog);
  DOM.signInTab.addEventListener("click", () => setAuthMode("signIn"));
  DOM.signUpTab.addEventListener("click", () => setAuthMode("signUp"));
  DOM.forgotPasswordBtn.addEventListener("click", requestPasswordReset);
  DOM.resendConfirmationBtn.addEventListener("click", () => resendConfirmationEmail());
  DOM.profileForm.addEventListener("submit", saveProfile);
  DOM.profileUploadBtn.addEventListener("click", () => DOM.profileImageInput.click());
  DOM.profileImageInput.addEventListener("change", handleProfileImageSelection);
  DOM.profileRemoveBtn.addEventListener("click", removeProfileImage);
  DOM.profileLogoutBtn.addEventListener("click", logoutFromProfile);
  DOM.profilePlansBtn.addEventListener("click", () => {
    closeDialog(DOM.profileDialog);
    openPlans();
  });
  DOM.profileBillingBtn.addEventListener("click", openPlans);
  DOM.profilePreferencesBtn.addEventListener("click", () => {
    closeDialog(DOM.profileDialog);
    openPreferenceSettings();
  });
  DOM.profilePasswordResetBtn.addEventListener("click", sendProfilePasswordReset);
  DOM.profileSyncBtn.addEventListener("click", syncAccountNow);
  DOM.profileDownloadBtn.addEventListener("click", downloadAccountData);
  DOM.manageBillingBtn.addEventListener("click", openPlans);
  DOM.plansDialog.addEventListener("click", event => {
    const button = event.target.closest("[data-subscribe-plan]");
    if (button) openPlans();
  });
  DOM.profileUsername.addEventListener("input", () => {
    renderProfileAvatar(DOM.profileUsername.value.trim() || getProfileName(state.user));
  });
  DOM.passwordResetForm.addEventListener("submit", submitPasswordReset);
  DOM.promptForm.addEventListener("submit", submitPromptDialog);
  DOM.promptCancelBtn.addEventListener("click", cancelPromptDialog);
  DOM.promptCancelX.addEventListener("click", cancelPromptDialog);
  DOM.promptDialog.addEventListener("cancel", event => {
    event.preventDefault();
    cancelPromptDialog();
  });
  DOM.confirmForm.addEventListener("submit", event => {
    event.preventDefault();
    finishConfirmation(true);
  });
  DOM.confirmCancelBtn.addEventListener("click", () => finishConfirmation(false));
  DOM.confirmCancelX.addEventListener("click", () => finishConfirmation(false));
  DOM.confirmDialog.addEventListener("cancel", event => {
    event.preventDefault();
    finishConfirmation(false);
  });

  window.addEventListener("online", handleNetworkReconnect);
  window.addEventListener("offline", updateNetworkStatus);
  window.addEventListener("focus", pollCloudChanges);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) pollCloudChanges();
  });
  window.addEventListener("resize", updateViewportHeight, { passive: true });
  window.visualViewport?.addEventListener("resize", updateViewportHeight, { passive: true });
  const themeQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const handleSystemThemeChange = () => {
    if (state.settings.theme === "system") applyTheme();
  };
  if (typeof themeQuery.addEventListener === "function") {
    themeQuery.addEventListener("change", handleSystemThemeChange);
  } else {
    themeQuery.addListener?.(handleSystemThemeChange);
  }

  DOM.main.addEventListener("dragenter", handleDragEnter);
  DOM.main.addEventListener("dragover", handleDragOver);
  DOM.main.addEventListener("dragleave", handleDragLeave);
  DOM.main.addEventListener("drop", handleDrop);
  DOM.input.addEventListener("paste", handlePaste);
}

function makeChat({ incognito = false, folderId = "" } = {}) {
  return {
    id: createId("chat"),
    title: incognito ? "Incognito chat" : "New chat",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    pinned: false,
    favorite: false,
    folderId,
    incognito,
    messages: []
  };
}

function dedupeChatsById(chats) {
  const seen = new Set();
  return (Array.isArray(chats) ? chats : []).filter(chat => {
    if (!chat?.id || seen.has(chat.id)) return false;
    seen.add(chat.id);
    return true;
  });
}

function getChat() {
  return state.chats.find(chat => chat.id === state.currentChatId);
}

function createChat() {
  if (state.loading) stopGeneration();
  const activeChat = getChat();
  if (activeChat?.messages.length === 0 && Boolean(activeChat.incognito) === incognitoMode) {
    DOM.input.focus();
    closeMobileSidebar();
    return;
  }

  const activeFolder = state.settings.activeFolderId;
  const folderId = ["all", "unfiled"].includes(activeFolder) ? "" : activeFolder;
  const chat = makeChat({ incognito: incognitoMode, folderId });
  state.chats.unshift(chat);
  state.currentChatId = chat.id;
  state.pendingAttachments = [];
  searchMode = false;
  DOM.input.value = "";
  visibleChatCount = CONFIG.INITIAL_CHAT_BATCH;
  persistChatChange();
  renderChats();
  renderMessages();
  renderAttachmentTray();
  updateIncognitoUi();
  updateComposerState();
  closeMobileSidebar();
  DOM.input.focus();
  announce("New chat created");
}

async function sendMessage(options = {}) {
  if (state.loading) return;

  const attachments = options.attachments ?? state.pendingAttachments;
  const enteredText = (options.text ?? DOM.input.value).trim();
  const text = enteredText || createAttachmentPrompt(attachments);
  if (!text || attachments.some(attachment => attachment.status !== "ready")) return;
  const chat = getChat();
  if (!chat) return;

  if ((!options.hiddenUser || options.countsTowardLimit) && !canSendMessage()) {
    toast("You've reached your daily message limit. Upgrade or come back tomorrow.", "error");
    return;
  }

  if (searchMode && !options.bypassSearch && !attachments.length) {
    return sendSearchMessage(text);
  }

  if (!canUseModel(state.model)) {
    state.model = defaultState.model;
    DOM.modelSelect.value = state.model;
  }

  const requestModel = canUseModel(options.model || state.model)
    ? (options.model || state.model)
    : defaultState.model;
  const searchQuery = !options.hiddenUser && !options.bypassSearch ? detectSearchIntent(text) : null;
  const imagePrompt = !options.hiddenUser && !options.bypassSearch ? detectImageIntent(text) : null;

  let userMessage = options.userMessage;

  if (!options.hiddenUser && !userMessage) {
    userMessage = {
      id: createId("message"),
      role: "user",
      content: text,
      timestamp: Date.now(),
      status: "complete",
      attachments: attachments.map(stripAttachmentForMessage)
    };
    chat.messages.push(userMessage);
  }

  if (!options.hiddenUser) {
    DOM.input.value = "";
    state.pendingAttachments = [];
    renderAttachmentTray();
    resizeTextarea();
  }

  if ((chat.title === "New chat" || chat.title === "Incognito chat") && !options.hiddenUser) {
    chat.title = createChatTitle(text);
  }

  chat.updatedAt = Date.now();
  state.loading = true;
  abortController = new AbortController();
  updateComposerState();
  renderChats();
  checkpointMessages({ immediate: true });

  if (searchQuery) {
    if (!canSearch()) {
      toast("You've reached your daily web search limit. Upgrade or come back tomorrow.", "error");
      state.loading = false;
      abortController = null;
      updateComposerState();
      renderMessages();
      return;
    }

    const searchIndicator = {
      id: createId("message"),
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      model: "Web search",
      status: "streaming",
      attachments: []
    };
    chat.messages.push(searchIndicator);
    checkpointMessages({ immediate: true });
    renderMessages({ focusMessageId: searchIndicator.id });
    announce("Searching the web");

    try {
      const response = await fetch(CONFIG.SEARCH_API, {
        method: "POST",
        headers: await getChatRequestHeaders(),
        signal: abortController.signal,
        body: JSON.stringify({ query: searchQuery })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Search failed.");
      searchIndicator.content = data.answer || "No results found.";
      searchIndicator.searchResults = data.results || [];
      searchIndicator.status = "complete";
      incrementSearchDailyCount();
      if (!options.hiddenUser) incrementDailyCount();
    } catch (error) {
      searchIndicator.status = error.name === "AbortError" ? "stopped" : "error";
      if (searchIndicator.status === "error") {
        searchIndicator.error = error.message || "Search failed.";
      }
    }

    state.loading = false;
    abortController = null;
    chat.updatedAt = Date.now();
    persist();
    updateStats();
    updateComposerState();
    renderMessages();
    return;
  }

  if (imagePrompt) {
    if (!canGenerateImage()) {
      toast("You've reached your daily image limit. Upgrade or come back tomorrow.", "error");
      state.loading = false;
      abortController = null;
      updateComposerState();
      renderMessages();
      return;
    }

    const imageIndicator = {
      id: createId("message"),
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      model: "gpt-image-1-mini",
      status: "streaming",
      imagePrompt,
      attachments: []
    };
    chat.messages.push(imageIndicator);
    checkpointMessages({ immediate: true });
    renderMessages({ focusMessageId: imageIndicator.id });
    announce("Generating image");

    try {
      const imageResponse = await fetch(CONFIG.IMAGE_API, {
        method: "POST",
        headers: await getChatRequestHeaders(),
        signal: abortController.signal,
        body: JSON.stringify({ prompt: imagePrompt })
      });
      const imageData = await imageResponse.json();
      if (!imageResponse.ok) throw new Error(imageData?.error || "Image generation failed.");

      const image = imageData?.image;
      const url = getGeneratedImageSource(image);
      if (!url) throw new Error("Image generation returned no image.");

      imageIndicator.generatedImage = url;
      imageIndicator.model = getImageResponseModel(imageData);
      imageIndicator.content = getImageResponseText(imageData);
      imageIndicator.imagePrompt = "";
      imageIndicator.status = "complete";
      persistChatChange();
      incrementImageDailyCount();
    } catch (error) {
      imageIndicator.status = error.name === "AbortError" ? "stopped" : "error";
      imageIndicator.error = error.message || "Image generation failed.";
      imageIndicator.content = "";
      imageIndicator.imagePrompt = "";
    }

    state.loading = false;
    abortController = null;
    chat.updatedAt = Date.now();
    persist();
    updateStats();
    updateComposerState();
    renderMessages();
    return;
  }

  const assistantMessage = options.targetMessage || {
    id: createId("message"),
    role: "assistant",
    content: "",
    timestamp: Date.now(),
    model: requestModel,
    status: "streaming",
    attachments: [],
    comparisonId: options.comparisonId || "",
    comparisonLabel: options.comparisonLabel || ""
  };

  if (!options.targetMessage) chat.messages.push(assistantMessage);
  else {
    assistantMessage.status = "streaming";
    assistantMessage.model = requestModel;
  }

  checkpointMessages({ immediate: true });
  renderMessages({ focusMessageId: assistantMessage.id });
  announce(`Generating with ${MODEL_NAMES[requestModel] || requestModel}`);

  try {
    const history = options.historyOverride
      || createHistory(chat, assistantMessage.id, Boolean(options.targetMessage));
    const activeAgent = globalThis.TalkatonProductivity?.getActiveAgent?.() || null;
    if (activeAgent?.name) assistantMessage.agentName = String(activeAgent.name).slice(0, 60);
    const requestHeaders = await getChatRequestHeaders();
    const response = await fetch(CONFIG.CHAT_API, {
      method: "POST",
      headers: requestHeaders,
      signal: abortController.signal,
      body: JSON.stringify({
        message: text,
        model: requestModel,
        plan: getRequestPlan(),
        timeZone: getClientTimeZone(),
        history,
        memory: state.settings.memory ? state.memory.slice(-8) : [],
        agent: activeAgent,
        attachments: attachments.map(attachment => ({
          name: attachment.name,
          type: attachment.type,
          kind: attachment.kind,
          dataUrl: attachment.dataUrl,
          extractedText: attachment.extractedText
        }))
      })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data?.error || `Chat failed (${response.status}).`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/event-stream") || !response.body) {
      const data = await response.json().catch(() => ({}));
      assistantMessage.content += data.reply || "";
    } else {
      await consumeEventStream(response.body, assistantMessage);
    }

    assistantMessage.status = assistantMessage.content ? "complete" : "error";
    if (!assistantMessage.content) assistantMessage.error = "The model returned an empty response.";

    if (!options.hiddenUser || options.countsTowardLimit) {
      rememberExchange(text, assistantMessage.content);
      incrementDailyCount();
    }
    announce("Response complete");
  } catch (error) {
    if (error.name === "AbortError") {
      assistantMessage.status = "stopped";
      announce("Generation stopped");
    } else {
      assistantMessage.status = "error";
      assistantMessage.error = error.message || "The response failed.";
      toast(assistantMessage.error, "error");
      announce("The response failed");
    }
  } finally {
    cancelStreamingRender();
    state.loading = false;
    abortController = null;
    chat.updatedAt = Date.now();
    persist();
    updateStats();
    updateComposerState();
    renderMessages({ focusMessageId: assistantMessage.id, preserveScroll: userPausedScroll });
  }
}

async function consumeEventStream(body, assistantMessage) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() || "";

    for (const event of events) {
      consumeChatSseEvent(event, assistantMessage);
    }
  }

  if (buffer.trim()) consumeChatSseEvent(buffer, assistantMessage, true);
}

function consumeChatSseEvent(event, assistantMessage, immediate = false) {
  const data = event.split(/\r?\n/)
    .filter(line => line.startsWith("data:"))
    .map(line => line.slice(5).trimStart())
    .join("\n")
    .trim();
  if (!data || data === "[DONE]") return;
  let payload;
  try {
    payload = JSON.parse(data);
  } catch {
    return;
  }
  if (payload.error) throw new Error(payload.error.message || payload.message || "The model stream failed.");
  const token = extractChatStreamText(payload);
  if (!token) return;
  assistantMessage.content += token;
  assistantMessage.model = payload.model || assistantMessage.model;
  checkpointMessages(immediate ? { immediate: true } : undefined);
  if (!immediate) scheduleStreamingRender(assistantMessage);
}

function extractChatStreamText(payload) {
  const content = payload?.choices?.[0]?.delta?.content
    ?? payload?.choices?.[0]?.message?.content
    ?? payload?.output_text
    ?? payload?.response?.output_text;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map(part => {
    if (typeof part === "string") return part;
    if (!part || typeof part !== "object") return "";
    return ["text", "output_text"].includes(part.type) && typeof part.text === "string" ? part.text : "";
  }).join("");
}

function stopGeneration() {
  abortController?.abort();
}

function scheduleStreamingRender(message) {
  if (renderFrame || renderTimer) return;
  const elapsed = performance.now() - lastStreamingPaint;
  const interval = message.content.length > 12_000
    ? 220
    : message.content.length > 4_000
      ? 140
      : STREAM_PAINT_INTERVAL;
  const delay = Math.max(0, interval - elapsed);

  renderTimer = setTimeout(() => {
    renderTimer = null;
    renderFrame = requestAnimationFrame(async () => {
      renderFrame = null;
      lastStreamingPaint = performance.now();
      const article = DOM.chatArea.querySelector(`[data-message-id="${CSS.escape(message.id)}"]`);
      const body = article?.querySelector(".messageContent");
      if (!body) return;
      await renderMessageBody(body, message.content, true);
      if (state.settings.autoScroll && !userPausedScroll) scrollBottom({ force: false });
    });
  }, delay);
}

function cancelStreamingRender() {
  if (renderTimer) clearTimeout(renderTimer);
  if (renderFrame) cancelAnimationFrame(renderFrame);
  renderTimer = null;
  renderFrame = null;
}

function createHistory(chat, assistantMessageId, includeTargetAssistant = false) {
  const endIndex = chat.messages.findIndex(message => message.id === assistantMessageId);
  const messages = endIndex >= 0
    ? chat.messages.slice(0, endIndex + (includeTargetAssistant ? 1 : 0))
    : chat.messages;
  const history = includeTargetAssistant ? messages : messages.slice(0, -1);
  return history
    .filter(message => ["user", "assistant"].includes(message.role) && message.content)
    .slice(-18)
    .map(({ role, content }) => ({ role, content }));
}

async function sendSearchMessage(text) {
  const chat = getChat();
  if (!chat) return;

  if (!canSendMessage()) {
    toast("You've reached your daily message limit. Upgrade or come back tomorrow.", "error");
    return;
  }

  if (!canSearch()) {
    toast("You've reached your daily web search limit. Upgrade or come back tomorrow.", "error");
    return;
  }

  const userMessage = {
    id: createId("message"),
    role: "user",
    content: text,
    timestamp: Date.now(),
    status: "complete",
    attachments: []
  };
  const assistantMessage = {
    id: createId("message"),
    role: "assistant",
    content: "",
    timestamp: Date.now(),
    model: "Web search",
    status: "streaming",
    attachments: []
  };
  chat.messages.push(userMessage, assistantMessage);
  if (chat.title === "New chat" || chat.title === "Incognito chat") chat.title = createChatTitle(text);
  DOM.input.value = "";
  searchMode = false;
  state.loading = true;
  abortController = new AbortController();
  updateSearchMode();
  updateComposerState();
  renderChats();
  renderMessages();

  try {
    const response = await fetch(CONFIG.SEARCH_API, {
      method: "POST",
      headers: await getChatRequestHeaders(),
      signal: abortController.signal,
      body: JSON.stringify({ query: text })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || "Search failed.");
    assistantMessage.content = data.answer || "No results found.";
    assistantMessage.searchResults = data.results || [];
    assistantMessage.status = "complete";
    incrementDailyCount();
    incrementSearchDailyCount();
  } catch (error) {
    assistantMessage.status = error.name === "AbortError" ? "stopped" : "error";
    if (assistantMessage.status === "error") {
      assistantMessage.error = error.message || "Search failed.";
    }
  } finally {
    state.loading = false;
    abortController = null;
    chat.updatedAt = Date.now();
    persist();
    updateStats();
    updateComposerState();
    renderMessages();
  }
}

function getGeneratedImageSource(image) {
  if (image?.url) return image.url;
  if (!image?.b64_json) return "";

  const format = String(image.output_format || image.mime_type || "webp")
    .toLowerCase()
    .replace(/^image\//, "");
  const mimeType = format === "jpg" || format === "jpeg"
    ? "image/jpeg"
    : format === "png"
      ? "image/png"
      : "image/webp";
  return `data:${mimeType};base64,${image.b64_json}`;
}

function getImageResponseText(data) {
  const text = String(data?.commentary || "").trim();
  return text || "Your image is ready.";
}

function getImageResponseModel(data) {
  const imageModel = String(data?.model || "gpt-image-1-mini");
  return data?.commentary_provider === "openrouter"
    ? `${imageModel} + OpenRouter`
    : imageModel;
}

function getGeneratedImageExtension(source) {
  const dataType = String(source || "").match(/^data:image\/(png|jpe?g|webp)/i)?.[1]?.toLowerCase();
  if (dataType) return dataType === "jpeg" ? "jpg" : dataType;

  try {
    const extension = new URL(source).pathname.match(/\.(png|jpe?g|webp)$/i)?.[1]?.toLowerCase();
    if (extension) return extension === "jpeg" ? "jpg" : extension;
  } catch {}

  return "webp";
}

async function generateImage() {
  if (state.loading) return;

  if (!canGenerateImage()) {
    toast("You've reached your daily image limit. Upgrade or come back tomorrow.", "error");
    return;
  }

  const prompt = await askForText({
    eyebrow: "Image studio",
    title: "Create an image",
    label: "Show the prompt you want",
    submitLabel: "Generate",
    placeholder: "A cinematic robot exploring a quiet library..."
  });

  if (!prompt) return;

  const chat = getChat();
  if (!chat) return;

  chat.messages.push({
    id: createId("message"),
    role: "user",
    content: `Create an image: ${prompt}`,
    timestamp: Date.now(),
    status: "complete",
    attachments: []
  });

  const assistant = {
    id: createId("message"),
    role: "assistant",
    content: "",
    timestamp: Date.now(),
    model: "gpt-image-1-mini",
    status: "streaming",
    imagePrompt: prompt,
    attachments: []
  };

  chat.messages.push(assistant);
  state.loading = true;
  abortController = new AbortController();
  updateComposerState();
  renderMessages({ focusMessageId: assistant.id });

  try {
    const response = await fetch(CONFIG.IMAGE_API, {
      method: "POST",
      headers: await getChatRequestHeaders(),
      signal: abortController.signal,
      body: JSON.stringify({ prompt })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || "Image generation failed.");

    const image = data?.image;
    assistant.generatedImage = getGeneratedImageSource(image);

    if (!assistant.generatedImage) throw new Error("Image generation returned no image.");

    assistant.model = getImageResponseModel(data);
    assistant.content = getImageResponseText(data);
    assistant.imagePrompt = "";
    assistant.status = "complete";
    persistChatChange();
    incrementImageDailyCount();
  } catch (error) {
    assistant.status = error.name === "AbortError" ? "stopped" : "error";
    assistant.error = error.message || "Image generation failed.";
    assistant.content = "";
    assistant.imagePrompt = "";
  } finally {
    state.loading = false;
    abortController = null;
    chat.updatedAt = Date.now();
    persist();
    updateComposerState();
    renderMessages();
  }
}

function renderMessages(options = {}) {
  const chat = getChat();
  updateIncognitoUi();
  const previousScrollTop = DOM.chatViewport.scrollTop;
  const sameChat = DOM.chatArea.dataset.chatId === chat?.id;
  const isEmpty = !chat?.messages.length;
  DOM.app.classList.toggle("isEmpty", isEmpty);
  document.body.classList.toggle("landingMode", isEmpty);
  DOM.conversationTitle.textContent = chat?.title || "New chat";

  if (isEmpty) {
    if (!sameChat || !DOM.chatArea.querySelector(".emptyState")) {
      DOM.chatArea.replaceChildren(createEmptyState());
    }
    DOM.chatArea.dataset.chatId = chat?.id || "";
    DOM.clearChatBtn.disabled = true;
    return;
  }

  DOM.clearChatBtn.disabled = false;
  DOM.chatArea.querySelector(".emptyState")?.remove();
  if (!sameChat) DOM.chatArea.replaceChildren();
  DOM.chatArea.dataset.chatId = chat.id;

  const existing = new Map(
    [...DOM.chatArea.children]
      .filter(node => node.matches?.("[data-message-id]"))
      .map(node => [node.dataset.messageId, node])
  );
  const activeIds = new Set();
  const renderQueue = [];
  let didChange = !sameChat;

  chat.messages.forEach((message, index) => {
    activeIds.add(message.id);
    let article = existing.get(message.id);

    if (!article || messageElementNeedsUpdate(article, message)) {
      const replacement = createMessageElement(message, index, {
        animate: Boolean(sameChat && !article)
      });
      if (article) article.replaceWith(replacement);
      article = replacement;
      didChange = true;
      renderQueue.push({ article, message });
    }

    const currentAtIndex = DOM.chatArea.children[index];
    if (currentAtIndex !== article) {
      DOM.chatArea.insertBefore(article, currentAtIndex || null);
    }
  });

  existing.forEach((article, id) => {
    if (!activeIds.has(id)) {
      article.remove();
      didChange = true;
    }
  });

  renderQueue.forEach(({ article, message }) => {
    const body = article.querySelector(".messageContent");
    if (body && message.content) {
      renderMessageBody(body, message.content, message.status === "streaming");
    }
  });

  if (options.preserveScroll) {
    requestAnimationFrame(() => DOM.chatViewport.scrollTo({ top: previousScrollTop, behavior: "instant" }));
  } else if (options.focusMessageId) {
    requestAnimationFrame(() => scrollBottom({ force: true, behavior: "instant" }));
  } else if (!sameChat) {
    requestAnimationFrame(() => scrollBottom({ force: true, behavior: "instant" }));
  } else if (didChange && state.settings.autoScroll && !userPausedScroll) {
    requestAnimationFrame(() => scrollBottom({ force: false, behavior: "instant" }));
  }
}

function messageElementNeedsUpdate(article, message) {
  const previous = article._talkatonRenderState;
  if (!previous) return true;
  return previous.content !== message.content
    || previous.status !== message.status
    || previous.timestamp !== message.timestamp
    || previous.model !== message.model
    || previous.error !== message.error
    || previous.generatedImage !== message.generatedImage
    || previous.imagePrompt !== message.imagePrompt
    || previous.comparisonId !== message.comparisonId
    || previous.comparisonLabel !== message.comparisonLabel
    || previous.agentName !== message.agentName
    || previous.searchResults !== message.searchResults
    || previous.attachments !== message.attachments
    || previous.timestampsEnabled !== state.settings.timestamps
    || previous.markdownEnabled !== state.settings.markdown;
}

function captureMessageRenderState(message) {
  return {
    content: message.content,
    status: message.status,
    timestamp: message.timestamp,
    model: message.model,
    error: message.error,
    generatedImage: message.generatedImage,
    imagePrompt: message.imagePrompt,
    comparisonId: message.comparisonId,
    comparisonLabel: message.comparisonLabel,
    agentName: message.agentName,
    searchResults: message.searchResults,
    attachments: message.attachments,
    timestampsEnabled: state.settings.timestamps,
    markdownEnabled: state.settings.markdown
  };
}

function createEmptyState() {
  const wrapper = element("div", "emptyState");
  wrapper.setAttribute("aria-labelledby", "landingTitle");
  wrapper.innerHTML = `
    <div class="emptyBrand" aria-hidden="true">T</div>
    <h1 id="landingTitle">Talkaton</h1>
    <p class="heroTagline">Smart. Funny. <span>Slightly unhinged.</span></p>
    <p class="heroQuestion">What are we building today?</p>
    <div class="suggestionGrid">
      <button type="button" data-suggestion="Help me plan a focused week with realistic priorities" aria-label="Start with: Plan my week"><strong>Plan my week</strong><span>Turn a messy list into a clear plan</span></button>
      <button type="button" data-suggestion="Explain a difficult concept to me using a simple analogy" aria-label="Start with: Make it click"><strong>Make it click</strong><span>Explain something without the jargon</span></button>
      <button type="button" data-suggestion="Review this idea and challenge my assumptions" aria-label="Start with: Pressure-test an idea"><strong>Pressure-test an idea</strong><span>Find the gaps before they find you</span></button>
      <button type="button" data-suggestion="Help me write something concise, clear, and human" aria-label="Start with: Write with me"><strong>Write with me</strong><span>Polish a draft or start from scratch</span></button>
    </div>`;
  return wrapper;
}

function createMessageElement(message, index, { animate = true } = {}) {
  const isUser = message.role === "user";
  const article = element("article", `message ${isUser ? "userMessage" : "assistantMessage"}${animate ? " messageEnter" : ""}`);
  article.dataset.messageId = message.id;
  article.dataset.status = message.status || "complete";
  article._talkatonRenderState = captureMessageRenderState(message);

  const inner = element("div", "messageInner");
  const header = element("header", "messageHeader");
  const identity = element("div", "messageIdentity");
  const avatar = element("span", `messageAvatar ${isUser ? "userAvatar" : "assistantAvatar"}`);
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = isUser ? "Y" : "T";
  const identityName = document.createElement("strong");
  identityName.textContent = isUser ? "You" : message.agentName || "Talkaton";
  identity.append(avatar, identityName);
  header.append(identity);

  if (!isUser && message.comparisonLabel) {
    const comparisonBadge = element("span", "comparisonBadge");
    comparisonBadge.textContent = message.comparisonLabel;
    identity.append(comparisonBadge);
  }

  if (state.settings.timestamps) {
    const time = element("time", "messageTime");
    time.dateTime = new Date(message.timestamp).toISOString();
    time.textContent = formatTime(message.timestamp);
    header.append(time);
  }

  const body = element("div", "messageContent");

  if (message.status === "streaming" && message.imagePrompt) {
    body.append(createImageGenerationProgress(message.imagePrompt));
  } else if (message.status === "streaming" && !message.content) {
    body.append(createTypingIndicator());
  } else if (message.content) {
    body.textContent = message.content;
  }

  if (message.attachments?.length) {
    inner.append(header, createMessageAttachments(message.attachments), body);
  } else {
    inner.append(header, body);
  }

  if (message.generatedImage) {
    const figure = element("figure", "generatedImage");
    const image = new Image();
    image.src = message.generatedImage;
    image.alt = message.content || "AI-generated image";
    image.loading = "lazy";
    image.decoding = "async";
    const caption = element("figcaption", "generatedImageActions");
    const download = element("button", "generatedImageDownload");
    download.type = "button";
    const extension = getGeneratedImageExtension(message.generatedImage);
    const fileName = `${slugify(getChat()?.title || "talkaton-image")}-${String(message.id).slice(-8)}.${extension}`;
    download.textContent = "Download image ↓";
    download.setAttribute("aria-label", "Download this generated image");
    download.addEventListener("click", async () => {
      download.disabled = true;
      download.textContent = "Downloading…";
      try {
        await downloadResource(message.generatedImage, fileName);
        download.textContent = "Downloaded ✓";
      } catch (error) {
        download.textContent = "Try again";
        toast(error?.message || "The image could not be downloaded.", "error");
      } finally {
        setTimeout(() => {
          download.disabled = false;
          download.textContent = "Download image ↓";
        }, 1600);
      }
    });
    caption.append(download);
    figure.append(image, caption);
    inner.append(figure);
  }

  if (message.searchResults?.length) {
    const list = element("div", "searchResults");
    message.searchResults.forEach(r => {
      const card = element("a", "searchResultCard");
      card.href = r.url;
      card.target = "_blank";
      card.rel = "noopener noreferrer";
      let domain = "";
      try { domain = new URL(r.url).hostname; } catch {}
      card.innerHTML = `<span class="searchResultUrl">${escapeHtml(domain)}</span><strong class="searchResultTitle">${escapeHtml(r.title)}</strong><span class="searchResultSnippet">${escapeHtml(r.content)}</span>`;
      list.append(card);
    });
    inner.append(list);
  }

  if (message.status === "error") inner.append(createErrorState(message));
  if (message.status === "stopped") {
    const stopped = element("p", "stoppedNote");
    stopped.textContent = "Generation stopped";
    inner.append(stopped);
  }

  inner.append(createMessageFooter(message, index));
  article.append(inner);
  return article;
}

function createMessageFooter(message, index) {
  const footer = element("footer", "messageFooter");
  const metrics = element("span", "messageMetrics");
  if (message.role === "assistant" && message.content) metrics.textContent = getReadingMetrics(message.content);
  footer.append(metrics);

  const actions = element("div", "messageActions");
  if (message.role === "assistant") {
    actions.append(
      actionButton("Copy", "copy"),
      actionButton("Read", "speak"),
      actionButton("Download", "download")
    );
    if (message.status === "complete") {
      actions.append(actionButton("Regenerate", "regenerate"), actionButton("Continue", "continue"));
      if (getUserTier() !== "guest" && MODEL_NAMES[message.model]) {
        actions.append(actionButton("Compare model", "compare"));
      }
    }
    if (message.status === "stopped") actions.append(actionButton("Continue", "continue"));
    const model = element("span", "modelName");
    model.textContent = MODEL_NAMES[message.model] || message.model || "Talkaton";
    model.title = "Model used for this response";
    actions.append(model);
  } else {
    actions.append(actionButton("Copy", "copy"), actionButton("Edit", "edit"));
  }
  footer.append(actions);
  return footer;
}

function actionButton(label, action) {
  const button = element("button", "messageAction");
  button.type = "button";
  button.dataset.messageAction = action;
  button.textContent = label;
  return button;
}

function createTypingIndicator() {
  const indicator = element("div", "typingIndicator");
  indicator.setAttribute("role", "status");
  indicator.setAttribute("aria-label", "Talkaton is thinking");
  indicator.innerHTML = "<span></span><span></span><span></span>";
  return indicator;
}

function createImageGenerationProgress(prompt) {
  const progress = element("div", "imageGenerationProgress");
  progress.setAttribute("role", "status");
  progress.setAttribute("aria-live", "polite");
  progress.setAttribute("aria-label", "Talkaton is creating your image");

  const preview = element("div", "imageGenerationPreview");
  preview.setAttribute("aria-hidden", "true");
  preview.innerHTML = "<span></span><span></span><span></span>";

  const details = element("div", "imageGenerationDetails");
  const eyebrow = element("span", "imageGenerationEyebrow");
  eyebrow.textContent = "Image Studio";
  const title = document.createElement("strong");
  title.textContent = "Creating your image";
  const description = document.createElement("p");
  description.textContent = "Composing the scene, rendering details, and preparing the final image.";
  const promptPreview = element("span", "imageGenerationPrompt");
  promptPreview.textContent = String(prompt || "").slice(0, 180);
  details.append(eyebrow, title, description, promptPreview);
  progress.append(preview, details);
  return progress;
}

function createErrorState(message) {
  const error = element("div", "messageError");
  error.setAttribute("role", "alert");
  error.innerHTML = `<div><strong>That response hit a snag.</strong><span>${escapeHtml(message.error || "Please try again.")}</span></div><button type="button" data-message-action="retry">Retry</button>`;
  return error;
}

function createMessageAttachments(attachments) {
  const grid = element("div", "messageAttachments");
  attachments.forEach(attachment => {
    if (attachment.kind === "image" && (attachment.previewUrl || attachment.dataUrl)) {
      const image = new Image();
      image.src = attachment.previewUrl || attachment.dataUrl;
      image.alt = attachment.name;
      image.loading = "lazy";
      image.decoding = "async";
      grid.append(image);
    } else {
      const chip = element("div", "messageFile");
      const meta = getAttachmentMeta(attachment);
      chip.innerHTML = `<span>${attachmentGlyph(attachment)}</span><div><strong>${escapeHtml(attachment.name)}</strong><small>${meta}</small></div>`;
      grid.append(chip);
    }
  });
  return grid;
}

async function renderMessageBody(container, content, streaming = false) {
  if (!content) return;
  if (!state.settings.markdown) {
    container.textContent = content;
    return;
  }

  try {
    const markdown = await loadMarkdown();
    markdown.renderRichMarkdown(container, content, { streaming });
  } catch {
    container.textContent = content;
  }
}

function loadMarkdown() {
  if (!markdownModulePromise) markdownModulePromise = import("../modules/markdown.js?v=20260729-collaboration1");
  return markdownModulePromise;
}

async function handleChatAction(event) {
  const suggestion = event.target.closest("[data-suggestion]");
  if (suggestion) {
    DOM.input.value = suggestion.dataset.suggestion;
    resizeTextarea();
    updateComposerState();
    DOM.input.focus();
    return;
  }

  if (event.target.closest(".emptyState") && !event.target.closest("button, a")) {
    DOM.input.focus({ preventScroll: true });
    return;
  }

  const codeButton = event.target.closest("[data-copy-code]");
  if (codeButton) {
    const code = codeButton.closest(".codeBlock")?.querySelector("code")?.textContent || "";
    try {
      await copyText(code);
      codeButton.textContent = "Copied";
      codeButton.dataset.copied = "true";
      announce("Code copied to clipboard");
      setTimeout(() => {
        codeButton.textContent = "Copy";
        delete codeButton.dataset.copied;
      }, 1400);
    } catch {
      toast("Couldn’t copy the code. Please select it manually.", "error");
    }
    return;
  }

  const button = event.target.closest("[data-message-action]");
  if (!button) return;
  const article = button.closest("[data-message-id]");
  const chat = getChat();
  const message = chat?.messages.find(item => item.id === article?.dataset.messageId);
  if (!message) return;

  switch (button.dataset.messageAction) {
    case "copy":
      await copyText(message.content);
      toast("Copied to clipboard");
      break;
    case "download":
      downloadMessage(message);
      break;
    case "speak":
      toggleSpeech(message, button);
      break;
    case "edit":
      editUserMessage(message, article);
      break;
    case "regenerate":
    case "retry":
      regenerateMessage(message);
      break;
    case "continue":
      continueMessage(message);
      break;
    case "compare":
      compareMessageWithAnotherModel(message);
      break;
  }
}

function regenerateMessage(message) {
  if (state.loading) return;
  const chat = getChat();
  const assistantIndex = chat.messages.findIndex(item => item.id === message.id);
  let userIndex = assistantIndex - 1;
  while (userIndex >= 0 && chat.messages[userIndex].role !== "user") userIndex -= 1;
  if (userIndex < 0) return;
  const userMessage = chat.messages[userIndex];

  if (message.model === "Web search") {
    chat.messages.splice(userIndex);
    searchMode = true;
    return sendSearchMessage(userMessage.content);
  }

  chat.messages.splice(userIndex + 1);
  persist();
  sendMessage({
    text: userMessage.content,
    attachments: userMessage.attachments || [],
    userMessage,
    hiddenUser: true
  });
}

function continueMessage(message) {
  if (state.loading) return;
  const chat = getChat();
  const index = chat.messages.findIndex(item => item.id === message.id);
  if (index < 0) return;
  chat.messages.splice(index + 1);
  sendMessage({
    text: "Continue exactly where the previous response stopped. Do not repeat completed content.",
    hiddenUser: true,
    targetMessage: message
  });
}

function compareMessageWithAnotherModel(message) {
  if (state.loading) return;
  if (getUserTier() === "guest") {
    toast("Log in to compare models.", "error");
    handleAuth();
    return;
  }
  const chat = getChat();
  const assistantIndex = chat?.messages.findIndex(item => item.id === message.id) ?? -1;
  let userIndex = assistantIndex - 1;
  while (userIndex >= 0 && chat.messages[userIndex].role !== "user") userIndex -= 1;
  if (userIndex < 0) return;

  const availableModels = getAvailableModels();
  if (availableModels.length < 2) {
    toast("A second model is not available for this account.", "error");
    return;
  }
  const currentIndex = availableModels.indexOf(message.model);
  const alternateModel = availableModels[(currentIndex + 1 + availableModels.length) % availableModels.length];
  const userMessage = chat.messages[userIndex];
  const comparisonId = message.comparisonId || createId("comparison");
  message.comparisonId = comparisonId;
  message.comparisonLabel = `Original · ${MODEL_NAMES[message.model] || message.model}`;
  persistChatChange();
  renderMessages({ preserveScroll: true });
  toast(`Comparing with ${MODEL_NAMES[alternateModel]}.`);
  sendMessage({
    text: `Give an independent second answer to this original request. Do not copy the earlier answer. Point out any important difference in your conclusion.\n\nOriginal request: ${userMessage.content}`,
    attachments: userMessage.attachments || [],
    hiddenUser: true,
    bypassSearch: true,
    countsTowardLimit: true,
    model: alternateModel,
    comparisonId,
    comparisonLabel: `Comparison · ${MODEL_NAMES[alternateModel]}`
  });
}

function editUserMessage(message, article) {
  if (state.loading || article.querySelector(".messageEditor")) return;
  const body = article.querySelector(".messageContent");
  body.hidden = true;
  const editor = element("form", "messageEditor");
  editor.innerHTML = `<label class="srOnly" for="edit-${message.id}">Edit message</label><textarea id="edit-${message.id}"></textarea><div><button type="button" class="secondaryBtn">Cancel</button><button type="submit" class="primaryBtn">Save & submit</button></div>`;
  const textarea = editor.querySelector("textarea");
  textarea.value = message.content;
  editor.querySelector(".secondaryBtn").addEventListener("click", () => {
    editor.remove();
    body.hidden = false;
  });
  editor.addEventListener("submit", event => {
    event.preventDefault();
    const nextContent = textarea.value.trim();
    if (!nextContent) return;
    message.content = nextContent;
    message.timestamp = Date.now();
    const chat = getChat();
    const index = chat.messages.findIndex(item => item.id === message.id);
    chat.messages.splice(index + 1);
    persist();
    sendMessage({
      text: nextContent,
      attachments: message.attachments || [],
      userMessage: message,
      hiddenUser: true
    });
  });
  body.after(editor);
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
}

function toggleSpeech(message, button) {
  if (!("speechSynthesis" in window) || !state.settings.voice) {
    toast("Voice output is unavailable or disabled.", "error");
    return;
  }
  if (speechSynthesis.speaking) {
    speechSynthesis.cancel();
    document.querySelectorAll('[data-message-action="speak"]').forEach(item => { item.textContent = "Read"; });
    return;
  }
  const utterance = new SpeechSynthesisUtterance(stripMarkdown(message.content));
  applySelectedSpeechVoice(utterance);
  utterance.rate = Number(state.settings.speechRate) || 1;
  utterance.onend = utterance.onerror = () => { button.textContent = "Read"; };
  button.textContent = "Stop";
  speechSynthesis.speak(utterance);
}

function downloadMessage(message) {
  const chat = getChat();
  const blob = new Blob([message.content], { type: "text/markdown;charset=utf-8" });
  triggerBlobDownload(blob, `${slugify(chat?.title || "talkaton-response")}.md`);
}

async function downloadResource(source, fileName) {
  const response = await fetch(source, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`Download failed (${response.status}).`);
  triggerBlobDownload(await response.blob(), fileName);
}

function triggerBlobDownload(blob, fileName) {
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function updateMessageMetrics(article, message) {
  const metrics = article?.querySelector(".messageMetrics");
  if (metrics) metrics.textContent = getReadingMetrics(message.content);
}

function renderChats() {
  const query = DOM.chatSearchInput.value.trim().toLowerCase();
  renderFolderPicker();
  const activeFolderId = state.settings.activeFolderId;
  const filtered = state.chats
    .filter(chat => {
      if (chat.incognito) return chat.id === state.currentChatId;
      if (activeFolderId === "all") return true;
      if (activeFolderId === "unfiled") return !chat.folderId;
      return chat.folderId === activeFolderId;
    })
    .filter(chat => !query || chat.title.toLowerCase().includes(query) || chat.messages.some(message => message.content.toLowerCase().includes(query)))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || Number(b.favorite) - Number(a.favorite) || b.updatedAt - a.updatedAt);
  const visible = filtered.slice(0, visibleChatCount);
  DOM.chatList.replaceChildren();

  if (!visible.length) {
    const empty = element("div", "chatListEmpty");
    empty.textContent = query ? "No chats match your search." : "Your chats will appear here.";
    DOM.chatList.append(empty);
    DOM.chatListSentinel.hidden = true;
    DOM.chatList.append(DOM.chatListSentinel);
    return;
  }

  const pinned = visible.filter(chat => chat.pinned);
  const recent = visible.filter(chat => !chat.pinned);
  if (pinned.length) DOM.chatList.append(createChatGroup("Pinned", pinned));
  if (recent.length) DOM.chatList.append(createChatGroup(query ? "Results" : "Recent", recent));
  DOM.chatListSentinel.hidden = visible.length >= filtered.length;
  DOM.chatList.append(DOM.chatListSentinel);
}

function scheduleChatSearchRender() {
  if (chatSearchTimer) clearTimeout(chatSearchTimer);
  chatSearchTimer = setTimeout(() => {
    chatSearchTimer = null;
    visibleChatCount = CONFIG.INITIAL_CHAT_BATCH;
    renderChats();
  }, 100);
}

function createChatGroup(label, chats) {
  const group = element("section", "chatGroup");
  const heading = element("h2", "chatGroupTitle");
  heading.textContent = label;
  group.append(heading);
  chats.forEach(chat => group.append(createChatItem(chat)));
  return group;
}

function createChatItem(chat) {
  const item = element("div", `chatItem${chat.id === state.currentChatId ? " active" : ""}`);
  item.setAttribute("role", "listitem");
  item.dataset.chatId = chat.id;
  const open = element("button", "chatSelectBtn");
  open.type = "button";
  open.dataset.chatAction = "open";
  const folder = state.settings.chatFolders.find(candidate => candidate.id === chat.folderId);
  const detail = chat.incognito
    ? `Incognito · ${formatRelativeTime(chat.updatedAt)}`
    : `${folder ? `${folder.name} · ` : ""}${formatRelativeTime(chat.updatedAt)}`;
  open.innerHTML = `<span>${escapeHtml(chat.title)}</span><small>${escapeHtml(detail)}</small>`;
  open.title = chat.title;

  const favorite = element("button", `chatIconBtn${chat.favorite ? " selected" : ""}`);
  favorite.type = "button";
  favorite.dataset.chatAction = "favorite";
  favorite.setAttribute("aria-label", `${chat.favorite ? "Remove from" : "Add to"} favorites: ${chat.title}`);
  favorite.title = chat.favorite ? "Remove favorite" : "Favorite";
  favorite.textContent = "★";

  const menu = element("button", "chatIconBtn");
  menu.type = "button";
  menu.dataset.chatAction = "menu";
  menu.setAttribute("aria-label", `More options for ${chat.title}`);
  menu.textContent = "•••";

  const actions = element("div", "chatMenu");
  actions.hidden = true;
  actions.innerHTML = `
    <button type="button" data-chat-action="pin">${chat.pinned ? "Unpin" : "Pin"}</button>
    <button type="button" data-chat-action="rename">Rename</button>
    ${chat.incognito ? "" : '<button type="button" data-chat-action="move">Move to folder</button>'}
    <button type="button" data-chat-action="share">Share chat</button>
    <button type="button" class="dangerAction" data-chat-action="delete">Delete</button>`;

  item.append(open, favorite, menu, actions);
  return item;
}

async function handleChatListAction(event) {
  const button = event.target.closest("[data-chat-action]");
  if (!button) return;
  const item = button.closest("[data-chat-id]");
  const chat = state.chats.find(candidate => candidate.id === item?.dataset.chatId);
  if (!chat) return;
  const action = button.dataset.chatAction;

  if (action !== "menu") closeAllChatMenus(item);

  switch (action) {
    case "open":
      if (state.loading) stopGeneration();
      state.currentChatId = chat.id;
      incognitoMode = Boolean(chat.incognito);
      state.pendingAttachments = [];
      persist();
      renderChats();
      renderMessages();
      renderAttachmentTray();
      updateIncognitoUi();
      closeMobileSidebar();
      break;
    case "menu":
      closeAllChatMenus(item);
      item.querySelector(".chatMenu").hidden = !item.querySelector(".chatMenu").hidden;
      break;
    case "favorite":
      chat.favorite = !chat.favorite;
      chat.updatedAt = Date.now();
      persistChatChange();
      renderChats();
      break;
    case "pin":
      chat.pinned = !chat.pinned;
      chat.updatedAt = Date.now();
      persistChatChange();
      renderChats();
      toast(chat.pinned ? "Chat pinned" : "Chat unpinned");
      break;
    case "rename": {
      const name = await askForText({
        eyebrow: "Conversation",
        title: "Rename chat",
        label: "Chat name",
        value: chat.title,
        submitLabel: "Save"
      });
      if (!name) return;
      const nextTitle = name.slice(0, 80);
      const renamedAt = Date.now();
      state.chats = dedupeChatsById(state.chats.map(candidate => (
        candidate.id === chat.id
          ? { ...candidate, title: nextTitle, updatedAt: renamedAt }
          : candidate
      )));
      persistChatChange();
      renderChats();
      if (chat.id === state.currentChatId) DOM.conversationTitle.textContent = nextTitle;
      break;
    }
    case "move":
      await moveChatToFolder(chat);
      break;
    case "share":
      await shareChat(chat);
      break;
    case "delete": {
      const confirmed = await askForConfirmation({
        eyebrow: "Delete chat",
        title: `Delete "${chat.title}"?`,
        message: "This will permanently delete this chat and all its messages.",
        submitLabel: "Delete",
        cancelLabel: "Keep"
      });
      if (!confirmed) return;
      deleteChat(chat.id);
      break;
    }
  }
}

function renderFolderPicker() {
  const folders = state.settings.chatFolders;
  const selected = state.settings.activeFolderId;
  DOM.chatFolderFilter.replaceChildren(
    new Option("All chats", "all"),
    new Option("Unfiled", "unfiled"),
    ...folders.map(folder => new Option(folder.name, folder.id))
  );
  DOM.chatFolderFilter.value = ["all", "unfiled"].includes(selected)
    || folders.some(folder => folder.id === selected)
    ? selected
    : "all";
  state.settings.activeFolderId = DOM.chatFolderFilter.value;
  DOM.deleteFolderBtn.disabled = ["all", "unfiled"].includes(DOM.chatFolderFilter.value);
}

async function createChatFolder() {
  const name = await askForText({
    eyebrow: "Folders",
    title: "Create a chat folder",
    label: "Folder name",
    placeholder: "Work, School, Ideas…",
    submitLabel: "Create"
  });
  if (!name) return;
  const existing = state.settings.chatFolders.find(folder => folder.name.toLowerCase() === name.toLowerCase());
  const folder = existing || {
    id: createId("folder"),
    name: name.slice(0, 40),
    createdAt: Date.now()
  };
  if (!existing) state.settings.chatFolders.push(folder);
  state.settings.activeFolderId = folder.id;
  persistChatChange();
  renderChats();
  toast(existing ? "Folder opened" : "Folder created");
}

async function deleteSelectedChatFolder() {
  const folderId = state.settings.activeFolderId;
  const folder = state.settings.chatFolders.find(candidate => candidate.id === folderId);
  if (!folder) return;
  const confirmed = await askForConfirmation({
    eyebrow: "Folders",
    title: `Delete "${folder.name}"?`,
    message: "The chats will stay in Talkaton and move to Unfiled.",
    submitLabel: "Delete folder",
    cancelLabel: "Keep"
  });
  if (!confirmed) return;
  state.settings.chatFolders = state.settings.chatFolders.filter(candidate => candidate.id !== folderId);
  state.chats.forEach(chat => {
    if (chat.folderId === folderId) chat.folderId = "";
  });
  state.settings.activeFolderId = "all";
  persistChatChange();
  renderChats();
  toast("Folder deleted; chats moved to Unfiled");
}

async function moveChatToFolder(chat) {
  const folderNames = state.settings.chatFolders.map(folder => folder.name).join(", ");
  const current = state.settings.chatFolders.find(folder => folder.id === chat.folderId)?.name || "none";
  const name = await askForText({
    eyebrow: "Folders",
    title: `Move "${chat.title}"`,
    label: folderNames
      ? `Folder name (${folderNames}) — type none to unfile`
      : "Folder name — a new folder will be created",
    value: current,
    placeholder: "Work",
    submitLabel: "Move"
  });
  if (!name) return;
  if (/^(none|unfiled)$/i.test(name)) {
    chat.folderId = "";
  } else {
    let folder = state.settings.chatFolders.find(candidate => candidate.name.toLowerCase() === name.toLowerCase());
    if (!folder) {
      folder = { id: createId("folder"), name: name.slice(0, 40), createdAt: Date.now() };
      state.settings.chatFolders.push(folder);
    }
    chat.folderId = folder.id;
  }
  chat.updatedAt = Date.now();
  persistChatChange();
  renderChats();
  toast(chat.folderId ? "Chat moved to folder" : "Chat moved to Unfiled");
}

function toggleIncognitoMode() {
  if (state.loading) stopGeneration();

  if (incognitoMode) {
    const leavingId = state.currentChatId;
    state.chats = state.chats.filter(chat => !chat.incognito);
    incognitoMode = false;
    let nextChat = state.chats.find(chat => chat.id !== leavingId);
    if (!nextChat) {
      nextChat = makeChat();
      state.chats.unshift(nextChat);
    }
    state.currentChatId = nextChat.id;
    toast("Incognito ended. That chat was not saved.");
  } else {
    incognitoMode = true;
    const chat = makeChat({ incognito: true });
    state.chats.unshift(chat);
    state.currentChatId = chat.id;
    state.pendingAttachments = [];
    toast("Incognito is on. This chat will disappear when you leave.");
  }

  DOM.input.value = "";
  persistChatChange();
  renderChats();
  renderMessages();
  renderAttachmentTray();
  updateComposerState();
  updateIncognitoUi();
  DOM.input.focus();
}

function updateIncognitoUi() {
  const active = Boolean(getChat()?.incognito);
  incognitoMode = active;
  DOM.incognitoBtn.classList.toggle("active", active);
  DOM.incognitoBtn.setAttribute("aria-pressed", String(active));
  DOM.incognitoBtn.textContent = active ? "Incognito on" : "Incognito";
  DOM.composer.classList.toggle("incognitoMode", active);
  DOM.conversationTitle.closest(".conversationHeading")?.classList.toggle("incognitoHeading", active);
}

async function shareChat(chat) {
  const messages = chat.messages
    .filter(message => ["user", "assistant"].includes(message.role) && message.content)
    .slice(-30)
    .map(message => ({
      role: message.role,
      content: String(message.content).slice(0, 4000),
      timestamp: message.timestamp,
      model: message.model || "",
      comparisonLabel: message.comparisonLabel || ""
    }));

  if (!messages.length) {
    toast("Add a message before sharing this chat.", "error");
    return;
  }

  const payload = encodeSharedPayload({
    version: 1,
    title: chat.title,
    messages
  });
  const url = `${window.location.origin}/chat#share=${payload}`;
  if (url.length > 28_000) {
    toast("This chat is too long for one private share link. Download individual responses instead.", "error");
    return;
  }

  try {
    if (navigator.share) {
      await navigator.share({
        title: chat.title,
        text: "Shared from Talkaton",
        url
      });
    } else {
      await copyText(url);
      toast("Private chat link copied");
    }
  } catch (error) {
    if (error?.name !== "AbortError") {
      await copyText(url);
      toast("Private chat link copied");
    }
  }
}

function encodeSharedPayload(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeSharedPayload(value) {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function importSharedChatFromUrl() {
  if (!window.location.hash.startsWith("#share=")) return;
  try {
    const payload = decodeSharedPayload(window.location.hash.slice(7));
    if (!Array.isArray(payload.messages) || !payload.messages.length) throw new Error("Empty chat");
    const chat = makeChat();
    chat.title = `${String(payload.title || "Shared chat").slice(0, 70)} (shared)`;
    chat.messages = payload.messages.slice(-30).map(message => ({
      id: createId("message"),
      role: message.role === "user" ? "user" : "assistant",
      content: String(message.content || "").slice(0, 4000),
      timestamp: Number(message.timestamp || Date.now()),
      model: String(message.model || ""),
      status: "complete",
      attachments: [],
      comparisonId: "",
      comparisonLabel: String(message.comparisonLabel || "")
    }));
    chat.updatedAt = Date.now();
    state.chats.unshift(chat);
    state.currentChatId = chat.id;
    window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
    saveStoredState(state);
    queueMicrotask(() => toast("Shared chat imported into your history"));
  } catch {
    window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
    queueMicrotask(() => toast("That shared chat link is invalid or expired.", "error"));
  }
}

function closeAllChatMenus(exceptItem) {
  DOM.chatList.querySelectorAll(".chatMenu").forEach(menu => {
    if (!exceptItem || !exceptItem.contains(menu)) menu.hidden = true;
  });
}

function deleteChat(chatId) {
  state.chats = state.chats.filter(chat => chat.id !== chatId);
  if (!state.chats.length) state.chats = [makeChat({ incognito: incognitoMode })];
  if (!state.chats.some(chat => chat.id === state.currentChatId)) state.currentChatId = state.chats[0].id;
  persistChatChange();
  renderChats();
  renderMessages();
  toast("Chat deleted");
}

async function clearConversation() {
  const chat = getChat();
  if (!chat?.messages.length || state.loading) return;
  const confirmation = await askForText({
    eyebrow: "Clear conversation",
    title: "Start this chat over?",
    label: "Type clear to confirm",
    placeholder: "clear",
    submitLabel: "Clear"
  });
  if (confirmation?.toLowerCase() !== "clear") return;
  chat.messages = [];
  chat.title = chat.incognito ? "Incognito chat" : "New chat";
  chat.updatedAt = Date.now();
  persistChatChange();
  renderChats();
  renderMessages();
  DOM.input.focus();
  toast("Conversation cleared");
}

async function addFiles(fileList) {
  const files = [...(fileList || [])];
  if (!files.length) return;
  if (state.pendingAttachments.length + files.length > 10) {
    toast("You can attach up to 10 files at once.", "error");
    return;
  }

  const placeholders = files.map(file => ({
    id: createId("upload"),
    name: file.name,
    size: file.size,
    type: file.type,
    kind: file.type.startsWith("image/") ? "image" : "file",
    progress: 3,
    status: "processing"
  }));
  state.pendingAttachments.push(...placeholders);
  renderAttachmentTray();
  updateComposerState();

  let readyCount = 0;
  const failures = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const placeholder = placeholders[index];

    try {
      const [prepared] = await prepareFiles([file], (_activeFile, progress) => {
        placeholder.progress = progress;
        renderAttachmentTray();
      });
      const stateIndex = state.pendingAttachments.findIndex(item => item.id === placeholder.id);
      if (stateIndex >= 0) {
        state.pendingAttachments[stateIndex] = prepared;
        readyCount += 1;
      }
    } catch (error) {
      state.pendingAttachments = state.pendingAttachments.filter(item => item.id !== placeholder.id);
      failures.push(error.message || `${file.name} could not be attached.`);
    }

    renderAttachmentTray();
    updateComposerState();
  }

  DOM.imageInput.value = "";
  DOM.fileInput.value = "";

  if (readyCount) {
    toast(`${readyCount} ${readyCount === 1 ? "file" : "files"} ready`);
    announce(`${readyCount} ${readyCount === 1 ? "file is" : "files are"} ready to send`);
  }
  if (failures.length) {
    const detail = failures.length === 1
      ? failures[0]
      : `${failures.length} files could not be added. Supported: ${ACCEPTED_FILE_LABEL}.`;
    toast(detail, "error");
  }
}

async function addFolder(fileList) {
  const files = [...(fileList || [])];
  if (!files.length) return;
  if (state.pendingAttachments.length >= 10) {
    toast("Remove an attachment before adding a folder.", "error");
    return;
  }

  const firstPath = files[0].webkitRelativePath || files[0].talkatonRelativePath || "";
  const folderName = firstPath.includes("/") ? firstPath.split("/")[0] : "Uploaded folder";
  const placeholder = {
    id: createId("upload"),
    name: `${folderName}/`,
    size: files.reduce((total, file) => total + file.size, 0),
    type: "application/x-directory",
    kind: "folder",
    progress: 3,
    status: "processing"
  };

  state.pendingAttachments.push(placeholder);
  renderAttachmentTray();
  updateComposerState();

  try {
    const prepared = await prepareFolder(files, (_file, progress) => {
      placeholder.progress = progress;
      renderAttachmentTray();
    });
    const stateIndex = state.pendingAttachments.findIndex(item => item.id === placeholder.id);
    if (stateIndex >= 0) {
      state.pendingAttachments[stateIndex] = prepared;
      toast(`${prepared.fileCount} files from ${prepared.name} ready`);
      announce(`${prepared.name} is ready to send`);
    }
  } catch (error) {
    state.pendingAttachments = state.pendingAttachments.filter(item => item.id !== placeholder.id);
    toast(error.message || "That folder could not be attached.", "error");
  } finally {
    DOM.folderInput.value = "";
    renderAttachmentTray();
    updateComposerState();
  }
}

function createAttachmentPrompt(attachments) {
  if (!attachments.length) return "";
  if (attachments.length === 1) {
    const attachment = attachments[0];
    if (attachment.kind === "folder") return "Please analyze the attached folder.";
    return attachment.kind === "image"
      ? "Please analyze the attached image."
      : `Please analyze the attached file: ${attachment.name}.`;
  }
  return "Please analyze the attached files together.";
}

function renderAttachmentTray() {
  DOM.attachmentTray.replaceChildren();
  DOM.attachmentTray.hidden = state.pendingAttachments.length === 0;

  state.pendingAttachments.forEach(attachment => {
    const item = element("div", `attachmentPreview ${attachment.kind === "image" ? "imagePreview" : "filePreview"}`);
    item.dataset.attachmentId = attachment.id;
    if (attachment.kind === "image" && attachment.previewUrl) {
      const image = new Image();
      image.src = attachment.previewUrl;
      image.alt = "";
      item.append(image);
    } else {
      const icon = element("span", "fileIcon");
      icon.textContent = attachmentGlyph(attachment);
      item.append(icon);
    }

    const copy = element("div", "attachmentCopy");
    const readyMeta = getAttachmentMeta(attachment);
    copy.innerHTML = `<strong>${escapeHtml(attachment.name)}</strong><small>${attachment.status === "processing" ? `Preparing ${Math.round(attachment.progress || 0)}%` : readyMeta}</small>`;
    item.append(copy);

    const remove = element("button", "attachmentRemove");
    remove.type = "button";
    remove.dataset.removeAttachment = attachment.id;
    remove.setAttribute("aria-label", `Remove ${attachment.name}`);
    remove.textContent = "×";
    item.append(remove);

    if (attachment.status === "processing") {
      const progress = element("span", "uploadProgress");
      progress.style.setProperty("--progress", `${attachment.progress || 0}%`);
      item.append(progress);
    }
    DOM.attachmentTray.append(item);
  });
}

function handleAttachmentAction(event) {
  const button = event.target.closest("[data-remove-attachment]");
  if (!button) return;
  state.pendingAttachments = state.pendingAttachments.filter(item => item.id !== button.dataset.removeAttachment);
  renderAttachmentTray();
  updateComposerState();
}

function getAttachmentMeta(attachment) {
  if (attachment.kind !== "folder") return formatFileSize(attachment.size);
  const skipped = attachment.skippedCount
    ? ` · ${attachment.skippedCount} skipped`
    : "";
  return `${attachment.fileCount || 0} files${skipped} · ${formatFileSize(attachment.size)}`;
}

function stripAttachmentForMessage(attachment) {
  return {
    id: attachment.id,
    name: attachment.name,
    size: attachment.size,
    type: attachment.type,
    extension: attachment.extension,
    kind: attachment.kind,
    previewUrl: attachment.previewUrl,
    dataUrl: attachment.dataUrl,
    extractedText: attachment.extractedText,
    fileCount: attachment.fileCount,
    skippedCount: attachment.skippedCount
  };
}

function handleDragEnter(event) {
  event.preventDefault();
  if (!event.dataTransfer?.types?.includes("Files")) return;
  dragDepth += 1;
  DOM.composer.classList.add("isDragging");
}

function handleDragOver(event) {
  event.preventDefault();
  if (!event.dataTransfer?.types?.includes("Files")) return;
  event.dataTransfer.dropEffect = "copy";
  DOM.composer.classList.add("isDragging");
}

function handleDragLeave(event) {
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) DOM.composer.classList.remove("isDragging");
}

async function handleDrop(event) {
  event.preventDefault();
  dragDepth = 0;
  DOM.composer.classList.remove("isDragging");
  const folderFiles = await collectDroppedFolderFiles(event.dataTransfer);
  if (folderFiles.length) {
    await addFolder(folderFiles);
  } else {
    addFiles(event.dataTransfer?.files);
  }
}

async function collectDroppedFolderFiles(dataTransfer) {
  const entries = [...(dataTransfer?.items || [])]
    .map(item => item.webkitGetAsEntry?.())
    .filter(entry => entry?.isDirectory);
  if (!entries.length) return [];

  const files = [];
  for (const entry of entries) {
    await readDroppedEntry(entry, "", files);
  }
  return files;
}

async function readDroppedEntry(entry, parentPath, files) {
  if (files.length >= 500) return;
  const path = `${parentPath}${entry.name}`;

  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    file.talkatonRelativePath = path;
    files.push(file);
    return;
  }

  if (!entry.isDirectory) return;
  const directoryName = entry.name.toLowerCase();
  if ([".git", ".next", ".nuxt", ".svelte-kit", "build", "coverage", "dist", "node_modules", "target", "vendor"].includes(directoryName)) {
    return;
  }

  const reader = entry.createReader();
  while (files.length < 500) {
    const children = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    if (!children.length) break;
    for (const child of children) {
      await readDroppedEntry(child, `${path}/`, files);
      if (files.length >= 500) break;
    }
  }
}

function handlePaste(event) {
  const imageFiles = [...(event.clipboardData?.files || [])].filter(file => file.type.startsWith("image/"));
  if (imageFiles.length) {
    event.preventDefault();
    addFiles(imageFiles);
  }
}

function toggleSearchMode() {
  if (!searchMode && compareMode) setCompareMode(false);
  searchMode = !searchMode;
  updateSearchMode();
  DOM.input.focus();
}

function updateSearchMode() {
  DOM.searchBtn.setAttribute("aria-pressed", String(searchMode));
  DOM.searchBtn.classList.toggle("active", searchMode);
  DOM.composer.classList.toggle("searchMode", searchMode);
  DOM.input.placeholder = searchMode ? "Search the web with Talkaton" : "Message Talkaton";
  toast(searchMode ? "Web search on" : "Web search off");
}

function toggleCompareMode() {
  setCompareMode(!compareMode);
}

function setCompareMode(enabled) {
  if (enabled && getUserTier() === "guest") {
    toast("Log in to compare two AI models.", "error");
    handleAuth();
    return;
  }

  syncCompareModelPicker();
  if (enabled && getAvailableModels().filter(model => model !== state.model).length === 0) {
    toast("A second model is not available for this account.", "error");
    return;
  }

  compareMode = Boolean(enabled);
  DOM.compareBar.hidden = !compareMode;
  DOM.compareBtn.classList.toggle("active", compareMode);
  DOM.compareBtn.setAttribute("aria-pressed", String(compareMode));
  DOM.composer.classList.toggle("compareMode", compareMode);

  if (compareMode && searchMode) {
    searchMode = false;
    updateSearchMode();
  }
  DOM.input.placeholder = compareMode
    ? "Ask two models the same thing"
    : (searchMode ? "Search the web with Talkaton" : "Message Talkaton");
  if (compareMode) toast("Model comparison on");
  DOM.input.focus();
}

function syncCompareModelPicker() {
  if (!DOM.compareModelSelect) return;
  DOM.comparePrimaryName.textContent = MODEL_NAMES[state.model] || state.model;
  const availableModels = getAvailableModels();
  [...DOM.compareModelSelect.options].forEach(option => {
    option.disabled = !availableModels.includes(option.value) || option.value === state.model;
  });

  if (!availableModels.includes(DOM.compareModelSelect.value) || DOM.compareModelSelect.value === state.model) {
    DOM.compareModelSelect.value = availableModels.find(model => model !== state.model) || "";
  }

}

function validateCompareModel() {
  if (!canUseModel(DOM.compareModelSelect.value) || DOM.compareModelSelect.value === state.model) {
    syncCompareModelPicker();
    toast("Choose a different available model.", "error");
  }
}

function createComparisonHistory(chat) {
  return chat.messages
    .filter(message => ["user", "assistant"].includes(message.role) && message.content)
    .slice(-18)
    .map(({ role, content }) => ({ role, content }));
}

async function sendModelComparison() {
  if (state.loading) return;
  const attachments = state.pendingAttachments;
  const enteredText = DOM.input.value.trim();
  const text = enteredText || createAttachmentPrompt(attachments);
  if (!text || attachments.some(attachment => attachment.status !== "ready")) return;

  const primaryModel = state.model;
  const secondModel = DOM.compareModelSelect.value;
  if (!canUseModel(primaryModel) || !canUseModel(secondModel) || primaryModel === secondModel) {
    syncCompareModelPicker();
    toast("Choose two different models you can access.", "error");
    return;
  }

  const remaining = getRemainingMessages();
  if (remaining !== "∞" && remaining < 2) {
    toast("A comparison uses two messages. You need at least two remaining.", "error");
    return;
  }

  const chat = getChat();
  if (!chat) return;
  const historyOverride = createComparisonHistory(chat);
  const comparisonId = createId("comparison");

  await sendMessage({
    text,
    attachments,
    bypassSearch: true,
    model: primaryModel,
    historyOverride,
    comparisonId,
    comparisonLabel: `1 of 2 · ${MODEL_NAMES[primaryModel]}`
  });

  const firstResponse = chat.messages.find(message =>
    message.comparisonId === comparisonId && message.comparisonLabel.startsWith("1 of 2")
  );
  if (!state.loading && getChat()?.id === chat.id && firstResponse?.status === "complete") {
    await sendMessage({
      text,
      attachments,
      hiddenUser: true,
      bypassSearch: true,
      countsTowardLimit: true,
      model: secondModel,
      historyOverride,
      comparisonId,
      comparisonLabel: `2 of 2 · ${MODEL_NAMES[secondModel]}`
    });
  }
}

function setupVoicePicker() {
  if (!("speechSynthesis" in window)) {
    DOM.voiceSelect.disabled = true;
    DOM.voiceSelect.replaceChildren(new Option("Voices unavailable", ""));
    return;
  }

  const refreshVoices = () => populateVoicePicker();
  refreshVoices();
  if (typeof speechSynthesis.addEventListener === "function") {
    speechSynthesis.addEventListener("voiceschanged", refreshVoices);
  } else {
    speechSynthesis.onvoiceschanged = refreshVoices;
  }
}

function populateVoicePicker() {
  const voices = speechSynthesis.getVoices()
    .slice()
    .sort((first, second) => {
      if (first.default !== second.default) return first.default ? -1 : 1;
      return `${first.lang} ${first.name}`.localeCompare(`${second.lang} ${second.name}`);
    });
  const selectedVoiceURI = String(state.settings.voiceURI || "");
  const systemOption = new Option("System voice", "");
  DOM.voiceSelect.replaceChildren(systemOption);

  voices.forEach(voice => {
    const option = new Option(
      `${voice.name} · ${voice.lang}${voice.default ? " · Default" : ""}`,
      getSpeechVoiceId(voice)
    );
    DOM.voiceSelect.append(option);
  });

  DOM.voiceSelect.disabled = voices.length === 0;
  DOM.voiceSelect.value = voices.some(voice => getSpeechVoiceId(voice) === selectedVoiceURI)
    ? selectedVoiceURI
    : "";
}

function getSpeechVoiceId(voice) {
  return String(voice?.voiceURI || `${voice?.name || ""}|${voice?.lang || ""}`);
}

function getSelectedSpeechVoice() {
  if (!("speechSynthesis" in window)) return null;
  const selectedVoiceURI = String(state.settings.voiceURI || "");
  if (!selectedVoiceURI) return null;
  return speechSynthesis.getVoices()
    .find(voice => getSpeechVoiceId(voice) === selectedVoiceURI) || null;
}

function applySelectedSpeechVoice(utterance) {
  const selectedVoice = getSelectedSpeechVoice();
  if (!selectedVoice) return;
  utterance.voice = selectedVoice;
  utterance.lang = selectedVoice.lang;
}

async function toggleVoiceInput() {
  if (!DOM.voiceDialog.open) DOM.voiceDialog.showModal();
  DOM.voiceModelName.textContent = MODEL_NAMES[state.model] || "Talkaton";
  voiceUseRecordedTranscription = canUseRecordedVoiceInput();
  if (!voiceUseRecordedTranscription && !getSpeechRecognitionConstructor()) {
    setVoiceStatus("This browser cannot record or recognize speech. Try Chrome, Edge, Safari, or Opera.", true);
    DOM.voicePermissionBtn.disabled = true;
    DOM.voiceStartBtn.disabled = true;
    return;
  }
  await refreshMicrophonePermissionState();
  updateVoiceControls();
  if (voiceMicrophonePermissionGranted) {
    setVoiceStatus("Microphone allowed. Start whenever you’re ready.");
    DOM.voiceCaption.textContent = "Your microphone is ready. Talkaton is not listening yet.";
  } else {
    setVoiceStatus("Allow microphone access before starting.");
    DOM.voiceCaption.textContent = "Talkaton will only listen after you allow access and press Start.";
  }
}

function toggleVoiceRecognition() {
  if (voiceConversationActive) {
    endVoiceConversation();
    return;
  }
  if (recognition || voiceRecorder) {
    stopVoiceRecognition();
    return;
  }
  if (!voiceMicrophonePermissionGranted) {
    requestVoiceMicrophonePermission();
    return;
  }
  if (DOM.voiceAutoSend.checked) beginVoiceConversation();
  else startVoiceRecognition();
}

function beginVoiceConversation() {
  if (!canUseRecordedVoiceInput() && !getSpeechRecognitionConstructor()) {
    setVoiceStatus("This browser cannot record or recognize speech. Try Chrome, Edge, Safari, or Opera.", true);
    return;
  }
  if (!voiceMicrophonePermissionGranted) {
    setVoiceStatus("Allow microphone access first, then start the conversation.", true);
    updateVoiceControls();
    return;
  }
  if (state.loading || voiceSending) {
    setVoiceStatus("Wait for the current reply to finish, then start the live conversation.");
    return;
  }

  voiceConversationActive = true;
  DOM.voiceAutoSend.checked = true;
  DOM.voiceTranscript.value = "";
  voiceFinalTranscript = "";
  DOM.voiceCaption.textContent = "Listening for your first turn…";
  updateVoiceControls();
  setVoiceStatus("Starting live conversation…");
  startVoiceRecognition();
}

function getSpeechRecognitionConstructor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function canUseRecordedVoiceInput() {
  return Boolean(window.MediaRecorder && navigator.mediaDevices?.getUserMedia);
}

async function refreshMicrophonePermissionState() {
  if (!navigator.permissions?.query) return;
  try {
    const permission = await navigator.permissions.query({ name: "microphone" });
    voiceMicrophonePermissionGranted = permission.state === "granted";
    permission.onchange = () => {
      voiceMicrophonePermissionGranted = permission.state === "granted";
      updateVoiceControls();
      if (!voiceMicrophonePermissionGranted && voiceConversationActive) {
        endVoiceConversation({ updateStatus: false });
        setVoiceStatus("Microphone access is no longer allowed.", true);
      }
    };
  } catch {
    // Safari may support microphone access without exposing it through Permissions API.
  }
}

async function requestVoiceMicrophonePermission() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setVoiceStatus("This browser cannot request microphone access.", true);
    return false;
  }

  DOM.voicePermissionBtn.disabled = true;
  DOM.voicePermissionBtn.textContent = "Waiting for permission…";
  setVoiceStatus("Choose Allow in your browser’s microphone prompt.");
  DOM.voiceCaption.textContent = "Talkaton is requesting microphone access, but is not listening yet.";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(track => track.stop());
    voiceMicrophonePermissionGranted = true;
    updateVoiceControls();
    setVoiceStatus("Microphone allowed. Press Start when you’re ready.");
    DOM.voiceCaption.textContent = "Permission is ready. Talkaton will not listen until you start.";
    announce("Microphone permission allowed");
    return true;
  } catch (error) {
    voiceMicrophonePermissionGranted = false;
    const blocked = error?.name === "NotAllowedError" || error?.name === "SecurityError";
    setVoiceStatus(
      blocked
        ? "Microphone access was not allowed. Enable it in your browser’s site settings, then try again."
        : "Talkaton could not open your microphone. Check that it is connected and not busy.",
      true
    );
    DOM.voiceCaption.textContent = "No audio is being recorded.";
    updateVoiceControls();
    return false;
  }
}

function endVoiceConversation({ updateStatus = true } = {}) {
  voiceConversationActive = false;
  clearVoiceRestartTimer();
  stopVoiceRecognition({ cancelled: true });
  if (voiceSpeechResolver) voiceSpeechResolver();
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  DOM.voiceOrb.classList.remove("speaking");
  DOM.voiceCaption.textContent = "Conversation ended.";
  updateVoiceControls();
  if (updateStatus) setVoiceStatus("Live chat ended. Your conversation is saved.");
  announce("Live chat ended");
}

function clearVoiceRestartTimer() {
  if (!voiceRestartTimer) return;
  clearTimeout(voiceRestartTimer);
  voiceRestartTimer = null;
}

function resumeLiveVoiceConversation(delay = 350) {
  clearVoiceRestartTimer();
  if (!voiceConversationActive || !DOM.voiceDialog.open) return;
  voiceRestartTimer = setTimeout(() => {
    voiceRestartTimer = null;
    if (!voiceConversationActive || recognition || voiceRecorder || voiceSending || state.loading || !DOM.voiceDialog.open) return;
    startVoiceRecognition({ skipPermissionCheck: true });
  }, delay);
}

async function startVoiceRecognition({ skipPermissionCheck = false } = {}) {
  if (voiceUseRecordedTranscription && canUseRecordedVoiceInput()) {
    await startRecordedVoiceTurn({ skipPermissionCheck });
    return;
  }

  const SpeechRecognition = getSpeechRecognitionConstructor();
  if (!SpeechRecognition || recognition || voiceRecorder || voiceSending || state.loading) return;

  if (!skipPermissionCheck && !voiceMicrophonePermissionGranted) {
    setVoiceStatus("Allow microphone access before starting.", true);
    updateVoiceControls();
    return;
  }

  const instance = new SpeechRecognition();
  recognition = instance;
  instance.continuous = false;
  instance.interimResults = true;
  instance.maxAlternatives = 1;
  instance.lang = document.documentElement.lang || navigator.language || "en-US";
  voiceFinalTranscript = DOM.voiceTranscript.value.trim();
  let failed = false;
  let fallbackToRecording = false;

  instance.onstart = () => {
    DOM.voiceBtn.classList.add("recording");
    DOM.voiceBtn.setAttribute("aria-pressed", "true");
    DOM.voiceOrb.classList.add("listening");
    DOM.voiceOrb.classList.remove("speaking");
    updateVoiceControls();
    setVoiceStatus("Listening… speak naturally.");
    announce(voiceConversationActive ? "Live chat started" : "Voice input started");
  };
  instance.onresult = event => {
    let interim = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      if (event.results[index].isFinal) {
        voiceFinalTranscript += `${voiceFinalTranscript ? " " : ""}${event.results[index][0].transcript.trim()}`;
      }
      else interim += event.results[index][0].transcript;
    }
    DOM.voiceTranscript.value = `${voiceFinalTranscript}${interim ? ` ${interim.trim()}` : ""}`.trim();
    DOM.voiceCaption.textContent = DOM.voiceTranscript.value || "Listening…";
    updateVoiceControls();
  };
  instance.onend = () => {
    if (recognition !== instance) return;
    recognition = null;
    DOM.voiceBtn.classList.remove("recording");
    DOM.voiceBtn.setAttribute("aria-pressed", "false");
    DOM.voiceOrb.classList.remove("listening");
    updateVoiceControls();
    if (fallbackToRecording && voiceConversationActive && DOM.voiceDialog.open) {
      setVoiceStatus("Switching to Talkaton transcription…");
      setTimeout(() => startRecordedVoiceTurn({ skipPermissionCheck: true }), 150);
      return;
    }
    const transcriptReady = Boolean(DOM.voiceTranscript.value.trim());
    if (!failed && !voiceConversationActive) {
      setVoiceStatus(
        transcriptReady
          ? "Transcript ready. Send it or tap the microphone to add more."
          : "Ready for your voice.",
        false
      );
    }
    announce("Voice input stopped");
    if (!failed && voiceConversationActive && DOM.voiceDialog.open && transcriptReady) {
      sendVoiceTranscript();
    } else if (!failed && voiceConversationActive && DOM.voiceDialog.open) {
      setVoiceStatus("Listening… speak naturally.");
      resumeLiveVoiceConversation(500);
    }
  };
  instance.onerror = event => {
    if (event.error === "network" && canUseRecordedVoiceInput()) {
      failed = true;
      fallbackToRecording = true;
      voiceUseRecordedTranscription = true;
      setVoiceStatus("The browser voice service disconnected. Switching automatically…");
      DOM.voiceCaption.textContent = "Keeping Live chat connected with Talkaton transcription.";
      return;
    }
    const quietTimeout = event.error === "no-speech" && voiceConversationActive;
    failed = event.error !== "aborted" && !quietTimeout;
    const messages = {
      "not-allowed": "Microphone access was denied. Allow it in site settings and try again.",
      "service-not-allowed": "Speech recognition is blocked by this browser.",
      "audio-capture": "No working microphone was found.",
      "no-speech": "No speech was heard. Tap the microphone and try again.",
      network: "Voice recognition lost its connection. Check your internet and try again."
    };
    if (failed) {
      voiceConversationActive = false;
      updateVoiceControls();
      setVoiceStatus(messages[event.error] || `Voice recognition stopped: ${event.error}.`, true);
    }
  };
  try {
    instance.start();
  } catch {
    recognition = null;
    setVoiceStatus("The microphone is already busy. Wait a moment and try again.", true);
  }
}

async function startRecordedVoiceTurn({ skipPermissionCheck = false } = {}) {
  if (voiceRecorder || recognition || voiceSending || state.loading) return;
  if (!skipPermissionCheck && !voiceMicrophonePermissionGranted) {
    setVoiceStatus("Allow microphone access before starting.", true);
    updateVoiceControls();
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1
      }
    });
    if (!DOM.voiceDialog.open || (!voiceConversationActive && DOM.voiceAutoSend.checked)) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }

    voiceMicrophonePermissionGranted = true;
    voiceRecorderStream = stream;
    voiceRecorderChunks = [];
    voiceRecorderCancelled = false;
    voiceSoundDetected = false;
    voiceRecordingStartedAt = performance.now();
    voiceLastSoundAt = voiceRecordingStartedAt;

    const mimeType = chooseVoiceRecordingMimeType();
    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);
    voiceRecorder = recorder;
    recorder.ondataavailable = event => {
      if (event.data?.size) voiceRecorderChunks.push(event.data);
    };
    recorder.onerror = () => {
      voiceRecorderCancelled = true;
      setVoiceStatus("The microphone recording stopped unexpectedly. Try again.", true);
      if (voiceConversationActive) voiceConversationActive = false;
      stopVoiceRecognition({ cancelled: true });
    };
    recorder.onstart = () => {
      DOM.voiceBtn.classList.add("recording");
      DOM.voiceBtn.setAttribute("aria-pressed", "true");
      DOM.voiceOrb.classList.add("listening");
      DOM.voiceOrb.classList.remove("speaking");
      DOM.voiceCaption.textContent = "Listening…";
      setVoiceStatus("Listening… speak naturally.");
      updateVoiceControls();
      announce(voiceConversationActive ? "Live chat started" : "Voice input started");
    };
    recorder.onstop = async () => {
      const cancelled = voiceRecorderCancelled;
      const chunks = voiceRecorderChunks.slice();
      const detectedSpeech = voiceSoundDetected;
      const recordedType = recorder.mimeType || mimeType || "audio/webm";
      voiceRecorder = null;
      voiceRecorderChunks = [];
      cleanupRecordedVoiceMedia();
      DOM.voiceBtn.classList.remove("recording");
      DOM.voiceBtn.setAttribute("aria-pressed", "false");
      DOM.voiceOrb.classList.remove("listening");
      updateVoiceControls();
      if (cancelled) return;

      const audio = new Blob(chunks, { type: recordedType });
      if (!detectedSpeech || audio.size < 256) {
        DOM.voiceCaption.textContent = "No speech heard yet.";
        setVoiceStatus("Listening for you…");
        if (voiceConversationActive && DOM.voiceDialog.open) resumeLiveVoiceConversation(350);
        return;
      }

      try {
        setVoiceStatus("Transcribing what you said…");
        DOM.voiceCaption.textContent = "Turning your voice into text…";
        const text = await transcribeRecordedVoice(audio);
        if (!text) throw new Error("No speech was detected.");
        voiceFinalTranscript = text;
        DOM.voiceTranscript.value = text;
        DOM.voiceCaption.textContent = text;
        updateVoiceControls();
        if (voiceConversationActive && DOM.voiceDialog.open) {
          await sendVoiceTranscript();
        } else {
          setVoiceStatus("Transcript ready. Send it or start again.");
        }
      } catch (error) {
        voiceConversationActive = false;
        updateVoiceControls();
        setVoiceStatus(error.message || "Talkaton could not transcribe that recording. Try again.", true);
      }
    };

    recorder.start(250);
    monitorRecordedVoiceActivity(recorder, stream);
  } catch (error) {
    cleanupRecordedVoiceMedia();
    voiceRecorder = null;
    voiceMicrophonePermissionGranted = error?.name !== "NotAllowedError" && voiceMicrophonePermissionGranted;
    updateVoiceControls();
    setVoiceStatus(
      error?.name === "NotAllowedError"
        ? "Microphone access was denied. Allow it in site settings and try again."
        : "Talkaton could not start the microphone. Check that it is connected and not busy.",
      true
    );
  }
}

function chooseVoiceRecordingMimeType() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/ogg;codecs=opus",
    "audio/mp4",
    "audio/webm"
  ];
  return candidates.find(type => MediaRecorder.isTypeSupported?.(type)) || "";
}

function monitorRecordedVoiceActivity(recorder, stream) {
  voiceRecorderTimeout = setTimeout(() => {
    if (voiceRecorder === recorder && recorder.state !== "inactive") recorder.stop();
  }, VOICE_MAX_TURN_MS);

  try {
    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) return;
    const context = new AudioContextConstructor();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    const samples = new Uint8Array(analyser.fftSize = 1024);
    source.connect(analyser);
    voiceAudioContext = context;
    context.resume?.();

    const sampleVolume = () => {
      if (voiceRecorder !== recorder || recorder.state === "inactive") return;
      analyser.getByteTimeDomainData(samples);
      let total = 0;
      for (const sample of samples) {
        const normalized = (sample - 128) / 128;
        total += normalized * normalized;
      }
      const volume = Math.sqrt(total / samples.length);
      const now = performance.now();
      if (volume >= VOICE_ACTIVITY_THRESHOLD) {
        voiceSoundDetected = true;
        voiceLastSoundAt = now;
      }

      const silentAfterSpeech = voiceSoundDetected && now - voiceLastSoundAt >= VOICE_SILENCE_MS;
      const waitedWithoutSpeech = !voiceSoundDetected && now - voiceRecordingStartedAt >= VOICE_WAIT_FOR_SPEECH_MS;
      if (silentAfterSpeech || waitedWithoutSpeech) {
        if (recorder.state !== "inactive") recorder.stop();
        return;
      }
      voiceSilenceFrame = requestAnimationFrame(sampleVolume);
    };
    voiceSilenceFrame = requestAnimationFrame(sampleVolume);
  } catch {
    // The maximum-turn timer still lets recording work if audio metering is unavailable.
  }
}

function cleanupRecordedVoiceMedia() {
  if (voiceSilenceFrame !== null) cancelAnimationFrame(voiceSilenceFrame);
  voiceSilenceFrame = null;
  if (voiceRecorderTimeout !== null) clearTimeout(voiceRecorderTimeout);
  voiceRecorderTimeout = null;
  if (voiceAudioContext) {
    try { voiceAudioContext.close(); } catch {}
  }
  voiceAudioContext = null;
  if (voiceRecorderStream) {
    voiceRecorderStream.getTracks().forEach(track => track.stop());
  }
  voiceRecorderStream = null;
}

async function transcribeRecordedVoice(audio) {
  const headers = await getChatRequestHeaders();
  delete headers["Content-Type"];
  headers["Content-Type"] = String(audio.type || "audio/webm").split(";")[0];
  headers["X-Audio-Language"] = document.documentElement.lang || navigator.language || "en";
  const response = await fetch("/api/transcribe", {
    method: "POST",
    headers,
    body: audio
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Voice transcription failed (${response.status}).`);
  }
  return String(data.text || "").trim();
}

function stopVoiceRecognition({ cancelled = false } = {}) {
  if (voiceRecorder) {
    voiceRecorderCancelled ||= cancelled;
    if (voiceRecorder.state !== "inactive") {
      try { voiceRecorder.stop(); } catch {}
    }
    return;
  }
  const active = recognition;
  if (!active) return;
  try {
    active.stop();
  } catch {
    try { active.abort(); } catch {}
  }
}

function updateVoiceControls() {
  const voiceInputActive = Boolean(recognition || voiceRecorder);
  DOM.voiceSendBtn.disabled = voiceSending || !DOM.voiceTranscript.value.trim();
  DOM.voicePermissionBtn.textContent = voiceMicrophonePermissionGranted
    ? "Microphone allowed ✓"
    : "Allow microphone";
  DOM.voicePermissionBtn.disabled = voiceMicrophonePermissionGranted || voiceConversationActive;
  DOM.voicePermissionBtn.classList.toggle("allowed", voiceMicrophonePermissionGranted);
  DOM.voiceStartBtn.disabled = !voiceMicrophonePermissionGranted && !voiceConversationActive && !voiceInputActive;
  DOM.voiceStartBtn.textContent = voiceConversationActive
    ? "End Live chat"
    : voiceInputActive
      ? "Stop microphone"
      : "Start Live chat";
  DOM.voiceAutoSend.disabled = voiceConversationActive;
  DOM.voiceDialog.classList.toggle("liveConversation", voiceConversationActive);
  DOM.voiceLiveIndicator.classList.toggle("active", voiceConversationActive);
  DOM.voiceLiveIndicator.querySelector("strong").textContent = voiceConversationActive
    ? voiceSending
      ? "Live chat · Talkaton is replying"
      : "Live chat · Listening"
    : "Live chat off";
  DOM.voiceOrb.setAttribute(
    "aria-label",
    voiceConversationActive ? "End Live chat" : "Start Live chat"
  );
}

function setVoiceStatus(message, error = false) {
  DOM.voiceStatus.textContent = message;
  DOM.voiceStatus.classList.toggle("error", error);
}

async function sendVoiceTranscript() {
  const text = DOM.voiceTranscript.value.trim();
  if (!text || voiceSending || state.loading) return;
  stopVoiceRecognition();
  voiceSending = true;
  updateVoiceControls();
  DOM.voiceCaption.textContent = text;
  setVoiceStatus(voiceConversationActive ? "Talkaton is thinking…" : "Sending to Talkaton…");
  const chat = getChat();
  const beforeIds = new Set(chat?.messages.map(message => message.id) || []);
  try {
    await sendMessage({ text });
    DOM.voiceTranscript.value = "";
    voiceFinalTranscript = "";
    const reply = [...(getChat()?.messages || [])].reverse().find(message =>
      message.role === "assistant"
      && message.status === "complete"
      && !beforeIds.has(message.id)
      && message.content
    );
    if (reply && DOM.voiceSpeakReplies.checked && DOM.voiceDialog.open) {
      DOM.voiceCaption.textContent = stripMarkdown(reply.content).slice(0, 280);
      setVoiceStatus("Talkaton is speaking…");
      await speakText(reply.content, { liveConversation: voiceConversationActive });
    }
    if (voiceConversationActive && DOM.voiceDialog.open) {
      DOM.voiceCaption.textContent = "Listening for your next turn…";
      setVoiceStatus("Listening for your next turn…");
    } else {
      setVoiceStatus(reply ? "Reply complete. Start again when you’re ready." : "Ready for your next turn.");
    }
  } finally {
    voiceSending = false;
    updateVoiceControls();
    if (voiceConversationActive && DOM.voiceDialog.open) resumeLiveVoiceConversation();
  }
}

function speakText(text, { liveConversation = false } = {}) {
  if (!("speechSynthesis" in window) || !state.settings.voice) return Promise.resolve();
  if (voiceSpeechResolver) voiceSpeechResolver();
  speechSynthesis.cancel();
  return new Promise(resolve => {
    const utterance = new SpeechSynthesisUtterance(stripMarkdown(text));
    const finish = () => {
      if (voiceSpeechResolver === finish) voiceSpeechResolver = null;
      DOM.voiceOrb.classList.remove("speaking");
      resolve();
    };
    voiceSpeechResolver = finish;
    applySelectedSpeechVoice(utterance);
    utterance.rate = Number(state.settings.speechRate) || 1;
    utterance.onend = finish;
    utterance.onerror = finish;
    if (liveConversation) DOM.voiceOrb.classList.add("speaking");
    speechSynthesis.speak(utterance);
  });
}

function openSettings() {
  if (state.loggedIn && state.user) {
    openProfile();
    return;
  }
  openPreferenceSettings();
}

function openPreferenceSettings() {
  byId("themeSelect").value = state.settings.theme;
  byId("timestampsToggle").checked = state.settings.timestamps;
  byId("autoScrollToggle").checked = state.settings.autoScroll;
  byId("memoryToggle").checked = state.settings.memory;
  byId("markdownToggle").checked = state.settings.markdown;
  byId("voiceOutputToggle").checked = state.settings.voice;
  byId("speechRateInput").value = state.settings.speechRate;
  byId("speechRateValue").textContent = `${state.settings.speechRate}×`;
  if (!DOM.settingsDialog.open) DOM.settingsDialog.showModal();
}

function saveSettingsFromDialog() {
  state.settings.theme = byId("themeSelect").value;
  state.settings.timestamps = byId("timestampsToggle").checked;
  state.settings.autoScroll = byId("autoScrollToggle").checked;
  state.settings.memory = byId("memoryToggle").checked;
  state.settings.markdown = byId("markdownToggle").checked;
  state.settings.voice = byId("voiceOutputToggle").checked;
  state.settings.speechRate = Number(byId("speechRateInput").value);
  byId("speechRateValue").textContent = `${state.settings.speechRate}×`;
  applyPreferences();
  persist();
  renderMessages();
}

function applyPreferences() {
  if (!canUseModel(state.model)) state.model = defaultState.model;
  DOM.modelSelect.value = state.model;
  DOM.app.classList.toggle("sidebarCollapsed", Boolean(state.sidebarCollapsed));
  applyTheme();
}

function applyTheme() {
  const theme = state.settings.theme === "system"
    ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : state.settings.theme;
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]').content = theme === "dark" ? "#0b0b0c" : "#f7f7f8";
}

function cycleTheme() {
  const order = ["system", "dark", "light"];
  state.settings.theme = order[(order.indexOf(state.settings.theme) + 1) % order.length];
  applyTheme();
  persist();
  toast(`Theme: ${state.settings.theme}`);
}

function openMemory() {
  DOM.memoryContent.replaceChildren();
  const header = element("div", "memoryActions");
  header.innerHTML = `
    <span class="memoryCount">${state.memory.length} ${state.memory.length === 1 ? "memory" : "memories"}</span>
    <span>
      <button type="button" class="textActionBtn" data-memory-action="import">Import from another AI</button>
      ${state.memory.length ? '<button type="button" class="textActionBtn dangerTextBtn" data-memory-action="clearAll">Clear all</button>' : ""}
    </span>`;
  DOM.memoryContent.append(header);
  if (!state.memory.length) {
    DOM.memoryContent.insertAdjacentHTML("beforeend", `<div class="dialogEmpty"><strong>No saved memory yet</strong><span>Import a ChatGPT, Claude, JSON, or plain-text export—or add context by chatting.</span></div>`);
  } else {
    const list = element("div", "memoryList");
    [...state.memory].reverse().slice(0, 40).forEach((item, displayIndex) => {
      const realIndex = state.memory.length - 1 - displayIndex;
      const card = element("article", "memoryCard");
      card.dataset.memoryIndex = realIndex;
      card.innerHTML = `<div class="memoryCardBody"><strong>${escapeHtml(item.user || "Conversation")}</strong><p>${escapeHtml(item.ai || "")}</p><time>${formatRelativeTime(item.time)}</time></div><button type="button" class="memoryDeleteBtn" data-memory-action="delete" data-memory-index="${realIndex}" aria-label="Delete this memory" title="Delete">×</button>`;
      list.append(card);
    });
    DOM.memoryContent.append(list);
  }
  if (!DOM.memoryDialog.open) DOM.memoryDialog.showModal();
}

async function handleMemoryAction(e) {
  const btn = e.target.closest("[data-memory-action]");
  if (!btn) return;
  const action = btn.dataset.memoryAction;
  if (action === "import") {
    DOM.memoryImportInput.click();
  } else if (action === "clearAll") {
    state.memory = [];
    persist();
    openMemory();
    DOM.memoryCount.textContent = state.memory.length;
    toast("All memories cleared");
  } else if (action === "delete") {
    const index = Number(btn.dataset.memoryIndex);
    state.memory.splice(index, 1);
    persist();
    openMemory();
    DOM.memoryCount.textContent = state.memory.length;
    toast("Memory deleted");
  }
}

async function importMemoryFile(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) {
    toast("That export is too large. Choose a file under 20 MB.", "error");
    return;
  }

  try {
    const text = await file.text();
    const imported = parseImportedMemory(text, file.name);
    if (!imported.length) throw new Error("No conversations or memory were found in that file.");
    const seen = new Set(state.memory.map(item => `${item.user}\n${item.ai}`.toLowerCase()));
    const unique = imported.filter(item => {
      const key = `${item.user}\n${item.ai}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    state.memory = [...state.memory, ...unique].slice(-CONFIG.MAX_MEMORY);
    persistChatChange();
    updateStats();
    openMemory();
    toast(`Imported ${unique.length} ${unique.length === 1 ? "memory" : "memories"}`);
  } catch (error) {
    toast(error.message || "That memory export could not be imported.", "error");
  }
}

function parseImportedMemory(text, fileName = "") {
  const fallbackTime = Date.now();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }

  const entries = [];
  const addPair = (user, ai, time = fallbackTime) => {
    const safeUser = String(user || "").trim().slice(0, 3000);
    const safeAi = String(ai || "").trim().slice(0, 6000);
    if (!safeUser && !safeAi) return;
    entries.push({
      user: safeUser || `Imported from ${fileName || "another AI"}`,
      ai: safeAi,
      time: Number(time || fallbackTime)
    });
  };

  const roots = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.conversations)
      ? parsed.conversations
      : parsed
        ? [parsed]
        : [];

  for (const conversation of roots) {
    if (Array.isArray(conversation?.mapping)) {
      // Some exports represent mapping as an array instead of an object.
      conversation.mapping = Object.fromEntries(conversation.mapping.map((node, index) => [node.id || index, node]));
    }
    if (conversation?.mapping && typeof conversation.mapping === "object") {
      const ordered = Object.values(conversation.mapping)
        .map(node => node?.message)
        .filter(Boolean)
        .sort((a, b) => Number(a.create_time || 0) - Number(b.create_time || 0));
      let pendingUser = "";
      for (const message of ordered) {
        const role = message.author?.role;
        const content = Array.isArray(message.content?.parts)
          ? message.content.parts.filter(part => typeof part === "string").join("\n")
          : String(message.content?.text || "");
        if (role === "user") pendingUser = content;
        if (role === "assistant" && (pendingUser || content)) {
          addPair(pendingUser, content, Number(message.create_time || 0) * 1000 || fallbackTime);
          pendingUser = "";
        }
      }
      continue;
    }

    const messages = conversation?.chat_messages || conversation?.messages || conversation?.content;
    if (Array.isArray(messages)) {
      let pendingUser = "";
      for (const message of messages) {
        const role = String(message.sender || message.role || message.author?.role || "").toLowerCase();
        const content = Array.isArray(message.content)
          ? message.content.map(part => part?.text || part).filter(part => typeof part === "string").join("\n")
          : String(message.text || message.content || "");
        if (["human", "user"].includes(role)) pendingUser = content;
        if (["assistant", "ai", "claude"].includes(role) && (pendingUser || content)) {
          addPair(pendingUser, content, Date.parse(message.created_at || "") || fallbackTime);
          pendingUser = "";
        }
      }
      continue;
    }

    if (conversation?.user || conversation?.ai) {
      addPair(conversation.user, conversation.ai, conversation.time);
    }
  }

  if (!entries.length && text.trim()) {
    const chunks = text.trim().split(/\n{2,}/).filter(Boolean).slice(0, 25);
    chunks.forEach(chunk => addPair(`Imported from ${fileName || "another AI"}`, chunk));
  }
  return entries.slice(-CONFIG.MAX_MEMORY);
}

async function restoreSession() {
  try {
    const url = new URL(window.location.href);
    const redirect = getAuthRedirectState(url);

    const supabase = await getSupabase();
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;

    let session = data?.session || null;

    if (!session && redirect.code && !redirect.error) {
      const { data: exchangeData, error: exchangeError } = await supabase.auth.exchangeCodeForSession(redirect.code);
      if (!exchangeError) session = exchangeData?.session || null;
    }

    if (redirect.isAuthRedirect && !redirect.error && !session) {
      session = await waitForAuthSession(supabase);
    }

    state.user = session?.user || null;
    state.loggedIn = Boolean(state.user);

    if (redirect.error) {
      passwordRecoveryPending = false;
      clearAuthRedirectUrl();
      updateAccount();
      openAuthFailure(redirect.error);
      return;
    }

    if (redirect.kind === "recovery") {
      if (!state.loggedIn) {
        clearAuthRedirectUrl();
        openAuthFailure("That password-reset link is invalid or has expired. Request a new one.");
        return;
      }
      passwordRecoveryPending = true;
      updateAccount();
      openPasswordRecoveryDialog();
      return;
    }

    if (redirect.kind === "signup" || redirect.kind === "login") {
      if (!state.loggedIn) {
        clearAuthRedirectUrl();
        openAuthFailure("That email confirmation link is invalid or has expired. Please try again.");
        return;
      }
      if (redirect.kind === "signup") completeEmailSignupConfirmation();
      else completeEmailLoginConfirmation();
      await pullFromCloud();
      updateAccount();
      return;
    }

    if (state.loggedIn) {
      await pullFromCloud();
      updateAccount();
    }
  } catch (error) {
    console.warn("Session restore unavailable:", error);
    if (getAuthRedirectState(new URL(window.location.href)).isAuthRedirect) {
      clearAuthRedirectUrl();
      openAuthFailure("Talkaton couldn’t finish authentication. Check your connection and try again.");
    }
  }
}

function getAuthRedirectState(url) {
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
  const getParam = key => url.searchParams.get(key) || hashParams.get(key) || "";
  const type = getParam("type");
  const kind = url.searchParams.get("recovery") === "1" || type === "recovery"
    ? "recovery"
    : url.searchParams.get("signup-confirmed") === "1" || type === "signup"
      ? "signup"
      : url.searchParams.get("login-confirmed") === "1" || type === "magiclink"
        ? "login"
        : "";
  const error = getParam("error_description") || getParam("error");
  const code = getParam("code");
  const isAuthRedirect = Boolean(kind || error || code || getParam("access_token"));
  return { kind, error, code, isAuthRedirect };
}

function waitForAuthSession(supabase, timeoutMs = 8000) {
  return new Promise(resolve => {
    let settled = false;
    let subscription;
    const finish = session => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      subscription?.unsubscribe();
      resolve(session || null);
    };
    const timeout = setTimeout(() => finish(null), timeoutMs);
    const result = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) finish(session);
    });
    subscription = result.data.subscription;
    if (settled) subscription.unsubscribe();
  });
}

function openAuthFailure(message) {
  setAuthMode("signIn", { focus: false });
  setAuthMessage(message);
  showAuthDialog();
}

function handleRequestedAuthMode() {
  const url = new URL(window.location.href);
  const requestedMode = url.searchParams.get("auth");
  if (requestedMode !== "signup" && requestedMode !== "login") return;
  url.searchParams.delete("auth");
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);

  if (state.loggedIn) {
    openProfile();
    return;
  }

  setAuthMode(requestedMode === "signup" ? "signUp" : "signIn", { focus: false });
  showAuthDialog();
}

function handleRequestedBetaMode() {
  const url = new URL(window.location.href);
  if (url.searchParams.get("beta") !== "1") return;
  betaModeRequested = true;
  url.searchParams.delete("beta");
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
  activateRequestedBetaMode();
}

function activateRequestedBetaMode() {
  if (!betaModeRequested) return;

  if (!state.loggedIn) {
    setAuthMode("signIn", { focus: false });
    setAuthMessage("Log in with the confirmed account that was approved for the Beta Lab.");
    showAuthDialog();
    return;
  }

  betaModeRequested = false;
  if (!betaApproved) {
    toast("This account is not approved for Beta Lab yet. Request access at talkaton.org/beta.", "error");
    return;
  }

  toast("Trusted Beta access is active: all models, higher limits, and model comparison are ready.");
  announce("Trusted Beta access is active");
}

async function refreshBetaAccess() {
  betaApproved = false;
  devAccessApproved = false;
  betaAccessExpiresAt = "";
  devAccessExpiresAt = "";

  if (state.loggedIn && state.user) {
    try {
      const supabase = await getSupabase();
      const { data } = await supabase.auth.getSession();
      const accessToken = data?.session?.access_token;
      if (accessToken) {
        const response = await fetch("/api/beta-status", {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store"
        });
        if (response.ok) {
          const result = await response.json();
          betaApproved = result?.approved === true;
          devAccessApproved = result?.devApproved === true;
          betaAccessExpiresAt = result?.betaExpiresAt || "";
          devAccessExpiresAt = result?.devExpiresAt || "";
        }
      }
    } catch (error) {
      console.warn("Beta access check unavailable:", error);
    }
  }

  syncBetaAccessAvailability();
  syncCompareModelPicker();
  updateMessageCounter();
  updateStats();
  updateAccount();
  renderMessages({ preserveScroll: true });
  return betaApproved;
}

async function refreshBillingAccess({ forceRefresh = false } = {}) {
  subscriptionPlan = "free";
  billingStatus = {
    plan: state.loggedIn ? "free" : "guest",
    paid: false,
    billingConfigured: false,
    testMode: false,
    subscriptionStatus: null
  };

  try {
    const response = await fetch(`/api/billing-status${forceRefresh ? "?refresh=1" : ""}`, {
      headers: await getChatRequestHeaders(),
      cache: "no-store"
    });
    if (!response.ok) throw new Error("Billing status is unavailable.");
    const result = await response.json();
    if (["plus", "pro", "max"].includes(result?.plan)) subscriptionPlan = result.plan;
    billingStatus = {
      plan: result?.plan || (state.loggedIn ? "free" : "guest"),
      paid: result?.paid === true,
      billingConfigured: result?.billingConfigured === true,
      testMode: result?.testMode === true,
      subscriptionStatus: result?.subscriptionStatus || null
    };
  } catch (error) {
    console.warn("Billing status check unavailable:", error);
  }

  if (!canUseModel(state.model)) {
    state.model = defaultState.model;
    DOM.modelSelect.value = state.model;
    persist();
  }
  syncCompareModelPicker();
  updatePlansDialog();
  updateMessageCounter();
  updateStats();
  updateAccount();
  return billingStatus;
}

function hasSuccessfulBillingReturn() {
  return new URL(window.location.href).searchParams.get("billing") === "success";
}

function handleBillingReturn() {
  const url = new URL(window.location.href);
  const result = url.searchParams.get("billing");
  if (!result) return;

  url.searchParams.delete("billing");
  url.searchParams.delete("session_id");
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);

  if (result === "success") {
    toast(`Talkaton ${capitalize(subscriptionPlan)} is active. Your new limits are ready.`);
    openPlans();
  } else if (result === "cancelled") {
    toast("Checkout canceled. Your current plan did not change.");
  } else if (result === "returned") {
    refreshBillingAccess({ forceRefresh: true });
  }
}

function openPlans() {
  window.location.assign("https://subscriptions.talkaton.org");
}

function updatePlansDialog() {
  if (!DOM.plansDialogStatus) return;
  const tier = getUserTier();
  const unlimited = isUnlimitedTier(tier) || devAccessApproved;
  DOM.plansDialogStatus.textContent = unlimited
    ? `${getTierLabel(tier)} includes unlimited Talkaton access.`
    : `${getTierLabel(tier)} is active.`;
  DOM.billingTestMode.hidden = !billingStatus.testMode;
  DOM.manageBillingBtn.hidden = !billingStatus.paid;
  DOM.profileBillingBtn.hidden = !billingStatus.paid;

  DOM.plansDialog.querySelectorAll("[data-subscribe-plan]").forEach(button => {
    const plan = button.dataset.subscribePlan;
    const isCurrent = tier === plan;
    const mustManage = billingStatus.paid && !isCurrent;
    button.disabled = isCurrent || unlimited || mustManage || !billingStatus.billingConfigured;
    button.textContent = isCurrent
      ? "Current plan"
      : unlimited
        ? "Included"
        : mustManage
          ? "Use Manage subscription"
          : billingStatus.billingConfigured
            ? `Choose ${capitalize(plan)}`
            : "Checkout setup pending";
    button.closest("[data-plan-card]")?.classList.toggle("currentPlan", isCurrent);
  });
}

async function startPlanCheckout(plan, button) {
  DOM.plansError.textContent = "";
  if (!state.loggedIn) {
    closeDialog(DOM.plansDialog);
    setAuthMode("signIn", { focus: false });
    setAuthMessage("Log in to a confirmed account, then choose your Talkaton plan.", "success");
    showAuthDialog();
    return;
  }

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Opening Stripe…";
  try {
    const response = await fetch("/api/billing-checkout", {
      method: "POST",
      headers: await getChatRequestHeaders(),
      body: JSON.stringify({ plan })
    });
    const result = await response.json();
    if (!response.ok || !result?.url) throw new Error(result?.error || "Checkout could not start.");
    window.location.assign(result.url);
  } catch (error) {
    DOM.plansError.textContent = error.message || "Checkout could not start.";
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function openBillingPortal() {
  DOM.plansError.textContent = "";
  try {
    const response = await fetch("/api/billing-portal", {
      method: "POST",
      headers: await getChatRequestHeaders(),
      body: "{}"
    });
    const result = await response.json();
    if (!response.ok || !result?.url) throw new Error(result?.error || "Billing could not open.");
    window.location.assign(result.url);
  } catch (error) {
    if (DOM.plansDialog.open) DOM.plansError.textContent = error.message || "Billing could not open.";
    else toast(error.message || "Billing could not open.", "error");
  }
}

function capitalize(value) {
  const text = String(value || "");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function syncBetaAccessAvailability() {
  if (!canUseModel(state.model)) {
    state.model = defaultState.model;
    DOM.modelSelect.value = state.model;
    persist();
  }
  syncCompareModelPicker();
}

async function getChatRequestHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (!state.loggedIn) return headers;

  try {
    const supabase = await getSupabase();
    const { data } = await supabase.auth.getSession();
    const accessToken = data?.session?.access_token;
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  } catch (error) {
    console.warn("Could not attach the account session to this request:", error);
  }

  return headers;
}

async function handleAuth() {
  if (passwordRecoveryPending) {
    openPasswordRecoveryDialog();
    return;
  }

  if (state.loggedIn) {
    openProfile();
    return;
  }
  setAuthMode("signIn", { focus: false });
  setAuthMessage("");
  showAuthDialog();
}

function showAuthDialog({ focus = true } = {}) {
  if (!DOM.authDialog.open) DOM.authDialog.showModal();
  requestAnimationFrame(() => {
    updateGoogleAuthAvailability();
    if (focus) DOM.authEmail.focus();
  });
}

function resetClosedAuthDialog() {
  DOM.authGoogleBtn.setAttribute("aria-busy", "false");
  DOM.authGoogleBtn.disabled = !googleAuthEnabled;
  setAuthMessage("");
}

async function submitAuth(event) {
  event.preventDefault();
  setAuthMessage("");
  const modeAtSubmit = authMode;
  const isSignUp = modeAtSubmit === "signUp";
  const email = DOM.authEmail.value.trim();
  const password = DOM.authPassword.value;

  if (isSignUp) {
    if (password.length < 8) {
      setAuthMessage("Use at least 8 characters for your password.");
      DOM.authPassword.focus();
      return;
    }
    if (password !== DOM.authConfirmPassword.value) {
      setAuthMessage("Those passwords don’t match.");
      DOM.authConfirmPassword.focus();
      return;
    }
  }

  const submit = DOM.authSubmitBtn;
  submit.disabled = true;
  DOM.signInTab.disabled = true;
  DOM.signUpTab.disabled = true;
  DOM.authGoogleBtn.setAttribute("aria-busy", "true");
  DOM.forgotPasswordBtn.disabled = true;
  DOM.resendConfirmationBtn.disabled = true;
  submit.textContent = isSignUp ? "Creating account…" : "Signing in…";

  try {
    const supabase = await getSupabase();

    if (isSignUp) {
      const redirectUrl = createAuthEmailRedirect("signup");
      signupConfirmationPending = true;
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: redirectUrl.toString()
        }
      });
      if (error) throw error;

      // Supabase sends the confirmation from signUp when email confirmation is
      // enabled. If it is disabled, require an emailed OTP before keeping a
      // local session so signup still follows the same confirmation flow.
      if (data.session?.user) {
        const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
        if (signOutError) throw signOutError;
        const { error: confirmationError } = await supabase.auth.signInWithOtp({
          email,
          options: {
            shouldCreateUser: false,
            emailRedirectTo: redirectUrl.toString()
          }
        });
        if (confirmationError) throw confirmationError;
      }

      state.user = null;
      state.loggedIn = false;
      DOM.authPassword.value = "";
      DOM.authConfirmPassword.value = "";
      updateAccount();
      setAuthMessage(
        "Account created. We sent you a confirmation email—click the link to finish signing up.",
        "success"
      );
      showResendConfirmation = true;
      updateResendConfirmationButton();
      announce("Account created. Confirmation email sent");
      return;
    }

    loginConfirmationPending = true;
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });
    if (error) throw error;

    const user = data?.user || data?.session?.user || null;
    if (!user) throw new Error("Login succeeded without a user session. Please try again.");
    const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
    if (signOutError) throw signOutError;
    const redirectUrl = createAuthEmailRedirect("login");
    const { error: emailError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: redirectUrl.toString()
      }
    });
    if (emailError) throw emailError;

    state.user = null;
    state.loggedIn = false;
    DOM.authPassword.value = "";
    updateAccount();
    setAuthMessage(
      "Password accepted. We sent a one-time confirmation link—click it to finish logging in.",
      "success"
    );
    showResendConfirmation = true;
    updateResendConfirmationButton();
    announce("Password accepted. Login confirmation email sent.");
  } catch (error) {
    const message = String(error?.message || "");
    if (!isSignUp && isUnconfirmedEmailError(error)) {
      showResendConfirmation = true;
      await resendConfirmationEmail({ emailOverride: email, automatic: true });
    } else {
      setAuthMessage(message || (isSignUp ? "Sign up failed." : "Log in failed."));
    }
  } finally {
    signupConfirmationPending = false;
    loginConfirmationPending = false;
    submit.disabled = false;
    DOM.signInTab.disabled = false;
    DOM.signUpTab.disabled = false;
    DOM.authGoogleBtn.setAttribute("aria-busy", "false");
    DOM.forgotPasswordBtn.disabled = false;
    updateResendConfirmationButton();
    submit.textContent = authMode === "signUp" ? "Create account" : "Sign in";
  }
}

async function startGoogleRedirectSignIn() {
  setAuthMessage("");
  DOM.authGoogleBtn.setAttribute("aria-busy", "true");
  DOM.authGoogleBtn.disabled = true;
  try {
    const supabase = await getSupabase();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: "https://talkaton.org/chat/",
        skipBrowserRedirect: true
      }
    });
    if (error) throw error;
    if (!data?.url) throw new Error("Google sign-in did not return a secure redirect.");
    window.location.assign(data.url);
  } catch (error) {
    setAuthMessage(error?.message || "Google sign-in is unavailable right now. Use email and password instead.");
    DOM.authGoogleBtn.setAttribute("aria-busy", "false");
    DOM.authGoogleBtn.disabled = false;
  }
}

function openProfile() {
  if (!state.loggedIn || !state.user) return;
  const username = getProfileName(state.user);
  pendingProfileAvatar = getProfileAvatar(state.user);
  DOM.profileUsername.value = username;
  DOM.profileEmail.value = state.user.email || "";
  DOM.profileError.textContent = "";
  renderProfileAvatar(username);

  const messageCount = state.chats.reduce((total, chat) => total + chat.messages.length, 0);
  const remaining = getRemainingMessages();
  const limit = getDailyLimit();
  const limitText = remaining === "∞" ? "∞" : `${remaining} / ${limit}`;
  const tier = getUserTier();
  const tierLabel = getTierLabel(tier);
  const tierDescription = getTierDescription(tier);
  const betaExpiry = formatAccessExpiry(betaAccessExpiresAt);
  const devExpiry = formatAccessExpiry(devAccessExpiresAt);
  const imagesLeft = getRemainingImages();
  const searchesLeft = getRemainingSearches();
  DOM.profileDashboard.innerHTML = `
    <article><span>Your plan</span><strong>${tierLabel}</strong><small>${tierDescription}</small></article>
    <article><span>Trusted Beta</span><strong>${betaApproved ? "Active" : "Not approved"}</strong><small>${betaApproved ? `Higher limits; Free accounts use Ollama${betaExpiry ? ` · ${betaExpiry}` : ""}` : "Trusted members only · request access from the Beta page"}</small></article>
    <article><span>Dev Access</span><strong>${devAccessApproved || isUnlimitedTier(tier) ? "Unlimited" : "Not approved"}</strong><small>${devAccessApproved ? `Infinite messages, images, and web searches${devExpiry ? ` · ${devExpiry}` : ""}` : isUnlimitedTier(tier) ? "Included with your staff role" : "Request it from the Beta page after logging in"}</small></article>
    <article><span>Messages left today</span><strong>${limitText}</strong><small>${tierLabel}</small></article>
    <article><span>Images left today</span><strong>${imagesLeft}</strong><small>${getImageDailyLimit() || "Free account required"}</small></article>
    <article><span>Web searches left</span><strong>${searchesLeft}</strong><small>${getSearchDailyLimit()} per day</small></article>
    <article><span>Conversations</span><strong>${state.chats.length}</strong><small>${messageCount} messages in total</small></article>
    <article><span>Saved memories</span><strong>${state.memory.length}</strong><small>${state.settings.memory ? "Memory is on" : "Memory is paused"}</small></article>
    <article><span>Sign-in method</span><strong>${getAccountProviderLabel(state.user)}</strong><small>${state.user.email_confirmed_at ? "Email verified" : "Verification required"}</small></article>
    <article><span>Cloud sync</span><strong>${navigator.onLine ? "Connected" : "Offline"}</strong><small>${navigator.onLine ? "Chats, images, memory, and settings" : "Changes sync after reconnecting"}</small></article>`;

  DOM.profileBillingBtn.hidden = !billingStatus.paid;
  DOM.profileAccountStatus.textContent = "";

  if (!DOM.profileDialog.open) DOM.profileDialog.showModal();
  requestAnimationFrame(() => DOM.profileUsername.focus());
}

function getAccountProviderLabel(user) {
  const provider = String(user?.app_metadata?.provider || user?.identities?.[0]?.provider || "email");
  return provider === "google" ? "Google" : "Email and password";
}

async function sendProfilePasswordReset() {
  if (!state.user?.email) return;
  DOM.profileAccountStatus.textContent = "Sending password reset email…";
  DOM.profilePasswordResetBtn.disabled = true;
  try {
    const supabase = await getSupabase();
    const { error } = await supabase.auth.resetPasswordForEmail(state.user.email, {
      redirectTo: "https://talkaton.org/chat/?password-reset=1"
    });
    if (error) throw error;
    DOM.profileAccountStatus.textContent = "Password reset email sent. Check your inbox and spam folder.";
  } catch (error) {
    DOM.profileAccountStatus.textContent = error.message || "Couldn’t send the password reset email.";
  } finally {
    DOM.profilePasswordResetBtn.disabled = false;
  }
}

async function syncAccountNow() {
  DOM.profileAccountStatus.textContent = "Syncing your account…";
  DOM.profileSyncBtn.disabled = true;
  try {
    cloudDirty = true;
    await syncToCloud();
    if (cloudDirty) throw new Error("Cloud sync will retry automatically.");
    DOM.profileAccountStatus.textContent = "Cloud sync is up to date.";
  } catch (error) {
    DOM.profileAccountStatus.textContent = error.message || "Cloud sync is temporarily unavailable.";
  } finally {
    DOM.profileSyncBtn.disabled = false;
  }
}

function downloadAccountData() {
  const accountData = {
    exportedAt: new Date().toISOString(),
    account: {
      email: state.user?.email || "",
      username: getProfileName(state.user),
      provider: getAccountProviderLabel(state.user)
    },
    ...serializeForCloud(state)
  };
  const blob = new Blob([JSON.stringify(accountData, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `talkaton-account-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
  DOM.profileAccountStatus.textContent = "Your Talkaton account data was downloaded.";
}

function formatAccessExpiry(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `until ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date)}`;
}

async function saveProfile(event) {
  event.preventDefault();
  const username = DOM.profileUsername.value.trim();
  DOM.profileError.textContent = "";

  if (username.length < 2) {
    DOM.profileError.textContent = "Use at least 2 characters for your username.";
    DOM.profileUsername.focus();
    return;
  }

  setProfileBusy(true);
  try {
    const supabase = await getSupabase();
    const { data, error } = await supabase.auth.updateUser({
      data: {
        username,
        name: username,
        avatar_url: pendingProfileAvatar || null
      }
    });
    if (error) throw error;
    state.user = data.user || state.user;
    state.loggedIn = Boolean(state.user);
    updateAccount();
    closeDialog(DOM.profileDialog);
    toast("Profile updated");
    announce("Profile updated successfully");
  } catch (error) {
    DOM.profileError.textContent = error.message || "Couldn’t update your profile.";
  } finally {
    setProfileBusy(false);
  }
}

async function handleProfileImageSelection(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  DOM.profileError.textContent = "";
  DOM.profileUploadBtn.disabled = true;
  DOM.profileUploadBtn.textContent = "Preparing…";

  try {
    pendingProfileAvatar = await createProfileAvatar(file);
    renderProfileAvatar(DOM.profileUsername.value.trim() || getProfileName(state.user));
    announce("Profile picture ready to save");
  } catch (error) {
    DOM.profileError.textContent = error.message || "Couldn’t prepare that profile picture.";
  } finally {
    DOM.profileUploadBtn.disabled = false;
    DOM.profileUploadBtn.textContent = "Choose photo";
  }
}

function removeProfileImage() {
  pendingProfileAvatar = "";
  renderProfileAvatar(DOM.profileUsername.value.trim() || getProfileName(state.user));
  announce("Profile picture removed. Save your profile to apply the change.");
}

async function logoutFromProfile() {
  setProfileBusy(true, "logout");
  try {
    const supabase = await getSupabase();
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) throw error;
    state.user = null;
    state.loggedIn = false;
    pendingProfileAvatar = "";
    closeDialog(DOM.profileDialog);
    resetLocalDataAfterLogout();
    toast("Logged out");
    announce("Logged out successfully");
  } catch (error) {
    DOM.profileError.textContent = error.message || "Couldn’t log out. Check your connection.";
  } finally {
    setProfileBusy(false);
  }
}

function resetLocalDataAfterLogout() {
  if (state.loading) stopGeneration();
  if (cloudSyncTimer) clearTimeout(cloudSyncTimer);
  if (cloudRetryTimer) clearTimeout(cloudRetryTimer);
  cloudSyncTimer = null;
  cloudSyncDueAt = 0;
  cloudRetryTimer = null;
  cloudDirty = false;
  lastCloudUpdateSeen = "";
  lastMessageCheckpointAt = 0;
  localMutationVersion = 0;
  betaApproved = false;
  devAccessApproved = false;
  betaAccessExpiresAt = "";
  devAccessExpiresAt = "";

  const preservedSettings = { ...defaultState.settings, ...(state.settings || {}) };
  const preservedDailyUsage = {
    dailyMessageCount: state.dailyMessageCount,
    dailyMessageDate: state.dailyMessageDate,
    dailyImageCount: state.dailyImageCount,
    dailyImageDate: state.dailyImageDate,
    dailySearchCount: state.dailySearchCount,
    dailySearchDate: state.dailySearchDate
  };

  state = {
    ...defaultState,
    ...preservedDailyUsage,
    settings: preservedSettings,
    chats: [],
    memory: [],
    pendingAttachments: []
  };
  normalizeState();
  saveStoredState(state);
  applyPreferences();
  renderChats();
  renderMessages();
  renderAttachmentTray();
  updateStats();
  updateComposerState();
  syncBetaAccessAvailability();
  updateAccount();
}

function setProfileBusy(busy, action = "save") {
  DOM.profileSaveBtn.disabled = busy;
  DOM.profileLogoutBtn.disabled = busy;
  DOM.profileUploadBtn.disabled = busy;
  DOM.profileRemoveBtn.disabled = busy || !pendingProfileAvatar;
  DOM.profileUsername.disabled = busy;
  DOM.profileSaveBtn.textContent = busy && action === "save" ? "Saving…" : "Save profile";
  DOM.profileLogoutBtn.textContent = busy && action === "logout" ? "Logging out…" : "Log out";
}

function renderProfileAvatar(username) {
  const initial = String(username || "Account").charAt(0).toUpperCase();
  DOM.profileAvatarInitial.textContent = initial;
  DOM.profileAvatarImage.hidden = !pendingProfileAvatar;
  DOM.profileAvatarImage.src = pendingProfileAvatar || "";
  DOM.profileRemoveBtn.disabled = !pendingProfileAvatar;
}

function getProfileName(user) {
  return String(
    user?.user_metadata?.username
    || user?.user_metadata?.name
    || user?.email?.split("@")[0]
    || "Account"
  ).slice(0, 30);
}

function getProfileAvatar(user) {
  const avatar = user?.user_metadata?.avatar_url;
  if (typeof avatar !== "string") return "";
  if (avatar.startsWith("data:image/") || avatar.startsWith("https://")) return avatar;
  return "";
}

async function createProfileAvatar(file) {
  const acceptedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!acceptedTypes.has(file.type)) throw new Error("Choose a JPG, PNG, or WebP image.");
  if (file.size > 5 * 1024 * 1024) throw new Error("Profile pictures must be 5 MB or smaller.");

  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const preview = new Image();
      preview.onload = () => resolve(preview);
      preview.onerror = () => reject(new Error("That image could not be opened."));
      preview.src = sourceUrl;
    });
    const size = 96;
    const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
    const sourceX = Math.max(0, (image.naturalWidth - sourceSize) / 2);
    const sourceY = Math.max(0, (image.naturalHeight - sourceSize) / 2);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size, size);
    context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, size, size);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.76);
    if (dataUrl.length > 24_000) throw new Error("That image is still too large after compression.");
    return dataUrl;
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

function createAuthEmailRedirect(kind) {
  const redirect = new URL("https://talkaton.org/chat/");
  redirect.searchParams.set(kind === "login" ? "login-confirmed" : "signup-confirmed", "1");
  return redirect;
}

function setAuthMode(mode, { focus = true } = {}) {
  authMode = mode === "signUp" ? "signUp" : "signIn";
  const isSignUp = authMode === "signUp";

  DOM.signInTab.setAttribute("aria-pressed", String(!isSignUp));
  DOM.signUpTab.setAttribute("aria-pressed", String(isSignUp));
  DOM.authEyebrow.textContent = isSignUp ? "Join Talkaton" : "Welcome back";
  DOM.authTitle.textContent = isSignUp ? "Create your Talkaton account" : "Sign in to continue";
  DOM.authIntro.textContent = isSignUp
    ? "Create your account. We’ll email you a confirmation link."
    : "Enter your email and password. We’ll send a secure confirmation link.";
  DOM.authConfirmPasswordField.hidden = !isSignUp;
  DOM.authConfirmPassword.disabled = !isSignUp;
  DOM.authConfirmPassword.required = isSignUp;
  DOM.authPassword.autocomplete = isSignUp ? "new-password" : "current-password";
  DOM.authPassword.minLength = isSignUp ? 8 : 0;
  DOM.forgotPasswordBtn.hidden = isSignUp;
  DOM.signInTab.hidden = !isSignUp;
  DOM.signUpTab.hidden = isSignUp;
  DOM.authSwitchText.textContent = isSignUp ? "Already have an account?" : "Need an account?";
  showResendConfirmation = false;
  updateGoogleAuthAvailability();
  DOM.authSubmitBtn.textContent = isSignUp ? "Create account" : "Sign in";
  setAuthMessage("");
  updateResendConfirmationButton();

  if (focus) {
    requestAnimationFrame(() => DOM.authEmail.focus());
  }
}

async function refreshAuthProviderAvailability() {
  try {
    const response = await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: CONFIG.SUPABASE_KEY },
      cache: "no-store",
      credentials: "omit"
    });
    if (!response.ok) throw new Error(`Auth settings failed (${response.status})`);
    const settings = await response.json();
    googleAuthEnabled = settings?.external?.google === true;
  } catch (error) {
    googleAuthEnabled = false;
    console.warn("Could not check Google sign-in availability:", error);
  }
  updateGoogleAuthAvailability();
}

function updateGoogleAuthAvailability() {
  DOM.authProviderSection.hidden = !googleAuthEnabled;
  DOM.authGoogleBtn.disabled = !googleAuthEnabled;
  DOM.authGoogleBtn.setAttribute("aria-busy", "false");
}

async function requestPasswordReset() {
  const email = DOM.authEmail.value.trim();
  setAuthMessage("");

  if (!email || !DOM.authEmail.checkValidity()) {
    setAuthMessage("Enter the email address for your Talkaton account.");
    DOM.authEmail.focus();
    DOM.authEmail.reportValidity();
    return;
  }

  const button = DOM.forgotPasswordBtn;
  button.disabled = true;
  button.textContent = "Sending reset email…";

  try {
    const supabase = await getSupabase();
    const redirectUrl = new URL("https://talkaton.org/chat/");
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: redirectUrl.toString()
    });
    if (error) throw error;
    setAuthMessage(
      "If an account exists for that email, a password reset link is on its way.",
      "success"
    );
    announce("Password reset email sent");
  } catch (error) {
    setAuthMessage(error.message || "Couldn’t send the reset email. Please try again.");
  } finally {
    button.disabled = false;
    button.textContent = "Forgot password?";
  }
}

async function resendConfirmationEmail({ emailOverride = "", automatic = false } = {}) {
  const email = String(emailOverride || DOM.authEmail.value).trim();
  setAuthMessage("");

  if (!email || !DOM.authEmail.checkValidity()) {
    setAuthMessage("Enter the email address you used to sign up.");
    DOM.authEmail.focus();
    DOM.authEmail.reportValidity();
    return;
  }

  if (Date.now() < resendConfirmationAvailableAt) {
    updateResendConfirmationButton();
    setAuthMessage("Please wait before requesting another confirmation email.");
    return;
  }

  const button = DOM.resendConfirmationBtn;
  showResendConfirmation = true;
  updateResendConfirmationButton();
  button.disabled = true;
  button.textContent = "Sending confirmation…";

  try {
    const supabase = await getSupabase();
    const redirectUrl = createAuthEmailRedirect("signup");
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: {
        emailRedirectTo: redirectUrl.toString()
      }
    });
    if (error) throw error;

    setAuthMessage(
      automatic
        ? "Your email is not confirmed, so Talkaton requested a new confirmation link. Check Inbox, Spam, and All Mail."
        : "Confirmation email requested. Check Inbox, Spam, and All Mail. Delivery can take a few minutes.",
      "success"
    );
    announce("Confirmation email requested");
    startResendConfirmationCooldown();
  } catch (error) {
    const message = String(error?.message || "");
    if (/rate limit|too many/i.test(message)) {
      setAuthMessage("Too many confirmation emails were requested. Wait about an hour and try again.");
    } else if (/not authorized/i.test(message)) {
      setAuthMessage("Talkaton’s email service is not authorized to deliver to this address yet. Contact support.");
    } else {
      setAuthMessage(message || "Couldn’t resend the confirmation email. Please try again.");
    }
    updateResendConfirmationButton();
  }
}

function isUnconfirmedEmailError(error) {
  if (error?.code === "email_not_confirmed") return true;
  return /email(?: address)? not confirmed|confirm your email|email.*unconfirmed/i.test(
    String(error?.message || error || "")
  );
}

function startResendConfirmationCooldown() {
  resendConfirmationAvailableAt = Date.now() + 60_000;
  clearInterval(resendConfirmationTimer);
  updateResendConfirmationButton();
  resendConfirmationTimer = setInterval(() => {
    updateResendConfirmationButton();
    if (Date.now() >= resendConfirmationAvailableAt) {
      clearInterval(resendConfirmationTimer);
      resendConfirmationTimer = null;
    }
  }, 1_000);
}

function updateResendConfirmationButton() {
  const remaining = Math.max(0, Math.ceil((resendConfirmationAvailableAt - Date.now()) / 1_000));
  DOM.resendConfirmationBtn.hidden = !showResendConfirmation;
  DOM.resendConfirmationBtn.disabled = remaining > 0;
  DOM.resendConfirmationBtn.textContent = remaining > 0
    ? `Resend in ${remaining}s`
    : "Resend confirmation email";
}

function openPasswordRecoveryDialog() {
  if (DOM.authDialog.open) DOM.authDialog.close();
  DOM.passwordResetError.textContent = "";
  if (!DOM.passwordResetDialog.open) DOM.passwordResetDialog.showModal();
  requestAnimationFrame(() => DOM.newPassword.focus());
}

async function submitPasswordReset(event) {
  event.preventDefault();
  DOM.passwordResetError.textContent = "";
  const password = DOM.newPassword.value;
  const confirmation = DOM.confirmPassword.value;

  if (password.length < 8) {
    DOM.passwordResetError.textContent = "Use at least 8 characters.";
    DOM.newPassword.focus();
    return;
  }

  if (password !== confirmation) {
    DOM.passwordResetError.textContent = "Those passwords don’t match.";
    DOM.confirmPassword.focus();
    return;
  }

  const submit = DOM.passwordResetForm.querySelector('[type="submit"]');
  submit.disabled = true;
  submit.textContent = "Updating password…";

  try {
    const supabase = await getSupabase();
    const { data, error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    state.user = data.user || state.user;
    state.loggedIn = true;
    passwordRecoveryPending = false;
    DOM.passwordResetForm.reset();
    closeDialog(DOM.passwordResetDialog);
    clearAuthRedirectUrl();
    updateAccount();
    toast("Password updated. You’re signed in.");
    announce("Password updated successfully");
  } catch (error) {
    DOM.passwordResetError.textContent = error.message || "Couldn’t update your password.";
  } finally {
    submit.disabled = false;
    submit.textContent = "Update password";
  }
}

function setAuthMessage(message, type = "error") {
  DOM.authError.textContent = message;
  DOM.authError.classList.toggle("success", type === "success");
}

function clearAuthRedirectUrl() {
  const url = new URL(window.location.href);
  [
    "recovery",
    "signup-confirmed",
    "login-confirmed",
    "code",
    "token_hash",
    "type",
    "error",
    "error_code",
    "error_description"
  ].forEach(key => url.searchParams.delete(key));
  url.hash = "";
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}`);
}

function completeEmailLoginConfirmation() {
  clearAuthRedirectUrl();
  closeDialog(DOM.authDialog);
  updateAccount();
  toast("Email confirmed. Welcome back.");
  announce("Email confirmed. You are signed in.");
}

function completeEmailSignupConfirmation() {
  clearAuthRedirectUrl();
  closeDialog(DOM.authDialog);
  updateAccount();
  toast("Email confirmed. Your Talkaton account is ready.");
  announce("Email confirmed. Your account is ready.");
}

function updateAccount() {
  const strong = DOM.loginBtn.querySelector("strong");
  const small = DOM.loginBtn.querySelector("small");
  const avatar = DOM.loginBtn.querySelector(".avatar");
  avatar.replaceChildren();
  if (state.loggedIn && state.user) {
    const name = getProfileName(state.user);
    const avatarUrl = getProfileAvatar(state.user);
    const role = getAccountRole(state.user.email);
    const tier = getUserTier();
    strong.textContent = name;
    small.textContent = passwordRecoveryPending
      ? "Set a new password"
      : role
        ? `${role.label} · Unlimited`
        : devAccessApproved
          ? "Dev access · Unlimited"
          : ["plus", "pro", "max"].includes(tier)
            ? `${getTierLabel(tier)} · Manage plan`
          : betaApproved
          ? "Beta approved · View profile"
          : "View profile";
    DOM.loginBtn.setAttribute("aria-label", `Open profile for ${name}`);
    if (avatarUrl) {
      const image = new Image();
      image.src = avatarUrl;
      image.alt = "";
      avatar.append(image);
    } else {
      avatar.textContent = name.charAt(0).toUpperCase();
    }
  } else {
    strong.textContent = "Guest";
    small.textContent = "Log in or sign up";
    avatar.textContent = "G";
    DOM.loginBtn.setAttribute("aria-label", "Log in or sign up");
  }
}

async function updateVisitorCounter() {
  try {
    const supabase = await getSupabase();
    const { data, error } = await supabase.rpc("get_real_member_count");
    if (error) throw error;
    const count = Number(data);
    if (!Number.isFinite(count)) throw new Error("Invalid member count");
    DOM.visitorCount.textContent = count.toLocaleString();
  } catch (error) {
    console.warn("Member counter unavailable:", error);
    DOM.visitorCount.textContent = "—";
    DOM.visitorCount.closest(".visitorCounter").title = "Member counter is temporarily unavailable";
  }
}

function updateStats() {
  DOM.memoryCount.textContent = state.memory.length;
  updateMessageCounter();
}

function updateMessageCounter() {
  resetDailyIfNewDay();
  const remaining = getRemainingMessages();
  if (remaining === "∞") {
    DOM.messageCounter.textContent = "∞";
    DOM.messageCounter.title = "Unlimited messages";
    DOM.messageCounter.classList.remove("atLimit", "nearLimit");
  } else if (PAID_TIERS.has(getUserTier()) && remaining === 0) {
    DOM.messageCounter.textContent = "Ollama";
    DOM.messageCounter.title = "Premium-model allowance used; messages continue with the Ollama backup";
    DOM.messageCounter.classList.remove("atLimit", "nearLimit");
  } else {
    const limit = getDailyLimit();
    DOM.messageCounter.textContent = `${remaining}/${limit}`;
    DOM.messageCounter.title = `${remaining} messages remaining today`;
    DOM.messageCounter.classList.toggle("atLimit", remaining === 0);
    DOM.messageCounter.classList.toggle("nearLimit", remaining > 0 && remaining <= 5);
  }
}

function rememberExchange(user, assistant) {
  if (!state.settings.memory || !assistant || getChat()?.incognito) return;
  state.memory.push({ user, ai: assistant, time: Date.now() });
  if (state.memory.length > CONFIG.MAX_MEMORY) state.memory.shift();
}

function updateComposerState() {
  const hasText = Boolean(DOM.input.value.trim());
  const hasAttachments = state.pendingAttachments.length > 0;
  const uploadsReady = state.pendingAttachments.every(item => item.status === "ready");
  DOM.sendBtn.disabled = state.loading ? false : ((!hasText && !hasAttachments) || !uploadsReady);
  DOM.sendBtn.classList.toggle("isStopping", state.loading);
  DOM.sendBtn.setAttribute("aria-label", state.loading ? "Stop generation" : "Send message");
  DOM.input.disabled = false;
  DOM.modelSelect.disabled = state.loading;
  DOM.compareBtn.disabled = state.loading;
  DOM.compareModelSelect.disabled = state.loading;
  DOM.charCount.textContent = DOM.input.value.length > 2000 ? DOM.input.value.length.toLocaleString() : "";
}

function handleComposerKeydown(event) {
  if (isMessageSubmitKey(event)) {
    event.preventDefault();
    if (typeof DOM.composer.requestSubmit === "function") {
      DOM.composer.requestSubmit();
    } else {
      state.loading ? stopGeneration() : sendMessage();
    }
  }
  if (event.key === "Escape" && state.loading) stopGeneration();
}

function handleComposerSubmit(event) {
  event.preventDefault();
  if (state.loading) {
    stopGeneration();
    return;
  }
  compareMode ? sendModelComparison() : sendMessage();
}

function handleGlobalShortcut(event) {
  if (event.key === "Escape" && DOM.toolsPopover.hasAttribute("data-fallback-open")) {
    hideToolsPopover();
    return;
  }

  const command = event.metaKey || event.ctrlKey;
  if (command && event.key.toLowerCase() === "k") {
    event.preventDefault();
    createChat();
  }
  if (command && event.key === "/") {
    event.preventDefault();
    openMobileSidebar();
    DOM.chatSearchInput.focus();
  }
  if (command && event.key === ",") {
    event.preventDefault();
    openSettings();
    return;
  }

  const target = event.target;
  const isEditable = target instanceof HTMLElement
    && Boolean(target.closest("input, textarea, select, button, [contenteditable='true']"));
  const isPrintable = event.key.length === 1
    && !event.metaKey
    && !event.ctrlKey
    && !event.altKey;

  if (
    DOM.app.classList.contains("isEmpty")
    && isPrintable
    && !isEditable
    && !document.querySelector("dialog[open]")
  ) {
    event.preventDefault();
    DOM.input.focus({ preventScroll: true });
    const start = DOM.input.selectionStart ?? DOM.input.value.length;
    const end = DOM.input.selectionEnd ?? start;
    DOM.input.setRangeText(event.key, start, end, "end");
    DOM.input.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

function resizeTextarea() {
  DOM.input.style.height = "0";
  DOM.input.style.height = `${Math.min(DOM.input.scrollHeight, 192)}px`;
}

function scheduleTextareaResize() {
  if (textareaResizeFrame) return;
  textareaResizeFrame = requestAnimationFrame(() => {
    textareaResizeFrame = null;
    resizeTextarea();
  });
}

function handleChatScroll() {
  const scrollTop = Math.max(0, DOM.chatViewport.scrollTop);
  const distance = Math.max(0, DOM.chatViewport.scrollHeight - scrollTop - DOM.chatViewport.clientHeight);
  const movedUp = scrollTop < lastChatScrollTop - 1;
  const reachedBottom = distance <= 8;

  if (movedUp) {
    userPausedScroll = true;
  } else if (reachedBottom) {
    userPausedScroll = false;
  } else if (distance > 120) {
    userPausedScroll = true;
  }

  lastChatScrollTop = scrollTop;
  DOM.scrollBottomBtn.hidden = distance < 240;
}

function handleChatWheel(event) {
  if (event.deltaY < 0) userPausedScroll = true;
}

function handleChatTouchStart(event) {
  touchScrollY = event.touches[0]?.clientY ?? null;
}

function handleChatTouchMove(event) {
  const nextY = event.touches[0]?.clientY;
  if (touchScrollY !== null && typeof nextY === "number" && nextY > touchScrollY + 1) {
    userPausedScroll = true;
  }
  touchScrollY = typeof nextY === "number" ? nextY : touchScrollY;
}

function clearChatTouch() {
  touchScrollY = null;
}

function scrollBottom({ behavior = "auto", force = false } = {}) {
  if (!force && userPausedScroll) return;
  DOM.chatViewport.scrollTo({ top: DOM.chatViewport.scrollHeight, behavior });
  if (force) userPausedScroll = false;
}

function updateNetworkStatus() {
  const online = navigator.onLine;
  DOM.offlineBanner.hidden = online;
  DOM.connectionStatus.classList.toggle("offline", !online);
  DOM.connectionStatus.lastChild.textContent = online ? "Online" : "Offline";
  updateComposerState();
}

function handleNetworkReconnect() {
  updateNetworkStatus();
  if (cloudRetryTimer) {
    clearTimeout(cloudRetryTimer);
    cloudRetryTimer = null;
  }
  if (cloudDirty) scheduleCloudSync(0);
  else pollCloudChanges();
}

function updateViewportHeight() {
  const height = window.visualViewport?.height || window.innerHeight;
  document.documentElement.style.setProperty("--app-height", `${height}px`);
}

function toggleSidebarCollapse() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  DOM.app.classList.toggle("sidebarCollapsed", state.sidebarCollapsed);
  DOM.sidebarCollapseBtn.textContent = state.sidebarCollapsed ? "›" : "‹";
  DOM.sidebarCollapseBtn.setAttribute("aria-label", state.sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar");
  persist();
}

function openMobileSidebar() {
  DOM.sidebar.classList.add("mobileOpen");
  DOM.sidebarBackdrop.hidden = false;
  requestAnimationFrame(() => DOM.sidebarBackdrop.classList.add("visible"));
}

function closeMobileSidebar() {
  DOM.sidebar.classList.remove("mobileOpen");
  DOM.sidebarBackdrop.classList.remove("visible");
  setTimeout(() => {
    if (!DOM.sidebar.classList.contains("mobileOpen")) DOM.sidebarBackdrop.hidden = true;
  }, 180);
}

function setupChatPagination() {
  if (!("IntersectionObserver" in window)) return;
  const observer = new IntersectionObserver(entries => {
    if (!entries[0].isIntersecting || DOM.chatListSentinel.hidden) return;
    visibleChatCount += CONFIG.CHAT_BATCH_SIZE;
    renderChats();
  }, { root: DOM.chatList, rootMargin: "120px" });
  observer.observe(DOM.chatListSentinel);
}

function askForText({
  eyebrow,
  title,
  label,
  value = "",
  placeholder = "",
  submitLabel = "Continue"
}) {
  if (activePromptResolver) {
    activePromptResolver(null);
    activePromptResolver = null;
  }

  DOM.promptEyebrow.textContent = eyebrow;
  DOM.promptTitle.textContent = title;

  const labelTextNode = [...DOM.promptLabel.childNodes]
    .find(node => node.nodeType === Node.TEXT_NODE);

  if (labelTextNode) labelTextNode.textContent = label;
  else DOM.promptLabel.prepend(document.createTextNode(label));

  DOM.promptInput.value = value;
  DOM.promptInput.placeholder = placeholder;
  DOM.promptSubmitBtn.textContent = submitLabel;

  if (!DOM.promptDialog.open) DOM.promptDialog.showModal();

  requestAnimationFrame(() => {
    DOM.promptInput.focus();
    DOM.promptInput.select();
  });

  return new Promise(resolve => {
    activePromptResolver = resolve;
  });
}

function submitPromptDialog(event) {
  event.preventDefault();

  const value = DOM.promptInput.value.trim();
  if (!value) {
    DOM.promptInput.focus();
    return;
  }

  const resolve = activePromptResolver;
  activePromptResolver = null;
  DOM.promptDialog.close();
  resolve?.(value);
}

function cancelPromptDialog() {
  const resolve = activePromptResolver;
  activePromptResolver = null;

  if (DOM.promptDialog.open) DOM.promptDialog.close();
  resolve?.(null);
}

let activeConfirmResolver = null;

function askForConfirmation({
  eyebrow = "Confirm",
  title = "Are you sure?",
  message = "This action cannot be undone.",
  submitLabel = "Yes",
  cancelLabel = "No"
}) {
  if (activeConfirmResolver) finishConfirmation(false);

  DOM.confirmEyebrow.textContent = eyebrow;
  DOM.confirmTitle.textContent = title;
  DOM.confirmMessage.textContent = message;
  DOM.confirmSubmitBtn.textContent = submitLabel;
  DOM.confirmCancelBtn.textContent = cancelLabel;

  if (!DOM.confirmDialog.open) DOM.confirmDialog.showModal();

  return new Promise(resolve => {
    activeConfirmResolver = resolve;
  });
}

function finishConfirmation(result) {
  const resolve = activeConfirmResolver;
  activeConfirmResolver = null;

  closeDialog(DOM.confirmDialog);
  resolve?.(result);
}

function supportsNativePopover() {
  return typeof DOM.toolsPopover.showPopover === "function"
    && typeof DOM.toolsPopover.hidePopover === "function";
}

function updateToolsButtonState() {
  const expanded = supportsNativePopover()
    ? DOM.toolsPopover.matches(":popover-open")
    : DOM.toolsPopover.hasAttribute("data-fallback-open");
  DOM.toolsBtn.setAttribute("aria-expanded", String(expanded));
}

function toggleToolsPopover() {
  if (!supportsNativePopover()) {
    toggleToolsFallback();
    return;
  }

  if (DOM.toolsPopover.matches(":popover-open")) {
    DOM.toolsPopover.hidePopover();
  } else {
    DOM.toolsPopover.showPopover();
  }
}

function hideToolsPopover() {
  if (supportsNativePopover() && DOM.toolsPopover.matches(":popover-open")) {
    DOM.toolsPopover.hidePopover();
  }
  DOM.toolsPopover.removeAttribute("data-fallback-open");
  updateToolsButtonState();
}

function toggleToolsFallback() {
  if (DOM.toolsPopover.hasAttribute("data-fallback-open")) {
    DOM.toolsPopover.removeAttribute("data-fallback-open");
  } else {
    DOM.toolsPopover.setAttribute("data-fallback-open", "");
  }
  updateToolsButtonState();
}

function handleDocumentClick(event) {
  if (
    DOM.toolsPopover.hasAttribute("data-fallback-open")
    && !DOM.toolsPopover.contains(event.target)
    && !DOM.toolsBtn.contains(event.target)
  ) {
    hideToolsPopover();
  }
}

function addRipple(event) {
  const button = event.target.closest(".ripple");
  if (!button || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const bounds = button.getBoundingClientRect();
  const ripple = element("span", "rippleEffect");
  ripple.style.left = `${event.clientX - bounds.left}px`;
  ripple.style.top = `${event.clientY - bounds.top}px`;
  button.append(ripple);
  setTimeout(() => ripple.remove(), 550);
}

function toast(message, type = "success") {
  const item = element("div", `toast ${type}`);
  item.textContent = message;
  DOM.toastRegion.append(item);
  requestAnimationFrame(() => item.classList.add("visible"));
  setTimeout(() => {
    item.classList.remove("visible");
    setTimeout(() => item.remove(), 200);
  }, 2800);
}

function announce(message) {
  DOM.announcer.textContent = "";
  requestAnimationFrame(() => { DOM.announcer.textContent = message; });
}

async function copyText(text) {
  const value = String(text || "");
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fall through for browsers that expose Clipboard API but deny access.
    }
  }

  const activeElement = document.activeElement;
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  textarea.setAttribute("readonly", "");
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  activeElement?.focus?.({ preventScroll: true });
  if (!copied) throw new Error("Clipboard copy failed");
}

function checkpointMessages({ immediate = false } = {}) {
  const now = Date.now();
  if (!immediate && now - lastMessageCheckpointAt < MESSAGE_CHECKPOINT_INTERVAL) return;
  lastMessageCheckpointAt = now;
  localMutationVersion += 1;
  saveStoredState(state);
  scheduleCloudSync(immediate ? 0 : 500);
}

function scheduleCloudSync(delay = CLOUD_SYNC_DELAY) {
  if (!state.loggedIn || !state.user) return;
  cloudDirty = true;
  if (cloudSyncInFlight || cloudRetryTimer) return;

  const dueAt = Date.now() + Math.max(0, delay);
  if (cloudSyncTimer && cloudSyncDueAt <= dueAt) return;
  if (cloudSyncTimer) clearTimeout(cloudSyncTimer);
  cloudSyncDueAt = dueAt;
  cloudSyncTimer = setTimeout(() => {
    cloudSyncTimer = null;
    cloudSyncDueAt = 0;
    syncToCloud();
  }, Math.max(0, delay));
}

async function syncToCloud() {
  if (!state.loggedIn || !state.user) return;
  if (cloudSyncInFlight) {
    cloudDirty = true;
    return;
  }
  if (!cloudDirty || cloudRetryTimer) return;
  cloudDirty = false;
  cloudSyncInFlight = true;
  try {
    const supabase = await getSupabase();
    const cloudData = serializeForCloud(state);
    await saveCloudData(supabase, state.user.id, cloudData);
    lastCloudUpdateSeen = cloudData.updated_at || lastCloudUpdateSeen;
  } catch (error) {
    cloudDirty = true;
    console.warn("Cloud sync failed:", error);
    cloudRetryTimer = setTimeout(() => {
      cloudRetryTimer = null;
      scheduleCloudSync(0);
    }, 30_000);
  } finally {
    cloudSyncInFlight = false;
    if (cloudDirty && !cloudRetryTimer) scheduleCloudSync(250);
  }
}

async function pullFromCloud({ background = false } = {}) {
  if (!state.loggedIn || !state.user || !navigator.onLine) return;
  if (cloudPullInFlight) return;
  if (background && (
    document.hidden
    || state.loading
    || cloudDirty
    || cloudSyncInFlight
    || cloudSyncTimer
    || persistTimer
    || persistIdleHandle
  )) return;

  const pullMutationVersion = localMutationVersion;
  cloudPullInFlight = true;
  try {
    const supabase = await getSupabase();
    const cloudData = await loadCloudData(supabase, state.user.id);
    if (!cloudData) return;
    if (
      localMutationVersion !== pullMutationVersion
      || (background && (
        state.loading
        || cloudDirty
        || cloudSyncInFlight
        || cloudSyncTimer
        || persistTimer
        || persistIdleHandle
      ))
    ) return;

    const cloudUpdate = String(cloudData.updated_at || "");
    if (background && cloudUpdate && cloudUpdate === lastCloudUpdateSeen) return;
    mergeCloudData(cloudData, { authoritative: background });
    lastCloudUpdateSeen = cloudUpdate;
  } catch (error) {
    console.warn("Cloud pull failed:", error);
  } finally {
    cloudPullInFlight = false;
  }
}

function pollCloudChanges() {
  pullFromCloud({ background: true });
}

function mergeCloudData(cloudData, { authoritative = false } = {}) {
  const localIncognitoChats = state.chats.filter(chat => chat.incognito);
  const activeIncognitoId = getChat()?.incognito ? state.currentChatId : "";
  const cloudChats = Array.isArray(cloudData.chats) ? cloudData.chats : [];
  const cloudMemory = Array.isArray(cloudData.memory) ? cloudData.memory : [];
  const cloudSettings = cloudData.settings || {};
  const cloudTime = new Date(cloudData.updated_at || 0).getTime();

  const localHasRealContent = state.chats.some(c => !c.incognito && c.messages.length > 0);
  const localLatest = state.chats.reduce(
    (max, chat) => chat.incognito ? max : Math.max(max, chat.updatedAt || 0),
    0
  );

  if (authoritative || !localHasRealContent || cloudTime >= localLatest) {
    state.chats = cloudChats;
    state.memory = cloudMemory;
    Object.assign(state.settings, cloudSettings);
  } else if (cloudChats.length) {
    const localIds = new Set(state.chats.map(c => c.id));
    const merged = [...state.chats];
    for (const cloudChat of cloudChats) {
      if (!localIds.has(cloudChat.id)) {
        merged.push(cloudChat);
      } else {
        const localIndex = merged.findIndex(c => c.id === cloudChat.id);
        if (localIndex >= 0 && (cloudChat.updatedAt || 0) > (merged[localIndex].updatedAt || 0)) {
          merged[localIndex] = cloudChat;
        }
      }
    }
    state.chats = merged.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const allMemory = [...cloudMemory, ...state.memory];
    const seen = new Set();
    state.memory = allMemory.filter(item => {
      const key = item.user || "";
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(-CONFIG.MAX_MEMORY);
  }

  state.chats = dedupeChatsById([...localIncognitoChats, ...state.chats]);
  if (activeIncognitoId && state.chats.some(chat => chat.id === activeIncognitoId)) {
    state.currentChatId = activeIncognitoId;
  }
  if (!state.chats.length) {
    const chat = makeChat();
    state.chats = [chat];
    state.currentChatId = chat.id;
  } else if (!state.chats.some(c => c.id === state.currentChatId)) {
    const chatWithMessages = state.chats.find(c => c.messages.length > 0);
    state.currentChatId = chatWithMessages ? chatWithMessages.id : state.chats[0].id;
  }

  saveStoredState(state);
  cloudDirty = false;
  applyPreferences();
  renderChats();
  renderMessages();
  updateStats();
  updateAccount();
}

function persistChatChange() {
  if (persistTimer) clearTimeout(persistTimer);
  if (persistIdleHandle && "cancelIdleCallback" in window) {
    window.cancelIdleCallback(persistIdleHandle);
  }
  persistTimer = null;
  persistIdleHandle = null;
  state.chats = dedupeChatsById(state.chats);
  localMutationVersion += 1;
  saveStoredState(state);
  scheduleCloudSync(0);
}

function persist() {
  localMutationVersion += 1;
  if (persistTimer || persistIdleHandle) return;

  if ("requestIdleCallback" in window) {
    persistIdleHandle = window.requestIdleCallback(() => {
      persistIdleHandle = null;
      saveStoredState(state);
      scheduleCloudSync();
    }, { timeout: 1000 });
    return;
  }

  persistTimer = setTimeout(() => {
    persistTimer = null;
    saveStoredState(state);
    scheduleCloudSync();
  }, 120);
}

function flushPersist() {
  localMutationVersion += 1;
  if (persistTimer) clearTimeout(persistTimer);
  if (persistIdleHandle && "cancelIdleCallback" in window) {
    window.cancelIdleCallback(persistIdleHandle);
  }
  persistTimer = null;
  persistIdleHandle = null;
  saveStoredState(state);
  if (state.loggedIn && state.user) {
    if (cloudSyncTimer) clearTimeout(cloudSyncTimer);
    cloudSyncTimer = null;
    cloudSyncDueAt = 0;
    cloudDirty = true;
    syncToCloud();
  }
}

function createChatTitle(text) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 42 ? `${clean.slice(0, 42).trim()}…` : clean;
}

function getReadingMetrics(text) {
  const words = stripMarkdown(text).trim().split(/\s+/).filter(Boolean).length;
  if (!words) return "";
  const minutes = Math.max(1, Math.ceil(words / 220));
  return `${words.toLocaleString()} words · ${minutes} min read`;
}

function stripMarkdown(text) {
  return String(text)
    .replace(/```[\s\S]*?```/g, match => match.replace(/```[^\n]*\n?|```/g, ""))
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[*_#>`~|-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(timestamp);
}

function formatRelativeTime(timestamp) {
  const elapsed = Date.now() - Number(timestamp || Date.now());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "Now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(timestamp);
}

function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "talkaton-response";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

function element(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function byId(id) {
  return document.getElementById(id);
}

function closeDialog(dialog) {
  if (dialog?.open) dialog.close();
}

function getShortcutKey() {
  const mac = navigator.userAgentData?.platform === "macOS"
    || /macintosh|mac os x|iphone|ipad|ipod/i.test(navigator.userAgent);
  return mac ? "⌘" : "Ctrl";
}

function updateShortcutLabels() {
  const key = getShortcutKey();
  document.querySelectorAll("kbd").forEach(kbd => {
    const text = kbd.textContent;
    if (text.includes("⌘")) kbd.textContent = text.replace("⌘", key);
  });
  const settingsHint = document.querySelector("#settingsBtn .navHint");
  if (settingsHint && settingsHint.textContent.includes("⌘")) {
    settingsHint.textContent = settingsHint.textContent.replace("⌘", key);
  }
}

function getClientTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function getSupabase() {
  if (!supabasePromise) {
    supabasePromise = Promise.resolve()
      .then(() => {
        const createClient = globalThis.supabase?.createClient;
        if (typeof createClient !== "function") {
          throw new Error("Talkaton account service did not load. Refresh the page and try again.");
        }
        const client = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, {
          auth: {
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: true,
            flowType: "pkce",
            storage: createSharedAuthStorage()
          }
        });
        client.auth.onAuthStateChange((event, session) => {
          if (event === "INITIAL_SESSION") {
            if (initialSessionResolved) return;
            initialSessionResolved = true;
          }
          if ((signupConfirmationPending || loginConfirmationPending) && event === "SIGNED_IN") return;
          if (!["SIGNED_IN", "SIGNED_OUT", "INITIAL_SESSION", "PASSWORD_RECOVERY", "USER_UPDATED"].includes(event)) return;
          const wasLoggedIn = state.loggedIn;
          state.user = session?.user || null;
          state.loggedIn = Boolean(session?.user);
          if (event === "PASSWORD_RECOVERY") {
            passwordRecoveryPending = true;
            openPasswordRecoveryDialog();
          } else if (
            event === "SIGNED_IN"
            && new URLSearchParams(window.location.search).get("signup-confirmed") === "1"
          ) {
            completeEmailSignupConfirmation();
          } else if (
            event === "SIGNED_IN"
            && new URLSearchParams(window.location.search).get("login-confirmed") === "1"
          ) {
            completeEmailLoginConfirmation();
          } else if (event === "SIGNED_OUT") {
            passwordRecoveryPending = false;
            betaApproved = false;
            devAccessApproved = false;
            betaAccessExpiresAt = "";
            devAccessExpiresAt = "";
            subscriptionPlan = "free";
            billingStatus = {
              plan: "guest",
              paid: false,
              billingConfigured: billingStatus.billingConfigured,
              testMode: billingStatus.testMode,
              subscriptionStatus: null
            };
            syncBetaAccessAvailability();
            closeDialog(DOM.passwordResetDialog);
            closeDialog(DOM.profileDialog);
          }
          updateAccount();
          if ((event === "SIGNED_IN" || event === "INITIAL_SESSION" || event === "USER_UPDATED") && session?.user) {
            refreshBetaAccess().then(() => {
              refreshBillingAccess().then(() => {
                updateAccount();
                activateRequestedBetaMode();
              });
            });
          }
          if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && !wasLoggedIn && session?.user) {
            pullFromCloud();
          }
        });
        return client;
      })
      .catch(error => {
        supabasePromise = null;
        throw error;
      });
  }
  return supabasePromise;
}

globalThis.TalkatonHost = Object.freeze({
  getState: () => state,
  getPlan: getUserTier,
  getCurrentChat: getChat,
  getUser: () => state.user,
  isLoggedIn: () => state.loggedIn,
  getSupabase,
  getAuthHeaders: getChatRequestHeaders,
  persistChatChange,
  renderMessages,
  renderChats,
  loadMarkdown,
  sendMessage,
  createId,
  toast,
  announce,
  openAuth: handleAuth,
  openDialog(dialog) {
    if (dialog && !dialog.open) dialog.showModal();
  },
  closeDialog
});
document.dispatchEvent(new CustomEvent("talkaton:host-ready"));

window.addEventListener("beforeunload", flushPersist);
setInterval(() => {
  if (state.loading) checkpointMessages();
  if (cloudDirty && state.loggedIn && !cloudSyncInFlight && !cloudRetryTimer) {
    syncToCloud();
  }
}, 5000);
setInterval(pollCloudChanges, CLOUD_PULL_INTERVAL);
