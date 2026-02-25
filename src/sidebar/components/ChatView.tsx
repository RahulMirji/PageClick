import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import TaskProgressCard from './TaskProgressCard'
import TaskPlanConfirm from './TaskPlanConfirm'
import ArtifactViewer from './ArtifactViewer'
import type { TaskProgress } from './TaskProgressCard'
import type { PlanConfirmData } from './TaskPlanConfirm'

export interface Message {
    role: 'user' | 'assistant'
    content: string
    images?: string[]
    taskProgress?: TaskProgress
    planConfirm?: PlanConfirmData
    hidden?: boolean
    tokenCount?: number
}

interface ChatViewProps {
    messages: Message[]
    isLoading: boolean
}

/** Strip all structured <<<...>>> blocks from content for display */
function cleanDisplayContent(text: string): string {
    return text
        .replace(/<<<ASK_USER>>>[\s\S]*?<<<END_ASK_USER>>>/g, '')
        .replace(/<<<TASK_READY>>>[\s\S]*?<<<END_TASK_READY>>>/g, '')
        .replace(/<<<ACTION_PLAN>>>[\s\S]*?<<<(?:END_ACTION_PLAN|_ACTION_PLAN)>>>/g, '')
        .replace(/<<<CHECKPOINT>>>[\s\S]*?<<<END_CHECKPOINT>>>/g, '')
        .replace(/<<<TASK_COMPLETE>>>[\s\S]*?<<<END_TASK_COMPLETE>>>/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

function ChatView({ messages, isLoading }: ChatViewProps) {
    const bottomRef = useRef<HTMLDivElement>(null)
    const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
    const [sharedIndex, setSharedIndex] = useState<number | null>(null)

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages, isLoading])

    const stripMarkdown = (md: string): string => {
        return md
            .replace(/^#{1,6}\s+/gm, '')
            .replace(/\*\*(.+?)\*\*/g, '$1')
            .replace(/\*(.+?)\*/g, '$1')
            .replace(/__(.+?)__/g, '$1')
            .replace(/_(.+?)_/g, '$1')
            .replace(/~~(.+?)~~/g, '$1')
            .replace(/`{3}[\s\S]*?`{3}/g, (m) =>
                m.replace(/^```\w*\n?/gm, '').replace(/```$/gm, ''))
            .replace(/`(.+?)`/g, '$1')
            .replace(/\[(.+?)\]\(.+?\)/g, '$1')
            .replace(/^[-*+]\s+/gm, '• ')
            .replace(/^\d+\.\s+/gm, (m) => m)
            .replace(/^>\s?/gm, '')
            .replace(/^---+$/gm, '')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/<<<ASK_USER>>>[\s\S]*?<<<END_ASK_USER>>>/g, '')
            .replace(/<<<TASK_READY>>>[\s\S]*?<<<END_TASK_READY>>>/g, '')
            .replace(/<<<ACTION_PLAN>>>[\s\S]*?<<<(?:END_ACTION_PLAN|_ACTION_PLAN)>>>/g, '')
            .replace(/<<<CHECKPOINT>>>[\s\S]*?<<<END_CHECKPOINT>>>/g, '')
            .replace(/<<<TASK_COMPLETE>>>[\s\S]*?<<<END_TASK_COMPLETE>>>/g, '')
            .trim()
    }

    const handleCopy = (text: string, index: number) => {
        navigator.clipboard.writeText(stripMarkdown(text))
        setCopiedIndex(index)
        setTimeout(() => setCopiedIndex(null), 2000)
    }

    const handleShare = async (text: string, index: number) => {
        const plainText = stripMarkdown(text)
        try {
            if (navigator.share) {
                await navigator.share({ text: plainText })
            } else {
                await navigator.clipboard.writeText(plainText)
            }
        } catch {
            await navigator.clipboard.writeText(plainText)
        }
        setSharedIndex(index)
        setTimeout(() => setSharedIndex(null), 2000)
    }

    return (
        <div className="chat-view">
            {messages.map((msg, i) => {
                // Skip hidden messages that have no visible UI components
                if (msg.hidden && !msg.planConfirm && !(msg.taskProgress && msg.taskProgress.steps.length > 0)) {
                    return null
                }
                return (
                    <div key={i} className={`chat-message ${msg.role}`}>
                        {msg.role === 'user' ? (
                            <div className="chat-bubble user">
                                {msg.images && msg.images.length > 0 && (
                                    <div className="chat-images">
                                        {msg.images.map((img, j) => (
                                            <img key={j} src={img} alt={`Attached ${j + 1}`} className="chat-image-thumb" />
                                        ))}
                                    </div>
                                )}
                                <span>{msg.content}</span>
                            </div>
                        ) : (
                            <div className="assistant-block">
                                {/* Render cleaned text (no raw structured blocks) — skip if hidden */}
                                {!msg.hidden && cleanDisplayContent(msg.content) && (
                                    <div className="assistant-text markdown-body">
                                        <ReactMarkdown
                                            remarkPlugins={[remarkGfm]}
                                            components={{
                                                // Strip the outer <pre> wrapper — ArtifactViewer provides its own container
                                                pre({ children }) {
                                                    return <>{children}</>
                                                },
                                                code({ className, children, ...rest }) {
                                                    // Fenced code blocks have a className like "language-ts"
                                                    const match = /language-(\w+)/.exec(className || '')
                                                    const isBlock = !!match
                                                    if (isBlock) {
                                                        const lang = match![1]
                                                        const code = String(children).replace(/\n$/, '')
                                                        return <ArtifactViewer lang={lang} code={code} />
                                                    }
                                                    // Inline code — keep as-is
                                                    return (
                                                        <code className={className} {...rest}>
                                                            {children}
                                                        </code>
                                                    )
                                                }
                                            }}
                                        >
                                            {cleanDisplayContent(msg.content)}
                                        </ReactMarkdown>
                                    </div>
                                )}

                                {/* Render plan confirmation (Proceed / Cancel) */}
                                {msg.planConfirm && (
                                    <TaskPlanConfirm plan={msg.planConfirm} />
                                )}

                                {/* Render task progress card if present */}
                                {msg.taskProgress && msg.taskProgress.steps.length > 0 && (
                                    <TaskProgressCard progress={msg.taskProgress} />
                                )}

                                {/* Show action buttons on every completed assistant message.
                                    The last message suppresses them while it's still streaming. */}
                                {!msg.hidden && msg.content && !(isLoading && i === messages.length - 1) && (
                                    <div className="message-actions">
                                        <div className="actions-left">
                                            <button
                                                className="action-icon-btn"
                                                aria-label="Share"
                                                title="Share"
                                                onClick={() => handleShare(msg.content, i)}
                                            >
                                                {sharedIndex === i ? (
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                        <polyline points="20 6 9 17 4 12" />
                                                    </svg>
                                                ) : (
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                        <circle cx="18" cy="5" r="3" />
                                                        <circle cx="6" cy="12" r="3" />
                                                        <circle cx="18" cy="19" r="3" />
                                                        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                                                        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                                                    </svg>
                                                )}
                                            </button>
                                            <button
                                                className="action-icon-btn"
                                                aria-label="Copy"
                                                title="Copy"
                                                onClick={() => handleCopy(msg.content, i)}
                                            >
                                                {copiedIndex === i ? (
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                        <polyline points="20 6 9 17 4 12" />
                                                    </svg>
                                                ) : (
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                                    </svg>
                                                )}
                                            </button>
                                        </div>
                                        <div className="actions-right">
                                            {msg.tokenCount && (
                                                <span className="token-count">~{msg.tokenCount} tokens</span>
                                            )}
                                            <button className="action-icon-btn" aria-label="Like" title="Helpful">
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z" />
                                                    <path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
                                                </svg>
                                            </button>
                                            <button className="action-icon-btn" aria-label="Dislike" title="Not helpful">
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z" />
                                                    <path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" />
                                                </svg>
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )
            }
            )}
            {isLoading && (
                <div className="chat-message assistant">
                    <div className="assistant-block">
                        <div className="thinking-indicator">
                            <div className="thinking-dot"></div>
                            <span>Thinking...</span>
                        </div>
                    </div>
                </div>
            )}
            <div ref={bottomRef} />
        </div>
    )
}

export default ChatView
