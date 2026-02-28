import { useState, useEffect } from 'react'
import type { User } from '../utils/auth'
import { getRequestCount, FREE_REQUEST_LIMIT } from '../utils/auth'
import HistoryView from './HistoryView'

interface ProfileViewProps {
    user: User | null
    onSignIn: () => void
    onSignOut: () => void
    onSelectConversation: (conversationId: string) => void
    onNewChat: () => void
    currentConversationId: string | null
}

function ProfileView({ user, onSignIn, onSignOut, onSelectConversation, onNewChat, currentConversationId }: ProfileViewProps) {
    const [requestCount, setRequestCount] = useState(0)
    const [showSignOutConfirm, setShowSignOutConfirm] = useState(false)

    useEffect(() => {
        getRequestCount().then(c => setRequestCount(c))
    }, [])

    if (!user) {
        return (
            <div className="profile-view">
                <div className="profile-guest">
                    <div className="profile-guest-icon">
                        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                            <circle cx="12" cy="7" r="4" />
                        </svg>
                    </div>
                    <h2 className="profile-guest-title">Welcome to PageClick</h2>
                    <p className="profile-guest-subtitle">
                        Sign in to unlock unlimited requests and sync your conversations.
                    </p>
                    <div className="profile-usage-meter">
                        <div className="profile-usage-bar">
                            <div
                                className="profile-usage-fill"
                                style={{ width: `${Math.min((requestCount / FREE_REQUEST_LIMIT) * 100, 100)}%` }}
                            />
                        </div>
                        <span className="profile-usage-text">{requestCount} / {FREE_REQUEST_LIMIT} free requests</span>
                    </div>
                    <button className="profile-signin-btn" onClick={onSignIn}>
                        <svg width="18" height="18" viewBox="0 0 24 24">
                            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                        </svg>
                        <span>Sign in with Google</span>
                    </button>
                </div>
            </div>
        )
    }

    return (
        <div className="profile-view">
            {/* User Card */}
            <div className="profile-card">
                <div className="profile-avatar-lg">
                    {user.avatar ? (
                        <img
                            src={user.avatar}
                            alt={user.name}
                            className="profile-avatar-img"
                            referrerPolicy="no-referrer"
                        />
                    ) : (
                        <div className="profile-avatar-fallback-lg">
                            {user.name.charAt(0).toUpperCase()}
                        </div>
                    )}
                </div>
                <h2 className="profile-name">{user.name}</h2>
                <p className="profile-email">{user.email}</p>
                <div className="profile-plan-badge">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                    </svg>
                    <span>Unlimited Access</span>
                </div>
            </div>

            {/* Account Section */}
            <div className="profile-section">
                <div className="profile-section-title">Account</div>
                <div className="profile-section-card">
                    <div className="profile-row">
                        <div className="profile-row-icon">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                                <circle cx="12" cy="7" r="4" />
                            </svg>
                        </div>
                        <span className="profile-row-label">Name</span>
                        <span className="profile-row-value">{user.name}</span>
                    </div>
                    <div className="profile-row">
                        <div className="profile-row-icon">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="2" y="4" width="20" height="16" rx="2" />
                                <path d="M22 7l-10 6L2 7" />
                            </svg>
                        </div>
                        <span className="profile-row-label">Email</span>
                        <span className="profile-row-value">{user.email}</span>
                    </div>
                </div>
            </div>

            {/* Chat History Section */}
            <div className="profile-section">
                <div className="profile-section-title">Chat History</div>
                <div className="profile-history-embed">
                    <HistoryView
                        onSelectConversation={onSelectConversation}
                        onNewChat={onNewChat}
                        currentConversationId={currentConversationId}
                    />
                </div>
            </div>

            {/* Preferences Section */}
            <div className="profile-section">
                <div className="profile-section-title">Preferences</div>
                <div className="profile-section-card">
                    <button className="profile-row clickable">
                        <div className="profile-row-icon">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="3" />
                                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                            </svg>
                        </div>
                        <span className="profile-row-label">Settings</span>
                        <svg className="profile-row-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
                    </button>
                    <button className="profile-row clickable">
                        <div className="profile-row-icon">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
                            </svg>
                        </div>
                        <span className="profile-row-label">Theme</span>
                        <span className="profile-row-value">System</span>
                    </button>
                    <button className="profile-row clickable">
                        <div className="profile-row-icon">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
                                <path d="M13.73 21a2 2 0 01-3.46 0" />
                            </svg>
                        </div>
                        <span className="profile-row-label">Notifications</span>
                        <span className="profile-row-value">On</span>
                    </button>
                </div>
            </div>

            {/* About Section */}
            <div className="profile-section">
                <div className="profile-section-title">About</div>
                <div className="profile-section-card">
                    <div className="profile-row">
                        <div className="profile-row-icon">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10" />
                                <path d="M12 16v-4M12 8h.01" />
                            </svg>
                        </div>
                        <span className="profile-row-label">Version</span>
                        <span className="profile-row-value">1.0.0</span>
                    </div>
                    <button className="profile-row clickable">
                        <div className="profile-row-icon">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                                <polyline points="14 2 14 8 20 8" />
                            </svg>
                        </div>
                        <span className="profile-row-label">Privacy Policy</span>
                        <svg className="profile-row-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
                    </button>
                    <button className="profile-row clickable">
                        <div className="profile-row-icon">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10" />
                                <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
                                <line x1="12" y1="17" x2="12.01" y2="17" />
                            </svg>
                        </div>
                        <span className="profile-row-label">Help & Support</span>
                        <svg className="profile-row-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
                    </button>
                </div>
            </div>

            {/* Sign Out Button */}
            <button className="profile-signout-btn" onClick={() => setShowSignOutConfirm(true)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                <span>Sign Out</span>
            </button>

            <div className="profile-footer">
                <span>PageClick v1.0.0</span>
            </div>

            {/* Sign Out Confirmation Overlay */}
            {showSignOutConfirm && (
                <div className="profile-signout-overlay" onClick={() => setShowSignOutConfirm(false)}>
                    <div className="profile-signout-dialog" onClick={e => e.stopPropagation()}>
                        <div className="profile-signout-icon">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                                <polyline points="16 17 21 12 16 7" />
                                <line x1="21" y1="12" x2="9" y2="12" />
                            </svg>
                        </div>
                        <h3>Sign out?</h3>
                        <p>You'll need to sign in again to access your conversations and unlimited requests.</p>
                        <div className="profile-signout-actions">
                            <button className="profile-signout-cancel" onClick={() => setShowSignOutConfirm(false)}>Cancel</button>
                            <button className="profile-signout-confirm" onClick={onSignOut}>Sign Out</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export default ProfileView
