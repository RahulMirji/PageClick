import { useState, useEffect } from 'react'
import { listProjects, createProject, updateProject, deleteProject, type Project } from '../utils/projectStore'

// ── Emoji picker ───────────────────────────────────────────────────

const PROJECT_EMOJIS = ['📁', '💼', '🏢', '🔬', '📚', '🎓', '🛒', '💻', '🎨', '🎮', '📱', '🌐', '⚙️', '🔧', '📊', '🗂️']

// ── Types ──────────────────────────────────────────────────────────

interface ProjectFormData {
    name: string
    icon: string
    urlPatterns: string
    instructions: string
}

const EMPTY_FORM: ProjectFormData = { name: '', icon: '📁', urlPatterns: '', instructions: '' }

// ── Component ──────────────────────────────────────────────────────

function ProjectsView() {
    const [projects, setProjects] = useState<Project[]>([])
    const [showForm, setShowForm] = useState(false)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [form, setForm] = useState<ProjectFormData>(EMPTY_FORM)
    const [saving, setSaving] = useState(false)

    const loadData = () => {
        listProjects().then(setProjects).catch(console.warn)
    }

    useEffect(() => { loadData() }, [])

    const handleSave = async () => {
        if (!form.name.trim()) return
        setSaving(true)
        try {
            const patterns = form.urlPatterns
                .split('\n')
                .map(p => p.trim())
                .filter(Boolean)

            if (editingId) {
                await updateProject(editingId, {
                    name: form.name,
                    icon: form.icon,
                    urlPatterns: patterns,
                    instructions: form.instructions,
                })
            } else {
                await createProject(form.name, patterns, form.instructions, form.icon)
            }
            setForm(EMPTY_FORM)
            setShowForm(false)
            setEditingId(null)
            loadData()
        } catch (err: any) {
            console.error('Failed to save project:', err)
        } finally {
            setSaving(false)
        }
    }

    const handleEdit = (p: Project) => {
        setForm({
            name: p.name,
            icon: p.icon,
            urlPatterns: p.urlPatterns.join('\n'),
            instructions: p.instructions,
        })
        setEditingId(p.id)
        setShowForm(true)
    }

    const handleDelete = async (id: string) => {
        await deleteProject(id)
        loadData()
    }

    return (
        <div className="projects-view">
            <div className="projects-view-header">
                <h2 className="workflows-title">Projects</h2>
                <button
                    className="projects-add-btn"
                    onClick={() => {
                        setForm(EMPTY_FORM)
                        setEditingId(null)
                        setShowForm(s => !s)
                    }}
                >
                    {showForm ? '✕ Cancel' : '+ New Project'}
                </button>
            </div>

            <div className="projects-view-content">
                {showForm && (
                    <div className="project-form">
                        <div className="project-form-row">
                            <div className="project-emoji-picker">
                                {PROJECT_EMOJIS.map(e => (
                                    <button
                                        key={e}
                                        className={`emoji-btn ${form.icon === e ? 'active' : ''}`}
                                        onClick={() => setForm(f => ({ ...f, icon: e }))}
                                    >{e}</button>
                                ))}
                            </div>
                        </div>
                        <input
                            className="project-input"
                            placeholder="Project name (e.g. Work — Jira)"
                            value={form.name}
                            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                        />
                        <textarea
                            className="project-input project-textarea-sm"
                            placeholder={"URL patterns (one per line)\ne.g. *github.com*\ne.g. *jira.*"}
                            value={form.urlPatterns}
                            onChange={e => setForm(f => ({ ...f, urlPatterns: e.target.value }))}
                            rows={3}
                        />
                        <textarea
                            className="project-input project-textarea"
                            placeholder="Custom instructions for the AI when on matching pages..."
                            value={form.instructions}
                            onChange={e => setForm(f => ({ ...f, instructions: e.target.value }))}
                            rows={4}
                        />
                        <button
                            className="project-save-btn"
                            onClick={handleSave}
                            disabled={saving || !form.name.trim()}
                        >
                            {saving ? 'Saving...' : editingId ? 'Update Project' : 'Create Project'}
                        </button>
                    </div>
                )}

                {projects.length > 0 ? (
                    <div className="project-list">
                        {projects.map(p => (
                            <div key={p.id} className="project-card">
                                <div className="project-card-main">
                                    <span className="project-card-icon">{p.icon}</span>
                                    <div className="project-card-text">
                                        <span className="project-card-name">{p.name}</span>
                                        <span className="project-card-patterns">
                                            {p.urlPatterns.length} URL pattern{p.urlPatterns.length !== 1 ? 's' : ''}
                                            {p.instructions && ' · ' + p.instructions.slice(0, 40) + (p.instructions.length > 40 ? '…' : '')}
                                        </span>
                                    </div>
                                </div>
                                <div className="project-card-actions">
                                    <button className="project-action-btn" onClick={() => handleEdit(p)} title="Edit">✏️</button>
                                    <button className="project-action-btn" onClick={() => handleDelete(p.id)} title="Delete">🗑️</button>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : !showForm ? (
                    <div className="projects-view-empty">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.3">
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                        </svg>
                        <p>No projects yet</p>
                        <span>Create a project to give the AI custom instructions per website</span>
                    </div>
                ) : null}
            </div>
        </div>
    )
}

export default ProjectsView
