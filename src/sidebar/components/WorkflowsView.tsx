import { useState, useEffect, type ReactNode } from "react";
import {
  listWorkflows,
  getCategoryEmoji,
  type WorkflowGroup,
} from "../utils/workflowStore";
import {
  listProjects,
  createProject,
  updateProject,
  deleteProject,
  type Project,
} from "../utils/projectStore";
import { parseUrlPatterns } from "./ProjectsView";

// ── Feather-style SVG icons ────────────────────────────────────────

const ICONS: Record<string, ReactNode> = {
  tag: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  ),
  star: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  ),
  percent: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="5" x2="5" y2="19" />
      <circle cx="6.5" cy="6.5" r="2.5" />
      <circle cx="17.5" cy="17.5" r="2.5" />
    </svg>
  ),
  "file-text": (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  ),
  link: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
    </svg>
  ),
  edit: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  ),
  "check-circle": (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  ),
  search: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  "book-open": (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
      <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
    </svg>
  ),
  "message-circle": (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
    </svg>
  ),
  send: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  ),
  list: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  ),
  "play-circle": (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polygon points="10 8 16 12 10 16 10 8" />
    </svg>
  ),
  award: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="7" />
      <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" />
    </svg>
  ),
  clock: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  zap: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ),
};

function getIcon(name: string): ReactNode {
  return ICONS[name] || ICONS["zap"];
}

// ── Emoji list for projects ────────────────────────────────────────
const PROJECT_EMOJIS = ["📁", "💼", "🏢", "🔬", "📚", "🎓", "🛒", "💻", "🎨", "🎮", "📱", "🌐", "⚙️", "🔧", "📊", "🗂️"];

interface ProjectFormData {
  name: string; icon: string; urlPatterns: string; instructions: string;
}
const EMPTY_FORM: ProjectFormData = { name: "", icon: "📁", urlPatterns: "", instructions: "" };

// ── Component ──────────────────────────────────────────────────────

interface WorkflowsViewProps {
  onRunWorkflow: (prompt: string) => void;
}

function WorkflowsView({ onRunWorkflow }: WorkflowsViewProps) {
  const [groups, setGroups] = useState<WorkflowGroup[]>([]);
  const [wfLoading, setWfLoading] = useState(true);

  // Projects state
  const [projects, setProjects] = useState<Project[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProjectFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listWorkflows().then(setGroups).finally(() => setWfLoading(false));
    listProjects().then(setProjects).catch(console.warn);
  }, []);

  const reloadProjects = () => listProjects().then(setProjects).catch(console.warn);

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const patterns = form.urlPatterns ? parseUrlPatterns(form.urlPatterns) : [];
      if (editingId) {
        await updateProject(editingId, { name: form.name, icon: form.icon, urlPatterns: patterns, instructions: form.instructions });
      } else {
        await createProject(form.name, patterns, form.instructions, form.icon);
      }
      setForm(EMPTY_FORM); setShowForm(false); setEditingId(null);
      reloadProjects();
    } finally { setSaving(false); }
  };

  const handleEdit = (p: Project) => {
    setForm({ name: p.name, icon: p.icon, urlPatterns: p.urlPatterns.join("\n"), instructions: p.instructions });
    setEditingId(p.id); setShowForm(true);
  };

  return (
    <div className="workflows-view">
      {/* ── Header ── */}
      <div className="workflows-header">
        <h2 className="workflows-title">Workflows</h2>
        <span className="workflows-subtitle">One-tap automations</span>
      </div>

      <div className="workflows-list">

        {/* ── Projects section ── */}
        <div className="workflow-group">
          <div className="workflow-group-label" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span>📂 PROJECTS</span>
            <button
              className="wf-projects-add-btn"
              onClick={() => { setForm(EMPTY_FORM); setEditingId(null); setShowForm((s) => !s); }}
            >
              {showForm ? "✕" : "+ New"}
            </button>
          </div>

          {showForm && (
            <div className="project-form" style={{ marginBottom: 8 }}>
              <div className="project-form-row">
                <div className="project-emoji-picker">
                  {PROJECT_EMOJIS.map((e) => (
                    <button key={e} className={`emoji-btn ${form.icon === e ? "active" : ""}`} onClick={() => setForm((f) => ({ ...f, icon: e }))}>{e}</button>
                  ))}
                </div>
              </div>
              <input className="project-input" placeholder="Project name (e.g. Work — Jira)" value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              <textarea className="project-input project-textarea-sm" placeholder={"URL patterns (one per line)\ne.g. *github.com*"} value={form.urlPatterns}
                onChange={(e) => setForm((f) => ({ ...f, urlPatterns: e.target.value }))} rows={2} />
              <textarea className="project-input project-textarea" placeholder="Custom AI instructions for matching pages..." value={form.instructions}
                onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))} rows={3} />
              <button className="project-save-btn" onClick={handleSave} disabled={saving || !form.name.trim()}>
                {saving ? "Saving..." : editingId ? "Update Project" : "Create Project"}
              </button>
            </div>
          )}

          {projects.length > 0 ? (
            <div className="project-list" style={{ marginBottom: 4 }}>
              {projects.map((p) => (
                <div key={p.id} className="project-card">
                  <div className="project-card-main">
                    <span className="project-card-icon">{p.icon}</span>
                    <div className="project-card-text">
                      <span className="project-card-name">{p.name}</span>
                      <span className="project-card-patterns">
                        {p.urlPatterns.length} URL pattern{p.urlPatterns.length !== 1 ? "s" : ""}
                        {p.instructions && " · " + p.instructions.slice(0, 36) + (p.instructions.length > 36 ? "…" : "")}
                      </span>
                    </div>
                  </div>
                  <div className="project-card-actions">
                    <button className="project-action-btn" onClick={() => handleEdit(p)} title="Edit">✏️</button>
                    <button className="project-action-btn" onClick={async () => { await deleteProject(p.id); reloadProjects(); }} title="Delete">🗑️</button>
                  </div>
                </div>
              ))}
            </div>
          ) : !showForm ? (
            <p style={{ fontSize: 12, color: "var(--text-muted)", padding: "6px 2px" }}>No projects yet. Create one to give the AI custom instructions per site.</p>
          ) : null}
        </div>

        {/* ── Workflow groups ── */}
        {wfLoading ? (
          <div className="workflows-loading">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="workflow-skeleton-sq"><div className="skeleton-icon-sq" /><div className="skeleton-text" style={{ width: "70%", marginTop: 6 }} /></div>
            ))}
          </div>
        ) : groups.length === 0 ? (
          <div className="workflows-empty">
            <p>No workflows available</p>
            <span>Check back later for new templates</span>
          </div>
        ) : groups.map((group) => (
          <div key={group.category} className="workflow-group">
            <div className="workflow-group-label">
              <span className="workflow-group-emoji">{getCategoryEmoji(group.category)}</span>
              {group.category}
            </div>
            {/* Horizontal 3-column compact grid */}
            <div className="workflow-grid">
              {group.workflows.map((wf) => (
                <button key={wf.id} className="workflow-tile" onClick={() => onRunWorkflow(wf.prompt)} title={wf.description}>
                  <div className="workflow-tile-icon">{getIcon(wf.icon)}</div>
                  <span className="workflow-tile-title">{wf.title}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default WorkflowsView;
