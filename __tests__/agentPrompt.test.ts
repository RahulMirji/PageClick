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

  // ── Browser action tasks (should be true) ──────────────────────
  it("detects navigation tasks", () => {
    expect(isTaskRequest("Go to gmail.com")).toBe(true);
    expect(isTaskRequest("Open YouTube")).toBe(true);
    expect(isTaskRequest("Navigate to the settings page")).toBe(true);
    expect(isTaskRequest("Visit amazon.com")).toBe(true);
  });

  it("detects interaction tasks", () => {
    expect(isTaskRequest("Click the submit button")).toBe(true);
    expect(isTaskRequest("Fill out the contact form")).toBe(true);
    expect(isTaskRequest("Sign in to my account")).toBe(true);
    expect(isTaskRequest("Download the PDF from this page")).toBe(true);
    expect(isTaskRequest("Search for headphones on Amazon")).toBe(true);
    expect(isTaskRequest("Book a flight ticket to NYC")).toBe(true);
    expect(isTaskRequest("Subscribe to the newsletter")).toBe(true);
    expect(isTaskRequest("Apply for this job")).toBe(true);
  });

  it("detects tab management tasks", () => {
    expect(isTaskRequest("Group my tabs by topic")).toBe(true);
    expect(isTaskRequest("Organize tabs into groups")).toBe(true);
  });

  it("detects short imperative commands", () => {
    expect(isTaskRequest("Refresh the page")).toBe(true);
    expect(isTaskRequest("Go back")).toBe(true);
    expect(isTaskRequest("Scroll down")).toBe(true);
  });

  // ── Conversational / coding queries (should be false) ──────────
  it("does not classify code requests as tasks", () => {
    expect(isTaskRequest("Write me a Python function to sort a list")).toBe(false);
    expect(isTaskRequest("Generate a React component for a login form")).toBe(false);
    expect(isTaskRequest("Create a function that calculates fibonacci numbers")).toBe(false);
    expect(isTaskRequest("Build me a REST API endpoint")).toBe(false);
    expect(isTaskRequest("Write a regex to match email addresses")).toBe(false);
    expect(isTaskRequest("Implement a binary search algorithm")).toBe(false);
  });

  it("does not classify explanation questions as tasks", () => {
    expect(isTaskRequest("What is React?")).toBe(false);
    expect(isTaskRequest("How does async/await work in JavaScript?")).toBe(false);
    expect(isTaskRequest("What is the difference between let and const?")).toBe(false);
    expect(isTaskRequest("Explain the observer pattern")).toBe(false);
    expect(isTaskRequest("Why does my code throw a null pointer error?")).toBe(false);
    expect(isTaskRequest("How can I optimize this SQL query?")).toBe(false);
    expect(isTaskRequest("What are the best practices for React hooks?")).toBe(false);
  });

  it("does not classify conversational messages as tasks", () => {
    expect(isTaskRequest("Hello")).toBe(false);
    expect(isTaskRequest("Thanks")).toBe(false);
    expect(isTaskRequest("Tell me about TypeScript generics")).toBe(false);
    expect(isTaskRequest("Summarize the content of this page")).toBe(false);
    expect(isTaskRequest("Compare Python and JavaScript")).toBe(false);
    expect(isTaskRequest("Debug this code for me: const x = null; x.foo()")).toBe(false);
    expect(isTaskRequest("Give me an example of a fetch request")).toBe(false);
  });

  it("does not classify general help requests as tasks", () => {
    expect(isTaskRequest("Can you help me understand closures?")).toBe(false);
    expect(isTaskRequest("What's the syntax for a for loop in Rust?")).toBe(false);
    expect(isTaskRequest("Show me a code example for async iterators")).toBe(false);
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
