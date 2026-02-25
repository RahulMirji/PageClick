/**
 * Token estimation utilities for context window management.
 *
 * Uses the common ~4 characters per token rule-of-thumb that works well
 * as a safe ceiling estimate across GPT, Gemini, and similar models.
 */

/** Rough estimate: 1 token ≈ 4 characters */
export function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4)
}

/** Safe context ceiling to keep well under model limits */
export const MAX_CONTEXT_TOKENS = 6000

/**
 * Given a list of chat messages (newest last), returns the longest tail
 * that fits within MAX_CONTEXT_TOKENS total across all message content.
 * Always includes at least the most recent message.
 */
export function trimToContextWindow<T extends { role: string; content: string | unknown[] }>(
    messages: T[]
): { trimmed: T[]; dropped: number } {
    let total = 0
    const result: T[] = []

    // Walk backwards from newest → oldest
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i]
        const text =
            typeof msg.content === 'string'
                ? msg.content
                : JSON.stringify(msg.content)
        const tokens = estimateTokens(text)

        if (result.length > 0 && total + tokens > MAX_CONTEXT_TOKENS) {
            // Would overflow — stop here
            const dropped = i + 1
            return { trimmed: result.reverse(), dropped }
        }

        total += tokens
        result.push(msg)
    }

    return { trimmed: result.reverse(), dropped: 0 }
}
