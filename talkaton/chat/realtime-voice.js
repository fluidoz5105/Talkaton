import { NativeVoiceSession, createSdpExchange } from "../modules/native-voice.js";

const host = globalThis.TalkatonHost;
const dom = Object.fromEntries([
  "voiceDialog", "voiceRealtimeToggle", "realtimeVoiceSelect", "voicePermissionBtn", "voiceStartBtn",
  "voiceOrb", "voiceStatus", "voiceCaption", "voiceTranscript", "voiceLiveIndicator", "voiceEndBtn"
].map(id => [id, document.getElementById(id)]));

let voice = null;
let permissionGranted = false;
let transcript = { user: "", assistant: "" };

if (host && dom.voiceRealtimeToggle) initialize();

function initialize() {
  const capabilities = NativeVoiceSession.capabilities();
  if (!capabilities.supported) {
    dom.voiceRealtimeToggle.checked = false;
    dom.voiceRealtimeToggle.disabled = true;
    dom.realtimeVoiceSelect.disabled = true;
    return;
  }
  const syncPlan = () => {
    const ollamaOnly = ["free", "guest"].includes(host.getPlan());
    dom.voiceRealtimeToggle.disabled = ollamaOnly;
    if (ollamaOnly) { dom.voiceRealtimeToggle.checked = false; stopRealtimeVoice(); }
    dom.realtimeVoiceSelect.disabled = !dom.voiceRealtimeToggle.checked;
  };
  new MutationObserver(syncPlan).observe(dom.voiceDialog, { attributes: true, attributeFilter: ["open"] });
  syncPlan();
  for (const control of [dom.voicePermissionBtn, dom.voiceStartBtn, dom.voiceOrb]) control.addEventListener("click", interceptVoiceControl, true);
  dom.voiceEndBtn.addEventListener("click", stopRealtimeVoice, true);
  dom.voiceDialog.addEventListener("close", stopRealtimeVoice);
  dom.voiceRealtimeToggle.addEventListener("change", () => {
    dom.realtimeVoiceSelect.disabled = !dom.voiceRealtimeToggle.checked;
    if (!dom.voiceRealtimeToggle.checked) stopRealtimeVoice();
    else setStatus(permissionGranted ? "Microphone allowed. Start whenever you’re ready." : "Allow microphone access before starting.");
  });
}

function interceptVoiceControl(event) {
  if (["free", "guest"].includes(host.getPlan())) {
    dom.voiceRealtimeToggle.checked = false;
    dom.realtimeVoiceSelect.disabled = true;
    return; // Let the existing recorded-voice handler run through Ollama chat.
  }
  if (!dom.voiceRealtimeToggle.checked) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (event.currentTarget === dom.voicePermissionBtn) requestPermission();
  else if (voice?.state && voice.state !== "idle") stopRealtimeVoice();
  else if (!permissionGranted) requestPermission();
  else startRealtimeVoice();
}

function createVoiceSession() {
  const selected = encodeURIComponent(dom.realtimeVoiceSelect.value || "marin");
  const exchangeSdp = createSdpExchange(`/api/realtime-session?voice=${selected}`, {
    getAccessToken: async () => String((await host.getAuthHeaders()).Authorization || "").replace(/^Bearer\s+/i, "")
  });
  const session = new NativeVoiceSession({ exchangeSdp });
  session.addEventListener("statechange", event => updateState(event.detail.state));
  session.addEventListener("transcript", event => handleTranscript(event.detail));
  session.addEventListener("warning", event => setStatus(event.detail.message));
  session.addEventListener("error", event => setStatus(event.detail.error?.message || "The voice connection stopped.", true));
  session.addEventListener("level", event => dom.voiceOrb.style.setProperty("--voice-level", String(Math.max(0, Math.min(1, event.detail.level || 0)))));
  return session;
}

async function requestPermission() {
  voice ||= createVoiceSession();
  setStatus("Waiting for microphone permission…");
  dom.voicePermissionBtn.disabled = true;
  try {
    await voice.requestMicrophonePermission();
    permissionGranted = true;
    dom.voicePermissionBtn.textContent = "Microphone allowed ✓";
    dom.voicePermissionBtn.classList.add("allowed");
    dom.voiceStartBtn.disabled = false;
    dom.voiceCaption.textContent = "Your microphone is ready. Talkaton is not listening yet.";
    setStatus("Microphone allowed. Start whenever you’re ready.");
  } catch (error) {
    permissionGranted = false;
    dom.voicePermissionBtn.disabled = false;
    dom.voicePermissionBtn.textContent = "Allow microphone";
    setStatus(error.message || "Microphone access was denied.", true);
  }
}

async function startRealtimeVoice() {
  voice ||= createVoiceSession();
  transcript = { user: "", assistant: "" };
  dom.voiceStartBtn.disabled = true;
  setStatus("Connecting secure live voice…");
  dom.voiceCaption.textContent = "Connecting…";
  try {
    await voice.start();
  } catch (error) {
    setStatus(error.message || "Live voice could not connect.", true);
    updateState("idle");
  }
}

function stopRealtimeVoice() {
  if (!voice || voice.state === "idle") return;
  voice.stop("user-ended");
  updateState("idle");
}

function updateState(state) {
  const connected = state === "connected";
  const busy = ["connecting", "requesting-permission"].includes(state);
  dom.voiceDialog.classList.toggle("liveConversation", connected);
  dom.voiceOrb.classList.toggle("listening", connected);
  dom.voiceLiveIndicator.classList.toggle("active", connected);
  dom.voiceLiveIndicator.querySelector("strong").textContent = connected ? "Live voice · Connected" : busy ? "Live voice · Connecting" : "Live chat off";
  dom.voiceStartBtn.disabled = busy || (!permissionGranted && state === "idle");
  dom.voiceStartBtn.textContent = connected ? "End live conversation" : busy ? "Connecting…" : "Start live conversation";
  dom.voiceOrb.setAttribute("aria-label", connected ? "End live conversation" : "Start live conversation");
  if (connected) {
    setStatus("Connected. Speak naturally—you can interrupt Talkaton.");
    dom.voiceCaption.textContent = "Listening…";
  } else if (state === "idle" && permissionGranted) setStatus("Microphone allowed. Start whenever you’re ready.");
}

function handleTranscript(detail) {
  const speaker = detail.speaker === "user" ? "user" : "assistant";
  if (detail.delta) transcript[speaker] += detail.text;
  else transcript[speaker] = detail.text || transcript[speaker];
  const label = speaker === "user" ? "You" : "Talkaton";
  dom.voiceCaption.textContent = `${label}: ${transcript[speaker]}`;
  dom.voiceTranscript.value = [transcript.user && `You: ${transcript.user}`, transcript.assistant && `Talkaton: ${transcript.assistant}`].filter(Boolean).join("\n\n");
  if (!detail.final || !transcript[speaker].trim()) return;
  saveTranscriptMessage(speaker, transcript[speaker].trim());
  transcript[speaker] = "";
}

function saveTranscriptMessage(role, content) {
  const chat = host.getCurrentChat();
  if (!chat) return;
  chat.messages.push({ id: host.createId("message"), role, content, status: "complete", timestamp: Date.now(), model: role === "assistant" ? "openai/gpt-realtime-2.1" : undefined });
  chat.updatedAt = Date.now();
  host.persistChatChange();
  host.renderMessages();
}

function setStatus(message, error = false) {
  dom.voiceStatus.textContent = message;
  dom.voiceStatus.classList.toggle("error", error);
}
