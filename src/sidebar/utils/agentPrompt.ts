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

  // Page load state
  if (snapshot.readyState && snapshot.readyState !== "complete") {
    parts.push(`- ⚠️ Page still loading (readyState: ${snapshot.readyState})`);
  }
  if (snapshot.hasLoadingIndicators) {
    parts.push(`- ⚠️ Loading indicators detected (spinners/skeletons visible) — page may not be fully loaded`);
  }

  // Flow / form position awareness
  if (snapshot.formContext) {
    const fc = snapshot.formContext;
    const remaining = Math.max(0, fc.totalFields - fc.filledFields);
    parts.push(`FLOW POSITION:`);
    if (fc.stepIndicator) parts.push(`  - Step indicator: "${fc.stepIndicator}"`);
    if (fc.activeStep) parts.push(`  - Active step/tab: "${fc.activeStep}"`);
    if (fc.progressPercent !== undefined) parts.push(`  - Progress: ${fc.progressPercent}%`);
    if (fc.totalFields > 0) {
      parts.push(`  - Form fields: ${fc.filledFields}/${fc.totalFields} filled`);
      parts.push(`  - Remaining visible fields: ${remaining}`);
      if (fc.unfilledFields.length > 0) {
        parts.push(`  - Empty fields (prioritize these): ${fc.unfilledFields.join(", ")}`);
      }
    }
  }

  if (snapshot.nodes && snapshot.nodes.length > 0) {
    parts.push(`- Interactive Elements (${snapshot.nodes.length}):`);
    const summary = snapshot.nodes
      .slice(0, 60)
      .map((n) => {
        let desc = `  [${n.tag}] "${n.text}"`;
        if (n.attrs?.["aria-label"])
          desc += ` (aria: ${n.attrs["aria-label"]})`;
        if (n.attrs?.href) desc += ` → ${n.attrs.href}`;
        if (n.attrs?.role) desc += ` role=${n.attrs.role}`;
        if (n.attrs?.["aria-expanded"]) desc += ` expanded=${n.attrs["aria-expanded"]}`;
        if (n.attrs?.["aria-selected"] === "true") desc += ` [SELECTED]`;
        if (n.attrs?.["aria-current"]) desc += ` [CURRENT]`;
        if (n.attrs?.value) desc += ` value="${n.attrs.value}"`;
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
- You can click, type, select dropdowns, set date fields, scroll, navigate, extract data, run JS eval, download files, and ORGANIZE BROWSER TABS INTO GROUPS.
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
  const lastFailure = orchestrator.getLastFailure();
  const stuckGuidance = orchestrator.isStuck()
    ? `\nSTUCK SIGNAL:
- You have been on the same page with no form-progress change for multiple loops.
- Your next action should be recovery-oriented: scroll, reveal hidden controls, or click Next/Continue.`
    : "";
  const failureGuidance = lastFailure
    ? `\n⚠️ LAST ACTION FAILED:
- Action: ${lastFailure.action}
- Selector: ${lastFailure.selector || "(none)"}
- Error: ${lastFailure.error || "Unknown failure"}
- Do NOT retry the same selector. Pick a different element from Interactive Elements.
- If target may be off-screen, use scroll first before retrying.`
    : "";

  return `You are PageClick AI, an autonomous browser automation agent. You are in the EXECUTION phase — you must generate the NEXT SINGLE ACTION to take.

TASK GOAL: "${state.goal}"

${clarifications}

${historySummary}
${stuckGuidance}
${failureGuidance}

${buildPageContext(snapshot)}
${cdpContext ? "\n" + cdpContext : ""}
${projectContext ? "\n" + projectContext : ""}

LOOP ITERATION: ${state.loopCount + 1} / ${state.maxLoops}${state.loopCount >= state.maxLoops * 0.8 ? `\n⚠️ BUDGET WARNING: Only ${state.maxLoops - state.loopCount} iterations remaining. If you cannot complete the task soon, call task_complete with a summary of progress so far and what remains.` : ""}

${FORMATTING_RULES}

INSTRUCTIONS:
1. Look at the current page state, FLOW POSITION, and your previous actions.
2. Think step-by-step: write a brief 1-sentence reasoning in your response text BEFORE calling any tool. This helps you plan better. For example: "The search box is visible at #search-input, I'll type the query there."
3. Determine the SINGLE BEST next action to take toward the goal.
4. Call EXACTLY ONE tool. After this action executes, you'll get a fresh page snapshot to decide the next step.
5. Use CSS selectors from the Interactive Elements list above when selecting elements.
6. If the page hasn't loaded expected content, use scroll to reveal more content.
7. If you need to navigate to a new page, use the navigate tool.
7.1. For date inputs/calendars, prefer select_date with YYYY-MM-DD instead of generic input.
8. Pay attention to FLOW POSITION — if a form shows "Step 2 of 5" with unfilled fields, fill those fields BEFORE clicking Next.
9. If a loading indicator is detected, use scroll or wait before taking action — the page may not be ready.
10. Check element values/states (aria-expanded, aria-selected, value) to understand what's already done.

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
- YOUTUBE ADS: If you see a "Skip Ad", "Skip Ads", or "Skip" button on YouTube (selectors: .ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, button[class*="skip"]), click it IMMEDIATELY before doing anything else. Also dismiss any overlay/popup ads or consent dialogs that block the video.
`;
}

// ── Info-only prompt (non-task, regular Q&A) ─────────────────────

export function buildInfoPrompt(
  snapshot: PageSnapshot | null,
  project?: Project | null,
): string {
  const pageContext = buildPageContext(snapshot);
  const projectContext = buildProjectContext(project);

  return `You are PageClick AI, a knowledgeable and helpful AI assistant that lives inside a browser sidebar. You can answer questions, write code, explain concepts, debug problems, and have natural conversations.

${pageContext ? pageContext + "\n" : ""}
${projectContext ? projectContext + "\n" : ""}
${FORMATTING_RULES}

INSTRUCTIONS:
- Answer the user's question directly and helpfully.
- If the user asks for code, provide well-formatted code blocks with the correct language tag.
- If the current page context is relevant to their question, reference it. Otherwise, ignore it.
- Be conversational, concise, and accurate.
- You can use markdown formatting: bold, italic, lists, code blocks, headings, etc.
- Do NOT generate any action plan or automation steps — just answer like a knowledgeable assistant.
- If the user seems to want you to DO something on the page (click, navigate, fill forms), tell them to phrase it as a direct instruction like "Click the submit button" or "Navigate to gmail.com".
`;
}

// ── Task detection heuristic ─────────────────────────────────────

/**
 * Patterns that indicate conversational / informational / coding requests.
 * If ANY of these match, we treat it as a NON-task (chat mode) unless
 * there's a very strong browser-action signal.
 */
const CHAT_PATTERNS = [
  // Code generation / explanation
  /\b(write|generate|create|build|implement|code)\b.{0,20}\b(a |an |me |the )?(function|class|component|script|program|module|api|endpoint|code|snippet|hook|test|app|bot|server|page|website|html|css|style|algorithm|pattern|interface|type|struct|query|schema|migration|template|util|helper|service|handler|middleware|decorator|wrapper|factory|singleton|method)\b/i,
  /\b(how (do|can|to|does|would)|what (is|are|does|was|were)|where (is|are|do)|when (is|did|does|was)|why (is|does|did|do|are)|who (is|are|was))\b/i,
  /\b(explain|describe|summarize|translate|compare|analyze|debug|fix|refactor|review|improve|optimize|convert|rewrite)\b/i,
  /\b(tell me|can you tell|could you|would you|what('s| is) (the|a|an)|define|meaning of)\b/i,
  // Direct code output requests
  /\b(give me|show me|provide)\b.{0,20}\b(code|example|snippet|function|implementation|solution|algorithm)\b/i,
  // Questions ending with ?
  /^[^.]{5,}\?\s*$/,
  // Programming / technical chat
  /\b(syntax|error|bug|issue|difference between|pros and cons|best practice|tutorial|documentation)\b/i,
  /\b(python|javascript|typescript|java|rust|go|react|vue|angular|node|express|django|flask|sql|regex|css|html)\b.*\b(code|function|class|method|example|snippet|how)\b/i,
];

/** Strong browser-action signals that override chat patterns */
const BROWSER_ACTION_PATTERNS = [
  /\b(buy|purchase|order|add to cart|checkout)\b/i,
  /\b(click|tap|press)\b.{0,30}\b(button|link|icon|menu|tab|element)\b/i,
  /\b(go to|navigate to|open|visit)\b.{0,30}\b(page|site|website|url|link|gmail|youtube|github|google|amazon)\b/i,
  /\b(search for|look for|find)\b.{0,40}\b(on |in |at |the page|this page|the site|this site|website)\b/i,
  /\b(fill|fill in|fill out|complete)\b.{0,20}\b(form|field|input|application)\b/i,
  /\b(sign up|sign in|login|log in|register|log out|sign out)\b/i,
  /\b(download|upload)\b.{0,20}\b(file|image|document|pdf|video|from)\b/i,
  /\b(copy|paste|clipboard)\b.{0,20}\b(to|from|this|that|text|content)\b/i,
  /\b(book|reserve|schedule)\b.{0,30}\b(ticket|flight|hotel|appointment|meeting|slot)\b/i,
  /\b(subscribe|unsubscribe)\b/i,
  /\b(tab\s*group|group.{0,10}tabs|organize.{0,10}tabs)\b/i,
  /\b(scroll|swipe)\b.{0,20}\b(down|up|to|page|bottom|top)\b/i,
  /\b(apply|submit|send|post)\b.{0,30}\b(form|application|resume|message|job|position|internship|role)\b/i,
  /\b(read file|local file|native app|filesystem)\b/i,
  // Very intentional action language
  /\b(do it|do this|do that|go ahead|proceed|make it happen)\b/i,
];

/**
 * Returns true if the user's message looks like a task request
 * (wants the agent to DO something in the browser) vs. a conversational
 * question, code request, or general chat.
 *
 * Logic:
 * 1. If a chat/conversational pattern matches → NOT a task (checked first to
 *    prevent false positives like "create a login form component")
 * 2. If a strong browser-action pattern matches → task
 * 3. Fallback: short imperative sentences → task, everything else → chat
 */
export function isTaskRequest(message: string): boolean {
  const trimmed = message.trim();

  // Very short messages (< 4 words) that are just greetings or questions
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount <= 2 && /^(hi|hello|hey|thanks|thank you|ok|okay|sure|yes|no|yo|sup)$/i.test(trimmed)) {
    return false;
  }

  // 1) Chat/conversational pattern → not a task (checked FIRST)
  if (CHAT_PATTERNS.some((p) => p.test(trimmed))) {
    return false;
  }

  // 2) Strong browser-action signal → task
  if (BROWSER_ACTION_PATTERNS.some((p) => p.test(trimmed))) {
    return true;
  }

  // 3) Fallback heuristic: short imperative sentences without a question mark
  //    e.g. "Open Gmail", "Search Amazon for headphones"
  if (wordCount <= 8 && !trimmed.endsWith("?") && /^[A-Z]/.test(trimmed)) {
    // Check for at least one action-ish verb
    if (/\b(open|go|click|search|find|type|scroll|get|check|show|close|refresh|reload|switch|move|drag|run|start|stop|enable|disable|turn|set|change|update|delete|remove|add|create|new|save|send|post|share|follow|unfollow|like|unlike|block|unblock|mute|unmute|pin|unpin|archive|star|mark|accept|reject|deny|approve|confirm|cancel|skip|next|back|previous|forward|undo|redo|play|pause|resume|select|pick|choose|grab|extract|read|scan|scrape)\b/i.test(trimmed)) {
      return true;
    }
  }

  return false;
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
