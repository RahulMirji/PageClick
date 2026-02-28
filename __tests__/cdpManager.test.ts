import { beforeEach, describe, expect, it, vi } from "vitest";

type Listener<T extends (...args: any[]) => any> = T;

function createChromeMock(options?: {
  tabUrl?: string;
  sendCommandImpl?: (method: string, _params: any) => any;
}) {
  const eventListeners: Array<Listener<any>> = [];
  const detachListeners: Array<Listener<any>> = [];

  const chromeMock: any = {
    runtime: {
      lastError: null,
    },
    tabs: {
      get: vi.fn(async () => ({
        id: 1,
        url: options?.tabUrl ?? "https://example.com",
      })),
    },
    debugger: {
      onEvent: {
        addListener: vi.fn((cb: Listener<any>) => eventListeners.push(cb)),
      },
      onDetach: {
        addListener: vi.fn((cb: Listener<any>) => detachListeners.push(cb)),
      },
      attach: vi.fn((_target: any, _version: string, cb: () => void) => cb()),
      detach: vi.fn((_target: any, cb: () => void) => cb()),
      sendCommand: vi.fn(
        (
          _target: any,
          method: string,
          params: any,
          cb: (result: any) => void,
        ) => {
          const result = options?.sendCommandImpl
            ? options.sendCommandImpl(method, params)
            : {};
          cb(result);
        },
      ),
    },
    __listeners: {
      eventListeners,
      detachListeners,
    },
  };

  return chromeMock;
}

describe("cdpManager", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns detached snapshot by default", async () => {
    (globalThis as any).chrome = createChromeMock();

    const { cdpManager } = await import("../src/background/cdpManager");
    const snapshot = cdpManager.getSnapshot(1);

    expect(snapshot.attached).toBe(false);
    expect(snapshot.networkLog).toEqual([]);
    expect(snapshot.consoleLog).toEqual([]);
    expect(snapshot.jsErrors).toEqual([]);
  });

  it("rejects attach on restricted URLs", async () => {
    (globalThis as any).chrome = createChromeMock({
      tabUrl: "chrome://settings",
    });

    const { cdpManager } = await import("../src/background/cdpManager");
    const result = await cdpManager.attach(1);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Cannot attach to restricted page");
  });

  it("attaches, evaluates JS, and detaches successfully", async () => {
    (globalThis as any).chrome = createChromeMock({
      sendCommandImpl: (method) => {
        if (method === "Runtime.evaluate") {
          return { result: { value: { ok: true } } };
        }
        return {};
      },
    });

    const { cdpManager } = await import("../src/background/cdpManager");

    const attach = await cdpManager.attach(1);
    expect(attach).toEqual({ ok: true });

    const snapAfterAttach = cdpManager.getSnapshot(1);
    expect(snapAfterAttach.attached).toBe(true);

    const evalResult = await cdpManager.evalJs(1, "({ ok: true })");
    expect(evalResult.result).toBe('{"ok":true}');

    await cdpManager.detach(1);

    const snapAfterDetach = cdpManager.getSnapshot(1);
    expect(snapAfterDetach.attached).toBe(false);
  });

  it("returns error when evaluating without debugger attach", async () => {
    (globalThis as any).chrome = createChromeMock();

    const { cdpManager } = await import("../src/background/cdpManager");
    const evalResult = await cdpManager.evalJs(999, "1+1");

    expect(evalResult.error).toBe("Debugger not attached");
  });
});
