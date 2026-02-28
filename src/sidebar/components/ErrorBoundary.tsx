import { Component, type ReactNode, type ErrorInfo } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[PageClick] Uncaught error:", error, info.componentStack);
  }

  handleReload = () => {
    // Reload the side panel
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100vh",
            padding: "24px",
            textAlign: "center",
            background: "var(--bg-primary, #0a0a0a)",
            color: "var(--text-primary, #fff)",
            gap: "12px",
            fontFamily: "Inter, sans-serif",
          }}
        >
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#ef4444"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p style={{ margin: 0, fontWeight: 600, fontSize: "15px" }}>
            Something went wrong
          </p>
          <p
            style={{
              margin: 0,
              fontSize: "12px",
              color: "var(--text-muted, #888)",
              maxWidth: "240px",
            }}
          >
            {this.state.error?.message || "An unexpected error occurred."}
          </p>
          <button
            onClick={this.handleReload}
            style={{
              marginTop: "8px",
              padding: "8px 20px",
              borderRadius: "8px",
              border: "none",
              background: "var(--accent, #7c3aed)",
              color: "#fff",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload Extension
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
