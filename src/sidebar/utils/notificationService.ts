/**
 * notificationService.ts
 *
 * Sends a task-result notification request to the background service worker.
 * The background fires the actual chrome.notifications API call so it works
 * even if the side panel is closed or blurred.
 *
 * Only fires the notification when the side panel is not currently focused,
 * to avoid noisy alerts while the user is actively watching.
 */

export function requestTaskNotification(title: string, message: string): void {
  // Don't notify if the user is already looking at the panel
  if (document.visibilityState === "visible") return;

  chrome.runtime
    .sendMessage({
      type: "SHOW_NOTIFICATION",
      title,
      message,
    })
    .catch(() => {
      // Panel may have been unloaded — background will still handle it
    });
}
