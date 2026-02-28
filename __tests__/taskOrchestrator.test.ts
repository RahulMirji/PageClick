import { describe, expect, it } from "vitest";
import { TaskOrchestrator } from "../src/sidebar/utils/taskOrchestrator";
import type { ActionPlan } from "../src/shared/messages";

function plan(explanation = "Plan 1"): ActionPlan {
  return {
    explanation,
    actions: [
      {
        action: "click",
        selector: "#submit",
        confidence: 0.9,
        risk: "low",
        description: "Click submit",
      },
    ],
  };
}

describe("TaskOrchestrator", () => {
  it("starts task in clarifying phase and can abort", () => {
    const orchestrator = new TaskOrchestrator();

    orchestrator.startTask("Book a flight");
    expect(orchestrator.getState().phase).toBe("clarifying");
    expect(orchestrator.isActive()).toBe(true);

    orchestrator.abort("Stopped by user");
    expect(orchestrator.getState().phase).toBe("idle");
    expect(orchestrator.isAborted()).toBe(true);
  });

  it("tracks clarifications and builds context string", () => {
    const orchestrator = new TaskOrchestrator();
    orchestrator.startTask("Buy shoes");
    orchestrator.addClarifications({ Size: "9", Color: "Black" });

    const context = orchestrator.buildClarificationContext();
    expect(context).toContain("Size: 9");
    expect(context).toContain("Color: Black");
  });

  it("transitions through execution and observing with loop completion", () => {
    const orchestrator = new TaskOrchestrator();
    orchestrator.startTask("Submit form");
    orchestrator.beginExecution();
    expect(orchestrator.getState().phase).toBe("executing");

    orchestrator.setPlan(plan("Fill and submit form"));
    orchestrator.recordStepResult({
      success: true,
      action: "click",
      selector: "#submit",
      durationMs: 100,
    });

    const keepGoing = orchestrator.completeLoop({
      iteration: 1,
      pageUrl: "https://example.com/form",
      plan: plan("Fill and submit form"),
      results: [
        {
          success: true,
          action: "click",
          selector: "#submit",
          durationMs: 100,
        },
      ],
      timestamp: Date.now(),
    });

    expect(keepGoing).toBe(true);
    expect(orchestrator.getState().phase).toBe("observing");
    expect(orchestrator.getState().loopCount).toBe(1);

    const summary = orchestrator.buildHistorySummary();
    expect(summary).toContain("PREVIOUS ACTIONS");
    expect(summary).toContain("Iteration 1");
    expect(summary).toContain("Plan: Fill and submit form");
  });

  it("supports checkpoint and resume", () => {
    const orchestrator = new TaskOrchestrator();
    orchestrator.startTask("Checkout");
    orchestrator.beginExecution();

    orchestrator.checkpoint({
      reason: "Payment",
      message: "Proceed with payment?",
      canSkip: false,
    });
    expect(orchestrator.getState().phase).toBe("checkpoint");

    orchestrator.resumeFromCheckpoint();
    expect(orchestrator.getState().phase).toBe("executing");
  });

  it("completes task and emits completed state", () => {
    const orchestrator = new TaskOrchestrator();
    orchestrator.startTask("Do work");
    orchestrator.complete({ summary: "Done", nextSteps: ["Review output"] });

    expect(orchestrator.getState().phase).toBe("completed");
    expect(orchestrator.getState().statusMessage).toBe("Done");
  });

  it("enters error phase when loop budget is exhausted", () => {
    const orchestrator = new TaskOrchestrator();
    orchestrator.startTask("Long task");
    orchestrator.beginExecution();

    let keepGoing = true;
    for (let i = 1; i <= 15; i++) {
      keepGoing = orchestrator.completeLoop({
        iteration: i,
        pageUrl: `https://example.com/${i}`,
        plan: plan(`Plan ${i}`),
        results: [
          {
            success: true,
            action: "click",
            selector: "#ok",
            durationMs: 50,
          },
        ],
        timestamp: Date.now(),
      });
    }

    expect(keepGoing).toBe(false);
    expect(orchestrator.getState().phase).toBe("error");
    expect(orchestrator.getState().statusMessage).toBe("Loop budget exhausted");
  });
});
