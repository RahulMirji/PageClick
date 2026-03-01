/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import SearchBox from "../src/sidebar/components/SearchBox";

describe("SearchBox DOM interactions", () => {
  it("sends message on Enter", () => {
    const onSend = vi.fn();
    const onModelChange = vi.fn();

    render(
      <SearchBox
        onSend={onSend}
        isLoading={false}
        selectedModel="gemini-3-pro"
        onModelChange={onModelChange}
      />,
    );

    const input = screen.getByPlaceholderText("Ask anything...");
    fireEvent.change(input, { target: { value: "Hello world" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSend).toHaveBeenCalledWith("Hello world", undefined);
  });

  it("changes model from dropdown", () => {
    const onSend = vi.fn();
    const onModelChange = vi.fn();

    render(
      <SearchBox
        onSend={onSend}
        isLoading={false}
        selectedModel="gemini-3-pro"
        onModelChange={onModelChange}
      />,
    );

    fireEvent.click(screen.getByText("Gemini 3 Flash"));
    fireEvent.click(screen.getByText("GPT-OSS"));

    expect(onModelChange).toHaveBeenCalledWith("gpt-oss-120b");
  });

  it("calls onStop when loading and submit button is clicked", () => {
    const onSend = vi.fn();
    const onStop = vi.fn();
    const onModelChange = vi.fn();

    render(
      <SearchBox
        onSend={onSend}
        onStop={onStop}
        isLoading={true}
        selectedModel="gemini-3-pro"
        onModelChange={onModelChange}
      />,
    );

    fireEvent.click(screen.getByLabelText("Stop"));

    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
  });
});
