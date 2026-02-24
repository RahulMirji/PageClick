/**
 * Agent Prompt Builder — Phase-aware system prompts for the agentic loop.
 *
 * Generates different system prompts depending on the task phase:
 * - Clarification: AI asks structured questions
 * - Execution: AI generates single-step action plans with page context
 * - Checkpoint detection: AI signals when payment/sensitive flows are reached
 */

import type { PageSnapshot } from '../../shared/messages'
import type { TaskOrchestrator } from './taskOrchestrator'

// ── Shared formatting instructions ───────────────────────────────

const FORMATTING_RULES = `
FORMATTING: You are displayed in a narrow sidebar panel (~380px wide). Prefer bullet lists or bold headings over markdown tables. Be concise.
`.trim()

// ── Page context builder ─────────────────────────────────────────

function buildPageContext(snapshot: PageSnapshot | null): string {
    if (!snapshot || (!snapshot.url && !snapshot.title)) return ''

    const parts = [
        `CURRENT PAGE:`,
        `- URL: ${snapshot.url}`,
        `- Title: ${snapshot.title}`,
    ]

    if (snapshot.description) {
        parts.push(`- Description: ${snapshot.description}`)
    }

    if (snapshot.nodes && snapshot.nodes.length > 0) {
        parts.push(`- Interactive Elements (${snapshot.nodes.length}):`)
        const summary = snapshot.nodes
            .slice(0, 50)
            .map((n) => {
                let desc = `  [${n.tag}] "${n.text}"`
                if (n.attrs?.['aria-label']) desc += ` (aria: ${n.attrs['aria-label']})`
                if (n.attrs?.href) desc += ` → ${n.attrs.href}`
                if (n.attrs?.role) desc += ` role=${n.attrs.role}`
                if (n.attrs?._redacted) desc += ` [REDACTED]`
                desc += ` @ selector: ${n.path}`
                return desc
            })
            .join('\n')
        parts.push(summary)
    }

    if (snapshot.textContent) {
        parts.push(`- Visible Content (excerpt): ${snapshot.textContent}`)
    }

    return parts.join('\n')
}

// ── Plan prompt (replaces old clarification prompt) ──────────────

export function buildClarificationPrompt(
    goal: string,
    snapshot: PageSnapshot | null,
): string {
    return `You are PageClick AI, an intelligent browser automation assistant. The user has asked you to perform a task.

USER'S GOAL: "${goal}"

${buildPageContext(snapshot)}

${FORMATTING_RULES}

YOUR JOB RIGHT NOW: Generate a CONCISE PLAN (1-2 sentences) of what you will do to accomplish the user's goal. The user will see your plan and can either PROCEED or CANCEL.

IMPORTANT RULES:
- Do NOT ask clarifying questions. Just use whichever account, website, or page is currently active/logged in.
- If the user says "open my Gmail" — just navigate to Gmail. Don't ask which account.
- If the user says "find my email" — just go look. Don't ask when or which folder.
- Be action-oriented: describe WHAT you will do, not what you need to know.
- Keep it to 1-2 sentences max.

ONLY ask questions (via ASK_USER) if the task is genuinely IMPOSSIBLE without user input — for example, "Buy me a laptop" with no indication of which website, budget, or specs. Even then, keep questions to 2-3 max.

RESPONSE FORMAT — always prefer TASK_READY:

<<<TASK_READY>>>
{"ready":true,"summary":"I'll navigate to Gmail and search for your Chrome Web Store submission email."}
<<<END_TASK_READY>>>

Only if truly stuck:

<<<ASK_USER>>>
{"questions":["What's your budget range?","Any brand preference?"]}
<<<END_ASK_USER>>>
`
}

// ── Execution prompt (single-step) ───────────────────────────────

export function buildExecutionPrompt(
    orchestrator: TaskOrchestrator,
    snapshot: PageSnapshot | null,
): string {
    const state = orchestrator.getState()
    const historySummary = orchestrator.buildHistorySummary()
    const clarifications = orchestrator.buildClarificationContext()

    return `You are PageClick AI, an autonomous browser automation agent. You are in the EXECUTION phase — you must generate the NEXT SINGLE ACTION to take.

TASK GOAL: "${state.goal}"

${clarifications}

${historySummary}

${buildPageContext(snapshot)}

LOOP ITERATION: ${state.loopCount + 1} / ${state.maxLoops}

${FORMATTING_RULES}

INSTRUCTIONS:
1. Look at the current page state and your previous actions.
2. Determine the SINGLE BEST next action to take toward the goal.
3. Generate EXACTLY ONE action step (not multiple). After this action executes, you'll get a fresh page snapshot to decide the next step.
4. Use CSS selectors from the Interactive Elements list above for grounding.
5. If the page hasn't loaded the expected content, use scroll or wait.
6. If you need to navigate to a new page, use the "navigate" action.

RESPONSE FORMAT — pick ONE of these:

**Option A: Execute an action**
Your brief explanation of what you're doing and why.

<<<ACTION_PLAN>>>
{"explanation":"what this step does","actions":[{"action":"click|input|scroll|extract|navigate","selector":"CSS selector","value":"optional value","confidence":0.95,"risk":"low|medium|high","description":"human readable step description"}]}
<<<END_ACTION_PLAN>>>

**Option B: Task checkpoint (payment, account creation, etc.)**
<<<CHECKPOINT>>>
{"reason":"About to enter payment flow","message":"I've added the item to your cart and reached checkout. Would you like me to continue?","canSkip":false}
<<<END_CHECKPOINT>>>

**Option C: Task complete**
<<<TASK_COMPLETE>>>
{"summary":"What was accomplished","nextSteps":["Step 1 for user","Step 2 for user"]}
<<<END_TASK_COMPLETE>>>

**Option D: Stuck or can't proceed**
<<<TASK_COMPLETE>>>
{"summary":"I was unable to complete the task because [reason]","nextSteps":["Suggestion for user"]}
<<<END_TASK_COMPLETE>>>

CRITICAL RULES:
- Generate ONLY ONE action at a time.
- For input actions, make sure the selector targets an actual input/textarea element.
- For navigate, put the full URL in "value".
- NEVER interact with password fields, credit card fields, or payment forms.
- If you see a checkout/payment page, emit a CHECKPOINT instead of an action.
- If you've achieved the goal or can't make progress, emit TASK_COMPLETE.
- Use "extract" to read text from the page when you need information to decide next steps.
`
}

// ── Info-only prompt (non-task, regular Q&A) ─────────────────────

export function buildInfoPrompt(snapshot: PageSnapshot | null): string {
    const pageContext = buildPageContext(snapshot)

    return `You are PageClick AI, a helpful browser assistant. The user is asking an informational question (NOT asking you to perform an action).

${pageContext ? pageContext + '\n' : ''}
${FORMATTING_RULES}

INSTRUCTIONS: Use the page context to make your response relevant. Be conversational and concise. Do NOT generate any action plan blocks — just answer naturally.
`
}

// ── Task detection heuristic ─────────────────────────────────────

const TASK_PATTERNS = [
    /\b(buy|purchase|order|shop|add to cart)\b/i,
    /\b(click|tap|press|select|choose)\b/i,
    /\b(go to|navigate|open|visit)\b/i,
    /\b(search for|look for|find)\b/i,
    /\b(type|enter|fill|write|input)\b/i,
    /\b(scroll|swipe)\b/i,
    /\b(sign up|sign in|login|register|log in)\b/i,
    /\b(download|upload)\b/i,
    /\b(book|reserve|schedule)\b/i,
    /\b(subscribe|unsubscribe)\b/i,
    /\b(do it|do this|do that|make it|help me)\b/i,
]

/**
 * Returns true if the user's message looks like a task request
 * (wants the agent to DO something) vs. an informational question.
 */
export function isTaskRequest(message: string): boolean {
    return TASK_PATTERNS.some(pattern => pattern.test(message))
}

// ── Response block parsers ───────────────────────────────────────

export function parseAskUser(response: string): { found: boolean; block?: { questions: string[] }; cleanContent: string } {
    const match = response.match(/<<<ASK_USER>>>\s*([\s\S]*?)\s*<<<END_ASK_USER>>>/)
    if (!match) return { found: false, cleanContent: response }

    try {
        const block = JSON.parse(match[1].trim())
        const cleanContent = response.replace(/<<<ASK_USER>>>\s*[\s\S]*?\s*<<<END_ASK_USER>>>/, '').trim()
        return { found: true, block, cleanContent }
    } catch {
        return { found: false, cleanContent: response }
    }
}

export function parseTaskReady(response: string): { found: boolean; block?: { ready: boolean; summary: string }; cleanContent: string } {
    const match = response.match(/<<<TASK_READY>>>\s*([\s\S]*?)\s*<<<END_TASK_READY>>>/)
    if (!match) return { found: false, cleanContent: response }

    try {
        const block = JSON.parse(match[1].trim())
        const cleanContent = response.replace(/<<<TASK_READY>>>\s*[\s\S]*?\s*<<<END_TASK_READY>>>/, '').trim()
        return { found: true, block, cleanContent }
    } catch {
        return { found: false, cleanContent: response }
    }
}

export function parseActionPlan(response: string): { found: boolean; block?: { explanation: string; actions: any[] }; cleanContent: string } {
    const match = response.match(/<<<ACTION_PLAN>>>\s*([\s\S]*?)\s*<<<(?:END_ACTION_PLAN|_ACTION_PLAN)>>>/)
    if (!match) return { found: false, cleanContent: response }

    try {
        let json = match[1].trim()
        // Repair common JSON issues
        json = json.replace(/"(\s*)"(\s*)(\w)/g, '",$1"$2$3')
        json = json.replace(/"([a-z]+)"(\s*)"([a-z])/gi, '"$1",$2"$3')
        json = json.replace(/([^\\])\n/g, '$1\\n')
        json = json.replace(/,\s*([}\]])/g, '$1')

        const block = JSON.parse(json)
        const cleanContent = response.replace(/<<<ACTION_PLAN>>>\s*[\s\S]*?\s*<<<(?:END_ACTION_PLAN|_ACTION_PLAN)>>>/, '').trim()
        return { found: true, block, cleanContent }
    } catch (e) {
        console.error('[agentPrompt] Failed to parse ACTION_PLAN:', e)
        return { found: false, cleanContent: response }
    }
}

export function parseCheckpoint(response: string): { found: boolean; block?: { reason: string; message: string; canSkip: boolean }; cleanContent: string } {
    const match = response.match(/<<<CHECKPOINT>>>\s*([\s\S]*?)\s*<<<END_CHECKPOINT>>>/)
    if (!match) return { found: false, cleanContent: response }

    try {
        const block = JSON.parse(match[1].trim())
        const cleanContent = response.replace(/<<<CHECKPOINT>>>\s*[\s\S]*?\s*<<<END_CHECKPOINT>>>/, '').trim()
        return { found: true, block, cleanContent }
    } catch {
        return { found: false, cleanContent: response }
    }
}

export function parseTaskComplete(response: string): { found: boolean; block?: { summary: string; nextSteps: string[] }; cleanContent: string } {
    const match = response.match(/<<<TASK_COMPLETE>>>\s*([\s\S]*?)\s*<<<END_TASK_COMPLETE>>>/)
    if (!match) return { found: false, cleanContent: response }

    try {
        const block = JSON.parse(match[1].trim())
        const cleanContent = response.replace(/<<<TASK_COMPLETE>>>\s*[\s\S]*?\s*<<<END_TASK_COMPLETE>>>/, '').trim()
        return { found: true, block, cleanContent }
    } catch {
        return { found: false, cleanContent: response }
    }
}
