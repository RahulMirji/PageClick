import { beforeEach, describe, expect, it, vi } from "vitest";
import { downloadUrl } from "../src/sidebar/utils/downloadService";

describe("downloadService downloadUrl", () => {
  const sendMessage = vi.fn();

  beforeEach(() => {
    sendMessage.mockReset();
    (globalThis as any).chrome = {
      runtime: {
        sendMessage,
      },
    };
  });

  it("returns background response on success", async () => {
    sendMessage.mockResolvedValue({ ok: true, downloadId: 99 });

    const result = await downloadUrl(
      "https://example.com/file.pdf",
      "file.pdf",
      true,
    );

    expect(sendMessage).toHaveBeenCalledWith({
      type: "DOWNLOAD_FILE",
      url: "https://example.com/file.pdf",
      filename: "file.pdf",
      saveAs: true,
    });
    expect(result).toEqual({ ok: true, downloadId: 99 });
  });

  it("returns normalized error when sendMessage throws", async () => {
    sendMessage.mockRejectedValue(new Error("Bridge failed"));

    const result = await downloadUrl("https://example.com/file.pdf");

    expect(result).toEqual({ ok: false, error: "Bridge failed" });
  });
});
