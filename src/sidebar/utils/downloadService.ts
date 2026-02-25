/**
 * downloadService.ts — Unified download utility for PageClick.
 *
 * Three export points:
 *  1. downloadUrl()    — AI-triggered: saves a remote URL via chrome.downloads (background)
 *  2. downloadText()   — UI-triggered: saves in-memory text as a file via blob URL
 *  3. formatConversationAsMarkdown() — conversation export formatter
 */

import type { Message } from '../components/ChatView'

// ── Remote URL download (via background + chrome.downloads) ─────────────

/**
 * Download a remote URL to the user's Downloads folder.
 * Routes through the background service worker because chrome.downloads
 * is not available directly in the side panel context.
 *
 * @param url      Full URL to download
 * @param filename Optional suggested filename
 * @param saveAs   If true, shows the native save-as dialog (default: false)
 */
export async function downloadUrl(
    url: string,
    filename?: string,
    saveAs = false,
): Promise<{ ok: boolean; error?: string }> {
    try {
        return await chrome.runtime.sendMessage({
            type: 'DOWNLOAD_FILE',
            url,
            filename: filename || undefined,
            saveAs,
        })
    } catch (e: any) {
        return { ok: false, error: e.message }
    }
}

// ── In-memory text download (blob URL, sidebar context) ─────────────────

/**
 * Download text content as a local file using a blob URL.
 * Does NOT require the downloads permission — works in any page context.
 * Used for: saving AI messages, exporting conversations.
 *
 * @param content  Text content to write to the file
 * @param filename Desired filename (e.g. "chat-export.md")
 * @param mimeType MIME type, defaults to text/markdown
 */
export function downloadText(
    content: string,
    filename: string,
    mimeType = 'text/markdown',
): void {
    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
}

// ── Conversation export formatter ────────────────────────────────────────

/**
 * Format a list of messages into a clean Markdown document for export.
 * Strips internal structured blocks (<<<TAG>>>) and metadata prefixes.
 */
export function formatConversationAsMarkdown(
    title: string,
    messages: Message[],
    exportedAt = new Date(),
): string {
    const dateStr = exportedAt.toLocaleDateString(undefined, {
        year: 'numeric', month: 'long', day: 'numeric',
    })

    const header = [
        `# ${title}`,
        ``,
        `_Exported from PageClick · ${dateStr}_`,
        ``,
        `---`,
        ``,
    ].join('\n')

    const body = messages
        .filter(m => m.content.trim().length > 0)
        .map(m => {
            const label = m.role === 'user' ? '### 👤 You' : '### 🤖 PageClick'
            // Strip any residual structured blocks from assistant messages
            const text = m.content
                .replace(/<<<[A-Z_]+>>>[\s\S]*?<<<END_[A-Z_]+>>>/g, '')
                .replace(/<<<[A-Z_]+>>>/g, '')
                .trim()
            return `${label}\n\n${text}`
        })
        .join('\n\n---\n\n')

    return header + body + '\n'
}
