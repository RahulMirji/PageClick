import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestTaskNotification } from "../src/sidebar/utils/notificationService";

describe("notificationService requestTaskNotification", () => {
  const sendMessage = vi.fn().mockResolvedValue({ ok: true });

  beforeEach(() => {
    sendMessage.mockClear();
    (globalThis as any).chrome = {
      runtime: {
        sendMessage,
      },
    };
  });

  it("does not notify when panel is visible", () => {
    (globalThis as any).document = { visibilityState: "visible" };

    requestTaskNotification("Done", "Task completed");

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("notifies background when panel is hidden", () => {
    (globalThis as any).document = { visibilityState: "hidden" };

    requestTaskNotification("Done", "Task completed");

    expect(sendMessage).toHaveBeenCalledWith({
      type: "SHOW_NOTIFICATION",
      title: "Done",
      message: "Task completed",
    });
  });
});
