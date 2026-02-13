import { useEffect, useRef } from 'react'

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

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages, isLoading])

    return (
        <div className="chat-view">
            {messages.map((msg, i) => (
                <div key={i} className={`chat-message ${msg.role}`}>
                    {msg.role === 'assistant' && (
                        <div className="chat-avatar">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                            </svg>
                        </div>
                    )}
                    <div className={`chat-bubble ${msg.role}`}>
                        <span>{msg.content}</span>
                    </div>
                </div>
            ))}
            {isLoading && (
                <div className="chat-message assistant">
                    <div className="chat-avatar">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                        </svg>
                    </div>
                    <div className="chat-bubble assistant">
                        <div className="typing-indicator">
                            <span></span>
                            <span></span>
                            <span></span>
                        </div>
                    </div>
                </div>
            )}
            <div ref={bottomRef} />
        </div>
    )
}

export default ChatView
