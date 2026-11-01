export const AGENT_SCHEMA_VERSION = 1;
export const AGENT_TOOL_IDS = Object.freeze(["webSearch", "imageGeneration", "fileAnalysis", "python", "codeExecution", "voice", "github"]);
export const AGENT_LIMITS = Object.freeze({
  name: 80,
  description: 500,
  systemInstructions: 32_000,
  preferredModel: 120,
  tags: 20,
  tagLength: 40,
  attachments: 30,
  attachmentName: 240,
  attachmentBytes: 50 * 1024 * 1024,
  inlineKnowledgeCharacters: 1_000_000,
  customTools: 40,
  metadataEntries: 50
});

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const TOOL_PATTERN = /^[a-z][a-z0-9]*(?::[a-z][a-z0-9-]*)+$/;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export function createAgentProfile(input, { now = new Date(), id = createId("agent") } = {}) {
  const timestamp = now.toISOString();
  return parseAgentProfile({
    schemaVersion: AGENT_SCHEMA_VERSION,
    id: input?.id || id,
    ownerId: input?.ownerId,
    workspaceId: input?.workspaceId ?? null,
    name: input?.name,
    description: input?.description ?? "",
    systemInstructions: input?.systemInstructions,
    preferredModel: input?.preferredModel ?? null,
    avatarColor: input?.avatarColor ?? "#f43f4a",
    visibility: input?.visibility ?? "private",
    tools: input?.tools,
    knowledge: input?.knowledge ?? [],
    tags: input?.tags ?? [],
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    metadata: input?.metadata ?? {}
  });
}

export function updateAgentProfile(current, patch, { now = new Date() } = {}) {
  const existing = parseAgentProfile(current);
  if (patch?.id && patch.id !== existing.id) throw new TypeError("An agent ID cannot be changed.");
  if (patch?.ownerId && patch.ownerId !== existing.ownerId) throw new TypeError("An agent owner cannot be changed.");
  return parseAgentProfile({ ...existing, ...patch, id: existing.id, ownerId: existing.ownerId, revision: existing.revision + 1, createdAt: existing.createdAt, updatedAt: now.toISOString() });
}

export function validateAgentProfile(value) {
  const issues = [];
  if (!isRecord(value)) return { success: false, data: null, issues: [{ path: "$", message: "Agent must be an object.", code: "invalid_type" }] };
  if (value.schemaVersion != null && value.schemaVersion !== AGENT_SCHEMA_VERSION) addIssue(issues, "schemaVersion", `Unsupported agent schema version ${String(value.schemaVersion)}.`, "invalid_value");
  const now = new Date().toISOString();
  const id = readText(value.id, "id", issues, { required: true, max: 128, pattern: ID_PATTERN });
  const ownerId = readText(value.ownerId, "ownerId", issues, { required: true, max: 128, pattern: ID_PATTERN });
  const workspaceId = value.workspaceId == null ? null : readText(value.workspaceId, "workspaceId", issues, { required: true, max: 128, pattern: ID_PATTERN });
  const name = readText(value.name, "name", issues, { required: true, max: AGENT_LIMITS.name });
  const description = readText(value.description ?? "", "description", issues, { max: AGENT_LIMITS.description });
  const systemInstructions = readText(value.systemInstructions, "systemInstructions", issues, { required: true, max: AGENT_LIMITS.systemInstructions, trim: false });
  const preferredModel = value.preferredModel == null ? null : readText(value.preferredModel, "preferredModel", issues, { required: true, max: AGENT_LIMITS.preferredModel });
  const avatarColor = readText(value.avatarColor ?? "#f43f4a", "avatarColor", issues, { required: true, max: 7, pattern: COLOR_PATTERN });
  const visibility = value.visibility === "workspace" ? "workspace" : "private";
  if (value.visibility != null && !["private", "workspace"].includes(value.visibility)) addIssue(issues, "visibility", "Visibility must be private or workspace.", "invalid_value");
  if (visibility === "workspace" && !workspaceId) addIssue(issues, "workspaceId", "Workspace agents require a workspace ID.", "required");
  const revision = Number.isInteger(value.revision) && value.revision > 0 ? value.revision : 1;
  const createdAt = readDate(value.createdAt ?? now, "createdAt", issues);
  const updatedAt = readDate(value.updatedAt ?? createdAt, "updatedAt", issues);
  const tools = normalizeTools(value.tools, issues);
  const knowledge = normalizeKnowledge(value.knowledge, issues, now);
  const tags = normalizeTags(value.tags, issues);
  const metadata = normalizeMetadata(value.metadata, "metadata", issues);
  if (issues.length) return { success: false, data: null, issues };
  return { success: true, issues: [], data: { schemaVersion: AGENT_SCHEMA_VERSION, id, ownerId, workspaceId, name, description, systemInstructions, preferredModel, avatarColor, visibility, tools, knowledge, tags, revision, createdAt, updatedAt, metadata } };
}

export function parseAgentProfile(value) {
  const result = validateAgentProfile(value);
  if (result.success) return result.data;
  throw new TypeError(result.issues.map(entry => `${entry.path}: ${entry.message}`).join("; "));
}

export function serializeAgentProfile(value) {
  return JSON.stringify(parseAgentProfile(value));
}

export function isAgentProfile(value) {
  return validateAgentProfile(value).success;
}

export async function createKnowledgeAttachment(file, { storageKind = "inline", storagePath, includeText = true, metadata = {} } = {}) {
  if (!file || typeof file.name !== "string") throw new TypeError("A file with a name is required.");
  const size = Number(file.size || 0);
  if (size > AGENT_LIMITS.attachmentBytes) throw new RangeError(`Knowledge files cannot exceed ${AGENT_LIMITS.attachmentBytes} bytes.`);
  if (!["inline", "local", "cloud"].includes(storageKind)) throw new TypeError("Unknown knowledge storage kind.");
  if (storageKind !== "inline" && !storagePath) throw new TypeError("Local and cloud knowledge files require a storage path.");
  const textCapable = /^(text\/|application\/(json|xml|javascript|typescript|csv))/.test(file.type || "") || /\.(md|txt|csv|json|ya?ml|xml|js|ts|tsx|jsx|py|sql)$/i.test(file.name);
  let inlineText;
  if (storageKind === "inline" && includeText && textCapable && typeof file.text === "function") {
    inlineText = await file.text();
    if (inlineText.length > AGENT_LIMITS.inlineKnowledgeCharacters) throw new RangeError("Extracted knowledge text is too large for an agent profile.");
  }
  return {
    id: createId("knowledge"),
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    size,
    storageKind,
    ...(inlineText == null ? {} : { inlineText }),
    ...(storagePath ? { storagePath } : {}),
    createdAt: new Date().toISOString(),
    metadata: normalizeMetadata(metadata, "metadata", [])
  };
}

function normalizeTools(value, issues) {
  const source = isRecord(value) ? value : {};
  if (value != null && !isRecord(value)) addIssue(issues, "tools", "Tools must be an object.", "invalid_type");
  const tools = Object.fromEntries(AGENT_TOOL_IDS.map(key => [key, source[key] === true]));
  const customSource = isRecord(source.custom) ? source.custom : {};
  if (source.custom != null && !isRecord(source.custom)) addIssue(issues, "tools.custom", "Custom tools must be an object.", "invalid_type");
  const entries = Object.entries(customSource);
  if (entries.length > AGENT_LIMITS.customTools) addIssue(issues, "tools.custom", `At most ${AGENT_LIMITS.customTools} custom tools are allowed.`, "too_large");
  tools.custom = {};
  for (const [key, enabled] of entries.slice(0, AGENT_LIMITS.customTools)) {
    if (!TOOL_PATTERN.test(key)) addIssue(issues, `tools.custom.${key}`, "Use a namespaced lowercase tool identifier.", "invalid_value");
    else if (typeof enabled !== "boolean") addIssue(issues, `tools.custom.${key}`, "Tool state must be boolean.", "invalid_type");
    else tools.custom[key] = enabled;
  }
  return tools;
}

function normalizeKnowledge(value, issues, now) {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    addIssue(issues, "knowledge", "Knowledge attachments must be an array.", "invalid_type");
    return [];
  }
  if (value.length > AGENT_LIMITS.attachments) addIssue(issues, "knowledge", `At most ${AGENT_LIMITS.attachments} attachments are allowed.`, "too_large");
  const seen = new Set();
  return value.slice(0, AGENT_LIMITS.attachments).map((entry, index) => {
    const source = isRecord(entry) ? entry : {};
    const path = `knowledge.${index}`;
    if (!isRecord(entry)) addIssue(issues, path, "Attachment must be an object.", "invalid_type");
    const id = readText(source.id ?? createId("knowledge"), `${path}.id`, issues, { required: true, max: 128, pattern: ID_PATTERN });
    if (seen.has(id)) addIssue(issues, `${path}.id`, "Attachment IDs must be unique.", "duplicate");
    seen.add(id);
    const storageKind = ["local", "cloud"].includes(source.storageKind) ? source.storageKind : "inline";
    if (source.storageKind != null && !["inline", "local", "cloud"].includes(source.storageKind)) addIssue(issues, `${path}.storageKind`, "Unknown storage kind.", "invalid_value");
    const storagePath = source.storagePath == null ? undefined : readText(source.storagePath, `${path}.storagePath`, issues, { max: 1_000 });
    if (storageKind !== "inline" && !storagePath) addIssue(issues, `${path}.storagePath`, "Local and cloud attachments require a storage path.", "required");
    const size = Number(source.size ?? 0);
    if (!Number.isInteger(size) || size < 0 || size > AGENT_LIMITS.attachmentBytes) addIssue(issues, `${path}.size`, "Attachment size is outside the allowed range.", "too_large");
    return {
      id,
      name: readText(source.name, `${path}.name`, issues, { required: true, max: AGENT_LIMITS.attachmentName }),
      mimeType: readText(source.mimeType ?? "application/octet-stream", `${path}.mimeType`, issues, { required: true, max: 160 }),
      size: Number.isFinite(size) ? size : 0,
      storageKind,
      ...(source.inlineText == null ? {} : { inlineText: readText(source.inlineText, `${path}.inlineText`, issues, { max: AGENT_LIMITS.inlineKnowledgeCharacters, trim: false }) }),
      ...(storagePath ? { storagePath } : {}),
      ...(source.checksum == null ? {} : { checksum: readText(source.checksum, `${path}.checksum`, issues, { max: 128 }) }),
      createdAt: readDate(source.createdAt ?? now, `${path}.createdAt`, issues),
      metadata: normalizeMetadata(source.metadata, `${path}.metadata`, issues)
    };
  });
}

function normalizeTags(value, issues) {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    addIssue(issues, "tags", "Tags must be an array.", "invalid_type");
    return [];
  }
  if (value.length > AGENT_LIMITS.tags) addIssue(issues, "tags", `At most ${AGENT_LIMITS.tags} tags are allowed.`, "too_large");
  return [...new Set(value.slice(0, AGENT_LIMITS.tags).map((tag, index) => readText(tag, `tags.${index}`, issues, { required: true, max: AGENT_LIMITS.tagLength })).filter(Boolean))];
}

function normalizeMetadata(value, path, issues) {
  if (value == null) return {};
  if (!isRecord(value)) {
    addIssue(issues, path, "Metadata must be an object.", "invalid_type");
    return {};
  }
  const entries = Object.entries(value);
  if (entries.length > AGENT_LIMITS.metadataEntries) addIssue(issues, path, `At most ${AGENT_LIMITS.metadataEntries} metadata entries are allowed.`, "too_large");
  return Object.fromEntries(entries.slice(0, AGENT_LIMITS.metadataEntries).filter(([key, entry]) => {
    const valid = typeof entry === "string" || (typeof entry === "number" && Number.isFinite(entry)) || typeof entry === "boolean" || entry === null;
    if (!valid) addIssue(issues, `${path}.${key}`, "Metadata values must be scalar.", "invalid_type");
    return valid;
  }).map(([key, entry]) => [key.slice(0, 80), entry]));
}

function readText(value, path, issues, { required = false, max, pattern, trim = true }) {
  if (typeof value !== "string") {
    addIssue(issues, path, "Value must be text.", "invalid_type");
    return "";
  }
  const result = trim ? value.trim() : value;
  if (required && !result.trim()) addIssue(issues, path, "Value is required.", "required");
  if (result.length > max) addIssue(issues, path, `Value cannot exceed ${max} characters.`, "too_long");
  if (result && pattern && !pattern.test(result)) addIssue(issues, path, "Value has an invalid format.", "invalid_value");
  return result.slice(0, max);
}

function readDate(value, path, issues) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    addIssue(issues, path, "Value must be a valid date.", "invalid_value");
    return new Date(0).toISOString();
  }
  return date.toISOString();
}

function addIssue(issues, path, message, code) {
  issues.push({ path, message, code });
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function createId(prefix) {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}
