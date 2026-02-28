import { beforeEach, describe, expect, it, vi } from "vitest";

const { cdpManagerMock } = vi.hoisted(() => ({
  cdpManagerMock: {
    attach: vi.fn(async () => ({ ok: true })),
    detach: vi.fn(async () => {}),
    getSnapshot: vi.fn(() => ({
      attached: true,
      networkLog: [
        {
          requestId: "1",
          url: "https://api.example.com",
          method: "GET",
          timestamp: Date.now(),
        },
      ],
      consoleLog: [],
      jsErrors: [],
      capturedAt: Date.now(),
    })),
    evalJs: vi.fn(async () => ({ result: "42" })),
  },
}));

vi.mock("../src/background/cdpManager", () => ({
  cdpManager: cdpManagerMock,
}));

type OnMessageListener = (
  message: any,
  sender: any,
  sendResponse: (response: any) => void,
) => any;

function createChromeMock() {
  let onMessageListener: OnMessageListener | null = null;
  let onRemovedListener: ((tabId: number) => void) | null = null;
  let onUpdatedListener: ((tabId: number, changeInfo: any) => void) | null =
    null;

  const state = {
    activeTabs: [
      {
        id: 1,
        url: "https://example.com",
        title: "Example",
        status: "complete",
      },
    ],
    allTabs: [
      {
        id: 1,
        url: "https://example.com",
        title: "Example",
        status: "complete",
        groupId: -1,
      },
    ],
    downloadError: "",
    nativeError: "",
    sentToTabResponse: { ok: true },
    tabGroups: [] as Array<{
      id: number;
      title?: string;
      color?: string;
      collapsed?: boolean;
    }>,
  };

  const chromeMock: any = {
    runtime: {
      lastError: null,
      onMessage: {
        addListener: vi.fn((cb: OnMessageListener) => {
          onMessageListener = cb;
        }),
      },
      sendNativeMessage: vi.fn(
        (_host: string, _payload: any, cb: (response: any) => void) => {
          if (state.nativeError) {
            chromeMock.runtime.lastError = { message: state.nativeError };
            cb(undefined);
            chromeMock.runtime.lastError = null;
            return;
          }
          cb({ ok: true, data: "native-ok" });
        },
      ),
    },
    notifications: {
      onClicked: {
        addListener: vi.fn(),
      },
      create: vi.fn(),
    },
    windows: {
      getCurrent: vi.fn((cb: (w: { id: number }) => void) => cb({ id: 7 })),
    },
    sidePanel: {
      setPanelBehavior: vi.fn(() => Promise.resolve()),
      open: vi.fn(() => Promise.resolve()),
    },
    downloads: {
      download: vi.fn((_opts: any, cb: (id?: number) => void) => {
        if (state.downloadError) {
          chromeMock.runtime.lastError = { message: state.downloadError };
          cb(undefined);
          chromeMock.runtime.lastError = null;
          return;
        }
        cb(123);
      }),
    },
    scripting: {
      executeScript: vi.fn(async () => {}),
    },
    tabs: {
      query: vi.fn((queryInfo: any, cb?: (tabs: any[]) => void) => {
        const result = queryInfo?.active ? state.activeTabs : state.allTabs;
        if (typeof cb === "function") {
          cb(result);
          return;
        }
        return Promise.resolve(result);
      }),
      sendMessage: vi.fn(async () => state.sentToTabResponse),
      update: vi.fn(async (_tabId: number, _opts: any) => ({})),
      group: vi.fn(async () => 999),
      onUpdated: {
        addListener: vi.fn((cb: (tabId: number, changeInfo: any) => void) => {
          onUpdatedListener = cb;
        }),
        removeListener: vi.fn(),
      },
      onRemoved: {
        addListener: vi.fn((cb: (tabId: number) => void) => {
          onRemovedListener = cb;
        }),
      },
    },
    tabGroups: {
      query: vi.fn(async (query: any) => {
        if (query?.title)
          return state.tabGroups.filter((g) => g.title === query.title);
        return state.tabGroups;
      }),
      update: vi.fn(async () => ({})),
    },
  };

  return {
    chromeMock,
    state,
    getOnMessageListener: () => onMessageListener,
    triggerTabRemoved: (tabId: number) => onRemovedListener?.(tabId),
    triggerTabUpdated: (tabId: number, changeInfo: any) =>
      onUpdatedListener?.(tabId, changeInfo),
  };
}

async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("background message router", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("registers side panel behavior and message listener on load", async () => {
    const { chromeMock, getOnMessageListener } = createChromeMock();
    (globalThis as any).chrome = chromeMock;

    await import("../src/background");

    expect(chromeMock.sidePanel.setPanelBehavior).toHaveBeenCalledWith({
      openPanelOnActionClick: true,
    });
    expect(getOnMessageListener()).toBeTypeOf("function");
  });

  it("handles SHOW_NOTIFICATION", async () => {
    const { chromeMock, getOnMessageListener } = createChromeMock();
    (globalThis as any).chrome = chromeMock;
    await import("../src/background");

    const sendResponse = vi.fn();
    const keepOpen = getOnMessageListener()!(
      { type: "SHOW_NOTIFICATION", title: "Done", message: "Task complete" },
      {},
      sendResponse,
    );

    expect(keepOpen).toBe(true);
    expect(chromeMock.notifications.create).toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
  });

  it("handles DOWNLOAD_FILE success and failure", async () => {
    const ctx = createChromeMock();
    (globalThis as any).chrome = ctx.chromeMock;
    await import("../src/background");

    const sendOk = vi.fn();
    ctx.getOnMessageListener()!(
      { type: "DOWNLOAD_FILE", url: "https://example.com/file.pdf" },
      {},
      sendOk,
    );
    expect(sendOk).toHaveBeenCalledWith({ ok: true, downloadId: 123 });

    ctx.state.downloadError = "Download failed";
    const sendErr = vi.fn();
    ctx.getOnMessageListener()!(
      { type: "DOWNLOAD_FILE", url: "https://example.com/file.pdf" },
      {},
      sendErr,
    );
    expect(sendErr).toHaveBeenCalledWith({
      ok: false,
      error: "Download failed",
    });
  });

  it("handles CAPTURE_PAGE on restricted URL without script injection", async () => {
    const ctx = createChromeMock();
    ctx.state.activeTabs = [
      {
        id: 1,
        url: "chrome://extensions",
        title: "Extensions",
        status: "complete",
      },
    ];
    (globalThis as any).chrome = ctx.chromeMock;
    await import("../src/background");

    const sendResponse = vi.fn();
    const keepOpen = ctx.getOnMessageListener()!(
      { type: "CAPTURE_PAGE" },
      {},
      sendResponse,
    );
    expect(keepOpen).toBe(true);

    await flushAsync();

    expect(ctx.chromeMock.scripting.executeScript).not.toHaveBeenCalled();
    const response = sendResponse.mock.calls[0][0];
    expect(response.type).toBe("CAPTURE_PAGE_RESULT");
    expect(response.payload.url).toBe("chrome://extensions");
    expect(response.payload.nodes).toEqual([]);
  });

  it("routes EXECUTE_ACTION navigate through background URL normalization", async () => {
    const ctx = createChromeMock();
    (globalThis as any).chrome = ctx.chromeMock;
    await import("../src/background");

    const sendResponse = vi.fn();
    const keepOpen = ctx.getOnMessageListener()!(
      {
        type: "EXECUTE_ACTION",
        step: { action: "navigate", selector: "", value: "example.org/path" },
      },
      {},
      sendResponse,
    );
    expect(keepOpen).toBe(true);

    await flushAsync();

    expect(ctx.chromeMock.tabs.update).toHaveBeenCalledWith(1, {
      url: "https://example.org/path",
    });
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "EXECUTE_ACTION_RESULT",
        result: expect.objectContaining({ success: true, action: "navigate" }),
      }),
    );
  });

  it("handles debugger messages (attach/snapshot/eval)", async () => {
    const ctx = createChromeMock();
    (globalThis as any).chrome = ctx.chromeMock;
    await import("../src/background");

    const attachResponse = vi.fn();
    ctx.getOnMessageListener()!(
      { type: "ATTACH_DEBUGGER" },
      {},
      attachResponse,
    );
    await flushAsync();
    expect(cdpManagerMock.attach).toHaveBeenCalledWith(1);
    expect(attachResponse).toHaveBeenCalledWith({ ok: true });

    const snapshotResponse = vi.fn();
    ctx.getOnMessageListener()!(
      { type: "GET_CDP_SNAPSHOT" },
      {},
      snapshotResponse,
    );
    expect(cdpManagerMock.getSnapshot).toHaveBeenCalledWith(1);
    expect(snapshotResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "CDP_SNAPSHOT_RESULT",
      }),
    );

    const evalResponse = vi.fn();
    ctx.getOnMessageListener()!(
      { type: "EVAL_JS", expression: "6*7" },
      {},
      evalResponse,
    );
    await flushAsync();
    expect(cdpManagerMock.evalJs).toHaveBeenCalledWith(1, "6*7");
    expect(evalResponse).toHaveBeenCalledWith({
      type: "EVAL_JS_RESULT",
      result: "42",
    });
  });

  it("detaches debugger when tab is removed", async () => {
    const ctx = createChromeMock();
    (globalThis as any).chrome = ctx.chromeMock;
    await import("../src/background");

    ctx.triggerTabRemoved(999);
    await flushAsync();

    expect(cdpManagerMock.detach).toHaveBeenCalledWith(999);
  });

  it("handles NATIVE_HOST_CALL success and runtime error", async () => {
    const ctx = createChromeMock();
    (globalThis as any).chrome = ctx.chromeMock;
    await import("../src/background");

    const okResponse = vi.fn();
    ctx.getOnMessageListener()!(
      { type: "NATIVE_HOST_CALL", payload: { op: "clipboard.read" } },
      {},
      okResponse,
    );
    expect(okResponse).toHaveBeenCalledWith({ ok: true, data: "native-ok" });

    ctx.state.nativeError = "Native host unavailable";
    const errResponse = vi.fn();
    ctx.getOnMessageListener()!(
      { type: "NATIVE_HOST_CALL", payload: { op: "clipboard.read" } },
      {},
      errResponse,
    );
    expect(errResponse).toHaveBeenCalledWith({
      ok: false,
      error: "Native host unavailable",
    });
  });

  it("handles TAB_GROUP_CREATE for matching tabs and no-match error", async () => {
    const ctx = createChromeMock();
    ctx.state.allTabs = [
      {
        id: 1,
        title: "GitHub",
        url: "https://github.com/org/repo",
        groupId: -1,
      },
      { id: 2, title: "Docs", url: "https://docs.example.com", groupId: -1 },
    ];
    (globalThis as any).chrome = ctx.chromeMock;
    await import("../src/background");

    const okResponse = vi.fn();
    ctx.getOnMessageListener()!(
      {
        type: "TAB_GROUP_CREATE",
        title: "Work",
        color: "blue",
        urls: ["*github.com*"],
        collapsed: false,
      },
      {},
      okResponse,
    );
    await flushAsync();
    expect(ctx.chromeMock.tabs.group).toHaveBeenCalledWith({ tabIds: [1] });
    expect(okResponse).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true }),
    );

    const noMatchResponse = vi.fn();
    ctx.getOnMessageListener()!(
      {
        type: "TAB_GROUP_CREATE",
        title: "None",
        color: "blue",
        urls: ["*no-match.example*"],
      },
      {},
      noMatchResponse,
    );
    await flushAsync();
    expect(noMatchResponse).toHaveBeenCalledWith({
      ok: false,
      error: "No tabs matched the given URL patterns",
    });
  });

  it("handles WAIT_FOR_PAGE_LOAD immediate complete path", async () => {
    vi.useFakeTimers();
    const ctx = createChromeMock();
    ctx.state.activeTabs = [
      {
        id: 1,
        url: "https://example.com/loaded",
        title: "Loaded",
        status: "complete",
      },
    ];
    (globalThis as any).chrome = ctx.chromeMock;
    await import("../src/background");

    const sendResponse = vi.fn();
    const keepOpen = ctx.getOnMessageListener()!(
      { type: "WAIT_FOR_PAGE_LOAD", timeoutMs: 5000 },
      {},
      sendResponse,
    );
    expect(keepOpen).toBe(true);
    await vi.advanceTimersByTimeAsync(801);

    expect(sendResponse).toHaveBeenCalledWith({
      type: "WAIT_FOR_PAGE_LOAD_RESULT",
      success: true,
      url: "https://example.com/loaded",
    });
    vi.useRealTimers();
  });

  it("returns execute-action error on restricted page for non-navigate actions", async () => {
    const ctx = createChromeMock();
    ctx.state.activeTabs = [
      {
        id: 1,
        url: "chrome://settings",
        title: "Settings",
        status: "complete",
      },
    ];
    (globalThis as any).chrome = ctx.chromeMock;
    await import("../src/background");

    const sendResponse = vi.fn();
    ctx.getOnMessageListener()!(
      { type: "EXECUTE_ACTION", step: { action: "click", selector: "#btn" } },
      {},
      sendResponse,
    );
    await flushAsync();
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "EXECUTE_ACTION_RESULT",
        result: expect.objectContaining({ success: false, action: "click" }),
      }),
    );
  });

  it("handles TAB_GROUP_ADD for existing group and matching tabs", async () => {
    const ctx = createChromeMock();
    ctx.state.tabGroups = [
      { id: 77, title: "Work", color: "blue", collapsed: false },
    ];
    ctx.state.allTabs = [
      {
        id: 1,
        title: "GitHub PR",
        url: "https://github.com/org/repo/pull/1",
        groupId: -1,
      },
      {
        id: 2,
        title: "Jira",
        url: "https://jira.example.com/T-1",
        groupId: -1,
      },
      {
        id: 3,
        title: "Already Grouped",
        url: "https://github.com/grouped",
        groupId: 77,
      },
    ];
    (globalThis as any).chrome = ctx.chromeMock;
    await import("../src/background");

    const sendResponse = vi.fn();
    ctx.getOnMessageListener()!(
      { type: "TAB_GROUP_ADD", title: "Work", urls: ["*github.com*"] },
      {},
      sendResponse,
    );
    await flushAsync();

    expect(ctx.chromeMock.tabs.group).toHaveBeenCalledWith({
      tabIds: [1],
      groupId: 77,
    });
    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      groupId: 77,
      addedCount: 1,
    });
  });

  it("returns TAB_GROUP_ADD error when group does not exist", async () => {
    const ctx = createChromeMock();
    ctx.state.tabGroups = [];
    (globalThis as any).chrome = ctx.chromeMock;
    await import("../src/background");

    const sendResponse = vi.fn();
    ctx.getOnMessageListener()!(
      { type: "TAB_GROUP_ADD", title: "Missing", urls: ["*github.com*"] },
      {},
      sendResponse,
    );
    await flushAsync();

    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      error: 'No tab group found with title "Missing"',
    });
  });

  it("handles TAB_GROUP_LIST with tab counts and tab metadata", async () => {
    const ctx = createChromeMock();
    ctx.state.tabGroups = [
      { id: 10, title: "Group A", color: "blue", collapsed: false },
      { id: 11, title: "Group B", color: "green", collapsed: true },
    ];
    ctx.state.allTabs = [
      { id: 1, title: "A1", url: "https://a1.example.com", groupId: 10 },
      { id: 2, title: "A2", url: "https://a2.example.com", groupId: 10 },
      { id: 3, title: "B1", url: "https://b1.example.com", groupId: 11 },
    ];
    (globalThis as any).chrome = ctx.chromeMock;
    await import("../src/background");

    const sendResponse = vi.fn();
    ctx.getOnMessageListener()!({ type: "TAB_GROUP_LIST" }, {}, sendResponse);
    await flushAsync();

    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      groups: [
        expect.objectContaining({ id: 10, title: "Group A", tabCount: 2 }),
        expect.objectContaining({ id: 11, title: "Group B", tabCount: 1 }),
      ],
    });
  });

  it("handles WAIT_FOR_PAGE_LOAD via onUpdated completion path", async () => {
    vi.useFakeTimers();
    const ctx = createChromeMock();
    ctx.state.activeTabs = [
      {
        id: 5,
        url: "https://example.com/loading",
        title: "Loading",
        status: "loading",
      },
    ];
    (globalThis as any).chrome = ctx.chromeMock;
    await import("../src/background");

    const sendResponse = vi.fn();
    ctx.getOnMessageListener()!(
      { type: "WAIT_FOR_PAGE_LOAD", timeoutMs: 5000 },
      {},
      sendResponse,
    );
    await flushAsync();
    ctx.state.activeTabs = [
      {
        id: 5,
        url: "https://example.com/loaded",
        title: "Loaded",
        status: "complete",
      },
    ];
    ctx.triggerTabUpdated(5, { status: "complete" });
    await vi.advanceTimersByTimeAsync(801);
    await flushAsync();

    expect(sendResponse).toHaveBeenCalledWith({
      type: "WAIT_FOR_PAGE_LOAD_RESULT",
      success: true,
      url: "https://example.com/loaded",
    });
    vi.useRealTimers();
  });

  it("handles WAIT_FOR_PAGE_LOAD timeout fallback path", async () => {
    vi.useFakeTimers();
    const ctx = createChromeMock();
    ctx.state.activeTabs = [
      {
        id: 9,
        url: "https://example.com/slow",
        title: "Slow",
        status: "loading",
      },
    ];
    (globalThis as any).chrome = ctx.chromeMock;
    await import("../src/background");

    const sendResponse = vi.fn();
    ctx.getOnMessageListener()!(
      { type: "WAIT_FOR_PAGE_LOAD", timeoutMs: 1200 },
      {},
      sendResponse,
    );
    await vi.advanceTimersByTimeAsync(1201);

    expect(sendResponse).toHaveBeenCalledWith({
      type: "WAIT_FOR_PAGE_LOAD_RESULT",
      success: true,
      url: "https://example.com/slow",
    });
    vi.useRealTimers();
  });
});
