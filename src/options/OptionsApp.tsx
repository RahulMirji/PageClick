import { useState, useEffect } from "react";

// ── Types ────────────────────────────────────────────────────────────
type ModelId = "gpt-oss-120b" | "qwen3-32b" | "llama-4-scout" | "llama-3.3-70b" | "gemini-3-pro";
type Theme = "light" | "dark" | "system";

interface Settings {
  defaultModel: ModelId;
  theme: Theme;
}

const DEFAULT_SETTINGS: Settings = {
  defaultModel: "gemini-3-pro",
  theme: "light",
};

const STORAGE_KEY = "pageclick_settings";

async function loadSettings(): Promise<Settings> {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      resolve({ ...DEFAULT_SETTINGS, ...(result[STORAGE_KEY] || {}) });
    });
  });
}

async function saveSettings(settings: Settings): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: settings }, resolve);
  });
}

async function clearAllHistory(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove("conversations", resolve);
  });
}

// ── Component ────────────────────────────────────────────────────────

const MODELS: { id: ModelId; label: string; icon: string; desc: string }[] = [
  {
    id: "gemini-3-pro",
    label: "Gemini 3 Pro",
    icon: "💎",
    desc: "Best quality, slower",
  },
  {
    id: "gpt-oss-120b",
    label: "GPT-OSS 120B",
    icon: "⚡",
    desc: "Balanced speed & quality",
  },
  {
    id: "qwen3-32b",
    label: "Qwen3 32B",
    icon: "🧠",
    desc: "Strong reasoning model",
  },
  {
    id: "llama-4-scout",
    label: "Llama 4 Scout",
    icon: "🦙",
    desc: "Open-source, vision support",
  },
  {
    id: "llama-3.3-70b",
    label: "Llama 3.3 70B",
    icon: "🦙",
    desc: "Strong general-purpose",
  },
];

const THEMES: { id: Theme; label: string; icon: string }[] = [
  { id: "light", label: "Light", icon: "☀️" },
  { id: "dark", label: "Dark", icon: "🌙" },
  { id: "system", label: "System", icon: "💻" },
];

export default function OptionsApp() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadSettings().then((s) => {
      setSettings(s);
      setIsLoading(false);
    });
  }, []);

  const handleSave = async (patch: Partial<Settings>) => {
    const updated = { ...settings, ...patch };
    setSettings(updated);
    await saveSettings(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  const handleClearHistory = async () => {
    if (
      !confirm("Clear all local conversation history? This cannot be undone.")
    )
      return;
    await clearAllHistory();
    setCleared(true);
    setTimeout(() => setCleared(false), 2000);
  };

  if (isLoading) {
    return (
      <div style={styles.page}>
        <div style={styles.container}>
          <p style={{ color: "#888", fontSize: "14px" }}>Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.logoRow}>
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#1a1a1a"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 9 15a1.65 1.65 0 0 0-1.82-.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 15 9a1.65 1.65 0 0 0 1.82.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 15z" />
            </svg>
            <h1 style={styles.title}>PageClick Settings</h1>
          </div>
          {saved && <span style={styles.savedBadge}>✓ Saved</span>}
        </div>

        {/* Default Model */}
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>Default Model</h2>
          <p style={styles.sectionDesc}>
            Choose the AI model used for new conversations.
          </p>
          <div style={styles.optionGrid}>
            {MODELS.map((m) => (
              <button
                key={m.id}
                style={{
                  ...styles.optionCard,
                  ...(settings.defaultModel === m.id
                    ? styles.optionCardActive
                    : {}),
                }}
                onClick={() => handleSave({ defaultModel: m.id })}
              >
                <span style={styles.optionIcon}>{m.icon}</span>
                <div style={styles.optionText}>
                  <span style={styles.optionLabel}>{m.label}</span>
                  <span style={styles.optionDesc}>{m.desc}</span>
                </div>
                {settings.defaultModel === m.id && (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ color: "#1a1a1a", flexShrink: 0 }}
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </section>

        <div style={styles.divider} />

        {/* Theme */}
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>Appearance</h2>
          <p style={styles.sectionDesc}>Choose how the sidebar looks.</p>
          <div style={styles.themeRow}>
            {THEMES.map((t) => (
              <button
                key={t.id}
                style={{
                  ...styles.themeBtn,
                  ...(settings.theme === t.id ? styles.themeBtnActive : {}),
                }}
                onClick={() => handleSave({ theme: t.id })}
              >
                <span>{t.icon}</span>
                <span style={styles.themeBtnLabel}>{t.label}</span>
              </button>
            ))}
          </div>
        </section>

        <div style={styles.divider} />

        {/* Data */}
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>Data</h2>
          <p style={styles.sectionDesc}>
            Manage your stored conversation history.
          </p>
          <button style={styles.dangerBtn} onClick={handleClearHistory}>
            {cleared ? (
              <>✓ History cleared</>
            ) : (
              <>
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
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                </svg>
                Clear Local History
              </>
            )}
          </button>
        </section>

        {/* Footer */}
        <div style={styles.footer}>
          <span>PageClick v1.0.0</span>
          <span style={{ margin: "0 6px", opacity: 0.3 }}>·</span>
          <a
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
            style={styles.footerLink}
          >
            GitHub
          </a>
        </div>
      </div>
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#f7f7f7",
    fontFamily:
      "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    color: "#1a1a1a",
    fontSize: "14px",
    WebkitFontSmoothing: "antialiased",
    padding: "40px 16px",
  },
  container: {
    maxWidth: "520px",
    margin: "0 auto",
    background: "#ffffff",
    borderRadius: "16px",
    padding: "28px 28px 20px",
    boxShadow: "0 4px 24px rgba(0,0,0,0.07)",
    border: "1px solid #ebebeb",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "24px",
  },
  logoRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
  title: {
    fontSize: "18px",
    fontWeight: 700,
    margin: 0,
    letterSpacing: "-0.2px",
  },
  savedBadge: {
    fontSize: "12px",
    fontWeight: 600,
    color: "#16a34a",
    background: "#dcfce7",
    padding: "4px 10px",
    borderRadius: "999px",
    transition: "all 0.2s ease",
  },
  section: {
    marginBottom: "8px",
  },
  sectionTitle: {
    fontSize: "13px",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.6px",
    color: "#999",
    marginBottom: "4px",
  },
  sectionDesc: {
    fontSize: "13px",
    color: "#666",
    marginBottom: "14px",
  },
  optionGrid: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  optionCard: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    width: "100%",
    padding: "12px 14px",
    background: "#f7f7f7",
    border: "1.5px solid #e8e8e8",
    borderRadius: "10px",
    cursor: "pointer",
    textAlign: "left",
    fontFamily: "inherit",
    transition: "all 0.15s ease",
  },
  optionCardActive: {
    background: "#f0f0f0",
    border: "1.5px solid #1a1a1a",
  },
  optionIcon: {
    fontSize: "18px",
    lineHeight: 1,
    flexShrink: 0,
  },
  optionText: {
    display: "flex",
    flexDirection: "column",
    gap: "1px",
    flex: 1,
  },
  optionLabel: {
    fontSize: "13px",
    fontWeight: 600,
    color: "#1a1a1a",
  },
  optionDesc: {
    fontSize: "11px",
    color: "#888",
  },
  divider: {
    height: "1px",
    background: "#ebebeb",
    margin: "20px 0",
  },
  themeRow: {
    display: "flex",
    gap: "8px",
  },
  themeBtn: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "6px",
    padding: "14px 8px",
    background: "#f7f7f7",
    border: "1.5px solid #e8e8e8",
    borderRadius: "10px",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: "18px",
    transition: "all 0.15s ease",
  },
  themeBtnActive: {
    background: "#f0f0f0",
    border: "1.5px solid #1a1a1a",
  },
  themeBtnLabel: {
    fontSize: "11px",
    fontWeight: 600,
    color: "#444",
  },
  dangerBtn: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "9px 16px",
    background: "#fff1f1",
    border: "1.5px solid #fecaca",
    color: "#dc2626",
    borderRadius: "8px",
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "all 0.15s ease",
  },
  footer: {
    marginTop: "24px",
    paddingTop: "16px",
    borderTop: "1px solid #ebebeb",
    fontSize: "12px",
    color: "#aaa",
    display: "flex",
    alignItems: "center",
  },
  footerLink: {
    color: "#aaa",
    textDecoration: "none",
  },
};
