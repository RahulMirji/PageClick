/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("../src/sidebar/utils/downloadService", () => ({
  downloadText: vi.fn(),
}));

import ChatView from "../src/sidebar/components/ChatView";
import { downloadText } from "../src/sidebar/utils/downloadService";

describe("ChatView DOM interactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (HTMLElement.prototype as any).scrollIntoView = vi.fn();
    Object.defineProperty(globalThis, "navigator", {
      value: {
        clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
        share: vi.fn().mockResolvedValue(undefined),
      },
      configurable: true,
    });
  });

  it("renders cleaned assistant content and token count", () => {
    render(
      <ChatView
        isLoading={false}
        messages={[
          {
            role: "assistant",
            content:
              'Intro\n<<<ACTION_PLAN>>> {"actions":[]} <<<END_ACTION_PLAN>>>\nDone',
            tokenCount: 120,
          },
        ]}
      />,
    );

    expect(screen.getByText("Intro")).toBeTruthy();
    expect(screen.getByText("Done")).toBeTruthy();
    expect(screen.queryByText("<<<ACTION_PLAN>>>")).toBeNull();
    expect(screen.getByText("~120 tokens")).toBeTruthy();
  });

  it("copies cleaned markdown on Copy click", async () => {
    render(
      <ChatView
        isLoading={false}
        messages={[
          {
            role: "assistant",
            content:
              '**Bold**\n<<<TASK_COMPLETE>>> {"summary":"ok","nextSteps":[]} <<<END_TASK_COMPLETE>>>',
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByLabelText("Copy"));

    expect((navigator as any).clipboard.writeText).toHaveBeenCalledWith("Bold");
  });

  it("downloads assistant message as markdown text", () => {
    render(
      <ChatView
        isLoading={false}
        messages={[{ role: "assistant", content: "Download me" }]}
      />,
    );

    fireEvent.click(screen.getByLabelText("Download message"));

    expect(downloadText).toHaveBeenCalled();
    expect((downloadText as any).mock.calls[0][0]).toContain("Download me");
  });
});
