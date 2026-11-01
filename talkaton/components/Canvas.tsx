import React, { useEffect, useMemo, useState } from "react";

export interface CanvasVersion {
  id: string;
  number: number;
  content: string;
  authorId: string;
  changeSummary: string;
  createdAt: string;
}

export interface CanvasArtifact {
  id: string;
  title: string;
  type: "markdown" | "code" | "html" | "json" | "text";
  language: string;
  currentVersionId: string;
  versions: CanvasVersion[];
  updatedAt: string;
}

export interface CanvasProps {
  chat: React.ReactNode;
  artifact: CanvasArtifact | null;
  renderPreview?: (content: string, artifact: CanvasArtifact) => React.ReactNode;
  onSave: (artifactId: string, content: string, expectedVersionId: string) => Promise<CanvasArtifact>;
  onRestore: (artifactId: string, versionId: string) => Promise<CanvasArtifact>;
  onDelete: (artifactId: string) => Promise<void>;
  onClose: () => void;
}

/** React integration reference for Talkaton's framework-neutral artifact runtime. */
export default function Canvas({ chat, artifact, renderPreview, onSave, onRestore, onDelete, onClose }: CanvasProps) {
  const [active, setActive] = useState(artifact);
  const [selectedVersionId, setSelectedVersionId] = useState(artifact?.currentVersionId ?? "");
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setActive(artifact);
    setSelectedVersionId(artifact?.currentVersionId ?? "");
    setEditing(false);
    setError("");
  }, [artifact]);

  const currentVersion = useMemo(() => {
    if (!active) return null;
    return active.versions.find(version => version.id === selectedVersionId)
      ?? active.versions.find(version => version.id === active.currentVersionId)
      ?? active.versions.at(-1)
      ?? null;
  }, [active, selectedVersionId]);

  useEffect(() => {
    if (!editing) setDraft(currentVersion?.content ?? "");
  }, [currentVersion, editing]);

  async function perform(operation: () => Promise<void>) {
    setBusy(true);
    setError("");
    try { await operation(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "The artifact operation failed."); }
    finally { setBusy(false); }
  }

  async function save() {
    if (!active) return;
    await perform(async () => {
      const saved = await onSave(active.id, draft, active.currentVersionId);
      setActive(saved);
      setSelectedVersionId(saved.currentVersionId);
      setEditing(false);
    });
  }

  async function restore() {
    if (!active || !selectedVersionId) return;
    await perform(async () => {
      const restored = await onRestore(active.id, selectedVersionId);
      setActive(restored);
      setSelectedVersionId(restored.currentVersionId);
      setEditing(false);
    });
  }

  async function remove() {
    if (!active) return;
    await perform(async () => { await onDelete(active.id); setActive(null); onClose(); });
  }

  return (
    <main className={`canvas${active ? " canvas--split" : ""}`}>
      <section className="canvas__chat" aria-label="Chat conversation">{chat}</section>
      {active && currentVersion && (
        <aside className="canvas__artifact" aria-label="Interactive artifact">
          <header className="canvas__header">
            <div>
              <p className="canvas__eyebrow">Artifact</p>
              <h2>{active.title}</h2>
            </div>
            <label className="canvas__version">
              <span>Version</span>
              <select value={selectedVersionId} disabled={busy || editing} onChange={event => setSelectedVersionId(event.target.value)}>
                {[...active.versions].reverse().map(version => (
                  <option key={version.id} value={version.id}>v{version.number} · {new Date(version.createdAt).toLocaleString()}</option>
                ))}
              </select>
            </label>
            <div className="canvas__actions">
              {editing ? (
                <>
                  <button type="button" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
                  <button type="button" className="canvas__primary" disabled={busy || draft === currentVersion.content} onClick={save}>Save version</button>
                </>
              ) : (
                <>
                  <button type="button" disabled={busy} onClick={() => { setDraft(currentVersion.content); setEditing(true); }}>Edit</button>
                  <button type="button" disabled={busy || selectedVersionId === active.currentVersionId} onClick={restore}>Restore</button>
                </>
              )}
              <button type="button" className="canvas__danger" disabled={busy} onClick={remove}>Delete</button>
              <button type="button" aria-label="Close Canvas" disabled={busy} onClick={onClose}>×</button>
            </div>
          </header>
          {error && <p className="canvas__error" role="alert">{error}</p>}
          <div className="canvas__body">
            {editing ? (
              <textarea className="canvas__editor" aria-label="Artifact content" value={draft} spellCheck={active.type === "markdown" || active.type === "text"} onChange={event => setDraft(event.target.value)} />
            ) : (
              <ArtifactPreview artifact={active} content={currentVersion.content} renderPreview={renderPreview} />
            )}
          </div>
          <footer className="canvas__footer">
            <span>{currentVersion.changeSummary}</span>
            <span>Updated {new Date(active.updatedAt).toLocaleString()}</span>
          </footer>
        </aside>
      )}
    </main>
  );
}

function ArtifactPreview({ artifact, content, renderPreview }: { artifact: CanvasArtifact; content: string; renderPreview?: CanvasProps["renderPreview"] }) {
  if (renderPreview) return <div className="canvas__preview">{renderPreview(content, artifact)}</div>;
  if (artifact.type === "html") return <iframe className="canvas__htmlPreview" title={`${artifact.title} preview`} sandbox="" srcDoc={content} />;
  return (
    <pre className={`canvas__preview canvas__preview--${artifact.type}`}>
      <code className={`language-${artifact.language.replace(/[^a-z0-9_-]/gi, "")}`}>{content}</code>
    </pre>
  );
}
