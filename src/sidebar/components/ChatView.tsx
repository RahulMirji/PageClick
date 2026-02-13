import { useState, useEffect, useRef } from 'react'

export interface Message {
    role: 'user' | 'assistant'
    content: string
}

interface ChatViewProps {
    messages: Message[]
    isLoading: boolean
}

function ChatView({ messages, isLoading }: ChatViewProps) {
    const bottomRef = useRef<HTMLDivElement>(null)
    const [copiedIndex, setCopiedIndex] = useState<number | null>(null)

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages, isLoading])

    const handleCopy = (text: string, index: number) => {
        navigator.clipboard.writeText(text)
        setCopiedIndex(index)
        setTimeout(() => setCopiedIndex(null), 2000)
    }

    return (
        <div className="chat-view">
            {messages.map((msg, i) => (
                <div key={i} className={`chat-message ${msg.role}`}>
                    {msg.role === 'user' ? (
                        <div className="chat-bubble user">
                            <span>{msg.content}</span>
                        </div>
                    ) : (
                        <div className="assistant-block">
                            <div className="assistant-text">
                                <span>{msg.content}</span>
                            </div>
                            {msg.content && (
                                <div className="message-actions">
                                    <div className="actions-left">
                                        <button
                                            className="action-icon-btn"
                                            aria-label="Share"
                                            title="Share"
                                        >
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <circle cx="18" cy="5" r="3" />
                                                <circle cx="6" cy="12" r="3" />
                                                <circle cx="18" cy="19" r="3" />
                                                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                                                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                                            </svg>
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
            ))}
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
