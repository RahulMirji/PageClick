import { describe, expect, it } from "vitest";
import {
  evaluatePlan,
  evaluateStep,
  isCheckpointAction,
} from "../src/shared/safety-policy";
import type { ActionStep } from "../src/shared/messages";

function step(overrides: Partial<ActionStep> = {}): ActionStep {
  return {
    action: "click",
    selector: "button.submit",
    confidence: 0.9,
    risk: "low",
    ...overrides,
  };
}

describe("safety-policy evaluateStep", () => {
  it("blocks actions on blocked URLs (except navigate)", () => {
    const verdict = evaluateStep(step(), "https://paypal.com/checkout");
    expect(verdict.tier).toBe("block");

    const navigateVerdict = evaluateStep(
      step({ action: "navigate", selector: "", value: "https://example.com" }),
      "https://paypal.com/checkout",
    );
    expect(navigateVerdict.tier).not.toBe("block");
  });

  it("blocks sensitive selectors", () => {
    const verdict = evaluateStep(step({ selector: 'input[type="password"]' }));
    expect(verdict.tier).toBe("block");
  });

  it("returns checkpoint for payment-like selectors", () => {
    const verdict = evaluateStep(step({ selector: "button.place-order" }));
    expect(verdict.tier).toBe("checkpoint");
    expect(isCheckpointAction(step({ selector: "button.place-order" }))).toBe(
      true,
    );
  });

  it("requires confirm for potentially destructive selectors", () => {
    const verdict = evaluateStep(step({ selector: "button.delete-item" }));
    expect(verdict.tier).toBe("confirm");
  });

  it("defaults medium and high risk to confirmation", () => {
    expect(evaluateStep(step({ risk: "medium" })).tier).toBe("confirm");
    expect(evaluateStep(step({ risk: "high" })).tier).toBe("confirm");
  });

  it("blocks invalid native payload", () => {
    const verdict = evaluateStep(
      step({ action: "native", selector: "", value: "not-json" }),
    );
    expect(verdict.tier).toBe("block");
  });

  it("blocks unsupported native op", () => {
    const verdict = evaluateStep(
      step({
        action: "native",
        selector: "",
        value: JSON.stringify({ op: "shell.exec", args: { cmd: "rm -rf /" } }),
      }),
    );
    expect(verdict.tier).toBe("block");
  });

  it("requires confirm for clipboard.write native op", () => {
    const verdict = evaluateStep(
      step({
        action: "native",
        selector: "",
        value: JSON.stringify({
          op: "clipboard.write",
          args: { text: "Hello" },
        }),
      }),
    );
    expect(verdict.tier).toBe("confirm");
  });

  it("requires checkpoint when native args look sensitive", () => {
    const verdict = evaluateStep(
      step({
        action: "native",
        selector: "",
        value: JSON.stringify({
          op: "clipboard.read",
          args: { hint: "read password from clipboard" },
        }),
      }),
    );
    expect(verdict.tier).toBe("checkpoint");
  });

  it("requires confirm for approved low-sensitivity native reads", () => {
    const clipRead = evaluateStep(
      step({
        action: "native",
        selector: "",
        value: JSON.stringify({ op: "clipboard.read", args: {} }),
      }),
    );
    expect(clipRead.tier).toBe("confirm");

    const fileRead = evaluateStep(
      step({
        action: "native",
        selector: "",
        value: JSON.stringify({
          op: "fs.readText",
          args: { path: "~/Documents/notes.txt" },
        }),
      }),
    );
    expect(fileRead.tier).toBe("confirm");
  });
});

describe("safety-policy evaluatePlan", () => {
  it("aggregates blocked/confirm steps and auto-run state", () => {
    const plan = evaluatePlan([
      step({ action: "scroll", selector: "body", risk: "low" }),
      step({ selector: "button.delete-account", risk: "low" }),
      step({ selector: 'input[type="password"]', risk: "low" }),
    ]);

    expect(plan.canAutoRun).toBe(false);
    expect(plan.requiresConfirmation.length).toBeGreaterThan(0);
    expect(plan.blocked.length).toBeGreaterThan(0);
  });
});
