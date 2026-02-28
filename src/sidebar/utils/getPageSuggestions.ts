export interface PageSuggestion {
  text: string;
}

export interface PageSuggestionsData {
  faviconUrl: string;
  siteName: string;
  suggestions: PageSuggestion[];
}

// ── Cache to avoid re-prompting the same page ──────────────────────
const cache = new Map<string, PageSuggestionsData>();

// ── JSON Schema for structured output ──────────────────────────────
const SUGGESTION_SCHEMA = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      items: { type: "string" },
      minItems: 4,
      maxItems: 4,
    },
  },
  required: ["suggestions"],
};

// ── Helpers ─────────────────────────────────────────────────────────

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function getSiteName(domain: string): string {
  const name = domain.split(".")[0];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function getFaviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
}

function isRestrictedUrl(url: string): boolean {
  return (
    !url ||
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("about:") ||
    url.startsWith("edge://") ||
    url.startsWith("brave://")
  );
}

// ── AI-powered suggestions using Chrome Prompt API ─────────────────

async function generateWithAI(
  url: string,
  title: string,
): Promise<string[] | null> {
  try {
    // Check if the Prompt API is available
    if (typeof LanguageModel === "undefined") {
      console.log("[PageClick] LanguageModel API not available");
      return null;
    }

    const availability = await LanguageModel.availability();
    if (availability === "unavailable") {
      console.log("[PageClick] Gemini Nano model unavailable");
      return null;
    }

    // Create a session with a focused system prompt
    const session = await LanguageModel.create({
      initialPrompts: [
        {
          role: "system",
          content:
            "You generate exactly 4 short, actionable suggestion prompts for an AI assistant sidebar based on the webpage the user is viewing. " +
            "Each suggestion should be a natural question or command (max 8 words) that a user would want to ask about the page content. " +
            "Be specific to the site type (e-commerce, video, code, article, social media, etc). " +
            "Never include numbering, bullet points, or quotes in the suggestions.",
        },
      ],
    });

    const result = await session.prompt(
      `Generate 4 smart suggestions for this page:\nURL: ${url}\nTitle: ${title}`,
      {
        responseConstraint: SUGGESTION_SCHEMA,
      },
    );

    session.destroy();

    const parsed = JSON.parse(result);
    if (
      parsed?.suggestions &&
      Array.isArray(parsed.suggestions) &&
      parsed.suggestions.length >= 3
    ) {
      return parsed.suggestions.slice(0, 4);
    }

    return null;
  } catch (err) {
    console.warn("[PageClick] AI suggestion generation failed:", err);
    return null;
  }
}

// ── Hardcoded fallback rules ────────────────────────────────────────

interface PatternRule {
  match: (url: string, title: string) => boolean;
  siteName: (url: string) => string;
  suggestions: string[];
}

const rules: PatternRule[] = [
  {
    match: (url) => /youtube\.com|youtu\.be/i.test(url),
    siteName: () => "YouTube",
    suggestions: [
      "Summarize this video",
      "List the key takeaways",
      "What topics are covered?",
      "Generate timestamps",
    ],
  },
  {
    match: (url) => /github\.com/i.test(url),
    siteName: () => "GitHub",
    suggestions: [
      "Explain this repository",
      "Summarize the README",
      "What tech stack is used?",
      "Find open issues",
    ],
  },
  {
    match: (url) =>
      /amazon\.|flipkart\.|ebay\.|etsy\.|shopify|myntra/i.test(url),
    siteName: (url) => {
      if (/amazon/i.test(url)) return "Amazon";
      if (/flipkart/i.test(url)) return "Flipkart";
      if (/ebay/i.test(url)) return "eBay";
      if (/etsy/i.test(url)) return "Etsy";
      if (/myntra/i.test(url)) return "Myntra";
      return "Store";
    },
    suggestions: [
      "Check if an upgrade is worth it",
      "Find best deals and prices",
      "Highlight what's new",
      "Summarize user reviews",
    ],
  },
  {
    match: (url) => /stackoverflow\.com|stackexchange\.com/i.test(url),
    siteName: () => "Stack Overflow",
    suggestions: [
      "Summarize the accepted answer",
      "Are there better solutions?",
      "Explain the code snippets",
      "What are common pitfalls?",
    ],
  },
  {
    match: (url) => /reddit\.com/i.test(url),
    siteName: () => "Reddit",
    suggestions: [
      "Summarize this thread",
      "What's the general consensus?",
      "Highlight the best comments",
      "What are people debating?",
    ],
  },
  {
    match: (url) => /twitter\.com|x\.com/i.test(url),
    siteName: () => "X",
    suggestions: [
      "Summarize this thread",
      "What's the main argument?",
      "Who are the key voices?",
      "What's trending here?",
    ],
  },
  {
    match: (url) => /linkedin\.com/i.test(url),
    siteName: () => "LinkedIn",
    suggestions: [
      "Summarize this post",
      "What skills are mentioned?",
      "Draft a thoughtful reply",
      "Extract key insights",
    ],
  },
  {
    match: (url, title) =>
      /medium\.com|substack\.com|dev\.to|hashnode|blog/i.test(url) ||
      /blog|article/i.test(title),
    siteName: () => "Blog",
    suggestions: [
      "Give me a TL;DR",
      "What are the key arguments?",
      "List actionable takeaways",
      "Is there anything controversial?",
    ],
  },
  {
    match: (url) =>
      /docs\.|documentation|wiki|developer\.|mdn|devdocs/i.test(url),
    siteName: () => "Docs",
    suggestions: [
      "Simplify this documentation",
      "Show me a quick example",
      "What are the important parameters?",
      "Compare with alternatives",
    ],
  },
  {
    match: (url, title) =>
      /news|cnn|bbc|reuters|nytimes|theguardian|ndtv/i.test(url) ||
      /news|breaking/i.test(title),
    siteName: () => "News",
    suggestions: [
      "Summarize key points",
      "Check for bias in reporting",
      "What's the broader context?",
      "List facts vs opinions",
    ],
  },
  {
    match: (url) => /wikipedia\.org/i.test(url),
    siteName: () => "Wikipedia",
    suggestions: [
      "Give me a simple summary",
      "What are the key dates?",
      "Explain like I'm 10",
      "What's most interesting here?",
    ],
  },
  {
    match: (url) => /apple\.com/i.test(url),
    siteName: () => "Apple",
    suggestions: [
      "Check if an upgrade is worth it",
      "Find best deals and prices",
      "Highlight what's new",
      "Summarize user reviews",
    ],
  },
];

function getFallbackSuggestions(
  url: string,
  title: string,
): PageSuggestionsData | null {
  const domain = getDomain(url);
  if (!domain) return null;

  const faviconUrl = getFaviconUrl(domain);

  for (const rule of rules) {
    if (rule.match(url, title)) {
      return {
        faviconUrl,
        siteName: rule.siteName(url),
        suggestions: rule.suggestions.map((text) => ({ text })),
      };
    }
  }

  return {
    faviconUrl,
    siteName: getSiteName(domain),
    suggestions: [
      { text: "Summarize this page" },
      { text: "Explain the main content" },
      { text: "What are the key points?" },
      { text: "Is there anything important I should know?" },
    ],
  };
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * AI-powered page suggestions with hardcoded fallback.
 * Uses Chrome's built-in Prompt API (Gemini Nano on-device) when available.
 */
export async function getPageSuggestionsAI(
  url: string,
  title: string,
): Promise<PageSuggestionsData | null> {
  if (isRestrictedUrl(url)) return null;

  const domain = getDomain(url);
  if (!domain) return null;

  // Check cache first
  const cacheKey = `${domain}:${url}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey)!;
  }

  const faviconUrl = getFaviconUrl(domain);

  // Try AI-powered generation
  const aiSuggestions = await generateWithAI(url, title);

  if (aiSuggestions) {
    const data: PageSuggestionsData = {
      faviconUrl,
      siteName: getSiteName(domain),
      suggestions: aiSuggestions.map((text) => ({ text })),
    };
    cache.set(cacheKey, data);
    return data;
  }

  // Fall back to hardcoded rules
  const fallback = getFallbackSuggestions(url, title);
  if (fallback) {
    cache.set(cacheKey, fallback);
  }
  return fallback;
}

/**
 * Synchronous fallback — the original hardcoded approach.
 * Exposed for immediate rendering while AI generates.
 */
export function getPageSuggestions(
  url: string,
  title: string,
): PageSuggestionsData | null {
  if (isRestrictedUrl(url)) return null;
  return getFallbackSuggestions(url, title);
}
