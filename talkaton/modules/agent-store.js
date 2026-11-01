import { createRecordStore } from "./record-store.js";
import { createAgentProfile, parseAgentProfile, updateAgentProfile } from "./agent-schema.js";

/**
 * @typedef {Object} AgentCloudAdapter
 * @property {(context: {userId: string, workspaceId?: string|null}) => Promise<Array<object>>} pullAgents
 * @property {(context: {userId: string, workspaceId?: string|null, agents: Array<object>, deletedIds: string[]}) => Promise<void>} pushAgents
 */

/**
 * Persistent custom-agent CRUD. Pass an AgentCloudAdapter to mirror profiles
 * to the active database without coupling this module to a vendor SDK.
 */
export function createAgentRepository({
  userId,
  workspaceId = null,
  cloud = null,
  autoPush = false,
  store = createRecordStore({
    databaseName: "talkaton-agent-profiles-v1",
    storeName: "agentProfiles",
    localStorageKey: "talkaton:agent-profiles:v1"
  })
} = {}) {
  if (!userId || typeof userId !== "string") throw new TypeError("An authenticated userId is required for agent storage.");
  const listeners = new Set();
  const tombstoneKey = `talkaton:agent-deletions:v1:${userId}:${workspaceId || "personal"}`;

  function key(id) {
    return `${userId}:${workspaceId || "personal"}:${id}`;
  }

  function publish(type, agent = null) {
    const event = Object.freeze({ type, agent, at: new Date().toISOString() });
    listeners.forEach(listener => {
      try { listener(event); } catch (error) { console.error("Talkaton agent subscriber failed:", error); }
    });
  }

  async function persist(agent, eventType) {
    const parsed = parseAgentProfile(agent);
    await store.put({ storageId: key(parsed.id), userId, workspaceId, profile: parsed });
    publish(eventType, parsed);
    if (autoPush && cloud) await pushToCloud();
    return parsed;
  }

  async function list() {
    const records = await store.getAll();
    return records
      .filter(record => record.userId === userId && (record.workspaceId || null) === workspaceId)
      .map(record => parseAgentProfile(record.profile))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async function get(id) {
    const record = await store.get(key(id));
    return record?.profile ? parseAgentProfile(record.profile) : null;
  }

  async function create(input) {
    const agent = createAgentProfile({ ...input, ownerId: userId, workspaceId });
    if (await get(agent.id)) throw new Error(`Agent ${agent.id} already exists.`);
    return persist(agent, "created");
  }

  async function update(id, patch, { expectedRevision } = {}) {
    const current = await get(id);
    if (!current) throw new Error(`Agent ${id} was not found.`);
    if (expectedRevision != null && current.revision !== expectedRevision) {
      const error = new Error("This agent was updated elsewhere. Reload it before saving again.");
      error.code = "AGENT_REVISION_CONFLICT";
      error.current = current;
      throw error;
    }
    return persist(updateAgentProfile(current, patch), "updated");
  }

  async function remove(id) {
    const current = await get(id);
    if (!current) return false;
    await store.delete(key(id));
    writeTombstones([...new Set([...readTombstones(), id])]);
    publish("deleted", current);
    if (autoPush && cloud) await pushToCloud();
    return true;
  }

  async function replaceKnowledge(id, attachments, options) {
    return update(id, { knowledge: attachments }, options);
  }

  async function addKnowledge(id, attachment, options) {
    const current = await get(id);
    if (!current) throw new Error(`Agent ${id} was not found.`);
    if (current.knowledge.some(entry => entry.id === attachment?.id)) throw new Error(`Knowledge attachment ${attachment.id} already exists.`);
    return update(id, { knowledge: [...current.knowledge, attachment] }, options);
  }

  async function removeKnowledge(id, attachmentId, options) {
    const current = await get(id);
    if (!current) throw new Error(`Agent ${id} was not found.`);
    if (!current.knowledge.some(entry => entry.id === attachmentId)) return current;
    return update(id, { knowledge: current.knowledge.filter(entry => entry.id !== attachmentId) }, options);
  }

  async function pushToCloud() {
    requireCloud("pushAgents");
    const agents = (await list()).map(serializeForCloud);
    const deletedIds = readTombstones();
    await cloud.pushAgents({ userId, workspaceId, agents, deletedIds });
    writeTombstones([]);
    publish("synced");
    return agents.length;
  }

  async function pullFromCloud({ replace = false } = {}) {
    requireCloud("pullAgents");
    const remote = await cloud.pullAgents({ userId, workspaceId });
    if (!Array.isArray(remote)) throw new TypeError("The cloud adapter must return an array of agents.");
    const local = new Map((await list()).map(agent => [agent.id, agent]));
    const remoteIds = new Set();
    for (const candidate of remote) {
      const agent = parseAgentProfile(candidate);
      if (agent.ownerId !== userId || (agent.workspaceId || null) !== workspaceId) continue;
      remoteIds.add(agent.id);
      const current = local.get(agent.id);
      if (!current || agent.updatedAt > current.updatedAt) await store.put({ storageId: key(agent.id), userId, workspaceId, profile: agent });
    }
    if (replace) {
      for (const current of local.values()) if (!remoteIds.has(current.id)) await store.delete(key(current.id));
    }
    publish("hydrated");
    return list();
  }

  async function synchronize() {
    await pullFromCloud();
    await pushToCloud();
    return list();
  }

  function requireCloud(method) {
    if (!cloud || typeof cloud[method] !== "function") throw new Error(`Agent cloud adapter does not implement ${method}().`);
  }

  function readTombstones() {
    try { return JSON.parse(globalThis.localStorage?.getItem(tombstoneKey) || "[]").filter(id => typeof id === "string"); }
    catch { return []; }
  }

  function writeTombstones(ids) {
    try { globalThis.localStorage?.setItem(tombstoneKey, JSON.stringify(ids)); } catch (error) { console.warn("Talkaton could not save agent deletion state:", error); }
  }

  return Object.freeze({
    list,
    get,
    create,
    update,
    remove,
    replaceKnowledge,
    addKnowledge,
    removeKnowledge,
    pushToCloud,
    pullFromCloud,
    synchronize,
    export: async () => JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), agents: (await list()).map(serializeForCloud) }, null, 2),
    import: async payload => {
      const parsed = typeof payload === "string" ? JSON.parse(payload) : payload;
      const entries = Array.isArray(parsed) ? parsed : parsed?.agents;
      if (!Array.isArray(entries)) throw new TypeError("Agent import must contain an agents array.");
      const saved = [];
      for (const entry of entries) {
        const agent = parseAgentProfile(entry);
        if (agent.ownerId !== userId || (agent.workspaceId || null) !== workspaceId) throw new Error("Imported agents must belong to the current account and workspace.");
        saved.push(await persist(agent, "imported"));
      }
      return saved;
    },
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("An agent listener must be a function.");
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  });
}

export function serializeForCloud(agent) {
  const parsed = parseAgentProfile(agent);
  return JSON.parse(JSON.stringify(parsed, (key, value) => {
    if (key === "inlineText" && typeof value === "string" && value.length > 1_000_000) return undefined;
    return value;
  }));
}
