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
    onSend: (message: string, images?: string[]) => void
    isLoading: boolean
    selectedModel: ModelId
    onModelChange: (model: ModelId) => void
}

function SearchBox({ onSend, isLoading, selectedModel, onModelChange }: SearchBoxProps) {
    const [query, setQuery] = useState('')
    const [showModelMenu, setShowModelMenu] = useState(false)
    const [attachedImages, setAttachedImages] = useState<string[]>([])
    const menuRef = useRef<HTMLDivElement>(null)
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)

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
        if ((!trimmed && attachedImages.length === 0) || isLoading) return

        // Auto-switch to Kimi K2.5 if images are attached and model doesn't support vision
        if (attachedImages.length > 0 && selectedModel !== 'kimi-k2.5') {
            onModelChange('kimi-k2.5')
        }

        onSend(trimmed || 'What is in this image?', attachedImages.length > 0 ? attachedImages : undefined)
        setQuery('')
        setAttachedImages([])
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

    const handleFileSelect = () => {
        fileInputRef.current?.click()
    }

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files
        if (!files) return

        Array.from(files).forEach((file) => {
            if (!file.type.startsWith('image/')) return
            // Limit to 3 images
            if (attachedImages.length >= 3) return

            const reader = new FileReader()
            reader.onload = () => {
                const base64 = reader.result as string
                setAttachedImages((prev) => {
                    if (prev.length >= 3) return prev
                    return [...prev, base64]
                })
            }
            reader.readAsDataURL(file)
        })

        // Reset input so the same file can be re-selected
        e.target.value = ''
    }

    const removeImage = (index: number) => {
        setAttachedImages((prev) => prev.filter((_, i) => i !== index))
    }

    return (
        <div className="search-box">
            {/* Image preview strip */}
            {attachedImages.length > 0 && (
                <div className="image-preview-strip">
                    {attachedImages.map((img, i) => (
                        <div key={i} className="image-preview-item">
                            <img src={img} alt={`Attached ${i + 1}`} className="image-preview-thumb" />
                            <button
                                className="image-preview-remove"
                                onClick={() => removeImage(i)}
                                aria-label="Remove image"
                            >
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                                    <line x1="18" y1="6" x2="6" y2="18" />
                                    <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                            </button>
                        </div>
                    ))}
                </div>
            )}

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

            {/* Hidden file input */}
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileChange}
                style={{ display: 'none' }}
            />

            <div className="search-actions">
                <div className="search-actions-left">
                    <button className="add-btn" aria-label="Attach image" onClick={handleFileSelect}>
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
                        aria-label={isLoading ? 'Stop' : 'Submit'}
                        disabled={!query.trim() && !isLoading && attachedImages.length === 0}
                        onClick={handleSend}
                    >
                        {isLoading ? (
                            <span className="stop-icon"></span>
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
