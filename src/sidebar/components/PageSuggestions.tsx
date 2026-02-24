import { useState, useEffect } from 'react'
import { getPageSuggestions, getPageSuggestionsAI, type PageSuggestionsData } from '../utils/getPageSuggestions'

interface PageSuggestionsProps {
    onSuggestionClick: (text: string) => void
}

function PageSuggestions({ onSuggestionClick }: PageSuggestionsProps) {
    const [data, setData] = useState<PageSuggestionsData | null>(null)
    const [isLoading, setIsLoading] = useState(true)

    const fetchSuggestions = async () => {
        setIsLoading(true)
        try {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
            const tab = tabs[0]
            if (tab?.url && tab?.title) {
                // Show hardcoded suggestions instantly
                const instant = getPageSuggestions(tab.url, tab.title)
                setData(instant)
                setIsLoading(false)

                // Then try AI-powered suggestions in background
                getPageSuggestionsAI(tab.url, tab.title)
                    .then((aiResult) => {
                        if (aiResult) setData(aiResult)
                    })
                    .catch(() => { /* keep fallback */ })
                return
            } else {
                setData(null)
            }
        } catch (err) {
            console.warn('PageSuggestions: failed to get active tab', err)
            setData(null)
        } finally {
            setIsLoading(false)
        }
    }

    useEffect(() => {
        fetchSuggestions()

        // Re-analyze when user switches tabs
        const onActivated = () => {
            // Small delay to let the tab info update
            setTimeout(fetchSuggestions, 150)
        }

        chrome.tabs.onActivated.addListener(onActivated)

        // Also listen for URL changes within the same tab
        const onUpdated = (
            _tabId: number,
            changeInfo: chrome.tabs.TabChangeInfo
        ) => {
            if (changeInfo.status === 'complete') {
                fetchSuggestions()
            }
        }

        chrome.tabs.onUpdated.addListener(onUpdated)

        return () => {
            chrome.tabs.onActivated.removeListener(onActivated)
            chrome.tabs.onUpdated.removeListener(onUpdated)
        }
    }, [])

    if (isLoading) {
        return (
            <div className="page-suggestions page-suggestions-loading">
                <div className="suggestion-skeleton-row">
                    <div className="skeleton-icon" />
                    <div className="skeleton-text" />
                </div>
                <div className="suggestion-skeleton-row">
                    <div className="skeleton-icon" />
                    <div className="skeleton-text" />
                </div>
                <div className="suggestion-skeleton-row">
                    <div className="skeleton-icon" />
                    <div className="skeleton-text short" />
                </div>
            </div>
        )
    }

    if (!data) return null

    return (
        <div className="page-suggestions">
            {data.suggestions.map((s, i) => (
                <button
                    key={i}
                    className="suggestion-row"
                    onClick={() => onSuggestionClick(s.text)}
                >
                    <img
                        src={data.faviconUrl}
                        alt={data.siteName}
                        className="suggestion-favicon"
                        width={20}
                        height={20}
                    />
                    <span className="suggestion-text">{s.text}</span>
                </button>
            ))}
        </div>
    )
}

export default PageSuggestions
