import { createAgentRepository } from "../modules/agent-store.js";
import { createKnowledgeAttachment } from "../modules/agent-schema.js";
import { createArtifactRepository, detectArtifacts } from "../modules/artifacts.js";
import { PythonSandbox } from "../modules/python-sandbox.js";
import { downloadTranscript } from "../modules/transcript-export.js";

let host = globalThis.TalkatonHost || null;
const byId = id => document.getElementById(id);
const dom = Object.fromEntries([
  "productivityDialog", "studioBtn", "studioNavHint", "agentForm", "agentName", "agentDescription", "agentInstructions",
  "agentList", "agentKnowledgeBtn", "agentKnowledgeInput", "agentKnowledgeList", "agentError",
  "agentFormTitle", "activeAgentStatus", "newAgentBtn", "deleteAgentBtn", "activateAgentBtn",
  "artifactList", "newArtifactBtn", "artifactTitle", "artifactLanguage", "artifactVersion", "artifactContent",
  "artifactPreview", "artifactSaveStatus", "saveArtifactBtn", "restoreArtifactBtn", "deleteArtifactBtn",
  "openArtifactWindowBtn", "analysisFileInput", "analysisFileName", "analysisFileMeta", "analysisCode",
  "analysisStatus", "analysisTextOutput", "analysisVisualOutput", "runAnalysisBtn", "stopAnalysisBtn",
  "resetAnalysisBtn", "artifactFromAnalysisBtn", "workspaceList", "workspaceTitle", "workspaceRole",
  "workspaceChats", "workspaceFiles", "workspaceError", "newWorkspaceBtn", "inviteWorkspaceBtn",
  "shareCurrentChatBtn", "workspaceFileBtn", "workspaceFileInput", "apiKeyForm", "apiKeyName",
  "newApiKeyReveal", "apiKeyList", "connectGithubBtn", "githubRepository", "loadRepositoryBtn", "canvasChatMirror",
  "proposePullRequestBtn", "githubStatus", "repositoryTree", "exportStatus", "chatArea"
].map(id => [id, byId(id)]));

const TOOL_MAP = Object.freeze({ web: "webSearch", images: "imageGeneration", files: "fileAnalysis", python: "python", canvas: "codeExecution" });
const TOOL_API = Object.freeze({ webSearch: "web", imageGeneration: "images", fileAnalysis: "files", python: "python", codeExecution: "canvas" });
const ACTIVE_AGENT_KEY = "talkaton:active-agent:v1";
const GUEST_PROFILE_KEY = "talkaton:studio-profile:v1";
const DEFAULT_ANALYSIS = `# Uploaded files are available by their exact file name.
file_name = next(iter(INPUT_FILES))
df = read_table(file_name)
print(df.describe(include="all").to_string())
df.head(20)`;

let ownerId = "";
let agents;
let artifacts;
let activeAgent = null;
let selectedAgent = null;
let knowledge = [];
let selectedArtifact = null;
let analysisFile = null;
let analysisResult = null;
let python = null;
let workspace = null;
let workspaceChannel = null;
let scanTimer = null;
let initialized = false;

globalThis.TalkatonProductivity = Object.freeze({
  getActiveAgent: () => currentProfileId() === ownerId && activeAgent ? apiAgent(activeAgent) : null,
  open: section => openStudio(section || "agents"),
  scanArtifacts
});

if (dom.productivityDialog) {
  if (host) initialize();
  else document.addEventListener("talkaton:host-ready", () => {
    host = globalThis.TalkatonHost || null;
    if (host) initialize();
  }, { once: true });
}

function initialize() {
  if (initialized) return;
  initialized = true;
  bindStudio();
  bindAgents();
  bindCanvas();
  bindAnalysis();
  bindWorkspaces();
  bindDeveloper();
  bindExports();
  observeArtifacts();
  ensureStores().then(() => Promise.all([loadAgents(), scanArtifacts()])).catch(reportError);
  const url = new URL(location.href);
  if (url.searchParams.get("github") === "connected") {
    url.searchParams.delete("github");
    history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    setTimeout(() => openStudio("developer"), 250);
  }
}

function bindStudio() {
  dom.studioBtn?.addEventListener("click", () => openStudio("agents"));
  const launchers = { popoverAgentStudio: "agents", popoverCanvas: "canvas", popoverDataAnalysis: "analysis", popoverExport: "export" };
  for (const [id, section] of Object.entries(launchers)) byId(id)?.addEventListener("click", () => {
    const popover = byId("toolsPopover");
    if (popover?.matches?.(":popover-open")) popover.hidePopover();
    openStudio(section);
  });
  document.querySelectorAll("[data-open-studio]").forEach(button => button.addEventListener("click", () => openStudio(button.dataset.openStudio)));
  document.querySelectorAll("[data-studio-tab]").forEach(button => {
    button.addEventListener("click", () => selectTab(button.dataset.studioTab));
    button.addEventListener("keydown", event => {
      if (!new Set(["ArrowLeft", "ArrowRight"]).has(event.key)) return;
      const tabs = [...document.querySelectorAll("[data-studio-tab]")];
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const next = tabs[(tabs.indexOf(button) + direction + tabs.length) % tabs.length];
      event.preventDefault();
      next.focus();
      selectTab(next.dataset.studioTab);
    });
  });
  document.querySelectorAll("[data-close-dialog='productivityDialog']").forEach(button => button.addEventListener("click", () => host.closeDialog(dom.productivityDialog)));
}

async function openStudio(section = "agents") {
  await ensureStores();
  selectTab(section);
  host.openDialog(dom.productivityDialog);
  if (section === "agents") await loadAgents();
  if (section === "canvas") await loadArtifacts();
  if (section === "workspace") await loadWorkspaces();
  if (section === "developer") await loadDeveloper();
}

function selectTab(name) {
  document.querySelectorAll("[data-studio-tab]").forEach(button => {
    const active = button.dataset.studioTab === name;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll("[data-studio-panel]").forEach(panel => { panel.hidden = panel.dataset.studioPanel !== name; });
}

async function ensureStores() {
  const currentOwner = currentProfileId();
  if (currentOwner === ownerId && agents && artifacts) return;
  ownerId = currentOwner;
  agents = createAgentRepository({ userId: ownerId });
  artifacts = createArtifactRepository({ userId: ownerId });
  selectedAgent = null;
  selectedArtifact = null;
  const activeId = scopedValue(ACTIVE_AGENT_KEY);
  activeAgent = activeId ? await agents.get(activeId) : null;
}

function currentProfileId() {
  return host.getUser()?.id || guestProfileId();
}

function guestProfileId() {
  let value = localStorage.getItem(GUEST_PROFILE_KEY);
  if (!value) {
    value = `guest:${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
    localStorage.setItem(GUEST_PROFILE_KEY, value);
  }
  return value;
}

function scopedValue(key, nextValue) {
  let values = {};
  try { values = JSON.parse(localStorage.getItem(key) || "{}"); } catch {}
  if (arguments.length > 1) {
    values[ownerId] = nextValue;
    localStorage.setItem(key, JSON.stringify(values));
  }
  return values[ownerId] || "";
}

function bindAgents() {
  dom.newAgentBtn.addEventListener("click", () => editAgent(null));
  dom.agentKnowledgeBtn.addEventListener("click", () => dom.agentKnowledgeInput.click());
  dom.agentKnowledgeInput.addEventListener("change", attachKnowledge);
  dom.agentForm.addEventListener("submit", saveAgent);
  dom.activateAgentBtn.addEventListener("click", activateAgent);
  dom.deleteAgentBtn.addEventListener("click", deleteAgent);
}

async function loadAgents() {
  await ensureStores();
  const list = await agents.list();
  dom.agentList.replaceChildren(...list.map(agent => {
    const button = node("button", "agentListItem");
    button.type = "button";
    button.dataset.active = String(agent.id === activeAgent?.id);
    const dot = node("span", "agentDot");
    dot.style.setProperty("--agent-color", agent.avatarColor);
    const copy = node("span");
    copy.append(textNode("strong", agent.name), textNode("small", agent.description || "Custom persona"));
    button.append(dot, copy);
    button.addEventListener("click", () => editAgent(agent));
    return button;
  }));
  if (!list.length) dom.agentList.append(empty("No custom agents yet."));
  dom.activeAgentStatus.textContent = activeAgent ? `${activeAgent.name} active` : "No active agent";
  updateStudioStatus();
}

function updateStudioStatus() {
  if (dom.studioNavHint) dom.studioNavHint.textContent = activeAgent ? "Active" : "Ready";
  if (dom.studioBtn) {
    dom.studioBtn.title = activeAgent
      ? `${activeAgent.name} is active. Open Studio.`
      : "Open Talkaton Studio";
  }
}

function editAgent(agent) {
  selectedAgent = agent;
  knowledge = agent ? [...agent.knowledge] : [];
  dom.agentName.value = agent?.name || "";
  dom.agentDescription.value = agent?.description || "";
  dom.agentInstructions.value = agent?.systemInstructions || "";
  document.querySelectorAll("[name='agentTool']").forEach(input => {
    input.checked = agent ? Boolean(agent.tools?.[TOOL_MAP[input.value]]) : ["web", "files", "canvas"].includes(input.value);
  });
  dom.agentFormTitle.textContent = agent ? `Edit ${agent.name}` : "Create an agent";
  dom.deleteAgentBtn.hidden = !agent;
  dom.activateAgentBtn.hidden = !agent;
  dom.activateAgentBtn.textContent = agent?.id === activeAgent?.id ? "Stop using agent" : "Use this agent";
  dom.agentError.textContent = "";
  renderKnowledge();
}

async function attachKnowledge() {
  dom.agentError.textContent = "";
  try {
    for (const file of [...dom.agentKnowledgeInput.files]) knowledge.push(await createKnowledgeAttachment(file));
    renderKnowledge();
  } catch (error) {
    dom.agentError.textContent = error.message;
  }
  dom.agentKnowledgeInput.value = "";
}

function renderKnowledge() {
  dom.agentKnowledgeList.replaceChildren(...knowledge.map(file => {
    const row = node("div", "knowledgeItem");
    const copy = node("span");
    copy.append(textNode("strong", file.name), textNode("small", `${formatBytes(file.size)} · ${file.inlineText ? "searchable text" : "file reference"}`));
    const remove = textNode("button", "Remove");
    remove.type = "button";
    remove.addEventListener("click", () => {
      knowledge = knowledge.filter(item => item.id !== file.id);
      renderKnowledge();
    });
    row.append(copy, remove);
    return row;
  }));
}

async function saveAgent(event) {
  event.preventDefault();
  dom.agentError.textContent = "";
  try {
    const tools = Object.fromEntries(Object.values(TOOL_MAP).map(tool => [tool, false]));
    document.querySelectorAll("[name='agentTool']:checked").forEach(input => { tools[TOOL_MAP[input.value]] = true; });
    const value = { name: dom.agentName.value, description: dom.agentDescription.value, systemInstructions: dom.agentInstructions.value, tools, knowledge };
    selectedAgent = selectedAgent
      ? await agents.update(selectedAgent.id, value, { expectedRevision: selectedAgent.revision })
      : await agents.create(value);
    if (activeAgent?.id === selectedAgent.id) activeAgent = selectedAgent;
    await loadAgents();
    editAgent(selectedAgent);
    host.toast(`Saved ${selectedAgent.name}.`);
  } catch (error) {
    dom.agentError.textContent = error.message;
  }
}

async function activateAgent() {
  if (!selectedAgent) return;
  activeAgent = activeAgent?.id === selectedAgent.id ? null : selectedAgent;
  scopedValue(ACTIVE_AGENT_KEY, activeAgent?.id || "");
  await loadAgents();
  editAgent(selectedAgent);
  host.toast(activeAgent ? `${activeAgent.name} is active for new messages.` : "Custom agent turned off.");
}

async function deleteAgent() {
  if (!selectedAgent || !confirm(`Delete ${selectedAgent.name}?`)) return;
  await agents.remove(selectedAgent.id);
  if (activeAgent?.id === selectedAgent.id) {
    activeAgent = null;
    scopedValue(ACTIVE_AGENT_KEY, "");
  }
  editAgent(null);
  await loadAgents();
}

function apiAgent(agent) {
  return {
    name: agent.name,
    instructions: agent.systemInstructions,
    tools: Object.entries(agent.tools || {}).filter(([, enabled]) => enabled === true).map(([key]) => TOOL_API[key]).filter(Boolean),
    knowledge: (agent.knowledge || []).filter(item => item.inlineText).map(item => ({ name: item.name, text: item.inlineText }))
  };
}

function bindCanvas() {
  dom.newArtifactBtn.addEventListener("click", () => editArtifact(null));
  dom.saveArtifactBtn.addEventListener("click", saveArtifact);
  dom.restoreArtifactBtn.addEventListener("click", restoreArtifact);
  dom.deleteArtifactBtn.addEventListener("click", deleteArtifact);
  dom.openArtifactWindowBtn.addEventListener("click", openArtifact);
  dom.artifactVersion.addEventListener("change", previewVersion);
  dom.artifactContent.addEventListener("input", () => {
    dom.artifactSaveStatus.textContent = "Unsaved changes";
    renderPreview(typeFor(dom.artifactLanguage.value), dom.artifactContent.value);
  });
  dom.artifactLanguage.addEventListener("change", () => renderPreview(typeFor(dom.artifactLanguage.value), dom.artifactContent.value));
}

async function loadArtifacts() {
  await ensureStores();
  const inChat = await artifacts.list({ chatId: host.getCurrentChat()?.id || null });
  const list = inChat.length ? inChat : await artifacts.list();
  renderCanvasChat();
  dom.artifactList.replaceChildren(...list.map(artifact => {
    const button = node("button", "artifactListItem");
    button.type = "button";
    const copy = node("span");
    copy.append(textNode("strong", artifact.title), textNode("small", `${artifact.language} · ${artifact.versions.length} version${artifact.versions.length === 1 ? "" : "s"}`));
    button.append(copy, textNode("span", "›"));
    button.addEventListener("click", () => editArtifact(artifact));
    return button;
  }));
  if (!list.length) dom.artifactList.append(empty("Code blocks and documents will appear here."));
  if (!selectedArtifact && list[0]) editArtifact(list[0]);
}

function editArtifact(artifact) {
  selectedArtifact = artifact;
  if (!artifact) {
    dom.artifactTitle.value = "Untitled artifact";
    dom.artifactLanguage.value = "markdown";
    dom.artifactContent.value = "# New artifact\n\nStart writing here.";
    dom.artifactVersion.replaceChildren(new Option("New artifact", ""));
    dom.artifactSaveStatus.textContent = "Not saved";
    renderPreview("markdown", dom.artifactContent.value);
    return;
  }
  const version = currentVersion(artifact);
  dom.artifactTitle.value = artifact.title;
  dom.artifactLanguage.value = [...dom.artifactLanguage.options].some(option => option.value === artifact.language) ? artifact.language : "text";
  dom.artifactContent.value = version.content;
  dom.artifactVersion.replaceChildren(...artifact.versions.slice().reverse().map(item => new Option(`Version ${item.number} · ${new Date(item.createdAt).toLocaleString()}`, item.id)));
  dom.artifactVersion.value = artifact.currentVersionId;
  dom.artifactSaveStatus.textContent = `Version ${version.number} saved`;
  renderPreview(artifact.type, version.content);
}

async function saveArtifact() {
  const title = dom.artifactTitle.value.trim() || "Untitled artifact";
  const language = dom.artifactLanguage.value;
  try {
    selectedArtifact = selectedArtifact
      ? await artifacts.update(selectedArtifact.id, dom.artifactContent.value, { title, expectedVersionId: selectedArtifact.currentVersionId })
      : await artifacts.create({ title, language, type: typeFor(language), content: dom.artifactContent.value, chatId: host.getCurrentChat()?.id || null });
    await loadArtifacts();
    editArtifact(selectedArtifact);
  } catch (error) {
    dom.artifactSaveStatus.textContent = error.message;
  }
}

async function restoreArtifact() {
  if (!selectedArtifact || !dom.artifactVersion.value) return;
  selectedArtifact = await artifacts.restoreVersion(selectedArtifact.id, dom.artifactVersion.value);
  await loadArtifacts();
  editArtifact(selectedArtifact);
  host.toast("Artifact version restored as a new version.");
}

async function deleteArtifact() {
  if (!selectedArtifact || !confirm(`Delete ${selectedArtifact.title}?`)) return;
  await artifacts.remove(selectedArtifact.id);
  selectedArtifact = null;
  editArtifact(null);
  await loadArtifacts();
}

function previewVersion() {
  const version = selectedArtifact?.versions.find(item => item.id === dom.artifactVersion.value);
  if (!version) return;
  dom.artifactContent.value = version.content;
  dom.artifactSaveStatus.textContent = `Viewing version ${version.number}`;
  renderPreview(selectedArtifact.type, version.content);
}

function renderPreview(type, content) {
  dom.artifactPreview.replaceChildren();
  if (type === "html") {
    const frame = document.createElement("iframe");
    frame.title = "Sandboxed artifact preview";
    frame.sandbox = "allow-forms allow-modals";
    frame.srcdoc = content;
    dom.artifactPreview.append(frame);
    return;
  }
  if (type === "markdown") {
    const fallback = () => {
      const pre = document.createElement("pre");
      pre.textContent = content;
      dom.artifactPreview.replaceChildren(pre);
    };
    host.loadMarkdown().then(module => module.renderRichMarkdown(dom.artifactPreview, content)).catch(fallback);
    return;
  }
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.textContent = content;
  pre.append(code);
  dom.artifactPreview.append(pre);
}

function renderCanvasChat() {
  const messages = host.getCurrentChat()?.messages || [];
  dom.canvasChatMirror.replaceChildren(...messages.slice(-30).map(message => {
    const article = node("article", message.role === "user" ? "canvasChatUser" : "canvasChatAssistant");
    article.append(textNode("strong", message.role === "user" ? "You" : message.agentName || "Talkaton"), textNode("p", String(message.content || "")));
    return article;
  }));
  if (!messages.length) dom.canvasChatMirror.append(empty("Start a chat, then open Canvas beside it."));
}

function openArtifact() {
  const content = dom.artifactContent.value;
  const body = dom.artifactLanguage.value === "html" ? content : `<pre style="white-space:pre-wrap;font:14px/1.6 ui-monospace,monospace;padding:32px">${escapeHtml(content)}</pre>`;
  const url = URL.createObjectURL(new Blob([`<!doctype html><meta charset="utf-8"><title>${escapeHtml(dom.artifactTitle.value)}</title>${body}`], { type: "text/html" }));
  window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function observeArtifacts() {
  const observer = new MutationObserver(() => {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scanArtifacts, 700);
  });
  observer.observe(dom.chatArea, { childList: true, subtree: true, characterData: true });
}

async function scanArtifacts() {
  await ensureStores();
  const chat = host.getCurrentChat();
  if (!chat?.messages?.length) return [];
  const existing = await artifacts.list({ chatId: chat.id });
  const captured = new Set(existing.map(item => item.messageId).filter(Boolean));
  const created = [];
  for (const message of chat.messages) {
    if (message.role !== "assistant" || message.status === "streaming" || !message.content || captured.has(message.id)) continue;
    if (!detectArtifacts(message.content).length) continue;
    created.push(...await artifacts.createFromMessage({ content: message.content, chatId: chat.id, messageId: message.id }));
  }
  if (created.length && dom.productivityDialog.open) await loadArtifacts();
  return created;
}

function bindAnalysis() {
  dom.analysisFileInput.addEventListener("change", () => {
    analysisFile = dom.analysisFileInput.files[0] || null;
    dom.analysisFileName.textContent = analysisFile?.name || "No dataset selected";
    dom.analysisFileMeta.textContent = analysisFile ? `${formatBytes(analysisFile.size)} · processed locally` : "CSV, TSV, and XLSX supported";
    if (analysisFile) dom.analysisCode.value = DEFAULT_ANALYSIS;
  });
  dom.runAnalysisBtn.addEventListener("click", runAnalysis);
  dom.stopAnalysisBtn.addEventListener("click", () => python?.cancel());
  dom.resetAnalysisBtn.addEventListener("click", resetAnalysis);
  dom.artifactFromAnalysisBtn.addEventListener("click", analysisArtifact);
}

async function runAnalysis() {
  if (!analysisFile) {
    dom.analysisStatus.textContent = "Choose a CSV, TSV, or XLSX file first.";
    return;
  }
  python ||= new PythonSandbox();
  python.addEventListener("progress", event => { dom.analysisStatus.textContent = event.detail.message; });
  dom.runAnalysisBtn.disabled = true;
  dom.stopAnalysisBtn.disabled = false;
  dom.artifactFromAnalysisBtn.disabled = true;
  dom.analysisTextOutput.textContent = "Preparing the isolated Python engine…";
  dom.analysisVisualOutput.replaceChildren();
  try {
    analysisResult = await python.run({ code: dom.analysisCode.value, files: [analysisFile], packages: ["pandas"], timeoutMs: 45_000 });
    dom.analysisTextOutput.textContent = [analysisResult.stdout, analysisResult.stderr, stringify(analysisResult.result)].filter(Boolean).join("\n") || "Python completed without text output.";
    for (const figure of analysisResult.figures || []) {
      const image = new Image();
      image.src = figure.dataUrl;
      image.alt = "Python-generated data visualization";
      dom.analysisVisualOutput.append(image);
    }
    dom.analysisStatus.textContent = `Completed in ${(analysisResult.durationMs / 1000).toFixed(1)} seconds · local sandbox`;
    dom.artifactFromAnalysisBtn.disabled = false;
  } catch (error) {
    dom.analysisTextOutput.textContent = error.message;
    dom.analysisStatus.textContent = error.code === "CANCELLED" ? "Analysis stopped." : "Analysis failed safely.";
  } finally {
    dom.runAnalysisBtn.disabled = false;
    dom.stopAnalysisBtn.disabled = true;
  }
}

function resetAnalysis() {
  python?.cancel("Analysis reset.");
  analysisFile = null;
  analysisResult = null;
  dom.analysisFileInput.value = "";
  dom.analysisFileName.textContent = "No dataset selected";
  dom.analysisFileMeta.textContent = "CSV, TSV, and XLSX supported";
  dom.analysisCode.value = DEFAULT_ANALYSIS;
  dom.analysisTextOutput.textContent = "Run code to see results.";
  dom.analysisVisualOutput.replaceChildren();
  dom.analysisStatus.textContent = "Engine not loaded";
  dom.artifactFromAnalysisBtn.disabled = true;
}

async function analysisArtifact() {
  if (!analysisResult) return;
  const content = `# Analysis of ${analysisFile.name}\n\n## Python\n\n\`\`\`python\n${dom.analysisCode.value}\n\`\`\`\n\n## Output\n\n\`\`\`text\n${dom.analysisTextOutput.textContent}\n\`\`\``;
  selectedArtifact = await artifacts.create({ title: `Analysis · ${analysisFile.name}`, type: "markdown", language: "markdown", content, chatId: host.getCurrentChat()?.id || null });
  await openStudio("canvas");
  editArtifact(selectedArtifact);
}

function bindWorkspaces() {
  dom.newWorkspaceBtn.addEventListener("click", createWorkspace);
  dom.inviteWorkspaceBtn.addEventListener("click", inviteMember);
  dom.shareCurrentChatBtn.addEventListener("click", shareChat);
  dom.workspaceFileBtn.addEventListener("click", () => dom.workspaceFileInput.click());
  dom.workspaceFileInput.addEventListener("change", uploadFiles);
}

async function loadWorkspaces() {
  dom.workspaceError.textContent = "";
  if (!accountRequired("Log in to use team workspaces.")) return;
  try {
    const client = await host.getSupabase();
    const { data, error } = await client.from("workspace_members").select("role, workspace:workspaces(id,name,slug,owner_user_id,updated_at)").order("joined_at");
    if (error) throw error;
    const memberships = (data || []).filter(item => item.workspace);
    dom.workspaceList.replaceChildren(...memberships.map(membership => {
      const button = node("button", "workspaceListItem");
      button.type = "button";
      const copy = node("span");
      copy.append(textNode("strong", membership.workspace.name), textNode("small", capitalize(membership.role)));
      button.append(copy, textNode("span", "›"));
      button.addEventListener("click", () => selectWorkspace({ ...membership.workspace, role: membership.role }));
      return button;
    }));
    if (!memberships.length) dom.workspaceList.append(empty("Create a workspace to share chats and files."));
  } catch (error) {
    dom.workspaceError.textContent = setupError(error, "Workspaces are unavailable.");
  }
}

async function createWorkspace() {
  if (!accountRequired("Log in before creating a workspace.")) return;
  const name = prompt("Workspace name");
  if (!name?.trim()) return;
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "workspace";
  try {
    const client = await host.getSupabase();
    const { data, error } = await client.from("workspaces").insert({ name: name.trim(), slug: `${base}-${crypto.randomUUID().slice(0, 8)}`, owner_user_id: host.getUser().id }).select().single();
    if (error) throw error;
    await loadWorkspaces();
    await selectWorkspace({ ...data, role: "admin" });
  } catch (error) {
    dom.workspaceError.textContent = setupError(error, "Workspace could not be created.");
  }
}

async function selectWorkspace(value) {
  workspace = value;
  dom.workspaceTitle.textContent = value.name;
  dom.workspaceRole.textContent = `${capitalize(value.role)} access · ${value.slug}`;
  const canEdit = ["admin", "editor"].includes(value.role);
  dom.inviteWorkspaceBtn.disabled = value.role !== "admin";
  dom.shareCurrentChatBtn.disabled = !canEdit;
  dom.workspaceFileBtn.disabled = !canEdit;
  await Promise.all([loadWorkspaceChats(), loadWorkspaceFiles()]);
  await subscribeWorkspace();
}

async function inviteMember() {
  if (!workspace || workspace.role !== "admin") return;
  const email = prompt("Teammate email address");
  if (!email?.trim()) return;
  const role = (prompt("Role: admin, editor, or viewer", "viewer") || "viewer").toLowerCase();
  if (!new Set(["admin", "editor", "viewer"]).has(role)) {
    dom.workspaceError.textContent = "Choose Admin, Editor, or Viewer.";
    return;
  }
  try {
    const client = await host.getSupabase();
    const { error } = await client.rpc("workspace_invite_member", { p_workspace_id: workspace.id, p_email: email.trim().toLowerCase(), p_role: role });
    if (error) throw error;
    host.toast(`${email.trim()} was added as ${role}.`);
  } catch (error) {
    dom.workspaceError.textContent = setupError(error, "That member could not be invited.");
  }
}

async function shareChat() {
  if (!workspace) return;
  const chat = host.getCurrentChat();
  if (!chat?.messages?.length) {
    dom.workspaceError.textContent = "Add at least one message before sharing this chat.";
    return;
  }
  const client = await host.getSupabase();
  const sharedId = crypto.randomUUID();
  try {
    const { error: chatError } = await client.from("workspace_chats").insert({ id: sharedId, workspace_id: workspace.id, title: chat.title || "Shared chat", created_by: host.getUser().id, model: host.getState().model, metadata: { sourceChatId: chat.id } });
    if (chatError) throw chatError;
    const rows = chat.messages.map(message => ({
      id: crypto.randomUUID(), workspace_id: workspace.id, chat_id: sharedId,
      author_user_id: message.role === "user" ? host.getUser().id : null,
      role: new Set(["system", "user", "assistant", "tool"]).has(message.role) ? message.role : "assistant",
      content: { text: String(message.content || ""), attachments: message.attachments || [], generatedImage: message.generatedImage || null },
      model: message.model || null,
      created_at: message.timestamp ? new Date(message.timestamp).toISOString() : new Date().toISOString()
    }));
    const { error: messageError } = await client.from("workspace_messages").insert(rows);
    if (messageError) {
      await client.from("workspace_chats").delete().eq("id", sharedId);
      throw messageError;
    }
    await loadWorkspaceChats();
    host.toast("Chat shared with the workspace.");
  } catch (error) {
    dom.workspaceError.textContent = setupError(error, "Chat could not be shared.");
  }
}

async function loadWorkspaceChats() {
  if (!workspace) return;
  const client = await host.getSupabase();
  const { data, error } = await client.from("workspace_chats").select("id,title,model,updated_at").eq("workspace_id", workspace.id).order("updated_at", { ascending: false }).limit(100);
  if (error) throw error;
  dom.workspaceChats.replaceChildren(...(data || []).map(chat => {
    const button = workspaceItem(chat.title, `${chat.model || "Talkaton"} · ${new Date(chat.updated_at).toLocaleString()}`);
    button.addEventListener("click", () => previewSharedChat(chat));
    return button;
  }));
  if (!data?.length) dom.workspaceChats.append(empty("No shared chats yet."));
}

async function previewSharedChat(chat) {
  const client = await host.getSupabase();
  const { data, error } = await client.from("workspace_messages").select("role,content,created_at").eq("chat_id", chat.id).order("created_at");
  if (error) {
    dom.workspaceError.textContent = error.message;
    return;
  }
  const preview = node("section", "workspaceChatPreview");
  const header = document.createElement("header");
  const close = textNode("button", "×");
  close.type = "button";
  close.addEventListener("click", () => preview.remove());
  header.append(textNode("strong", chat.title), close);
  preview.append(header, ...(data || []).map(message => {
    const article = document.createElement("article");
    article.append(textNode("strong", message.role === "user" ? "Teammate" : "Talkaton"), textNode("p", message.content?.text || ""));
    return article;
  }));
  dom.workspaceChats.prepend(preview);
}

async function uploadFiles() {
  if (!workspace) return;
  const client = await host.getSupabase();
  for (const file of [...dom.workspaceFileInput.files]) {
    if (file.size > 50 * 1024 * 1024) {
      dom.workspaceError.textContent = `${file.name} is larger than 50 MB.`;
      continue;
    }
    const safeName = file.name.normalize("NFKC").replace(/[^\w.() -]/g, "_").slice(0, 200);
    const path = `${workspace.id}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await client.storage.from("workspace-files").upload(path, file, { contentType: file.type || "application/octet-stream" });
    if (uploadError) {
      dom.workspaceError.textContent = setupError(uploadError, `${file.name} could not be uploaded.`);
      continue;
    }
    const { error: rowError } = await client.from("workspace_files").insert({ workspace_id: workspace.id, storage_path: path, display_name: file.name, content_type: file.type || null, size_bytes: file.size, uploaded_by: host.getUser().id });
    if (rowError) {
      await client.storage.from("workspace-files").remove([path]);
      dom.workspaceError.textContent = rowError.message;
    }
  }
  dom.workspaceFileInput.value = "";
  await loadWorkspaceFiles();
}

async function loadWorkspaceFiles() {
  if (!workspace) return;
  const client = await host.getSupabase();
  const { data, error } = await client.from("workspace_files").select("display_name,storage_path,size_bytes,content_type,updated_at").eq("workspace_id", workspace.id).order("updated_at", { ascending: false }).limit(200);
  if (error) throw error;
  dom.workspaceFiles.replaceChildren(...(data || []).map(file => {
    const button = workspaceItem(file.display_name, `${formatBytes(file.size_bytes)} · ${file.content_type || "file"}`);
    button.addEventListener("click", async () => {
      const { data: signed, error: signedError } = await client.storage.from("workspace-files").createSignedUrl(file.storage_path, 60);
      if (signedError) dom.workspaceError.textContent = signedError.message;
      else window.open(signed.signedUrl, "_blank", "noopener,noreferrer");
    });
    return button;
  }));
  if (!data?.length) dom.workspaceFiles.append(empty("No shared files yet."));
}

async function subscribeWorkspace() {
  const client = await host.getSupabase();
  if (workspaceChannel) await client.removeChannel(workspaceChannel);
  workspaceChannel = client.channel(`workspace:${workspace.id}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "workspace_chats", filter: `workspace_id=eq.${workspace.id}` }, loadWorkspaceChats)
    .on("postgres_changes", { event: "*", schema: "public", table: "workspace_files", filter: `workspace_id=eq.${workspace.id}` }, loadWorkspaceFiles)
    .subscribe();
}

function workspaceItem(title, detail) {
  const button = node("button", "workspaceItem");
  button.type = "button";
  button.append(textNode("strong", title), textNode("small", detail));
  return button;
}

function bindDeveloper() {
  dom.apiKeyForm.addEventListener("submit", createKey);
  dom.connectGithubBtn.addEventListener("click", connectGithub);
  dom.loadRepositoryBtn.addEventListener("click", loadTree);
  dom.proposePullRequestBtn.addEventListener("click", proposePullRequest);
}

async function loadDeveloper() {
  if (!accountRequired("Log in with a confirmed email to use developer tools.")) return;
  await Promise.allSettled([loadKeys(), loadGithub()]);
}

async function api(url, options = {}) {
  const headers = await host.getAuthHeaders();
  const response = await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `${response.status} ${response.statusText}`);
  return data;
}

async function loadKeys() {
  try {
    const data = await api("/api/developer-keys");
    dom.apiKeyList.replaceChildren(...(data.keys || []).map(key => {
      const row = node("div", "apiKeyItem");
      const copy = node("span");
      copy.append(textNode("strong", key.name), textNode("small", `${key.key_prefix}… · ${(key.scopes || []).join(", ")}${key.revoked_at ? " · Revoked" : ""}`));
      const actions = node("span");
      if (!key.revoked_at) {
        const roll = textNode("button", "Roll");
        roll.type = "button";
        roll.addEventListener("click", () => rollKey(key));
        const revoke = textNode("button", "Revoke");
        revoke.type = "button";
        revoke.addEventListener("click", () => revokeKey(key));
        actions.append(roll, revoke);
      }
      row.append(copy, actions);
      return row;
    }));
    if (!data.keys?.length) dom.apiKeyList.append(empty("No API keys yet."));
  } catch (error) {
    dom.apiKeyList.replaceChildren(empty(setupError(error, "API keys could not be loaded.")));
  }
}

async function createKey(event) {
  event.preventDefault();
  const scopes = [...document.querySelectorAll("[name='apiScope']:checked")].map(input => input.value);
  try {
    const data = await api("/api/developer-keys", { method: "POST", body: JSON.stringify({ action: "provision", name: dom.apiKeyName.value, scopes }) });
    revealKey(data.key, data.warning);
    dom.apiKeyForm.reset();
    await loadKeys();
  } catch (error) {
    dom.newApiKeyReveal.hidden = false;
    dom.newApiKeyReveal.textContent = setupError(error, "API key could not be created.");
  }
}

async function rollKey(key) {
  if (!confirm(`Roll ${key.name}? The old key will stop working immediately.`)) return;
  const data = await api("/api/developer-keys", { method: "POST", body: JSON.stringify({ action: "roll", keyId: key.id, name: key.name, scopes: key.scopes, workspaceId: key.workspace_id }) });
  revealKey(data.key, data.warning);
  await loadKeys();
}

async function revokeKey(key) {
  if (!confirm(`Revoke ${key.name}?`)) return;
  await api("/api/developer-keys", { method: "DELETE", body: JSON.stringify({ keyId: key.id }) });
  await loadKeys();
}

function revealKey(key, warning) {
  dom.newApiKeyReveal.hidden = false;
  dom.newApiKeyReveal.replaceChildren();
  const code = textNode("code", key);
  const copy = textNode("button", "Copy key");
  copy.type = "button";
  copy.addEventListener("click", async () => {
    await navigator.clipboard.writeText(key);
    copy.textContent = "Copied";
  });
  dom.newApiKeyReveal.append(code, copy, textNode("small", warning));
}

async function loadGithub() {
  try {
    const status = await api("/api/github-oauth?action=status");
    dom.githubStatus.textContent = status.connected ? `Connected as @${status.connection.github_login}` : "Not connected";
    dom.connectGithubBtn.textContent = status.connected ? "Reconnect GitHub" : "Connect GitHub";
    if (!status.connected) return;
    const result = await api("/api/github?action=repositories&perPage=100");
    let list = byId("githubRepositoryChoices");
    if (!list) {
      list = document.createElement("datalist");
      list.id = "githubRepositoryChoices";
      dom.githubRepository.after(list);
      dom.githubRepository.setAttribute("list", list.id);
    }
    list.replaceChildren(...(result.repositories || []).map(repo => new Option(repo.fullName, repo.fullName)));
  } catch (error) {
    dom.githubStatus.textContent = setupError(error, "GitHub status unavailable.");
  }
}

async function connectGithub() {
  if (!accountRequired("Log in before connecting GitHub.")) return;
  try {
    const data = await api("/api/github-oauth?action=authorize&returnPath=%2Fchat%3Fgithub%3Dconnected");
    location.assign(data.authorizationUrl);
  } catch (error) {
    dom.githubStatus.textContent = error.message;
  }
}

async function loadTree() {
  const parts = repositoryParts();
  if (!parts) return;
  dom.repositoryTree.textContent = "Loading repository tree…";
  try {
    const data = await api(`/api/github?action=tree&owner=${encodeURIComponent(parts.owner)}&repo=${encodeURIComponent(parts.repo)}&ref=HEAD`);
    dom.repositoryTree.replaceChildren(...(data.entries || []).slice(0, 1000).map(entry => textNode("div", `${entry.type === "tree" ? "▸" : "·"} ${entry.path}`, "repositoryEntry")));
  } catch (error) {
    dom.repositoryTree.textContent = error.message;
  }
}

async function proposePullRequest() {
  const parts = repositoryParts();
  if (!parts) return;
  if (!selectedArtifact) {
    dom.githubStatus.textContent = "Open an artifact in Canvas first. That artifact becomes the proposed file.";
    return;
  }
  const fallbackName = `${selectedArtifact.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "talkaton-artifact"}.${extensionFor(selectedArtifact.language)}`;
  const path = prompt("Repository path for this artifact", fallbackName);
  if (!path) return;
  const title = prompt("Pull request title", `Add ${selectedArtifact.title}`);
  if (!title) return;
  const branch = `talkaton/${Date.now()}-${path.split("/").pop().replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 40)}`;
  dom.githubStatus.textContent = "Creating a draft pull request…";
  try {
    const data = await api("/api/github?action=pull-request", { method: "POST", body: JSON.stringify({ owner: parts.owner, repo: parts.repo, base: "main", branch, title, description: `Draft proposal from Talkaton Canvas artifact “${selectedArtifact.title}”.`, draft: true, files: [{ path, content: currentVersion(selectedArtifact).content }] }) });
    dom.githubStatus.replaceChildren("Draft created: ");
    const link = textNode("a", `open pull request #${data.pullRequest.number}`);
    link.href = data.pullRequest.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    dom.githubStatus.append(link);
  } catch (error) {
    dom.githubStatus.textContent = error.message;
  }
}

function repositoryParts() {
  const match = dom.githubRepository.value.trim().match(/^([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!match) {
    dom.githubStatus.textContent = "Enter a repository as owner/name.";
    return null;
  }
  return { owner: match[1], repo: match[2] };
}

function bindExports() {
  document.querySelectorAll("[data-export-format]").forEach(button => button.addEventListener("click", () => {
    const chat = host.getCurrentChat();
    if (!chat?.messages?.length) {
      dom.exportStatus.textContent = "There is no conversation to export yet.";
      return;
    }
    try {
      const result = downloadTranscript({ title: chat.title, model: host.getState().model, messages: chat.messages }, button.dataset.exportFormat);
      dom.exportStatus.textContent = `Downloaded ${result.fileName}.`;
    } catch (error) {
      dom.exportStatus.textContent = error.message;
    }
  }));
}

function accountRequired(message) {
  if (host.isLoggedIn() && host.getUser()) return true;
  dom.workspaceError.textContent = message;
  host.openAuth("signIn");
  return false;
}

function currentVersion(artifact) {
  return artifact.versions.find(item => item.id === artifact.currentVersionId) || artifact.versions.at(-1);
}

function typeFor(language) {
  if (language === "markdown") return "markdown";
  if (language === "html") return "html";
  if (language === "json") return "json";
  if (language === "text") return "text";
  return "code";
}

function extensionFor(language) {
  return ({ markdown: "md", javascript: "js", typescript: "ts", python: "py", html: "html", json: "json", text: "txt" })[language] || "txt";
}

function stringify(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function setupError(error, fallback) {
  const message = String(error?.message || "");
  return /relation .* does not exist|schema cache|could not find/i.test(message)
    ? `${fallback} Apply supabase/enterprise-workspaces-and-developer-platform.sql first.`
    : message || fallback;
}

function empty(message) {
  return textNode("p", message, "studioEmptyState");
}

function node(tag, className = "") {
  const result = document.createElement(tag);
  if (className) result.className = className;
  return result;
}

function textNode(tag, text, className = "") {
  const result = node(tag, className);
  result.textContent = text;
  return result;
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function capitalize(value) {
  const text = String(value || "");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
}

function reportError(error) {
  console.error("Talkaton Studio failed to initialize:", error);
  host.toast("Studio could not finish loading. Refresh and try again.");
}
