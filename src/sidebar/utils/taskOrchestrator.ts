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
} from "../../shared/messages";

// ── Execution result (mirrors content script) ─────────────────────

export interface ExecutionResult {
  success: boolean;
  action: string;
  selector: string;
  extractedData?: string;
  error?: string;
  durationMs: number;
}

// ── Loop history entry ────────────────────────────────────────────

export interface LoopEntry {
  iteration: number;
  pageUrl: string;
  plan: ActionPlan;
  results: ExecutionResult[];
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
    this.abortController = new AbortController();
    this.state = {
      ...this.createInitialState(),
      phase: "clarifying",
      goal,
      statusMessage: "Understanding your request...",
    };
    this.emit({
      type: "PHASE_CHANGE",
      phase: "clarifying",
      message: this.state.statusMessage,
    });
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
   * Build a compact history summary for the AI prompt
   * (keeps token count manageable).
   */
  buildHistorySummary(): string {
    if (this.state.history.length === 0) return "";

    const lines: string[] = ["PREVIOUS ACTIONS:"];
    for (const entry of this.state.history) {
      lines.push(
        `\n--- Iteration ${entry.iteration} (on ${entry.pageUrl}) ---`,
      );
      lines.push(`Plan: ${entry.plan.explanation}`);
      for (const r of entry.results) {
        const status = r.success ? "✅" : "❌";
        lines.push(
          `  ${status} ${r.action} → ${r.selector}${r.error ? ` (Error: ${r.error})` : ""}${r.extractedData ? ` [Extracted: ${r.extractedData}]` : ""}`,
        );
      }
    }
    return lines.join("\n");
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
}
