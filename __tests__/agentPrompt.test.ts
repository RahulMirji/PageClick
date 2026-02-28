import { describe, expect, it } from "vitest";
import {
  isTaskRequest,
  parseActionPlan,
  parseAskUser,
  parseCheckpoint,
  parseTaskComplete,
  parseTaskReady,
} from "../src/sidebar/utils/agentPrompt";

describe("agentPrompt task detection", () => {
  it("detects task-style clipboard requests", () => {
    expect(isTaskRequest('Copy "Hello" to clipboard')).toBe(true);
    expect(isTaskRequest("Read local file ~/Documents/todo.txt")).toBe(true);
  });

  it("does not classify pure informational question as task", () => {
    expect(isTaskRequest("What is React?")).toBe(false);
  });
});

describe("agentPrompt structured block parsing", () => {
  it("parses ACTION_PLAN with one action", () => {
    const response = [
      "I will click the button.",
      "<<<ACTION_PLAN>>>",
      '{"explanation":"click submit","actions":[{"action":"click","selector":"button[type=submit]","confidence":0.95,"risk":"low","description":"Click submit"}]}',
      "<<<END_ACTION_PLAN>>>",
    ].join("\n");

    const parsed = parseActionPlan(response);
    expect(parsed.found).toBe(true);
    expect(parsed.block?.actions).toHaveLength(1);
    expect(parsed.cleanContent).toContain("I will click the button.");
  });

  it("parses ACTION_PLAN with alternate end tag variant", () => {
    const response =
      '<<<ACTION_PLAN>>> {"explanation":"x","actions":[]} <<<_ACTION_PLAN>>>';
    const parsed = parseActionPlan(response);
    expect(parsed.found).toBe(true);
    expect(parsed.block?.explanation).toBe("x");
  });

  it("returns not found for invalid ACTION_PLAN JSON", () => {
    const response = "<<<ACTION_PLAN>>> {not-json} <<<END_ACTION_PLAN>>>";
    const parsed = parseActionPlan(response);
    expect(parsed.found).toBe(false);
  });

  it("parses TASK_READY block", () => {
    const response =
      '<<<TASK_READY>>> {"ready":true,"summary":"Proceed"} <<<END_TASK_READY>>>';
    const parsed = parseTaskReady(response);
    expect(parsed.found).toBe(true);
    expect(parsed.block?.ready).toBe(true);
    expect(parsed.block?.summary).toBe("Proceed");
  });

  it("parses ASK_USER/CHECKPOINT/TASK_COMPLETE blocks", () => {
    const ask = parseAskUser(
      '<<<ASK_USER>>> {"questions":["A?"]} <<<END_ASK_USER>>>',
    );
    expect(ask.found).toBe(true);
    expect(ask.block?.questions[0]).toBe("A?");

    const checkpoint = parseCheckpoint(
      '<<<CHECKPOINT>>> {"reason":"r","message":"m","canSkip":false} <<<END_CHECKPOINT>>>',
    );
    expect(checkpoint.found).toBe(true);
    expect(checkpoint.block?.reason).toBe("r");

    const complete = parseTaskComplete(
      '<<<TASK_COMPLETE>>> {"summary":"done","nextSteps":["x"]} <<<END_TASK_COMPLETE>>>',
    );
    expect(complete.found).toBe(true);
    expect(complete.block?.summary).toBe("done");
  });
});
