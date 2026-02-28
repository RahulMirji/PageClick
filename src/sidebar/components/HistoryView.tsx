import { useState, useEffect, useCallback } from "react";
import {
  listConversations,
  deleteConversation,
  loadMessages,
  type Conversation,
} from "../utils/conversationStore";
import {
  downloadText,
  formatConversationAsMarkdown,
} from "../utils/downloadService";

interface HistoryViewProps {
  onSelectConversation: (conversationId: string) => void;
  onNewChat: () => void;
  currentConversationId: string | null;
}

function HistoryView({
  onSelectConversation,
  onNewChat,
  currentConversationId,
}: HistoryViewProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadConversations = useCallback(async () => {
    setIsLoading(true);
    try {
      const convs = await listConversations();
      setConversations(convs);
    } catch (err) {
      console.warn("Failed to load conversations:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  const handleDelete = async (e: React.MouseEvent, convId: string) => {
    e.stopPropagation();
    await deleteConversation(convId);
    setConversations((prev) => prev.filter((c) => c.id !== convId));
  };

  const handleExport = async (e: React.MouseEvent, conv: Conversation) => {
    e.stopPropagation();
    try {
      const messages = await loadMessages(conv.id);
      const md = formatConversationAsMarkdown(conv.title, messages);
      const safeTitle = conv.title
        .replace(/[^a-z0-9]/gi, "-")
        .toLowerCase()
        .slice(0, 40);
      downloadText(md, `pageclick-${safeTitle}.md`);
    } catch (err) {
      console.warn("Export failed:", err);
    }
  };

  // Group conversations by date
  const groups = groupByDate(conversations);

  return (
    <div className="history-view">
      <div className="history-header">
        <h2 className="history-title">History</h2>
        <button className="history-new-chat-btn" onClick={onNewChat}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span>New Chat</span>
        </button>
      </div>

      <div className="history-list">
        {isLoading ? (
          <div className="history-loading">
            {[1, 2, 3].map((i) => (
              <div key={i} className="history-skeleton">
                <div
                  className="skeleton-text"
                  style={{ width: `${60 + i * 10}%` }}
                />
                <div className="skeleton-text short" style={{ width: "35%" }} />
              </div>
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <div className="history-empty">
            <svg
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.3"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <p>No conversations yet</p>
            <span>Start a chat and it will appear here</span>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="history-group">
              <div className="history-group-label">{group.label}</div>
              {group.conversations.map((conv) => (
                <div
                  key={conv.id}
                  className={`history-item ${conv.id === currentConversationId ? "active" : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectConversation(conv.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectConversation(conv.id);
                    }
                  }}
                >
                  <div className="history-item-content">
                    <span className="history-item-title">{conv.title}</span>
                    <span className="history-item-time">
                      {formatTime(conv.updatedAt)}
                    </span>
                  </div>
                  <button
                    className="history-item-delete"
                    onClick={(e) => handleExport(e, conv)}
                    aria-label="Export conversation"
                    title="Export as .md"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                  </button>
                  <button
                    className="history-item-delete"
                    onClick={(e) => handleDelete(e, conv.id)}
                    aria-label="Delete conversation"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────

export interface DateGroup {
  label: string;
  conversations: Conversation[];
}

export function groupByDate(conversations: Conversation[]): DateGroup[] {
  const now = new Date();
  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const yesterday = today - 86400000;
  const weekAgo = today - 7 * 86400000;

  const groups: Record<string, Conversation[]> = {
    Today: [],
    Yesterday: [],
    "This Week": [],
    Older: [],
  };

  for (const conv of conversations) {
    if (conv.updatedAt >= today) {
      groups.Today.push(conv);
    } else if (conv.updatedAt >= yesterday) {
      groups.Yesterday.push(conv);
    } else if (conv.updatedAt >= weekAgo) {
      groups["This Week"].push(conv);
    } else {
      groups.Older.push(conv);
    }
  }

  return Object.entries(groups)
    .filter(([, convs]) => convs.length > 0)
    .map(([label, conversations]) => ({ label, conversations }));
}

export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const yesterday = today - 86400000;

  const timeStr = date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (timestamp >= today) {
    return `Today · ${timeStr}`;
  } else if (timestamp >= yesterday) {
    return `Yesterday · ${timeStr}`;
  }
  return (
    date.toLocaleDateString([], {
      month: "short",
      day: "numeric",
      year: "numeric",
    }) + ` · ${timeStr}`
  );
}

export default HistoryView;
