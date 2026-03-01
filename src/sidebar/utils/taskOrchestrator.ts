/**
 * Task Orchestrator — Agentic loop state machine.
 *
 * Manages the observe → plan → act → re-observe cycle for multi-step
 * browser automation tasks (e.g., shopping, form filling).
 *
 * Emits state changes so the UI can reflect progress.
 */

import type {
  TaskPhase,
  ActionPlan,
  ActionStep,
  CheckpointBlock,
  TaskCompleteBlock,
  PageObservation,
} from "../../shared/messages";

// ── Execution result (mirrors content script) ─────────────────────

export interface ExecutionResult {
  success: boolean;
  action: string;
  selector: string;
  extractedData?: string;
  error?: string;
  observation?: PageObservation;
  durationMs: number;
}

export interface LoopFlowState {
  url: string;
  stepIndicator?: string;
  activeStep?: string;
  filledFields?: number;
  totalFields?: number;
}

// ── Loop history entry ────────────────────────────────────────────

export interface LoopEntry {
  iteration: number;
  pageUrl: string;
  plan: ActionPlan;
  results: ExecutionResult[];
  flowState?: LoopFlowState;
  timestamp: number;
}

// ── Task state ────────────────────────────────────────────────────

export interface TaskState {
  phase: TaskPhase;
  goal: string;
  clarifications: Record<string, string>;
  loopCount: number;
  maxLoops: number;
  history: LoopEntry[];
  currentStepIndex: number;
  pendingPlan: ActionPlan | null;
  statusMessage: string;
  error?: string;
}

// ── Event types ───────────────────────────────────────────────────

export type TaskEvent =
  | { type: "PHASE_CHANGE"; phase: TaskPhase; message: string }
  | { type: "STEP_EXECUTING"; step: ActionStep; index: number; total: number }
  | { type: "STEP_RESULT"; result: ExecutionResult; index: number }
  | { type: "LOOP_COMPLETE"; iteration: number }
  | { type: "ASK_USER"; questions: string[] }
  | { type: "CHECKPOINT"; checkpoint: CheckpointBlock }
  | { type: "TASK_COMPLETE"; summary: TaskCompleteBlock }
  | { type: "ERROR"; error: string }
  | { type: "BUDGET_EXHAUSTED"; loopCount: number };

export type TaskEventListener = (event: TaskEvent) => void;

// ── Orchestrator class ────────────────────────────────────────────

const DEFAULT_MAX_LOOPS = 15;

export class TaskOrchestrator {
  private state: TaskState;
  private listeners: TaskEventListener[] = [];
  private abortController: AbortController | null = null;

  constructor() {
    this.state = this.createInitialState();
  }

  private createInitialState(): TaskState {
    return {
      phase: "idle",
      goal: "",
      clarifications: {},
      loopCount: 0,
      maxLoops: DEFAULT_MAX_LOOPS,
      history: [],
      currentStepIndex: 0,
      pendingPlan: null,
      statusMessage: "",
    };
  }

  // ── Public API ────────────────────────────────────────────────

  getState(): Readonly<TaskState> {
    return { ...this.state };
  }

  isActive(): boolean {
    return (
      this.state.phase !== "idle" &&
      this.state.phase !== "completed" &&
      this.state.phase !== "error"
    );
  }

  subscribe(listener: TaskEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /**
   * Start a new task. Called when the user sends a message that
   * looks like a "do something" request (vs. an informational question).
   */
  startTask(goal: string): void {
    const maxLoops = this.estimateMaxLoops(goal);
    this.abortController = new AbortController();
    this.state = {
      ...this.createInitialState(),
      phase: "clarifying",
      goal,
      maxLoops,
      statusMessage: "Understanding your request...",
    };
    this.emit({
      type: "PHASE_CHANGE",
      phase: "clarifying",
      message: this.state.statusMessage,
    });
  }

  /**
   * Resume after loop budget exhaustion while preserving goal + history context.
   */
  resumeAfterBudgetExhausted(): boolean {
    if (
      this.state.phase !== "error" ||
      this.state.statusMessage !== "Loop budget exhausted"
    ) {
      return false;
    }

    const extra = this.estimateResumeLoops(this.state.goal);
    this.state.maxLoops += extra;
    this.state.phase = "observing";
    this.state.statusMessage = `Resuming task with +${extra} loops...`;
    this.emit({
      type: "PHASE_CHANGE",
      phase: "observing",
      message: this.state.statusMessage,
    });
    return true;
  }

  /**
   * Provide answers to the AI's clarification questions.
   * They get merged into the task context so the AI has all info.
   */
  addClarifications(answers: Record<string, string>): void {
    this.state.clarifications = { ...this.state.clarifications, ...answers };
  }

  /**
   * Transition to execution phase after clarification is complete.
   */
  beginExecution(): void {
    this.state.phase = "executing";
    this.state.statusMessage = "Planning actions...";
    this.emit({
      type: "PHASE_CHANGE",
      phase: "executing",
      message: this.state.statusMessage,
    });
  }

  /**
   * Record a plan received from the AI for the current loop iteration.
   */
  setPlan(plan: ActionPlan): void {
    this.state.pendingPlan = plan;
    this.state.currentStepIndex = 0;
  }

  /**
   * Record the result of a single step execution.
   */
  recordStepResult(result: ExecutionResult): void {
    this.state.currentStepIndex++;
    this.emit({
      type: "STEP_RESULT",
      result,
      index: this.state.currentStepIndex - 1,
    });
  }

  /**
   * Complete one loop iteration (observe → plan → act).
   * Returns false if the budget is exhausted.
   */
  completeLoop(entry: LoopEntry): boolean {
    this.state.history.push(entry);
    this.state.loopCount++;
    this.state.pendingPlan = null;
    this.state.currentStepIndex = 0;

    this.emit({ type: "LOOP_COMPLETE", iteration: this.state.loopCount });

    if (this.state.loopCount >= this.state.maxLoops) {
      this.state.phase = "error";
      this.state.statusMessage = "Loop budget exhausted";
      this.emit({ type: "BUDGET_EXHAUSTED", loopCount: this.state.loopCount });
      return false;
    }

    // Transition to observing for the next loop
    this.state.phase = "observing";
    this.state.statusMessage = "Observing page changes...";
    this.emit({
      type: "PHASE_CHANGE",
      phase: "observing",
      message: this.state.statusMessage,
    });
    return true;
  }

  /**
   * Pause the task at a checkpoint (e.g., before payment).
   */
  checkpoint(block: CheckpointBlock): void {
    this.state.phase = "checkpoint";
    this.state.statusMessage = block.message;
    this.emit({ type: "CHECKPOINT", checkpoint: block });
  }

  /**
   * Resume after a checkpoint approval.
   */
  resumeFromCheckpoint(): void {
    this.state.phase = "executing";
    this.state.statusMessage = "Continuing task...";
    this.emit({
      type: "PHASE_CHANGE",
      phase: "executing",
      message: this.state.statusMessage,
    });
  }

  /**
   * Mark task as complete.
   */
  complete(summary: TaskCompleteBlock): void {
    this.state.phase = "completed";
    this.state.statusMessage = summary.summary;
    this.emit({ type: "TASK_COMPLETE", summary });
  }

  /**
   * Abort the current task.
   */
  abort(reason?: string): void {
    this.abortController?.abort();
    this.state.phase = "idle";
    this.state.statusMessage = reason || "Task cancelled";
    this.emit({
      type: "PHASE_CHANGE",
      phase: "idle",
      message: this.state.statusMessage,
    });
  }

  /**
   * Check if the task has been aborted.
   */
  isAborted(): boolean {
    return this.abortController?.signal.aborted ?? false;
  }

  /**
   * Set a status message for UI display.
   */
  setStatus(message: string): void {
    this.state.statusMessage = message;
  }

  /**
   * Detect if the agent appears stuck (same URL, no progress for 3+ loops).
   */
  isStuck(): boolean {
    const h = this.state.history;
    if (h.length < 3) return false;
    const recent = h.slice(-3);
    const normalizedUrls = recent.map((e) => e.flowState?.url || e.pageUrl);
    const sameUrl = normalizedUrls.every((u) => u === normalizedUrls[0]);
    if (!sameUrl) return false;

    // "No fields changed" over 3 loops (if form context exists)
    const filledSeries = recent.map((e) => e.flowState?.filledFields);
    const knownFilled = filledSeries.filter((v): v is number => typeof v === "number");
    const fieldsDidNotChange =
      knownFilled.length === 0 ||
      knownFilled.every((v) => v === knownFilled[0]);

    // Also treat same step indicator as stuck reinforcement
    const stepSeries = recent.map((e) => e.flowState?.stepIndicator || e.flowState?.activeStep || "");
    const sameStep = stepSeries.every((s) => s === stepSeries[0]);

    // Do not mark as stuck if there are hard failures; this signal is for silent no-progress loops
    const hasFailures = recent.some((e) => e.results.some((r) => !r.success));

    return !hasFailures && fieldsDidNotChange && sameStep;
  }

  /**
   * Build a compact history summary for the AI prompt
   * (keeps token count manageable).
   */
  buildHistorySummary(): string {
    if (this.state.history.length === 0) return "";

    const lines: string[] = ["PREVIOUS ACTIONS:"];
    // Show last 8 iterations to keep token budget manageable
    const recentHistory = this.state.history.slice(-8);
    if (this.state.history.length > 8) {
      lines.push(`(${this.state.history.length - 8} earlier iterations omitted)`);
    }
    for (const entry of recentHistory) {
      lines.push(
        `\n--- Iteration ${entry.iteration} (on ${entry.pageUrl}) ---`,
      );
      lines.push(`Plan: ${entry.plan.explanation}`);
      for (const r of entry.results) {
        const status = r.success ? "✅" : "❌";
        lines.push(
          `  ${status} ${r.action} → ${r.selector}${r.error ? ` (Error: ${r.error})` : ""}${r.extractedData ? ` [Extracted: ${r.extractedData}]` : ""}`,
        );
        if (r.observation) {
          const obs = r.observation;
          const obsBits: string[] = [];
          if (obs.formProgress) obsBits.push(`form=${obs.formProgress}`);
          if (obs.stepIndicator) obsBits.push(`step="${obs.stepIndicator}"`);
          if (obs.newElements?.length) obsBits.push(`ui=${obs.newElements.slice(0, 2).join(" | ")}`);
          if (obs.errorMessages?.length) obsBits.push(`errors=${obs.errorMessages.slice(0, 1).join(" | ")}`);
          if (obsBits.length > 0) {
            lines.push(`    ↳ Observation: ${obsBits.join("; ")}`);
          }
        }
      }
    }

    // Add stuck warning
    if (this.isStuck()) {
      lines.push(`\n⚠️ WARNING: You appear to be STUCK — same page and no form-progress change for 3 loops. Try a DIFFERENT approach: scroll to reveal more content or click the Next/Continue control.`);
    }

    return lines.join("\n");
  }

  /**
   * Returns the most recent failed action from loop history, if any.
   */
  getLastFailure():
    | { action: string; selector: string; error?: string }
    | null {
    for (let i = this.state.history.length - 1; i >= 0; i--) {
      const entry = this.state.history[i];
      for (let j = entry.results.length - 1; j >= 0; j--) {
        const r = entry.results[j];
        if (!r.success) {
          return { action: r.action, selector: r.selector, error: r.error };
        }
      }
    }
    return null;
  }

  /**
   * Build clarification context for the prompt.
   */
  buildClarificationContext(): string {
    const entries = Object.entries(this.state.clarifications);
    if (entries.length === 0) return "";

    const lines = ["USER PREFERENCES (gathered from clarification):"];
    for (const [key, value] of entries) {
      lines.push(`- ${key}: ${value}`);
    }
    return lines.join("\n");
  }

  // ── Private ───────────────────────────────────────────────────

  private emit(event: TaskEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (e) {
        console.error("[TaskOrchestrator] Listener error:", e);
      }
    }
  }

  private estimateMaxLoops(goal: string): number {
    const text = goal.toLowerCase();

    const complexPatterns = [
      /google cloud|gcp|aws|azure|oauth|api setup|console setup/,
      /book|booking|checkout|payment|reservation/,
      /multi[- ]page|wizard|step \d+ of \d+/,
      /configure|integration|onboarding|pipeline/,
    ];
    if (complexPatterns.some((p) => p.test(text))) return 40;

    const multiStepPatterns = [
      /fill|form|application|register|sign up/,
      /create|setup|install|enable|connect/,
      /\bthen\b|\band\b|\bafter\b/,
    ];
    if (multiStepPatterns.some((p) => p.test(text))) return 25;

    return 10;
  }

  private estimateResumeLoops(goal: string): number {
    const base = this.estimateMaxLoops(goal);
    if (base >= 40) return 20;
    if (base >= 25) return 15;
    return 10;
  }
}
