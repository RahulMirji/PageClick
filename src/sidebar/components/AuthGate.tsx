import { useState } from "react";

interface AuthGateProps {
  onSignIn: () => Promise<void>;
  onDismiss: () => void;
  requestCount: number;
}

function AuthGate({ onSignIn, onDismiss, requestCount }: AuthGateProps) {
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    setIsSigningIn(true);
    setError(null);
    try {
      await onSignIn();
    } catch (err: any) {
      setError(err.message || "Sign-in failed. Please try again.");
    } finally {
      setIsSigningIn(false);
    }
  };

  return (
    <div className="auth-gate-overlay">
      <div className="auth-gate-card">
        {/* Logo */}
        <div className="auth-gate-logo">
          <svg width="40" height="40" viewBox="0 0 56 56" fill="none">
            <rect width="56" height="56" rx="16" fill="#1a1a1a" />
            <path
              d="M18 28C18 22.477 22.477 18 28 18C33.523 18 38 22.477 38 28"
              stroke="#00D4FF"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <circle cx="28" cy="33" r="3" fill="#00D4FF" />
            <path
              d="M28 30V22"
              stroke="#00D4FF"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>
        </div>

        <h2 className="auth-gate-title">Free requests used</h2>
        <p className="auth-gate-subtitle">
          You've used all {requestCount} free requests. Sign in with Google to
          unlock unlimited access.
        </p>

        {error && <div className="auth-gate-error">{error}</div>}

        <button
          className="google-signin-btn"
          onClick={handleSignIn}
          disabled={isSigningIn}
        >
          {isSigningIn ? (
            <div className="google-signin-spinner" />
          ) : (
            <svg
              className="google-logo"
              width="18"
              height="18"
              viewBox="0 0 24 24"
            >
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
          )}
          <span>{isSigningIn ? "Signing in..." : "Sign in with Google"}</span>
        </button>

        <button className="auth-gate-dismiss" onClick={onDismiss}>
          Continue later
        </button>
      </div>
    </div>
  );
}

export default AuthGate;
