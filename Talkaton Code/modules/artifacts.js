import { createRecordStore } from "./record-store.js";

export const ARTIFACT_SCHEMA_VERSION = 1;
export const ARTIFACT_TYPES = Object.freeze(["markdown", "code", "html", "json", "text"]);
export const MAX_ARTIFACT_CONTENT_CHARACTERS = 5_000_000;
const CODE_FENCE = /```([\w.+#-]*)[^\S\r\n]*\r?\n([\s\S]*?)```/g;
const LANGUAGE_ALIASES = Object.freeze({ md: "markdown", markdown: "markdown", html: "html", htm: "html", json: "json", js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript", py: "python", sh: "shell", bash: "shell" });

/** Detect complete documents and substantial code blocks worth opening in Canvas. */
export function detectArtifacts(source, { minimumCodeLines = 8, minimumCodeCharacters = 240, minimumDocumentCharacters = 500 } = {}) {
  const text = String(source || "");
  const artifacts = [];
  let match;
  CODE_FENCE.lastIndex = 0;
  while ((match = CODE_FENCE.exec(text))) {
    const language = normalizeLanguage(match[1] || "text");
    const content = match[2].replace(/\s+$/, "");
    const lines = content.split(/\r?\n/).length;
    if (!isCompleteCode(content, language, lines, minimumCodeLines, minimumCodeCharacters)) continue;
    const type = language === "markdown" ? "markdown" : language === "html" ? "html" : language === "json" ? "json" : "code";
    artifacts.push({
      type,
      language,
      title: inferTitle(content, type, language, artifacts.length + 1),
      content,
      sourceStart: match.index,
      sourceEnd: CODE_FENCE.lastIndex,
      confidence: lines >= minimumCodeLines * 2 ? "high" : "medium"
    });
  }

  const withoutFences = text.replace(CODE_FENCE, "").trim();
  const headings = [...text.matchAll(/^#{1,3}\s+(.+)$/gm)];
  const looksLikeDocument = text.length >= minimumDocumentCharacters && headings.length >= 2 && /(?:^|\n)(?:[-*+] |\d+\. |>|---$)/m.test(text);
  if (looksLikeDocument && (!artifacts.length || withoutFences.length >= minimumDocumentCharacters / 2)) {
    artifacts.unshift({
      type: "markdown",
      language: "markdown",
      title: cleanTitle(headings[0]?.[1]) || "Markdown document",
      content: text.trim(),
      sourceStart: 0,
      sourceEnd: text.length,
      confidence: headings.length >= 3 ? "high" : "medium"
    });
  }
  return artifacts;
}

export function createArtifactRepository({
  userId,
  workspaceId = null,
  cloud = null,
  autoPush = false,
  maximumVersions = 100,
  store = createRecordStore({
    databaseName: "talkaton-artifacts-v1",
    storeName: "artifacts",
    localStorageKey: "talkaton:artifacts:v1"
  })
} = {}) {
  if (!userId || typeof userId !== "string") throw new TypeError("An authenticated userId is required for artifact storage.");
  if (!Number.isInteger(maximumVersions) || maximumVersions < 2 || maximumVersions > 500) throw new RangeError("maximumVersions must be between 2 and 500.");
  const listeners = new Set();

  function storageId(id) { return `${userId}:${workspaceId || "personal"}:${id}`; }
  function notify(type, artifact = null) {
    const event = Object.freeze({ type, artifact: artifact ? clone(artifact) : null, at: new Date().toISOString() });
    listeners.forEach(listener => {
      try { listener(event); } catch (error) { console.error("Talkaton artifact subscriber failed:", error); }
    });
  }
  async function persist(artifact, type) {
    const valid = validateArtifact(artifact);
    await store.put({ storageId: storageId(valid.id), userId, workspaceId, artifact: valid });
    notify(type, valid);
    if (autoPush && cloud) await pushToCloud();
    return clone(valid);
  }

  async function list({ chatId = null, includeDeleted = false } = {}) {
    const records = await store.getAll();
    return records
      .filter(record => record.userId === userId && (record.workspaceId || null) === workspaceId)
      .map(record => validateArtifact(record.artifact))
      .filter(artifact => (includeDeleted || !artifact.deletedAt) && (!chatId || artifact.chatId === chatId))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async function get(id, { includeDeleted = false } = {}) {
    const record = await store.get(storageId(id));
    if (!record?.artifact) return null;
    const artifact = validateArtifact(record.artifact);
    return artifact.deletedAt && !includeDeleted ? null : artifact;
  }

  async function create(input) {
    const timestamp = new Date().toISOString();
    const id = input?.id || createId("artifact");
    if (await get(id, { includeDeleted: true })) throw new Error(`Artifact ${id} already exists.`);
    const content = boundedContent(input?.content);
    const version = createVersion(content, input?.authorId || userId, input?.changeSummary || "Initial version", 1, timestamp);
    return persist({
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      id,
      ownerId: userId,
      workspaceId,
      chatId: input?.chatId || null,
      messageId: input?.messageId || null,
      title: cleanTitle(input?.title) || "Untitled artifact",
      type: ARTIFACT_TYPES.includes(input?.type) ? input.type : "text",
      language: normalizeLanguage(input?.language || input?.type || "text"),
      currentVersionId: version.id,
      versions: [version],
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
      metadata: scalarMetadata(input?.metadata)
    }, "created");
  }

  async function update(id, content, { authorId = userId, changeSummary = "Edited artifact", title, expectedVersionId } = {}) {
    const current = await requireArtifact(id);
    if (expectedVersionId && current.currentVersionId !== expectedVersionId) {
      const error = new Error("This artifact was updated elsewhere. Reload it before saving again.");
      error.code = "ARTIFACT_VERSION_CONFLICT";
      error.current = current;
      throw error;
    }
    const timestamp = new Date().toISOString();
    const version = createVersion(boundedContent(content), authorId, changeSummary, current.versions.length + 1, timestamp);
    const versions = [...current.versions, version].slice(-maximumVersions);
    return persist({ ...current, ...(title == null ? {} : { title: cleanTitle(title) || current.title }), versions, currentVersionId: version.id, updatedAt: timestamp }, "updated");
  }

  async function restoreVersion(id, versionId, { authorId = userId } = {}) {
    const current = await requireArtifact(id);
    const selected = current.versions.find(version => version.id === versionId);
    if (!selected) throw new Error(`Artifact version ${versionId} was not found.`);
    return update(id, selected.content, { authorId, changeSummary: `Restored version ${selected.number}`, expectedVersionId: current.currentVersionId });
  }

  async function remove(id, { permanent = false } = {}) {
    const current = await get(id, { includeDeleted: true });
    if (!current) return false;
    if (permanent) {
      await store.delete(storageId(id));
      notify("purged", current);
    } else {
      const timestamp = new Date().toISOString();
      await persist({ ...current, deletedAt: timestamp, updatedAt: timestamp }, "deleted");
    }
    return true;
  }

  async function recover(id) {
    const current = await get(id, { includeDeleted: true });
    if (!current) throw new Error(`Artifact ${id} was not found.`);
    return persist({ ...current, deletedAt: null, updatedAt: new Date().toISOString() }, "recovered");
  }

  async function createFromMessage({ content, chatId = null, messageId = null, authorId = userId, detectionOptions } = {}) {
    const candidates = detectArtifacts(content, detectionOptions);
    const created = [];
    for (const candidate of candidates) created.push(await create({ ...candidate, chatId, messageId, authorId, metadata: { sourceStart: candidate.sourceStart, sourceEnd: candidate.sourceEnd, detectionConfidence: candidate.confidence } }));
    return created;
  }

  async function pushToCloud() {
    if (!cloud || typeof cloud.pushArtifacts !== "function") throw new Error("Artifact cloud adapter does not implement pushArtifacts().");
    const artifacts = await list({ includeDeleted: true });
    await cloud.pushArtifacts({ userId, workspaceId, artifacts: clone(artifacts) });
    notify("synced");
    return artifacts.length;
  }

  async function pullFromCloud() {
    if (!cloud || typeof cloud.pullArtifacts !== "function") throw new Error("Artifact cloud adapter does not implement pullArtifacts().");
    const remote = await cloud.pullArtifacts({ userId, workspaceId });
    if (!Array.isArray(remote)) throw new TypeError("The cloud adapter must return an array of artifacts.");
    for (const entry of remote) {
      const artifact = validateArtifact(entry);
      if (artifact.ownerId !== userId || (artifact.workspaceId || null) !== workspaceId) continue;
      const local = await get(artifact.id, { includeDeleted: true });
      if (!local || artifact.updatedAt > local.updatedAt) await store.put({ storageId: storageId(artifact.id), userId, workspaceId, artifact });
    }
    notify("hydrated");
    return list();
  }

  async function requireArtifact(id) {
    const artifact = await get(id);
    if (!artifact) throw new Error(`Artifact ${id} was not found.`);
    return artifact;
  }

  return Object.freeze({
    list, get, create, update, restoreVersion, remove, recover, createFromMessage, pushToCloud, pullFromCloud,
    synchronize: async () => { await pullFromCloud(); await pushToCloud(); return list(); },
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("An artifact listener must be a function.");
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  });
}

/** Mount a framework-neutral split view with editing and immutable versions. */
export function mountArtifactCanvas(container, {
  chatElement,
  repository,
  artifact: initialArtifact,
  renderMarkdown,
  onClose = () => {},
  onDelete = () => {}
} = {}) {
  if (!(container instanceof Element)) throw new TypeError("Canvas container must be a DOM element.");
  if (!repository) throw new TypeError("An artifact repository is required.");
  let artifact = validateArtifact(initialArtifact);
  let editing = false;

  container.replaceChildren();
  container.classList.add("artifactCanvas");
  const chatPane = element("section", "artifactCanvas__chat", { "aria-label": "Chat" });
  if (chatElement) chatPane.append(chatElement);
  const artifactPane = element("section", "artifactCanvas__artifact", { "aria-label": "Artifact editor" });
  const header = element("header", "artifactCanvas__header");
  const heading = element("h2", "artifactCanvas__title");
  const versionSelect = document.createElement("select");
  versionSelect.setAttribute("aria-label", "Artifact version");
  const editButton = button("Edit", "artifactCanvas__edit");
  const saveButton = button("Save version", "artifactCanvas__save");
  const restoreButton = button("Restore version", "artifactCanvas__restore");
  const deleteButton = button("Delete", "artifactCanvas__delete");
  const closeButton = button("Close", "artifactCanvas__close");
  const editor = document.createElement("textarea");
  editor.className = "artifactCanvas__editor";
  editor.setAttribute("aria-label", "Artifact content");
  editor.spellcheck = artifact.type === "markdown" || artifact.type === "text";
  const preview = element("div", "artifactCanvas__preview");
  header.append(heading, versionSelect, editButton, saveButton, restoreButton, deleteButton, closeButton);
  artifactPane.append(header, editor, preview);
  container.append(chatPane, artifactPane);

  function render() {
    const current = currentVersion(artifact);
    heading.textContent = artifact.title;
    editor.value = current.content;
    editor.hidden = !editing;
    preview.hidden = editing;
    editButton.hidden = editing;
    saveButton.hidden = !editing;
    versionSelect.replaceChildren(...artifact.versions.slice().reverse().map(version => {
      const option = document.createElement("option");
      option.value = version.id;
      option.textContent = `Version ${version.number} · ${new Date(version.createdAt).toLocaleString()}`;
      option.selected = version.id === artifact.currentVersionId;
      return option;
    }));
    renderArtifactPreview(preview, artifact, current.content, renderMarkdown);
  }

  editButton.addEventListener("click", () => { editing = true; render(); editor.focus(); });
  saveButton.addEventListener("click", async () => {
    saveButton.disabled = true;
    try {
      artifact = await repository.update(artifact.id, editor.value, { expectedVersionId: artifact.currentVersionId });
      editing = false;
      render();
    } finally { saveButton.disabled = false; }
  });
  versionSelect.addEventListener("change", () => {
    const selected = artifact.versions.find(version => version.id === versionSelect.value);
    if (selected) renderArtifactPreview(preview, artifact, selected.content, renderMarkdown);
  });
  restoreButton.addEventListener("click", async () => { artifact = await repository.restoreVersion(artifact.id, versionSelect.value); editing = false; render(); });
  deleteButton.addEventListener("click", async () => { await repository.remove(artifact.id); container.replaceChildren(); onDelete(artifact); });
  closeButton.addEventListener("click", () => onClose(artifact));
  render();

  return Object.freeze({
    getArtifact: () => clone(artifact),
    refresh: async () => { artifact = await repository.get(artifact.id); if (artifact) render(); return clone(artifact); },
    destroy: () => { container.replaceChildren(); container.classList.remove("artifactCanvas"); }
  });
}

function renderArtifactPreview(container, artifact, content, renderMarkdown) {
  container.replaceChildren();
  if (artifact.type === "markdown" && typeof renderMarkdown === "function") {
    renderMarkdown(container, content);
    return;
  }
  if (artifact.type === "html") {
    const frame = document.createElement("iframe");
    frame.className = "artifactCanvas__htmlPreview";
    frame.title = `${artifact.title} preview`;
    frame.setAttribute("sandbox", "");
    frame.srcdoc = content;
    container.append(frame);
    return;
  }
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  if (artifact.language) code.className = `language-${artifact.language.replace(/[^a-z0-9_-]/gi, "")}`;
  code.textContent = content;
  pre.append(code);
  container.append(pre);
}

function validateArtifact(value) {
  if (!value || typeof value !== "object") throw new TypeError("Artifact must be an object.");
  const versions = Array.isArray(value.versions) ? value.versions.map((version, index) => {
    if (!version?.id || typeof version.content !== "string") throw new TypeError(`Artifact version ${index + 1} is invalid.`);
    return { id: String(version.id), number: Number.isInteger(version.number) ? version.number : index + 1, content: boundedContent(version.content), authorId: String(version.authorId || "unknown"), changeSummary: String(version.changeSummary || "Edited artifact").slice(0, 240), createdAt: new Date(version.createdAt).toISOString() };
  }) : [];
  if (!versions.length) throw new TypeError("Artifact must contain at least one version.");
  if (!versions.some(version => version.id === value.currentVersionId)) throw new TypeError("Current artifact version does not exist.");
  if (!String(value.id || "").trim() || !String(value.ownerId || "").trim()) throw new TypeError("Artifact ID and owner ID are required.");
  return {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    id: String(value.id), ownerId: String(value.ownerId), workspaceId: value.workspaceId == null ? null : String(value.workspaceId),
    chatId: value.chatId == null ? null : String(value.chatId), messageId: value.messageId == null ? null : String(value.messageId),
    title: cleanTitle(value.title) || "Untitled artifact",
    type: ARTIFACT_TYPES.includes(value.type) ? value.type : "text",
    language: normalizeLanguage(value.language || value.type),
    currentVersionId: String(value.currentVersionId), versions,
    createdAt: new Date(value.createdAt).toISOString(), updatedAt: new Date(value.updatedAt).toISOString(),
    deletedAt: value.deletedAt == null ? null : new Date(value.deletedAt).toISOString(), metadata: scalarMetadata(value.metadata)
  };
}

function createVersion(content, authorId, summary, number, createdAt) {
  return { id: createId("version"), number, content, authorId: String(authorId), changeSummary: String(summary || "Edited artifact").slice(0, 240), createdAt };
}
function currentVersion(artifact) { return artifact.versions.find(version => version.id === artifact.currentVersionId) || artifact.versions.at(-1); }
function normalizeLanguage(value) { const language = String(value || "text").toLowerCase().replace(/[^a-z0-9.+#-]/g, ""); return LANGUAGE_ALIASES[language] || language || "text"; }
function isCompleteCode(content, language, lines, minimumLines, minimumCharacters) {
  if (lines >= minimumLines || content.length >= minimumCharacters) return true;
  if (language === "json") { try { JSON.parse(content); return content.length >= 80; } catch { return false; } }
  return language === "html" && /<!doctype\s+html|<html[\s>]/i.test(content);
}
function inferTitle(content, type, language, index) {
  if (type === "markdown") return cleanTitle(content.match(/^#\s+(.+)$/m)?.[1]) || `Markdown document ${index}`;
  if (type === "html") return cleanTitle(content.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]) || `HTML artifact ${index}`;
  const symbol = content.match(/(?:class|function|interface|def)\s+([A-Za-z_$][\w$]*)/)?.[1];
  return symbol ? `${symbol} · ${language}` : `${language} artifact ${index}`;
}
function cleanTitle(value) { return String(value || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 120); }
function scalarMetadata(value) { return Object.fromEntries(Object.entries(value && typeof value === "object" ? value : {}).filter(([, entry]) => entry == null || typeof entry === "string" || typeof entry === "boolean" || (typeof entry === "number" && Number.isFinite(entry))).slice(0, 50)); }
function boundedContent(value) { const content = String(value ?? ""); if (content.length > MAX_ARTIFACT_CONTENT_CHARACTERS) throw new RangeError(`Artifact content cannot exceed ${MAX_ARTIFACT_CONTENT_CHARACTERS} characters.`); return content; }
function createId(prefix) { return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`; }
function element(tag, className, attributes = {}) { const node = document.createElement(tag); node.className = className; Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value)); return node; }
function button(label, className) { const node = element("button", className); node.type = "button"; node.textContent = label; return node; }
function clone(value) { return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }
