import { useState, useEffect } from "react";
import { listConversations, deleteConversation, type Conversation } from "../utils/conversationStore";
import { getUser } from "../utils/auth";

interface HistoryViewProps {
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
  currentConversationId: string | null;
}

function HistoryView({ onSelectConversation, onNewChat, currentConversationId }: HistoryViewProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    getUser().then((u) => {
      setIsLoggedIn(!!u);
      if (u) {
        listConversations()
          .then(setConversations)
          .finally(() => setIsLoading(false));
      } else {
        setIsLoading(false);
      }
    });
  }, []);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await deleteConversation(id);
    setConversations((prev) => prev.filter((c) => c.id !== id));
  };

  const formatDate = (ts: number) => {
    const now = Date.now();
    const diff = now - ts;
    if (diff < 60_000) return "Just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
    return new Date(ts).toLocaleDateString();
  };

  return (
    <div className="history-view">
      <div className="workflows-header">
        <h2 className="workflows-title">History</h2>
        <button className="history-new-btn" onClick={onNewChat}>+ New chat</button>
      </div>

      {!isLoggedIn && !isLoading && (
        <div className="history-empty">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.3">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <p>Sign in to see your history</p>
          <span>Conversations are saved for signed-in users</span>
        </div>
      )}

      {isLoading && (
        <div className="workflows-loading">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="workflow-skeleton" style={{ marginBottom: 4 }}>
              <div className="skeleton-lines" style={{ flex: 1 }}>
                <div className="skeleton-text" style={{ width: `${60 + i * 6}%` }} />
                <div className="skeleton-text short" style={{ width: "30%" }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {!isLoading && isLoggedIn && conversations.length === 0 && (
        <div className="history-empty">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.3">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <p>No conversations yet</p>
          <span>Start a new chat to see your history here</span>
        </div>
      )}

      {!isLoading && isLoggedIn && conversations.length > 0 && (
        <div className="history-list">
          {conversations.map((c) => (
            <button
              key={c.id}
              className={`history-item ${c.id === currentConversationId ? "active" : ""}`}
              onClick={() => { onSelectConversation(c.id); }}
            >
              <div className="history-item-icon">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <div className="history-item-text">
                <span className="history-item-title">{c.title || "Untitled"}</span>
                <span className="history-item-time">{formatDate(c.updatedAt)}</span>
              </div>
              <button
                className="history-item-delete"
                onClick={(e) => handleDelete(e, c.id)}
                title="Delete conversation"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default HistoryView;
