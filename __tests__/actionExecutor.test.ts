import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeAction } from "../src/content/action-executor";

class FakeElement {
  tagName: string;
  id = "";
  className = "";
  textContent: string | null = "";
  style: Record<string, string> = {};
  isContentEditable = false;

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  getBoundingClientRect() {
    return {
      x: 0,
      y: 0,
      width: 120,
      height: 40,
      top: 0,
      left: 0,
      right: 120,
      bottom: 40,
    };
  }

  scrollIntoView() {}
  dispatchEvent(_event: unknown) {
    return true;
  }
  querySelectorAll() {
    return [] as any[];
  }
  focus() {}
  click() {}
  remove() {}
}

class FakeHTMLElement extends FakeElement {}
class FakeInputElement extends FakeHTMLElement {
  type = "text";
  value = "";
  checked = false;
}
class FakeTextAreaElement extends FakeHTMLElement {
  value = "";
}
class FakeSelectElement extends FakeHTMLElement {
  options: Array<{ value: string; text: string; textContent: string }> = [];
  selectedIndex = 0;
  value = "";
}
class FakeAnchorElement extends FakeHTMLElement {
  href = "";
}
class FakeImageElement extends FakeHTMLElement {
  alt = "";
  src = "";
}

function installDom(selectorMap: Record<string, any>) {
  const body = new FakeHTMLElement("body");
  (body as any).appendChild = vi.fn();
  (body as any).removeChild = vi.fn();
  const documentElement = new FakeHTMLElement("html");
  (globalThis as any).document = {
    body,
    documentElement,
    querySelector: vi.fn((selector: string) => selectorMap[selector] ?? null),
    createElement: vi.fn(() => new FakeHTMLElement("div")),
  };
  (globalThis as any).window = {
    innerHeight: 900,
    innerWidth: 1200,
    scrollBy: vi.fn(),
    scrollTo: vi.fn(),
    location: { href: "https://example.com" },
  };
  (globalThis as any).Event = class {
    constructor(public type: string) {}
  };
  (globalThis as any).MouseEvent = class {
    constructor(public type: string) {}
  };
  (globalThis as any).KeyboardEvent = class {
    constructor(public type: string) {}
  };
  (globalThis as any).HTMLElement = FakeHTMLElement;
  (globalThis as any).Element = FakeElement;
  (globalThis as any).HTMLInputElement = FakeInputElement;
  (globalThis as any).HTMLTextAreaElement = FakeTextAreaElement;
  (globalThis as any).HTMLSelectElement = FakeSelectElement;
  (globalThis as any).HTMLAnchorElement = FakeAnchorElement;
  (globalThis as any).HTMLImageElement = FakeImageElement;
}

describe("action-executor executeAction", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns not found when selector does not resolve", async () => {
    installDom({});

    const result = await executeAction({
      action: "click",
      selector: "#missing",
      confidence: 1,
      risk: "low",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Element not found");
  });

  it("fails input action without value", async () => {
    const input = new FakeInputElement("input");
    installDom({ "#name": input });

    const result = await executeAction({
      action: "input",
      selector: "#name",
      confidence: 1,
      risk: "low",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Input action requires a value");
  });

  it("extracts anchor text with URL", async () => {
    const a = new FakeAnchorElement("a");
    a.textContent = "Docs";
    a.href = "https://example.com/docs";
    installDom({ "#link": a });

    const promise = executeAction({
      action: "extract",
      selector: "#link",
      confidence: 1,
      risk: "low",
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.extractedData).toContain("Docs");
    expect(result.extractedData).toContain("https://example.com/docs");
  });

  it("selects matching option text and succeeds", async () => {
    const select = new FakeSelectElement("select");
    select.options = [
      { value: "1", text: "Basic Plan", textContent: "Basic Plan" },
      { value: "2", text: "Pro Plan", textContent: "Pro Plan" },
    ];
    select.value = "1";
    installDom({ "#plan": select });

    const promise = executeAction({
      action: "select",
      selector: "#plan",
      value: "pro plan",
      confidence: 1,
      risk: "low",
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(select.value).toBe("2");
  });

  it("fails select action without value", async () => {
    const select = new FakeSelectElement("select");
    installDom({ "#plan": select });

    const result = await executeAction({
      action: "select",
      selector: "#plan",
      confidence: 1,
      risk: "low",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Select action requires a value");
  });

  it("returns unknown action error for unsupported action", async () => {
    const el = new FakeHTMLElement("div");
    installDom({ "#x": el });

    const result = await executeAction({
      action: "eval",
      selector: "#x",
      confidence: 1,
      risk: "low",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown action");
  });

  it("handles scroll on document body and top/bottom directions", async () => {
    installDom({});
    (globalThis as any).document.querySelector = vi.fn((selector: string) =>
      selector === "body" ? (globalThis as any).document.body : null,
    );

    const scrollDown = executeAction({
      action: "scroll",
      selector: "body",
      value: "down",
      confidence: 1,
      risk: "low",
    });
    await vi.runAllTimersAsync();
    const downResult = await scrollDown;

    const scrollTop = executeAction({
      action: "scroll",
      selector: "body",
      value: "top",
      confidence: 1,
      risk: "low",
    });
    await vi.runAllTimersAsync();
    const topResult = await scrollTop;

    expect(downResult.success).toBe(true);
    expect(topResult.success).toBe(true);
    expect((globalThis as any).window.scrollBy).toHaveBeenCalled();
    expect((globalThis as any).window.scrollTo).toHaveBeenCalled();
  });

  it("updates window location for navigate actions", async () => {
    const link = new FakeAnchorElement("a");
    link.href = "https://new.example.com";
    installDom({ "#nav": link });

    const promise = executeAction({
      action: "navigate",
      selector: "#nav",
      value: "https://new.example.com",
      confidence: 1,
      risk: "low",
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect((globalThis as any).window.location.href).toBe(
      "https://new.example.com",
    );
  });

  it("errors when requested select option is missing", async () => {
    const select = new FakeSelectElement("select");
    select.options = [{ value: "1", text: "Basic", textContent: "Basic" }];
    installDom({ "#plan": select });

    const promise = executeAction({
      action: "select",
      selector: "#plan",
      value: "Enterprise",
      confidence: 1,
      risk: "low",
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });
});
