/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const { storeMocks } = vi.hoisted(() => ({
  storeMocks: {
    listConversations: vi.fn(),
    deleteConversation: vi.fn(),
    loadMessages: vi.fn(),
    downloadText: vi.fn(),
    formatConversationAsMarkdown: vi.fn(() => "# Export"),
  },
}));

vi.mock("../src/sidebar/utils/conversationStore", () => ({
  listConversations: storeMocks.listConversations,
  deleteConversation: storeMocks.deleteConversation,
  loadMessages: storeMocks.loadMessages,
}));

vi.mock("../src/sidebar/utils/downloadService", () => ({
  downloadText: storeMocks.downloadText,
  formatConversationAsMarkdown: storeMocks.formatConversationAsMarkdown,
}));

import HistoryView from "../src/sidebar/components/HistoryView";

describe("HistoryView DOM interactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeMocks.listConversations.mockResolvedValue([
      {
        id: "c1",
        title: "My first chat",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);
    storeMocks.loadMessages.mockResolvedValue([
      { role: "assistant", content: "Hello" },
    ]);
  });

  it("selects a conversation when history item is clicked", async () => {
    const onSelectConversation = vi.fn();

    render(
      <HistoryView
        onSelectConversation={onSelectConversation}
        onNewChat={vi.fn()}
        currentConversationId={null}
      />,
    );

    const item = await screen.findByText("My first chat");
    fireEvent.click(item);

    expect(onSelectConversation).toHaveBeenCalledWith("c1");
  });

  it("deletes a conversation via delete button", async () => {
    render(
      <HistoryView
        onSelectConversation={vi.fn()}
        onNewChat={vi.fn()}
        currentConversationId={null}
      />,
    );

    const delBtn = await screen.findByLabelText("Delete conversation");
    fireEvent.click(delBtn);

    await waitFor(() => {
      expect(storeMocks.deleteConversation).toHaveBeenCalledWith("c1");
    });
  });

  it("exports a conversation as markdown", async () => {
    render(
      <HistoryView
        onSelectConversation={vi.fn()}
        onNewChat={vi.fn()}
        currentConversationId={null}
      />,
    );

    const exportBtn = await screen.findByLabelText("Export conversation");
    fireEvent.click(exportBtn);

    await waitFor(() => {
      expect(storeMocks.loadMessages).toHaveBeenCalledWith("c1");
      expect(storeMocks.downloadText).toHaveBeenCalled();
    });
  });
});
