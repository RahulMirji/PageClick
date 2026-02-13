import { useState, useRef, useEffect, KeyboardEvent } from 'react'

export type ModelId = 'kimi-k2.5' | 'gpt-oss-20b'

interface ModelOption {
    id: ModelId
    label: string
    icon: string
}

const MODELS: ModelOption[] = [
    { id: 'kimi-k2.5', label: 'Kimi K2.5', icon: '🌙' },
    { id: 'gpt-oss-20b', label: 'GPT-OSS', icon: '⚡' },
]

interface SearchBoxProps {
    onSend: (message: string) => void
    isLoading: boolean
    selectedModel: ModelId
    onModelChange: (model: ModelId) => void
}

function SearchBox({ onSend, isLoading, selectedModel, onModelChange }: SearchBoxProps) {
    const [query, setQuery] = useState('')
    const [showModelMenu, setShowModelMenu] = useState(false)
    const menuRef = useRef<HTMLDivElement>(null)
    const textareaRef = useRef<HTMLTextAreaElement>(null)

    const currentModel = MODELS.find((m) => m.id === selectedModel) || MODELS[0]

    // Auto-resize textarea
    const autoResize = () => {
        const el = textareaRef.current
        if (!el) return
        el.style.height = 'auto'
        el.style.height = `${el.scrollHeight}px`
    }

    // Close dropdown on outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setShowModelMenu(false)
            }
        }
        if (showModelMenu) {
            document.addEventListener('mousedown', handleClickOutside)
        }
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [showModelMenu])

    const handleSend = () => {
        const trimmed = query.trim()
        if (!trimmed || isLoading) return
        onSend(trimmed)
        setQuery('')
        // Reset textarea height
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto'
        }
    }

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleSend()
        }
    }

    return (
        <div className="search-box">
            <div className="search-input-area">
                <textarea
                    ref={textareaRef}
                    className="search-textarea"
                    placeholder="Ask anything..."
                    value={query}
                    onChange={(e) => {
                        setQuery(e.target.value)
                        autoResize()
                    }}
                    onKeyDown={handleKeyDown}
                    rows={1}
                />
            </div>
            <div className="search-actions">
                <div className="search-actions-left">
                    <button className="add-btn" aria-label="Add file">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="12" y1="5" x2="12" y2="19" />
                            <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                    </button>
                </div>
                <div className="search-actions-right">
                    <div className="model-selector" ref={menuRef}>
                        <button
                            className="pro-toggle"
                            onClick={() => setShowModelMenu((prev) => !prev)}
                        >
                            <span className="model-icon">{currentModel.icon}</span>
                            <span>{currentModel.label}</span>
                            <svg
                                className={`chevron ${showModelMenu ? 'open' : ''}`}
                                width="10"
                                height="10"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.5"
                            >
                                <polyline points="6 9 12 15 18 9" />
                            </svg>
                        </button>
                        {showModelMenu && (
                            <div className="model-dropdown">
                                {MODELS.map((model) => (
                                    <button
                                        key={model.id}
                                        className={`model-option ${model.id === selectedModel ? 'active' : ''}`}
                                        onClick={() => {
                                            onModelChange(model.id)
                                            setShowModelMenu(false)
                                        }}
                                    >
                                        <span className="model-option-icon">{model.icon}</span>
                                        <span className="model-option-label">{model.label}</span>
                                        {model.id === selectedModel && (
                                            <svg className="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                                <polyline points="20 6 9 17 4 12" />
                                            </svg>
                                        )}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    <button
                        className={`submit-btn ${isLoading ? 'loading' : ''}`}
                        aria-label="Submit"
                        disabled={!query.trim() || isLoading}
                        onClick={handleSend}
                    >
                        {isLoading ? (
                            <div className="submit-spinner"></div>
                        ) : (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="5" y1="12" x2="19" y2="12" />
                                <polyline points="12 5 19 12 12 19" />
                            </svg>
                        )}
                    </button>
                </div>
            </div>
        </div>
    )
}

export default SearchBox
