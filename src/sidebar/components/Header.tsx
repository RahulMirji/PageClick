import { useState, useRef, useEffect } from 'react'
import type { User } from '../utils/auth'

interface HeaderProps {
    status?: string
    user?: User | null
    onSignOut?: () => void
}

function Header({ status, user, onSignOut }: HeaderProps) {
    const [searchValue, setSearchValue] = useState('')
    const [showUserMenu, setShowUserMenu] = useState(false)
    const menuRef = useRef<HTMLDivElement>(null)

    // Close dropdown on outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setShowUserMenu(false)
            }
        }
        if (showUserMenu) {
            document.addEventListener('mousedown', handleClickOutside)
        }
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [showUserMenu])

    const handleGo = () => {
        const trimmed = searchValue.trim()
        if (!trimmed) return

        let url = trimmed
        // If it looks like a URL but has no protocol, add https://
        if (!/^https?:\/\//i.test(url)) {
            // Check if it looks like a domain (has a dot and no spaces)
            if (/^[^\s]+\.[^\s]+$/.test(url)) {
                url = 'https://' + url
            } else {
                // Not a URL — fall back to Google search
                url = 'https://www.google.com/search?q=' + encodeURIComponent(trimmed)
            }
        }

        chrome.tabs.create({ url })
        setSearchValue('')
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            handleGo()
        }
    }

    return (
        <header className="header">
            {status ? (
                <div className="status-bar">
                    <span className="status-dot"></span>
                    <span className="status-text">{status}</span>
                </div>
            ) : (
                <>
                    <button className="header-home-btn" aria-label="Home">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                            <polyline points="9 22 9 12 15 12 15 22" />
                        </svg>
                    </button>
                    <div className="header-search">
                        <input
                            type="text"
                            placeholder="Paste a link and hit Go"
                            value={searchValue}
                            onChange={(e) => setSearchValue(e.target.value)}
                            onKeyDown={handleKeyDown}
                            className="header-search-input"
                        />
                    </div>
                    {user ? (
                        <div className="user-avatar-container" ref={menuRef}>
                            <button
                                className="user-avatar-btn"
                                onClick={() => setShowUserMenu((prev) => !prev)}
                                aria-label="User menu"
                            >
                                {user.avatar ? (
                                    <img
                                        src={user.avatar}
                                        alt={user.name}
                                        className="user-avatar"
                                        referrerPolicy="no-referrer"
                                    />
                                ) : (
                                    <div className="user-avatar-fallback">
                                        {user.name.charAt(0).toUpperCase()}
                                    </div>
                                )}
                            </button>
                            {showUserMenu && (
                                <div className="user-menu">
                                    <div className="user-menu-info">
                                        <span className="user-menu-name">{user.name}</span>
                                        <span className="user-menu-email">{user.email}</span>
                                    </div>
                                    <div className="user-menu-divider" />
                                    <button
                                        className="user-menu-item"
                                        onClick={() => {
                                            setShowUserMenu(false)
                                            chrome.runtime.openOptionsPage()
                                        }}
                                    >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <circle cx="12" cy="12" r="3" />
                                            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 9 15a1.65 1.65 0 0 0-1.82-.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 15 9a1.65 1.65 0 0 0 1.82.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 15z" />
                                        </svg>
                                        <span>Settings</span>
                                    </button>
                                    <button
                                        className="user-menu-item"
                                        onClick={() => {
                                            setShowUserMenu(false)
                                            onSignOut?.()
                                        }}
                                    >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                                            <polyline points="16 17 21 12 16 7" />
                                            <line x1="21" y1="12" x2="9" y2="12" />
                                        </svg>
                                        <span>Sign out</span>
                                    </button>
                                </div>
                            )}
                        </div>
                    ) : (
                        <button className="header-go-btn" onClick={handleGo}>Go</button>
                    )}
                </>
            )}
        </header>
    )
}

export default Header
