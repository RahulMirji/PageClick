import { useState } from "react";

export interface WebSearchResult {
    title: string;
    url: string;
    snippet: string;
    score: number;
}

interface WebSearchResultsProps {
    query: string;
    results: WebSearchResult[];
    onDismiss: () => void;
    onResultClick?: (result: WebSearchResult) => void;
}

function getDomain(url: string): string {
    try {
        const hostname = new URL(url).hostname;
        return hostname.replace(/^www\./, "");
    } catch {
        return url;
    }
}

function WebSearchResults({
    query,
    results,
    onDismiss,
    onResultClick,
}: WebSearchResultsProps) {
    const [expanded, setExpanded] = useState(false);

    const visibleResults = expanded ? results : results.slice(0, 3);
    const hiddenCount = results.length - 3;

    return (
        <div className="web-search-panel">
            {/* Header row */}
            <div className="ws-header">
                <div className="ws-header-left">
                    <span className="ws-count-badge">
                        <svg
                            width="11"
                            height="11"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <circle cx="11" cy="11" r="8" />
                            <line x1="21" y1="21" x2="16.65" y2="16.65" />
                        </svg>
                        {results.length}
                    </span>
                    <span className="ws-query-label">"{query}"</span>
                </div>
                <button
                    className="ws-dismiss-btn"
                    onClick={onDismiss}
                    aria-label="Dismiss search results"
                >
                    <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                    >
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                </button>
            </div>

            {/* Results list */}
            <div className="ws-results-list">
                {visibleResults.map((result, i) => (
                    <button
                        key={i}
                        className="ws-result-item"
                        onClick={() => onResultClick?.(result)}
                        title={result.snippet}
                    >
                        <span className="ws-result-dot" />
                        <span className="ws-result-title">{result.title}</span>
                        <span className="ws-result-domain">{getDomain(result.url)}</span>
                    </button>
                ))}

                {!expanded && hiddenCount > 0 && (
                    <button
                        className="ws-show-more"
                        onClick={() => setExpanded(true)}
                    >
                        +{hiddenCount} more result{hiddenCount !== 1 ? "s" : ""}
                    </button>
                )}
            </div>
        </div>
    );
}

export default WebSearchResults;
