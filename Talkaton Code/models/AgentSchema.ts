/**
 * Canonical custom-agent contract for API, database, and UI boundaries.
 * Keep the browser runtime validator in modules/agent-schema.js aligned with
 * this contract when the schema version changes.
 */

export const AGENT_SCHEMA_VERSION = 1 as const;

export const AGENT_TOOL_IDS = [
  "webSearch",
  "imageGeneration",
  "fileAnalysis",
  "python",
  "codeExecution",
  "voice",
  "github"
] as const;

export type AgentToolId = (typeof AGENT_TOOL_IDS)[number];
export type AgentVisibility = "private" | "workspace";
export type KnowledgeStorageKind = "inline" | "local" | "cloud";

export interface AgentKnowledgeAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  storageKind: KnowledgeStorageKind;
  /** Text content is bounded so profiles remain portable. Large files use storagePath. */
  inlineText?: string;
  storagePath?: string;
  checksum?: string;
  createdAt: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface AgentToolConfiguration {
  webSearch: boolean;
  imageGeneration: boolean;
  fileAnalysis: boolean;
  python: boolean;
  codeExecution: boolean;
  voice: boolean;
  github: boolean;
  /** Namespaced extension tools, for example `workspace:calendar`. */
  custom: Record<string, boolean>;
}

export interface AgentSchema {
  schemaVersion: typeof AGENT_SCHEMA_VERSION;
  id: string;
  ownerId: string;
  workspaceId: string | null;
  name: string;
  description: string;
  systemInstructions: string;
  preferredModel: string | null;
  avatarColor: string;
  visibility: AgentVisibility;
  tools: AgentToolConfiguration;
  knowledge: AgentKnowledgeAttachment[];
  tags: string[];
  revision: number;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, string | number | boolean | null>;
}

export interface AgentInput {
  id?: string;
  ownerId: string;
  workspaceId?: string | null;
  name: string;
  description?: string;
  systemInstructions: string;
  preferredModel?: string | null;
  avatarColor?: string;
  visibility?: AgentVisibility;
  tools?: Partial<Omit<AgentToolConfiguration, "custom">> & { custom?: Record<string, boolean> };
  knowledge?: Partial<AgentKnowledgeAttachment>[];
  tags?: string[];
  metadata?: Record<string, string | number | boolean | null>;
}

export interface AgentValidationIssue {
  path: string;
  message: string;
  code: "required" | "invalid_type" | "invalid_value" | "too_long" | "too_large" | "duplicate";
}

export type AgentValidationResult =
  | { success: true; data: AgentSchema; issues: [] }
  | { success: false; data: null; issues: AgentValidationIssue[] };

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

export function createAgentProfile(input: AgentInput, now = new Date()): AgentSchema {
  const timestamp = now.toISOString();
  const candidate = {
    schemaVersion: AGENT_SCHEMA_VERSION,
    id: input.id || createAgentId(),
    ownerId: input.ownerId,
    workspaceId: input.workspaceId ?? null,
    name: input.name,
    description: input.description ?? "",
    systemInstructions: input.systemInstructions,
    preferredModel: input.preferredModel ?? null,
    avatarColor: input.avatarColor ?? "#f43f4a",
    visibility: input.visibility ?? "private",
    tools: input.tools,
    knowledge: input.knowledge ?? [],
    tags: input.tags ?? [],
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    metadata: input.metadata ?? {}
  };
  return parseAgentProfile(candidate);
}

export function validateAgentProfile(value: unknown): AgentValidationResult {
  const issues: AgentValidationIssue[] = [];
  if (!isRecord(value)) {
    return { success: false, data: null, issues: [{ path: "$", message: "Agent must be an object.", code: "invalid_type" }] };
  }

  if (value.schemaVersion != null && value.schemaVersion !== AGENT_SCHEMA_VERSION) {
    issue(issues, "schemaVersion", `Unsupported agent schema version ${String(value.schemaVersion)}.`, "invalid_value");
  }

  const now = new Date().toISOString();
  const id = readString(value.id, "id", issues, { required: true, max: 128, pattern: ID_PATTERN });
  const ownerId = readString(value.ownerId, "ownerId", issues, { required: true, max: 128, pattern: ID_PATTERN });
  const workspaceId = value.workspaceId == null ? null : readString(value.workspaceId, "workspaceId", issues, { required: true, max: 128, pattern: ID_PATTERN });
  const name = readString(value.name, "name", issues, { required: true, max: AGENT_LIMITS.name });
  const description = readString(value.description ?? "", "description", issues, { max: AGENT_LIMITS.description });
  const systemInstructions = readString(value.systemInstructions, "systemInstructions", issues, { required: true, max: AGENT_LIMITS.systemInstructions, trim: false });
  const preferredModel = value.preferredModel == null ? null : readString(value.preferredModel, "preferredModel", issues, { required: true, max: AGENT_LIMITS.preferredModel });
  const avatarColor = readString(value.avatarColor ?? "#f43f4a", "avatarColor", issues, { required: true, max: 7, pattern: COLOR_PATTERN });
  const visibility: AgentVisibility = value.visibility === "workspace" ? "workspace" : "private";

  if (value.visibility != null && value.visibility !== "private" && value.visibility !== "workspace") {
    issue(issues, "visibility", "Visibility must be private or workspace.", "invalid_value");
  }
  if (visibility === "workspace" && !workspaceId) issue(issues, "workspaceId", "Workspace agents require a workspace ID.", "required");

  const revision = Number.isInteger(value.revision) && Number(value.revision) > 0 ? Number(value.revision) : 1;
  const createdAt = readDate(value.createdAt ?? now, "createdAt", issues);
  const updatedAt = readDate(value.updatedAt ?? createdAt, "updatedAt", issues);
  const tools = normalizeTools(value.tools, issues);
  const knowledge = normalizeKnowledge(value.knowledge, issues, now);
  const tags = normalizeTags(value.tags, issues);
  const metadata = normalizeMetadata(value.metadata, "metadata", issues);

  if (issues.length) return { success: false, data: null, issues };
  return {
    success: true,
    issues: [],
    data: {
      schemaVersion: AGENT_SCHEMA_VERSION,
      id,
      ownerId,
      workspaceId,
      name,
      description,
      systemInstructions,
      preferredModel,
      avatarColor,
      visibility,
      tools,
      knowledge,
      tags,
      revision,
      createdAt,
      updatedAt,
      metadata
    }
  };
}

export function parseAgentProfile(value: unknown): AgentSchema {
  const result = validateAgentProfile(value);
  if (result.success) return result.data;
  throw new TypeError(result.issues.map(entry => `${entry.path}: ${entry.message}`).join("; "));
}

export function serializeAgentProfile(value: unknown): string {
  return JSON.stringify(parseAgentProfile(value));
}

export function isAgentProfile(value: unknown): value is AgentSchema {
  return validateAgentProfile(value).success;
}

function normalizeTools(value: unknown, issues: AgentValidationIssue[]): AgentToolConfiguration {
  const source = isRecord(value) ? value : {};
  if (value != null && !isRecord(value)) issue(issues, "tools", "Tools must be an object.", "invalid_type");
  const builtIn = Object.fromEntries(AGENT_TOOL_IDS.map(key => [key, source[key] === true])) as unknown as Omit<AgentToolConfiguration, "custom">;
  const customSource = isRecord(source.custom) ? source.custom : {};
  const custom: Record<string, boolean> = {};
  if (source.custom != null && !isRecord(source.custom)) issue(issues, "tools.custom", "Custom tools must be an object.", "invalid_type");
  const entries = Object.entries(customSource);
  if (entries.length > AGENT_LIMITS.customTools) issue(issues, "tools.custom", `At most ${AGENT_LIMITS.customTools} custom tools are allowed.`, "too_large");
  for (const [key, enabled] of entries.slice(0, AGENT_LIMITS.customTools)) {
    if (!TOOL_PATTERN.test(key)) issue(issues, `tools.custom.${key}`, "Use a namespaced lowercase tool identifier.", "invalid_value");
    else if (typeof enabled !== "boolean") issue(issues, `tools.custom.${key}`, "Tool state must be boolean.", "invalid_type");
    else custom[key] = enabled;
  }
  return { ...builtIn, custom };
}

function normalizeKnowledge(value: unknown, issues: AgentValidationIssue[], now: string): AgentKnowledgeAttachment[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    issue(issues, "knowledge", "Knowledge attachments must be an array.", "invalid_type");
    return [];
  }
  if (value.length > AGENT_LIMITS.attachments) issue(issues, "knowledge", `At most ${AGENT_LIMITS.attachments} attachments are allowed.`, "too_large");
  const seen = new Set<string>();
  return value.slice(0, AGENT_LIMITS.attachments).map((entry, index) => {
    const path = `knowledge.${index}`;
    const source = isRecord(entry) ? entry : {};
    if (!isRecord(entry)) issue(issues, path, "Attachment must be an object.", "invalid_type");
    const id = readString(source.id ?? createAgentId("knowledge"), `${path}.id`, issues, { required: true, max: 128, pattern: ID_PATTERN });
    if (seen.has(id)) issue(issues, `${path}.id`, "Attachment IDs must be unique.", "duplicate");
    seen.add(id);
    const name = readString(source.name, `${path}.name`, issues, { required: true, max: AGENT_LIMITS.attachmentName });
    const mimeType = readString(source.mimeType ?? "application/octet-stream", `${path}.mimeType`, issues, { required: true, max: 160 });
    const size = Number(source.size ?? 0);
    if (!Number.isInteger(size) || size < 0 || size > AGENT_LIMITS.attachmentBytes) issue(issues, `${path}.size`, `File size must be between 0 and ${AGENT_LIMITS.attachmentBytes} bytes.`, "too_large");
    const storageKind: KnowledgeStorageKind = source.storageKind === "cloud" || source.storageKind === "local" ? source.storageKind : "inline";
    if (source.storageKind != null && !["inline", "local", "cloud"].includes(String(source.storageKind))) issue(issues, `${path}.storageKind`, "Unknown storage kind.", "invalid_value");
    const inlineText = source.inlineText == null ? undefined : readString(source.inlineText, `${path}.inlineText`, issues, { max: AGENT_LIMITS.inlineKnowledgeCharacters });
    const storagePath = source.storagePath == null ? undefined : readString(source.storagePath, `${path}.storagePath`, issues, { max: 1_000 });
    if (storageKind !== "inline" && !storagePath) issue(issues, `${path}.storagePath`, "Local and cloud attachments require a storage path.", "required");
    const checksum = source.checksum == null ? undefined : readString(source.checksum, `${path}.checksum`, issues, { max: 128 });
    return { id, name, mimeType, size: Number.isFinite(size) ? size : 0, storageKind, inlineText, storagePath, checksum, createdAt: readDate(source.createdAt ?? now, `${path}.createdAt`, issues), metadata: normalizeMetadata(source.metadata, `${path}.metadata`, issues) };
  });
}

function normalizeTags(value: unknown, issues: AgentValidationIssue[]): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    issue(issues, "tags", "Tags must be an array.", "invalid_type");
    return [];
  }
  if (value.length > AGENT_LIMITS.tags) issue(issues, "tags", `At most ${AGENT_LIMITS.tags} tags are allowed.`, "too_large");
  return [...new Set(value.slice(0, AGENT_LIMITS.tags).map((tag, index) => readString(tag, `tags.${index}`, issues, { required: true, max: AGENT_LIMITS.tagLength })).filter(Boolean))];
}

function normalizeMetadata(value: unknown, path: string, issues: AgentValidationIssue[]): Record<string, string | number | boolean | null> {
  if (value == null) return {};
  if (!isRecord(value)) {
    issue(issues, path, "Metadata must be an object.", "invalid_type");
    return {};
  }
  const entries = Object.entries(value);
  if (entries.length > AGENT_LIMITS.metadataEntries) issue(issues, path, `At most ${AGENT_LIMITS.metadataEntries} metadata entries are allowed.`, "too_large");
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, entry] of entries.slice(0, AGENT_LIMITS.metadataEntries)) {
    if (typeof entry === "string" || (typeof entry === "number" && Number.isFinite(entry)) || typeof entry === "boolean" || entry === null) result[key.slice(0, 80)] = entry;
    else issue(issues, `${path}.${key}`, "Metadata values must be scalar.", "invalid_type");
  }
  return result;
}

function readString(value: unknown, path: string, issues: AgentValidationIssue[], options: { required?: boolean; max: number; pattern?: RegExp; trim?: boolean }): string {
  if (typeof value !== "string") {
    issue(issues, path, "Value must be text.", "invalid_type");
    return "";
  }
  const result = options.trim === false ? value : value.trim();
  if (options.required && !result.trim()) issue(issues, path, "Value is required.", "required");
  if (result.length > options.max) issue(issues, path, `Value cannot exceed ${options.max} characters.`, "too_long");
  if (result && options.pattern && !options.pattern.test(result)) issue(issues, path, "Value has an invalid format.", "invalid_value");
  return result.slice(0, options.max);
}

function readDate(value: unknown, path: string, issues: AgentValidationIssue[]): string {
  const date = new Date(typeof value === "string" || typeof value === "number" ? value : Number.NaN);
  if (Number.isNaN(date.getTime())) {
    issue(issues, path, "Value must be a valid date.", "invalid_value");
    return new Date(0).toISOString();
  }
  return date.toISOString();
}

function issue(issues: AgentValidationIssue[], path: string, message: string, code: AgentValidationIssue["code"]): void {
  issues.push({ path, message, code });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function createAgentId(prefix = "agent"): string {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}
