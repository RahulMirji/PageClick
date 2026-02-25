/**
 * ArtifactViewer — renders code blocks, SVGs, and other artifacts inline.
 *
 * Replaces plain <code> blocks in ChatView with:
 *   - Syntax-highlighted code (via Prism) with Copy + Download buttons
 *   - Inline SVG rendering
 *   - Fallback pre block for unknown types
 */

import { useState, useEffect, useRef } from 'react'
import Prism from 'prismjs'
import { downloadText } from '../utils/downloadService'

// Load common languages
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-jsx'
import 'prismjs/components/prism-tsx'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-css'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-sql'
import 'prismjs/components/prism-markdown'

// ── Helpers ──────────────────────────────────────────────────────────

const SVG_LANGS = ['svg']
const CODE_LANGS = ['js', 'jsx', 'ts', 'tsx', 'javascript', 'typescript', 'python', 'py',
    'css', 'scss', 'json', 'bash', 'sh', 'zsh', 'sql', 'html', 'xml', 'md', 'markdown', 'text', 'txt']

function getPrismLang(lang: string): string {
    const map: Record<string, string> = {
        js: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx',
        py: 'python', sh: 'bash', zsh: 'bash', md: 'markdown', txt: 'clike',
    }
    return map[lang] || lang
}

function downloadFile(content: string, lang: string) {
    const extMap: Record<string, string> = {
        javascript: 'js', typescript: 'ts', python: 'py', python3: 'py',
        jsx: 'jsx', tsx: 'tsx', css: 'css', json: 'json', bash: 'sh',
        sql: 'sql', html: 'html', svg: 'svg', markdown: 'md',
    }
    const ext = extMap[lang] || 'txt'
    downloadText(content, `snippet.${ext}`, 'text/plain')
}

// ── Sub-components ────────────────────────────────────────────────────

interface ToolbarProps {
    lang: string
    code: string
    onCopy: () => void
    copied: boolean
}

function ArtifactToolbar({ lang, code, onCopy, copied }: ToolbarProps) {
    return (
        <div className="artifact-toolbar">
            <span className="artifact-lang">{lang || 'code'}</span>
            <div className="artifact-toolbar-actions">
                <button
                    className="artifact-btn"
                    onClick={onCopy}
                    title="Copy"
                    aria-label="Copy code"
                >
                    {copied ? (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                        </svg>
                    ) : (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                    )}
                    <span>{copied ? 'Copied!' : 'Copy'}</span>
                </button>
                <button
                    className="artifact-btn"
                    onClick={() => downloadFile(code, lang)}
                    title="Download"
                    aria-label="Download file"
                >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    <span>Download</span>
                </button>
            </div>
        </div>
    )
}

// ── Main Component ────────────────────────────────────────────────────

interface ArtifactViewerProps {
    lang: string
    code: string
}

export default function ArtifactViewer({ lang, code }: ArtifactViewerProps) {
    const [copied, setCopied] = useState(false)
    const codeRef = useRef<HTMLElement>(null)
    const normalizedLang = lang.toLowerCase().trim()

    // Highlight on mount and when code changes
    useEffect(() => {
        if (codeRef.current && !SVG_LANGS.includes(normalizedLang)) {
            Prism.highlightElement(codeRef.current)
        }
    }, [code, normalizedLang])

    const handleCopy = () => {
        navigator.clipboard.writeText(code).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        })
    }

    // ── SVG ──
    if (SVG_LANGS.includes(normalizedLang)) {
        return (
            <div className="artifact-block">
                <ArtifactToolbar lang={normalizedLang} code={code} onCopy={handleCopy} copied={copied} />
                <div
                    className="artifact-svg-preview"
                    dangerouslySetInnerHTML={{ __html: code }}
                />
                <details className="artifact-svg-source">
                    <summary className="artifact-svg-toggle">Show source</summary>
                    <pre className="artifact-pre">
                        <code ref={codeRef} className="language-markup">{code}</code>
                    </pre>
                </details>
            </div>
        )
    }

    // ── Code (all other languages) ──
    const prismLang = CODE_LANGS.includes(normalizedLang) ? getPrismLang(normalizedLang) : 'clike'

    return (
        <div className="artifact-block">
            <ArtifactToolbar lang={normalizedLang || 'text'} code={code} onCopy={handleCopy} copied={copied} />
            <div className="artifact-code-scroll">
                <pre className="artifact-pre">
                    <code ref={codeRef} className={`language-${prismLang}`}>{code}</code>
                </pre>
            </div>
        </div>
    )
}
