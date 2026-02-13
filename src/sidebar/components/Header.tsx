import { useState } from 'react'

function Header() {
    const [searchValue, setSearchValue] = useState('')

    return (
        <header className="header">
            <button className="header-home-btn" aria-label="Home">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                    <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
            </button>
            <div className="header-search">
                <input
                    type="text"
                    placeholder="Search"
                    value={searchValue}
                    onChange={(e) => setSearchValue(e.target.value)}
                    className="header-search-input"
                />
            </div>
            <button className="header-go-btn">Go</button>
        </header>
    )
}

export default Header
