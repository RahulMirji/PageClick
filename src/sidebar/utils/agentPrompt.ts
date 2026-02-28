/**
 * Agent Prompt Builder — Phase-aware system prompts for the agentic loop.
 *
 * Generates different system prompts depending on the task phase:
 * - Clarification: AI asks structured questions
 * - Execution: AI generates single-step action plans with page context
 * - Checkpoint detection: AI signals when payment/sensitive flows are reached
 */

import type { PageSnapshot, CDPSnapshot } from "../../shared/messages";
import type { TaskOrchestrator } from "./taskOrchestrator";
import type { Project } from "./projectStore";

// ── Shared formatting instructions ───────────────────────────────

const FORMATTING_RULES = `
FORMATTING: You are displayed in a narrow sidebar panel (~380px wide). Prefer bullet lists or bold headings over markdown tables. Be concise.
`.trim();

// ── Page context builder ─────────────────────────────────────────

function buildPageContext(snapshot: PageSnapshot | null): string {
  if (!snapshot || (!snapshot.url && !snapshot.title)) return "";

  const parts = [
    `CURRENT PAGE:`,
    `- URL: ${snapshot.url}`,
    `- Title: ${snapshot.title}`,
  ];

  if (snapshot.description) {
    parts.push(`- Description: ${snapshot.description}`);
  }

  if (snapshot.nodes && snapshot.nodes.length > 0) {
    parts.push(`- Interactive Elements (${snapshot.nodes.length}):`);
    const summary = snapshot.nodes
      .slice(0, 50)
      .map((n) => {
        let desc = `  [${n.tag}] "${n.text}"`;
        if (n.attrs?.["aria-label"])
          desc += ` (aria: ${n.attrs["aria-label"]})`;
        if (n.attrs?.href) desc += ` → ${n.attrs.href}`;
        if (n.attrs?.role) desc += ` role=${n.attrs.role}`;
        if (n.attrs?._redacted) desc += ` [REDACTED]`;
        desc += ` @ selector: ${n.path}`;
        return desc;
      })
      .join("\n");
    parts.push(summary);
  }

  if (snapshot.textContent) {
    parts.push(`- Visible Content (excerpt): ${snapshot.textContent}`);
  }

  return parts.join("\n");
}

// ── CDP context builder ───────────────────────────────────────────

/**
 * Formats buffered CDP runtime data (network, console, JS errors) into
 * a compact prompt section. Hard-capped at 1500 chars to protect token budget.
 */
function buildCDPContext(cdp: CDPSnapshot | null | undefined): string {
  if (!cdp?.attached) return "";

  const parts: string[] = ["RUNTIME CONTEXT (Chrome DevTools):"];

  // JS errors first — highest diagnostic signal
  if (cdp.jsErrors.length > 0) {
    parts.push(`JS ERRORS (${cdp.jsErrors.length}):`);
    cdp.jsErrors.slice(0, 5).forEach((e) => parts.push(`  ❌ ${e}`));
  }

  // Console: surface warn/error only (reduces noise)
  const importantConsole = cdp.consoleLog.filter(
    (m) => m.level === "error" || m.level === "warn",
  );
  if (importantConsole.length > 0) {
    parts.push(`CONSOLE WARNINGS/ERRORS (${importantConsole.length}):`);
    importantConsole
      .slice(0, 5)
      .forEach((m) =>
        parts.push(`  [${m.level.toUpperCase()}] ${m.text.slice(0, 200)}`),
      );
  }

  // Network: failures first, then recent successes with JSON bodies
  if (cdp.networkLog.length > 0) {
    const failures = cdp.networkLog.filter(
      (r) => r.failed || (r.status !== undefined && r.status >= 400),
    );
    const successes = cdp.networkLog.filter(
      (r) => !r.failed && r.status !== undefined && r.status < 400,
    );

    if (failures.length > 0) {
      parts.push(`NETWORK FAILURES (${failures.length}):`);
      failures
        .slice(0, 5)
        .forEach((r) =>
          parts.push(
            `  ❌ ${r.method} ${r.url} → ${r.status ?? "failed"} ${r.failureText ?? ""}`,
          ),
        );
    }

    if (successes.length > 0) {
      parts.push(`RECENT API CALLS (${successes.length}):`);
      successes.slice(0, 5).forEach((r) => {
        let line = `  ✅ ${r.method} ${r.url} → ${r.status}`;
        if (r.responseBody)
          line += `\n     Response: ${r.responseBody.slice(0, 300)}`;
        parts.push(line);
      });
    }
  }

  const raw = parts.join("\n");
  // Hard cap to protect the 6000-token context window budget
  return raw.length > 1500 ? raw.slice(0, 1497) + "..." : raw;
}

// ── Project context builder ───────────────────────────────────────

function buildProjectContext(project: Project | null | undefined): string {
  if (!project?.instructions) return "";
  return `PROJECT CONTEXT: "${project.icon} ${project.name}"
The user has set the following custom instructions for this website. Follow these carefully:
${project.instructions}
`;
}

// ── Plan prompt (replaces old clarification prompt) ──────────────

export function buildClarificationPrompt(
  goal: string,
  snapshot: PageSnapshot | null,
  project?: Project | null,
): string {
  const projectContext = buildProjectContext(project);
  return `You are PageClick AI, an intelligent browser automation assistant. The user has asked you to perform a task.

USER'S GOAL: "${goal}"

${buildPageContext(snapshot)}
${projectContext ? "\n" + projectContext : ""}

${FORMATTING_RULES}

YOUR JOB RIGHT NOW: Generate a CONCISE PLAN (1-2 sentences) of what you will do to accomplish the user's goal. The user will see your plan and can either PROCEED or CANCEL.

YOUR CAPABILITIES:
- You can click, type, scroll, navigate, extract data, run JS eval, download files, and ORGANIZE BROWSER TABS INTO GROUPS.
- For tab management: you can create named color-coded tab groups, add tabs to existing groups, and list all current groups. You do this using the "tabgroup" action — you DO have direct access to the Chrome Tab Groups API.
- You can call approved local native operations through a secure bridge using the "native" action.

IMPORTANT RULES:
- Do NOT ask clarifying questions. Just use whichever account, website, or page is currently active/logged in.
- If the user says "open my Gmail" — just navigate to Gmail. Don't ask which account.
- If the user says "find my email" — just go look. Don't ask when or which folder.
- If the user says "group my tabs" or "organize my tabs" — use the tabgroup action. Do NOT give manual instructions.
- Be action-oriented: describe WHAT you will do, not what you need to know.
- Keep it to 1-2 sentences max.

ONLY ask questions (via the ask_user tool) if the task is genuinely IMPOSSIBLE without user input — for example, "Buy me a laptop" with no indication of which website, budget, or specs. Even then, keep questions to 2-3 max.

RESPONSE: Call the task_ready tool with your 1-2 sentence plan. Only call ask_user if the task is truly ambiguous.
`;
}

// ── Execution prompt (single-step) ───────────────────────────────

export function buildExecutionPrompt(
  orchestrator: TaskOrchestrator,
  snapshot: PageSnapshot | null,
  cdp?: CDPSnapshot | null,
  project?: Project | null,
): string {
  const state = orchestrator.getState();
  const historySummary = orchestrator.buildHistorySummary();
  const clarifications = orchestrator.buildClarificationContext();
  const cdpContext = buildCDPContext(cdp);
  const projectContext = buildProjectContext(project);

  return `You are PageClick AI, an autonomous browser automation agent. You are in the EXECUTION phase — you must generate the NEXT SINGLE ACTION to take.

TASK GOAL: "${state.goal}"

${clarifications}

${historySummary}

${buildPageContext(snapshot)}
${cdpContext ? "\n" + cdpContext : ""}
${projectContext ? "\n" + projectContext : ""}

LOOP ITERATION: ${state.loopCount + 1} / ${state.maxLoops}

${FORMATTING_RULES}

INSTRUCTIONS:
1. Look at the current page state and your previous actions.
2. Think step-by-step: write a brief 1-sentence reasoning in your response text BEFORE calling any tool. This helps you plan better. For example: "The search box is visible at #search-input, I'll type the query there."
3. Determine the SINGLE BEST next action to take toward the goal.
4. Call EXACTLY ONE tool. After this action executes, you'll get a fresh page snapshot to decide the next step.
5. Use CSS selectors from the Interactive Elements list above when selecting elements.
6. If the page hasn't loaded expected content, use scroll.
7. If you need to navigate to a new page, use the navigate tool.

RULES:
- ALWAYS write your brief reasoning as text content BEFORE the tool call. This is critical for accurate action selection.
- Call ONLY ONE tool per turn — never chain multiple actions.
- For input: selector must target an actual input/textarea element.
- For navigate: put the full URL in the value parameter.
- For eval: put the JS expression in value (selector can be empty).
- NEVER interact with password fields, credit card fields, or payment forms.
- If you see a checkout/payment page, call the checkpoint tool.
- If you've achieved the goal or cannot make further progress, call task_complete.
- Use extract to read visible DOM text; use eval to query JS/framework state.
- Use download to save files — pass a CSS selector for a link/image, or a direct URL in value.
- Use tabgroup to organize browser tabs — pass a JSON operation in value.
- Use native for clipboard/file operations — pass a JSON operation in value.
- For clipboard: always use the native tool, never navigator.clipboard or execCommand.
- Factor in RUNTIME CONTEXT (JS errors, network failures) when choosing your next action.
`;
}

// ── Info-only prompt (non-task, regular Q&A) ─────────────────────

export function buildInfoPrompt(
  snapshot: PageSnapshot | null,
  project?: Project | null,
): string {
  const pageContext = buildPageContext(snapshot);
  const projectContext = buildProjectContext(project);

  return `You are PageClick AI, a helpful browser assistant. The user is asking an informational question (NOT asking you to perform an action).

${pageContext ? pageContext + "\n" : ""}
${projectContext ? projectContext + "\n" : ""}
${FORMATTING_RULES}

INSTRUCTIONS: Use the page context to make your response relevant. Be conversational and concise. Do NOT generate any action plan blocks — just answer naturally.
`;
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
  /\b(clipboard|copy|paste|local file|read file|filesystem|native app)\b/i,
  /\b(book|reserve|schedule)\b/i,
  /\b(subscribe|unsubscribe)\b/i,
  /\b(group|organize|sort|categorize)\b/i,
  /\b(tab\s*group)/i,
  /\b(do it|do this|do that|make it|help me)\b/i,
];

/**
 * Returns true if the user's message looks like a task request
 * (wants the agent to DO something) vs. an informational question.
 */
export function isTaskRequest(message: string): boolean {
  return TASK_PATTERNS.some((pattern) => pattern.test(message));
}

// ── Response block parsers are intentionally removed.
// All response parsing is now handled by toolCallAdapter.ts
// which reads structured tool_calls from the model API response directly.

/** @deprecated Use toolCallAdapter.parseToolCallResponse() instead. Kept for backward compatibility during migration. */
export function parseAskUser(response: string): {
  found: boolean;
  block?: { questions: string[] };
  cleanContent: string;
} {
  const match = response.match(
    /<<<ASK_USER>>>\s*([\s\S]*?)\s*<<<END_ASK_USER>>>/,
  );
  if (!match) return { found: false, cleanContent: response };

  try {
    const block = JSON.parse(match[1].trim());
    const cleanContent = response
      .replace(/<<<ASK_USER>>>\s*[\s\S]*?\s*<<<END_ASK_USER>>>/, "")
      .trim();
    return { found: true, block, cleanContent };
  } catch {
    return { found: false, cleanContent: response };
  }
}

export function parseTaskReady(response: string): {
  found: boolean;
  block?: { ready: boolean; summary: string };
  cleanContent: string;
} {
  const match = response.match(
    /<<<TASK_READY>>>\s*([\s\S]*?)\s*<<<END_TASK_READY>>>/,
  );
  if (!match) return { found: false, cleanContent: response };

  try {
    const block = JSON.parse(match[1].trim());
    const cleanContent = response
      .replace(/<<<TASK_READY>>>\s*[\s\S]*?\s*<<<END_TASK_READY>>>/, "")
      .trim();
    return { found: true, block, cleanContent };
  } catch {
    return { found: false, cleanContent: response };
  }
}

export function parseActionPlan(response: string): {
  found: boolean;
  block?: { explanation: string; actions: any[] };
  cleanContent: string;
} {
  const match = response.match(
    /<<<ACTION_PLAN>>>\s*([\s\S]*?)\s*<<<(?:END_ACTION_PLAN|_ACTION_PLAN)>>>/,
  );
  if (!match) return { found: false, cleanContent: response };

  try {
    let json = match[1].trim();
    // Repair common JSON issues
    json = json.replace(/"(\s*)"(\s*)(\w)/g, '",$1"$2$3');
    json = json.replace(/"([a-z]+)"(\s*)"([a-z])/gi, '"$1",$2"$3');
    json = json.replace(/([^\\])\n/g, "$1\\n");
    json = json.replace(/,\s*([}\]])/g, "$1");

    const block = JSON.parse(json);
    const cleanContent = response
      .replace(
        /<<<ACTION_PLAN>>>\s*[\s\S]*?\s*<<<(?:END_ACTION_PLAN|_ACTION_PLAN)>>>/,
        "",
      )
      .trim();
    return { found: true, block, cleanContent };
  } catch (e) {
    console.error("[agentPrompt] Failed to parse ACTION_PLAN:", e);
    return { found: false, cleanContent: response };
  }
}

export function parseCheckpoint(response: string): {
  found: boolean;
  block?: { reason: string; message: string; canSkip: boolean };
  cleanContent: string;
} {
  const match = response.match(
    /<<<CHECKPOINT>>>\s*([\s\S]*?)\s*<<<END_CHECKPOINT>>>/,
  );
  if (!match) return { found: false, cleanContent: response };

  try {
    const block = JSON.parse(match[1].trim());
    const cleanContent = response
      .replace(/<<<CHECKPOINT>>>\s*[\s\S]*?\s*<<<END_CHECKPOINT>>>/, "")
      .trim();
    return { found: true, block, cleanContent };
  } catch {
    return { found: false, cleanContent: response };
  }
}

export function parseTaskComplete(response: string): {
  found: boolean;
  block?: { summary: string; nextSteps: string[] };
  cleanContent: string;
} {
  const match = response.match(
    /<<<TASK_COMPLETE>>>\s*([\s\S]*?)\s*<<<END_TASK_COMPLETE>>>/,
  );
  if (!match) return { found: false, cleanContent: response };

  try {
    const block = JSON.parse(match[1].trim());
    const cleanContent = response
      .replace(/<<<TASK_COMPLETE>>>\s*[\s\S]*?\s*<<<END_TASK_COMPLETE>>>/, "")
      .trim();
    return { found: true, block, cleanContent };
  } catch {
    return { found: false, cleanContent: response };
  }
}
