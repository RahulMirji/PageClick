import { useState } from 'react'

interface HeaderProps {
    status?: string
}

function Header({ status }: HeaderProps) {
    const [searchValue, setSearchValue] = useState('')

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
                    <button className="header-go-btn" onClick={handleGo}>Go</button>
                </>
            )}
        </header>
    )
}

export default Header
