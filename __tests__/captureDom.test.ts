import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeActionMock } = vi.hoisted(() => ({
  executeActionMock: vi.fn(async () => ({
    success: true,
    action: "click",
    selector: "#btn",
    durationMs: 10,
  })),
}));

vi.mock("../src/content/action-executor", () => ({
  executeAction: executeActionMock,
}));

class FakeElement {
  id = "";
  tagName: string;
  style: any = {};
  textContent: string | null = "";

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  getBoundingClientRect() {
    return {
      x: 10,
      y: 20,
      width: 100,
      height: 40,
      top: 20,
      left: 10,
      right: 110,
      bottom: 60,
    };
  }

  getAttribute(_name: string) {
    return null;
  }

  remove() {}
}

type OnMessageListener = (
  message: any,
  sender: any,
  sendResponse: (response: any) => void,
) => any;

describe("capture-dom content message listener", () => {
  let listener: OnMessageListener | null = null;

  beforeEach(async () => {
    vi.resetModules();
    executeActionMock.mockClear();

    const body = new FakeElement("body") as any;
    body.cloneNode = () => ({
      querySelectorAll: () => ({ forEach: () => {} }),
      innerText: "Visible page text",
    });
    body.appendChild = vi.fn();

    const existingHighlight = { remove: vi.fn() };

    (globalThis as any).document = {
      title: "Sample Page",
      readyState: "complete",
      body,
      documentElement: new FakeElement("html"),
      createTreeWalker: vi.fn(() => ({
        currentNode: body,
        nextNode: () => null,
      })),
      querySelector: vi.fn(() => null),
      querySelectorAll: vi.fn(() => []),
      getElementById: vi.fn((id: string) =>
        id === "__pc-highlight" ? existingHighlight : null,
      ),
      createElement: vi.fn(() => new FakeElement("div")),
    };
    (globalThis as any).window = {
      location: { href: "https://example.com/page" },
      innerHeight: 900,
      innerWidth: 1200,
      getComputedStyle: () => ({
        display: "block",
        visibility: "visible",
        opacity: "1",
      }),
    };
    (globalThis as any).NodeFilter = {
      SHOW_ELEMENT: 1,
      FILTER_REJECT: 2,
      FILTER_SKIP: 3,
      FILTER_ACCEPT: 1,
    };
    (globalThis as any).CSS = { escape: (v: string) => v };
    (globalThis as any).Element = FakeElement;
    (globalThis as any).HTMLInputElement = class extends FakeElement {};
    (globalThis as any).HTMLTextAreaElement = class extends FakeElement {};
    (globalThis as any).HTMLSelectElement = class extends FakeElement {};
    (globalThis as any).chrome = {
      runtime: {
        onMessage: {
          addListener: vi.fn((cb: OnMessageListener) => {
            listener = cb;
          }),
        },
      },
    };

    await import("../src/content/capture-dom");
  });

  it("responds to CAPTURE_PAGE with a snapshot", () => {
    expect(listener).toBeTruthy();
    const sendResponse = vi.fn();

    const keepOpen = listener!({ type: "CAPTURE_PAGE" }, {}, sendResponse);

    expect(keepOpen).toBe(true);
    expect(sendResponse).toHaveBeenCalled();
    const response = sendResponse.mock.calls[0][0];
    expect(response.type).toBe("CAPTURE_PAGE_RESULT");
    expect(response.payload.url).toBe("https://example.com/page");
    expect(response.payload.title).toBe("Sample Page");
    // New P0 fields
    expect(response.payload.readyState).toBe("complete");
    expect(response.payload.hasLoadingIndicators).toBe(false);
  });

  it("handles HIGHLIGHT_ELEMENT and CLEAR_HIGHLIGHT", () => {
    const target = new FakeElement("button");
    (globalThis as any).document.querySelector = vi.fn(() => target);

    const highlightResponse = vi.fn();
    const clearResponse = vi.fn();

    const highlightKeepOpen = listener!(
      { type: "HIGHLIGHT_ELEMENT", selector: "#btn" },
      {},
      highlightResponse,
    );
    const clearKeepOpen = listener!(
      { type: "CLEAR_HIGHLIGHT" },
      {},
      clearResponse,
    );

    expect(highlightKeepOpen).toBe(true);
    expect(clearKeepOpen).toBe(true);
    expect(highlightResponse).toHaveBeenCalledWith({ ok: true });
    expect(clearResponse).toHaveBeenCalledWith({ ok: true });
  });

  it("routes EXECUTE_ACTION through action-executor", async () => {
    const sendResponse = vi.fn();

    const keepOpen = listener!(
      { type: "EXECUTE_ACTION", step: { action: "click", selector: "#btn" } },
      {},
      sendResponse,
    );

    expect(keepOpen).toBe(true);
    await Promise.resolve();

    expect(executeActionMock).toHaveBeenCalledWith({
      action: "click",
      selector: "#btn",
    });
    expect(sendResponse).toHaveBeenCalledWith({
      type: "EXECUTE_ACTION_RESULT",
      result: {
        success: true,
        action: "click",
        selector: "#btn",
        durationMs: 10,
      },
    });
  });

  it("returns capture error payload when snapshot build throws", async () => {
    (globalThis as any).document.createTreeWalker = vi.fn(() => {
      throw new Error("DOM unavailable");
    });

    const sendResponse = vi.fn();
    listener!({ type: "CAPTURE_PAGE" }, {}, sendResponse);

    const response = sendResponse.mock.calls[0][0];
    expect(response.type).toBe("CAPTURE_PAGE_RESULT");
    expect(response.payload).toBeNull();
    expect(response.error).toBe("DOM unavailable");
  });
});
