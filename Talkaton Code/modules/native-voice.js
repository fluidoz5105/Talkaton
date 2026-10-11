const DEFAULT_CONNECTION_TIMEOUT_MS = 20_000;
const ICE_GATHER_TIMEOUT_MS = 4_000;

export class NativeVoiceError extends Error {
  constructor(message, code = "VOICE_ERROR", cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "NativeVoiceError";
    this.code = code;
  }
}

/**
 * Continuous voice transport over WebRTC.
 *
 * `exchangeSdp` must call a Talkaton server endpoint that creates an ephemeral
 * provider session. Long-lived provider keys must never be returned to this
 * module or embedded in browser JavaScript.
 */
export class NativeVoiceSession extends EventTarget {
  constructor({
    exchangeSdp,
    iceServers = [],
    audioElement = null,
    dataChannelLabel = "talkaton-events",
    connectionTimeoutMs = DEFAULT_CONNECTION_TIMEOUT_MS
  } = {}) {
    super();
    if (typeof exchangeSdp !== "function") {
      throw new NativeVoiceError("A secure SDP exchange function is required.", "INVALID_CONFIGURATION");
    }
    this.exchangeSdp = exchangeSdp;
    this.iceServers = iceServers;
    this.audioElement = audioElement;
    this.dataChannelLabel = dataChannelLabel;
    this.connectionTimeoutMs = connectionTimeoutMs;
    this.permission = "prompt";
    this.state = "idle";
    this.muted = false;
    this.peer = null;
    this.channel = null;
    this.stream = null;
    this.remoteStream = null;
    this.abortController = null;
    this.audioContext = null;
    this.levelFrame = 0;
    this.externalSignal = null;
    this.externalAbortHandler = null;
  }

  static capabilities() {
    const mediaDevices = typeof navigator !== "undefined" && navigator.mediaDevices;
    return Object.freeze({
      supported: typeof RTCPeerConnection !== "undefined" && Boolean(mediaDevices?.getUserMedia),
      microphone: Boolean(mediaDevices?.getUserMedia),
      deviceSelection: Boolean(mediaDevices?.enumerateDevices),
      outputSelection: typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype,
      secureContext: globalThis.isSecureContext !== false
    });
  }

  async inspectMicrophonePermission() {
    if (!navigator.permissions?.query) return this.permission;
    try {
      const status = await navigator.permissions.query({ name: "microphone" });
      this.permission = status.state;
      status.addEventListener("change", () => {
        this.permission = status.state;
        this.#emit("permissionchange", { permission: this.permission });
        if (this.permission === "denied" && this.state !== "idle") this.stop("permission-revoked");
      }, { once: false });
    } catch {
      // Safari does not expose the microphone permission through Permissions API.
    }
    return this.permission;
  }

  async requestMicrophonePermission({ deviceId, audio = {} } = {}) {
    this.#assertSupported();
    if (this.state !== "idle") {
      throw new NativeVoiceError("End the current voice session before changing microphone access.", "SESSION_ACTIVE");
    }
    this.#setState("requesting-permission");
    let probe;
    try {
      probe = await navigator.mediaDevices.getUserMedia({
        audio: createAudioConstraints(deviceId, audio),
        video: false
      });
      this.permission = "granted";
      this.#emit("permissionchange", { permission: "granted" });
      return true;
    } catch (error) {
      this.permission = error?.name === "NotAllowedError" ? "denied" : "prompt";
      throw microphoneError(error);
    } finally {
      probe?.getTracks().forEach(track => track.stop());
      this.#setState("idle");
    }
  }

  async start({ deviceId, audio = {}, signal, initialEvents = [] } = {}) {
    this.#assertSupported();
    if (this.state !== "idle") {
      throw new NativeVoiceError("A voice session is already starting or connected.", "SESSION_ACTIVE");
    }
    if (this.permission !== "granted") {
      throw new NativeVoiceError(
        "Allow microphone access before starting the live conversation.",
        "PERMISSION_REQUIRED"
      );
    }
    if (signal?.aborted) throw cancelledError(signal.reason);

    this.abortController = new AbortController();
    const onExternalAbort = () => this.stop("cancelled");
    signal?.addEventListener("abort", onExternalAbort, { once: true });
    this.externalSignal = signal || null;
    this.externalAbortHandler = onExternalAbort;
    this.#setState("connecting");

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: createAudioConstraints(deviceId, audio),
        video: false
      });
      if (this.abortController.signal.aborted) throw cancelledError();

      // The local track remains disabled until the authenticated WebRTC session
      // has accepted its SDP answer. Permission never implies recording.
      this.stream.getAudioTracks().forEach(track => { track.enabled = false; });
      this.peer = new RTCPeerConnection({ iceServers: this.iceServers });
      this.remoteStream = new MediaStream();
      this.#bindPeerEvents();
      this.channel = this.peer.createDataChannel(this.dataChannelLabel, { ordered: true });
      this.#bindDataChannel(this.channel);
      for (const track of this.stream.getAudioTracks()) this.peer.addTrack(track, this.stream);

      const offer = await this.peer.createOffer({ offerToReceiveAudio: true });
      await this.peer.setLocalDescription(offer);
      await waitForIceGathering(this.peer, ICE_GATHER_TIMEOUT_MS, this.abortController.signal);
      const answer = await this.exchangeSdp({
        sdp: this.peer.localDescription.sdp,
        type: this.peer.localDescription.type,
        signal: this.abortController.signal
      });
      const remoteDescription = normalizeAnswer(answer);
      await this.peer.setRemoteDescription(remoteDescription);
      this.stream.getAudioTracks().forEach(track => { track.enabled = !this.muted; });
      this.#startLevelMeter();

      await waitForConnection(this.peer, this.connectionTimeoutMs, this.abortController.signal);
      await waitForDataChannel(this.channel, this.connectionTimeoutMs, this.abortController.signal);
      this.#setState("connected");
      await this.#playRemoteAudio();
      for (const event of initialEvents) this.sendEvent(event);
      return this;
    } catch (error) {
      const normalized = error instanceof NativeVoiceError ? error : connectionError(error);
      this.stop("failed");
      throw normalized;
    }
  }

  mute(value = true) {
    this.muted = Boolean(value);
    this.stream?.getAudioTracks().forEach(track => { track.enabled = !this.muted; });
    this.#emit("mutechange", { muted: this.muted });
    return this.muted;
  }

  sendEvent(event) {
    if (this.channel?.readyState !== "open") {
      throw new NativeVoiceError("The voice event channel is not connected yet.", "CHANNEL_NOT_READY");
    }
    this.channel.send(typeof event === "string" ? event : JSON.stringify(event));
  }

  sendText(text) {
    const value = String(text || "").trim();
    if (!value) throw new NativeVoiceError("Text is required.", "EMPTY_TEXT");
    this.sendEvent({ type: "conversation.item.create", item: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: value }]
    } });
    this.sendEvent({ type: "response.create" });
  }

  async setOutputDevice(deviceId) {
    const element = this.#getAudioElement();
    if (typeof element.setSinkId !== "function") {
      throw new NativeVoiceError("This browser cannot choose an audio output device.", "OUTPUT_SELECTION_UNSUPPORTED");
    }
    await element.setSinkId(deviceId);
  }

  async listAudioDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return { inputs: [], outputs: [] };
    const devices = await navigator.mediaDevices.enumerateDevices();
    return {
      inputs: devices.filter(device => device.kind === "audioinput"),
      outputs: devices.filter(device => device.kind === "audiooutput")
    };
  }

  stop(reason = "ended") {
    if (this.state === "idle" && !this.peer && !this.stream) return;
    this.abortController?.abort(reason);
    this.abortController = null;
    this.externalSignal?.removeEventListener("abort", this.externalAbortHandler);
    this.externalSignal = null;
    this.externalAbortHandler = null;
    this.#stopLevelMeter();
    try { this.channel?.close(); } catch {}
    try { this.peer?.close(); } catch {}
    this.stream?.getTracks().forEach(track => track.stop());
    this.remoteStream?.getTracks().forEach(track => track.stop());
    if (this.audioElement) this.audioElement.srcObject = null;
    this.channel = null;
    this.peer = null;
    this.stream = null;
    this.remoteStream = null;
    this.#setState("idle", { reason });
  }

  #assertSupported() {
    const capabilities = NativeVoiceSession.capabilities();
    if (!capabilities.secureContext) {
      throw new NativeVoiceError("Microphone access requires HTTPS.", "INSECURE_CONTEXT");
    }
    if (!capabilities.supported) {
      throw new NativeVoiceError("This browser does not support WebRTC microphone conversations.", "UNSUPPORTED_BROWSER");
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      throw new NativeVoiceError("Live voice requires an internet connection.", "OFFLINE");
    }
  }

  #bindPeerEvents() {
    this.peer.addEventListener("track", event => {
      for (const track of event.streams[0]?.getTracks() || [event.track]) {
        if (!this.remoteStream.getTracks().includes(track)) this.remoteStream.addTrack(track);
      }
      const element = this.#getAudioElement();
      element.srcObject = this.remoteStream;
      this.#emit("remotetrack", { track: event.track, stream: this.remoteStream });
    });
    this.peer.addEventListener("connectionstatechange", () => {
      const connectionState = this.peer?.connectionState || "closed";
      this.#emit("connectionchange", { connectionState });
      if (["failed", "closed"].includes(connectionState) && this.state !== "idle") this.stop(connectionState);
      if (connectionState === "disconnected") {
        this.#emit("warning", { code: "CONNECTION_INTERRUPTED", message: "Voice connection interrupted. Reconnecting…" });
      }
    });
  }

  #bindDataChannel(channel) {
    channel.addEventListener("open", () => this.#emit("channelopen", {}));
    channel.addEventListener("close", () => this.#emit("channelclose", {}));
    channel.addEventListener("error", () => {
      this.#emit("error", { error: new NativeVoiceError("The live transcript channel failed.", "CHANNEL_ERROR") });
    });
    channel.addEventListener("message", event => {
      let payload = event.data;
      try { payload = JSON.parse(event.data); } catch {}
      this.#emit("providerevent", { event: payload });
      const transcript = normalizeTranscriptEvent(payload);
      if (transcript) this.#emit("transcript", transcript);
    });
  }

  #getAudioElement() {
    if (this.audioElement) return this.audioElement;
    if (typeof Audio === "undefined") {
      throw new NativeVoiceError("Remote audio playback is unavailable.", "AUDIO_UNAVAILABLE");
    }
    this.audioElement = new Audio();
    this.audioElement.autoplay = true;
    this.audioElement.playsInline = true;
    return this.audioElement;
  }

  async #playRemoteAudio() {
    const element = this.#getAudioElement();
    try {
      await element.play();
    } catch (error) {
      this.#emit("warning", {
        code: "PLAYBACK_GESTURE_REQUIRED",
        message: "Tap the voice control once to allow reply audio.",
        error
      });
    }
  }

  #startLevelMeter() {
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextClass || !this.stream) return;
    try {
      this.audioContext = new AudioContextClass();
      const source = this.audioContext.createMediaStreamSource(this.stream);
      const analyser = this.audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const values = new Uint8Array(analyser.frequencyBinCount);
      const sample = () => {
        analyser.getByteTimeDomainData(values);
        let sum = 0;
        for (const value of values) {
          const centered = (value - 128) / 128;
          sum += centered * centered;
        }
        this.#emit("level", { level: this.muted ? 0 : Math.min(1, Math.sqrt(sum / values.length) * 3) });
        this.levelFrame = requestAnimationFrame(sample);
      };
      this.levelFrame = requestAnimationFrame(sample);
    } catch {
      // Audio level visualization is optional and must not block voice transport.
    }
  }

  #stopLevelMeter() {
    if (this.levelFrame) cancelAnimationFrame(this.levelFrame);
    this.levelFrame = 0;
    this.audioContext?.close().catch(() => {});
    this.audioContext = null;
  }

  #setState(state, extra = {}) {
    this.state = state;
    this.#emit("statechange", { state, ...extra });
  }

  #emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

export function createSdpExchange(endpoint, { getAccessToken, headers = {}, credentials = "same-origin" } = {}) {
  const url = String(endpoint || "").trim();
  if (!url) throw new NativeVoiceError("An SDP exchange endpoint is required.", "INVALID_ENDPOINT");
  return async ({ sdp, signal }) => {
    const accessToken = typeof getAccessToken === "function" ? await getAccessToken() : "";
    const response = await fetch(url, {
      method: "POST",
      credentials,
      signal,
      headers: {
        "Content-Type": "application/sdp",
        Accept: "application/sdp, application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...headers
      },
      body: sdp
    });
    if (!response.ok) {
      let message = `Voice session setup failed (${response.status}).`;
      try {
        const data = await response.json();
        message = data?.error?.message || data?.error || message;
      } catch {}
      throw new NativeVoiceError(message, response.status === 401 ? "AUTH_REQUIRED" : "SESSION_SETUP_FAILED");
    }
    const contentType = response.headers.get("content-type") || "";
    return contentType.includes("application/json") ? response.json() : response.text();
  };
}

function createAudioConstraints(deviceId, overrides) {
  return {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    ...overrides
  };
}

function normalizeAnswer(value) {
  if (typeof value === "string" && value.trim()) return { type: "answer", sdp: value };
  const sdp = value?.sdp || value?.answer;
  if (!sdp) throw new NativeVoiceError("The voice server returned an invalid SDP answer.", "INVALID_ANSWER");
  return { type: value?.type || "answer", sdp };
}

function normalizeTranscriptEvent(event) {
  if (!event || typeof event !== "object") return null;
  const type = String(event.type || "");
  const text = String(event.delta || event.transcript || event.text || "");
  if (!text) return null;
  if (type.includes("input_audio_transcription") || event.speaker === "user") {
    return { speaker: "user", text, delta: type.endsWith(".delta"), final: !type.endsWith(".delta"), raw: event };
  }
  if (type.includes("audio_transcript") || type === "transcript" || event.speaker === "assistant") {
    return { speaker: "assistant", text, delta: type.endsWith(".delta"), final: !type.endsWith(".delta"), raw: event };
  }
  return null;
}

function waitForIceGathering(peer, timeoutMs, signal) {
  if (peer.iceGatheringState === "complete") return Promise.resolve();
  return waitForEvent({
    target: peer,
    event: "icegatheringstatechange",
    predicate: () => peer.iceGatheringState === "complete",
    timeoutMs,
    signal,
    resolveOnTimeout: true
  });
}

function waitForConnection(peer, timeoutMs, signal) {
  if (["connected", "completed"].includes(peer.connectionState) || peer.iceConnectionState === "connected") {
    return Promise.resolve();
  }
  return waitForEvent({
    target: peer,
    event: "connectionstatechange",
    predicate: () => peer.connectionState === "connected",
    timeoutMs,
    signal,
    errorMessage: "The live voice connection timed out."
  });
}

function waitForDataChannel(channel, timeoutMs, signal) {
  if (channel.readyState === "open") return Promise.resolve();
  return waitForEvent({
    target: channel,
    event: "open",
    predicate: () => channel.readyState === "open",
    timeoutMs,
    signal,
    errorMessage: "The live transcript channel timed out."
  });
}

function waitForEvent({ target, event, predicate, timeoutMs, signal, resolveOnTimeout = false, errorMessage }) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      target.removeEventListener(event, onEvent);
      signal?.removeEventListener("abort", onAbort);
    };
    const onEvent = () => {
      if (!predicate()) return;
      cleanup();
      resolve();
    };
    const onAbort = () => {
      cleanup();
      reject(cancelledError(signal.reason));
    };
    const timeout = setTimeout(() => {
      cleanup();
      if (resolveOnTimeout) resolve();
      else reject(new NativeVoiceError(errorMessage || "Voice connection timed out.", "CONNECTION_TIMEOUT"));
    }, timeoutMs);
    target.addEventListener(event, onEvent);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function microphoneError(error) {
  if (error?.name === "NotAllowedError") {
    return new NativeVoiceError("Microphone access was denied. Allow it in browser settings and try again.", "MICROPHONE_DENIED", error);
  }
  if (error?.name === "NotFoundError") {
    return new NativeVoiceError("No microphone was found.", "MICROPHONE_NOT_FOUND", error);
  }
  if (error?.name === "NotReadableError") {
    return new NativeVoiceError("The microphone is busy in another app or tab.", "MICROPHONE_BUSY", error);
  }
  return new NativeVoiceError("Talkaton could not open the microphone.", "MICROPHONE_ERROR", error);
}

function connectionError(error) {
  if (error?.name === "AbortError") return cancelledError(error.message);
  return new NativeVoiceError(error?.message || "Talkaton could not start live voice.", "CONNECTION_FAILED", error);
}

function cancelledError(reason) {
  return new NativeVoiceError(typeof reason === "string" ? reason : "Voice connection cancelled.", "CANCELLED");
}
