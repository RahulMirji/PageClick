export interface PageSuggestion {
    text: string
}

export interface PageSuggestionsData {
    faviconUrl: string
    siteName: string
    suggestions: PageSuggestion[]
}

interface PatternRule {
    match: (url: string, title: string) => boolean
    siteName: (url: string) => string
    suggestions: string[]
}

const rules: PatternRule[] = [
    {
        match: (url) => /youtube\.com|youtu\.be/i.test(url),
        siteName: () => 'YouTube',
        suggestions: [
            'Summarize this video',
            'List the key takeaways',
            'What topics are covered?',
            'Generate timestamps',
        ],
    },
    {
        match: (url) => /github\.com/i.test(url),
        siteName: () => 'GitHub',
        suggestions: [
            'Explain this repository',
            'Summarize the README',
            'What tech stack is used?',
            'Find open issues',
        ],
    },
    {
        match: (url) => /amazon\.|flipkart\.|ebay\.|etsy\.|shopify|myntra/i.test(url),
        siteName: (url) => {
            if (/amazon/i.test(url)) return 'Amazon'
            if (/flipkart/i.test(url)) return 'Flipkart'
            if (/ebay/i.test(url)) return 'eBay'
            if (/etsy/i.test(url)) return 'Etsy'
            if (/myntra/i.test(url)) return 'Myntra'
            return 'Store'
        },
        suggestions: [
            'Check if an upgrade is worth it',
            'Find best deals and prices',
            'Highlight what\'s new',
            'Summarize user reviews',
        ],
    },
    {
        match: (url) =>
            /stackoverflow\.com|stackexchange\.com/i.test(url),
        siteName: () => 'Stack Overflow',
        suggestions: [
            'Summarize the accepted answer',
            'Are there better solutions?',
            'Explain the code snippets',
            'What are common pitfalls?',
        ],
    },
    {
        match: (url) =>
            /reddit\.com/i.test(url),
        siteName: () => 'Reddit',
        suggestions: [
            'Summarize this thread',
            'What\'s the general consensus?',
            'Highlight the best comments',
            'What are people debating?',
        ],
    },
    {
        match: (url) =>
            /twitter\.com|x\.com/i.test(url),
        siteName: () => 'X',
        suggestions: [
            'Summarize this thread',
            'What\'s the main argument?',
            'Who are the key voices?',
            'What\'s trending here?',
        ],
    },
    {
        match: (url) =>
            /linkedin\.com/i.test(url),
        siteName: () => 'LinkedIn',
        suggestions: [
            'Summarize this post',
            'What skills are mentioned?',
            'Draft a thoughtful reply',
            'Extract key insights',
        ],
    },
    {
        match: (url, title) =>
            /medium\.com|substack\.com|dev\.to|hashnode|blog/i.test(url) ||
            /blog|article/i.test(title),
        siteName: () => 'Blog',
        suggestions: [
            'Give me a TL;DR',
            'What are the key arguments?',
            'List actionable takeaways',
            'Is there anything controversial?',
        ],
    },
    {
        match: (url) =>
            /docs\.|documentation|wiki|developer\.|mdn|devdocs/i.test(url),
        siteName: () => 'Docs',
        suggestions: [
            'Simplify this documentation',
            'Show me a quick example',
            'What are the important parameters?',
            'Compare with alternatives',
        ],
    },
    {
        match: (url, title) =>
            /news|cnn|bbc|reuters|nytimes|theguardian|ndtv/i.test(url) ||
            /news|breaking/i.test(title),
        siteName: () => 'News',
        suggestions: [
            'Summarize key points',
            'Check for bias in reporting',
            'What\'s the broader context?',
            'List facts vs opinions',
        ],
    },
    {
        match: (url) =>
            /wikipedia\.org/i.test(url),
        siteName: () => 'Wikipedia',
        suggestions: [
            'Give me a simple summary',
            'What are the key dates?',
            'Explain like I\'m 10',
            'What\'s most interesting here?',
        ],
    },
    {
        match: (url) =>
            /apple\.com/i.test(url),
        siteName: () => 'Apple',
        suggestions: [
            'Check if an upgrade is worth it',
            'Find best deals and prices',
            'Highlight what\'s new',
            'Summarize user reviews',
        ],
    },
]

function getDomain(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./, '')
    } catch {
        return ''
    }
}

export function getPageSuggestions(url: string, title: string): PageSuggestionsData | null {
    if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:')) {
        return null
    }

    const domain = getDomain(url)
    if (!domain) return null

    const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`

    for (const rule of rules) {
        if (rule.match(url, title)) {
            return {
                faviconUrl,
                siteName: rule.siteName(url),
                suggestions: rule.suggestions.map((text) => ({ text })),
            }
        }
    }

    // Fallback for any normal web page
    const siteName = domain.split('.')[0]
    const capitalized = siteName.charAt(0).toUpperCase() + siteName.slice(1)

    return {
        faviconUrl,
        siteName: capitalized,
        suggestions: [
            { text: 'Summarize this page' },
            { text: 'Explain the main content' },
            { text: 'What are the key points?' },
            { text: 'Is there anything important I should know?' },
        ],
    }
}
