/**
 * Safety Policy Engine
 *
 * Evaluates action steps against security rules before execution:
 * - Permission tiers (auto-allow, confirm, block)
 * - Dangerous selector/URL blocklist
 * - Risk escalation based on action + target
 * - Audit trail logging
 */

import type { ActionStep, RiskLevel } from "./messages";

type NativeOp = "clipboard.read" | "clipboard.write" | "fs.readText";

interface NativePayload {
  op: NativeOp;
  args?: Record<string, any>;
}

// ── Permission tiers ──────────────────────────────────────────────

export type PermissionTier = "auto" | "confirm" | "checkpoint" | "block";

export interface PolicyVerdict {
  tier: PermissionTier;
  reason: string;
  escalatedRisk?: RiskLevel; // if risk was escalated from the model's assessment
  originalRisk: RiskLevel;
}

// ── Blocklist patterns ────────────────────────────────────────────

/** Selectors that should NEVER be interacted with */
const BLOCKED_SELECTORS = [
  // Payment / checkout
  /input\[.*type=["']?password/i,
  /input\[.*autocomplete=["']?cc-/i,
  /\[data-.*payment\]/i,
  /\[data-.*billing\]/i,
  /\.stripe/i,
  /#card-element/i,

  // Authentication
  /\[data-.*otp\]/i,
  /\[data-.*mfa\]/i,
  /\[data-.*2fa\]/i,

  // System / dangerous
  /\[data-.*delete.*account\]/i,
  /\[data-.*deactivate\]/i,
];

/** URL patterns where actions should be blocked entirely */
const BLOCKED_URL_PATTERNS = [
  /chrome:\/\//,
  /chrome-extension:\/\//,
  /about:/,
  /^javascript:/i,
  /banking/i,
  /paypal\.com/i,
  /stripe\.com\/.*dashboard/i,
];

/** Selectors that require confirmation even at low risk */
const CONFIRM_SELECTORS = [
  /button.*delete/i,
  /button.*remove/i,
  /button.*cancel/i,
  /\[data-.*submit\]/i,
  /form.*submit/i,
  /input\[type=["']?submit/i,
  /a\[href.*logout\]/i,
  /a\[href.*signout\]/i,
  /button.*logout/i,
  /button.*sign.?out/i,
];

/** Selectors that trigger a task checkpoint (pause before continuing) */
const CHECKPOINT_SELECTORS = [
  /place.?order/i,
  /confirm.?payment/i,
  /pay.?now/i,
  /complete.?purchase/i,
  /proceed.?to.?pay/i,
  /submit.?order/i,
  /checkout.*confirm/i,
];

/** Action + selector combinations that escalate risk */
const RISK_ESCALATIONS: Array<{
  action: string;
  selectorPattern: RegExp;
  escalateTo: RiskLevel;
  reason: string;
}> = [
  {
    action: "click",
    selectorPattern: /delete|remove|cancel|unsubscribe/i,
    escalateTo: "high",
    reason: "Destructive action detected",
  },
  {
    action: "input",
    selectorPattern: /password|email|login|signin/i,
    escalateTo: "medium",
    reason: "Entering data into authentication field",
  },
  {
    action: "navigate",
    selectorPattern: /.*/,
    escalateTo: "low",
    reason: "Navigation — handled by background script",
  },
  {
    action: "click",
    selectorPattern: /purchase|buy|order|checkout|pay/i,
    escalateTo: "medium",
    reason: "Purchase/payment action — requires confirmation",
  },
];

const ALLOWED_NATIVE_OPS: NativeOp[] = [
  "clipboard.read",
  "clipboard.write",
  "fs.readText",
];

const SENSITIVE_NATIVE_PATTERNS = [
  /password/i,
  /passcode/i,
  /\b2fa\b/i,
  /\botp\b/i,
  /token/i,
  /secret/i,
  /private.?key/i,
  /credit.?card/i,
  /bank/i,
  /payment/i,
  /wallet/i,
];

function parseNativePayload(step: ActionStep): NativePayload | null {
  if (step.action !== "native") return null;
  if (!step.value) return null;
  try {
    const payload = JSON.parse(step.value);
    if (!payload || typeof payload !== "object") return null;
    return payload as NativePayload;
  } catch {
    return null;
  }
}

function hasSensitiveNativeIntent(payload: NativePayload): boolean {
  const raw = JSON.stringify(payload.args || {});
  return SENSITIVE_NATIVE_PATTERNS.some((pattern) => pattern.test(raw));
}

// ── Policy evaluation ─────────────────────────────────────────────

export function evaluateStep(
  step: ActionStep,
  pageUrl?: string,
): PolicyVerdict {
  // Native actions are always explicit and always gated.
  if (step.action === "native") {
    const payload = parseNativePayload(step);
    if (!payload || !payload.op) {
      return {
        tier: "block",
        reason: "Invalid native payload. Expected JSON with { op, args }.",
        originalRisk: step.risk,
      };
    }
    if (!ALLOWED_NATIVE_OPS.includes(payload.op)) {
      return {
        tier: "block",
        reason: `Native op "${payload.op}" is not allowed`,
        originalRisk: step.risk,
      };
    }

    if (payload.op === "clipboard.write") {
      return {
        tier: "confirm",
        reason: "Native clipboard write requires approval",
        escalatedRisk: "high",
        originalRisk: step.risk,
      };
    }

    if (hasSensitiveNativeIntent(payload)) {
      return {
        tier: "checkpoint",
        reason: `Native ${payload.op} payload appears sensitive`,
        escalatedRisk: "high",
        originalRisk: step.risk,
      };
    }

    return {
      tier: "confirm",
      reason: `Native ${payload.op} requires approval`,
      escalatedRisk: "high",
      originalRisk: step.risk,
    };
  }

  // 1. Check URL blocklist — but SKIP for 'navigate' actions
  //    Navigate actions leave the current page, so they should always be allowed
  if (pageUrl && step.action !== "navigate") {
    for (const pattern of BLOCKED_URL_PATTERNS) {
      if (pattern.test(pageUrl)) {
        return {
          tier: "block",
          reason: `Actions blocked on this page (${pattern.source})`,
          originalRisk: step.risk,
        };
      }
    }
  }

  // 2. Check selector blocklist
  for (const pattern of BLOCKED_SELECTORS) {
    if (pattern.test(step.selector)) {
      return {
        tier: "block",
        reason: `Blocked selector: ${step.selector} matches security rule`,
        originalRisk: step.risk,
      };
    }

    // Also check the description
    if (step.description && pattern.test(step.description)) {
      return {
        tier: "block",
        reason: `Action description matches blocked pattern`,
        originalRisk: step.risk,
      };
    }
  }

  // 3. Check if this is a checkpoint action (payment/order confirmation)
  for (const pattern of CHECKPOINT_SELECTORS) {
    if (
      pattern.test(step.selector) ||
      (step.description && pattern.test(step.description))
    ) {
      return {
        tier: "checkpoint",
        reason: `Payment/order checkpoint: matches "${pattern.source}"`,
        escalatedRisk: "high",
        originalRisk: step.risk,
      };
    }
  }

  // 4. Check if selector requires confirmation
  for (const pattern of CONFIRM_SELECTORS) {
    if (
      pattern.test(step.selector) ||
      (step.description && pattern.test(step.description))
    ) {
      return {
        tier: "confirm",
        reason: `Potentially destructive: matches "${pattern.source}"`,
        escalatedRisk: "medium",
        originalRisk: step.risk,
      };
    }
  }

  // 5. Risk escalation rules
  for (const rule of RISK_ESCALATIONS) {
    if (step.action === rule.action) {
      const target = `${step.selector} ${step.description || ""} ${step.value || ""}`;
      if (rule.selectorPattern.test(target)) {
        const escalated =
          riskLevel(rule.escalateTo) > riskLevel(step.risk)
            ? rule.escalateTo
            : step.risk;

        return {
          tier:
            escalated === "high"
              ? "confirm"
              : escalated === "medium"
                ? "confirm"
                : "auto",
          reason: rule.reason,
          escalatedRisk: escalated !== step.risk ? escalated : undefined,
          originalRisk: step.risk,
        };
      }
    }
  }

  // 6. Default tier based on model-declared risk
  switch (step.risk) {
    case "high":
      return {
        tier: "confirm",
        reason: "High risk action",
        originalRisk: step.risk,
      };
    case "medium":
      return {
        tier: "confirm",
        reason: "Medium risk — requires approval",
        originalRisk: step.risk,
      };
    case "low":
    default:
      return {
        tier: "auto",
        reason: "Low risk — auto-approved",
        originalRisk: step.risk,
      };
  }
}

function riskLevel(risk: RiskLevel): number {
  switch (risk) {
    case "low":
      return 0;
    case "medium":
      return 1;
    case "high":
      return 2;
  }
}

// ── Evaluate full plan ────────────────────────────────────────────

export interface PlanVerdict {
  canAutoRun: boolean;
  steps: Array<{ step: ActionStep; verdict: PolicyVerdict }>;
  blocked: ActionStep[];
  requiresConfirmation: ActionStep[];
}

export function evaluatePlan(
  steps: ActionStep[],
  pageUrl?: string,
): PlanVerdict {
  const results = steps.map((step) => ({
    step,
    verdict: evaluateStep(step, pageUrl),
  }));

  return {
    canAutoRun: results.every((r) => r.verdict.tier === "auto"),
    steps: results,
    blocked: results
      .filter((r) => r.verdict.tier === "block")
      .map((r) => r.step),
    requiresConfirmation: results
      .filter((r) => r.verdict.tier === "confirm")
      .map((r) => r.step),
  };
}

// ── Audit trail ───────────────────────────────────────────────────

export interface AuditEntry {
  timestamp: number;
  action: string;
  selector: string;
  url: string;
  verdict: PermissionTier;
  reason: string;
  userApproved: boolean;
  result?: "success" | "failed" | "blocked";
}

const AUDIT_STORAGE_KEY = "__pc_audit_log";
const MAX_AUDIT_ENTRIES = 200;

export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    const { [AUDIT_STORAGE_KEY]: existing } =
      await chrome.storage.local.get(AUDIT_STORAGE_KEY);
    const log: AuditEntry[] = Array.isArray(existing) ? existing : [];
    log.unshift(entry);
    // Keep bounded
    if (log.length > MAX_AUDIT_ENTRIES) {
      log.length = MAX_AUDIT_ENTRIES;
    }
    await chrome.storage.local.set({ [AUDIT_STORAGE_KEY]: log });
  } catch (err) {
    console.warn("PageClick: failed to log audit entry:", err);
  }
}

export async function getAuditLog(): Promise<AuditEntry[]> {
  try {
    const { [AUDIT_STORAGE_KEY]: log } =
      await chrome.storage.local.get(AUDIT_STORAGE_KEY);
    return Array.isArray(log) ? log : [];
  } catch {
    return [];
  }
}

// ── Checkpoint detection helper ───────────────────────────────────

export function isCheckpointAction(
  step: ActionStep,
  pageUrl?: string,
): boolean {
  const verdict = evaluateStep(step, pageUrl);
  return verdict.tier === "checkpoint";
}
