/// <reference types="chrome" />

/**
 * Background service worker — message routing hub.
 *
 * Routes messages between the sidebar (side panel) and content scripts.
 * Also handles side panel behavior.
 */

// Open side panel on extension icon click
chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: Error) => console.error(error));

// ── Message router ────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
    (message, _sender, sendResponse) => {
        console.log('%c[PageClick:BG] Message received:', 'color: #a78bfa; font-weight: bold', message.type, message)

        // Route CAPTURE_PAGE from sidebar → content script in active tab
        if (message.type === 'CAPTURE_PAGE') {
            handleCapturePage(message, sendResponse)
            return true // keep channel open
        }

        // EXECUTE_ACTION — handle navigate in background, forward others to content script
        if (message.type === 'EXECUTE_ACTION') {
            const step = message.step
            console.log('%c[PageClick:BG] EXECUTE_ACTION:', 'color: #a78bfa', { action: step.action, selector: step.selector, value: step.value })
            if (step.action === 'navigate') {
                console.log('%c[PageClick:BG] Routing navigate to background handler', 'color: #a78bfa')
                handleNavigateAction(step, sendResponse)
            } else {
                console.log('%c[PageClick:BG] Forwarding to content script', 'color: #a78bfa')
                forwardToActiveTab(message, sendResponse)
            }
            return true
        }

        // Route HIGHLIGHT_ELEMENT / CLEAR_HIGHLIGHT → content script
        if (message.type === 'HIGHLIGHT_ELEMENT' || message.type === 'CLEAR_HIGHLIGHT') {
            forwardToActiveTab(message, sendResponse)
            return true
        }

        // WAIT_FOR_PAGE_LOAD — wait for the active tab to finish loading
        if (message.type === 'WAIT_FOR_PAGE_LOAD') {
            handleWaitForPageLoad(message.timeoutMs || 10000, sendResponse)
            return true
        }
    }
)

async function handleCapturePage(
    _message: any,
    sendResponse: (response: any) => void
) {
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
        const tab = tabs[0]

        if (!tab?.id) {
            sendResponse({
                type: 'CAPTURE_PAGE_RESULT',
                payload: null,
                error: 'No active tab found',
            })
            return
        }

        const url = tab.url || ''
        const isRestricted =
            url.startsWith('chrome://') ||
            url.startsWith('chrome-extension://') ||
            url.startsWith('about:') ||
            url.startsWith('edge://') ||
            url.startsWith('brave://')

        if (isRestricted) {
            // Can't inject content scripts on restricted pages
            sendResponse({
                type: 'CAPTURE_PAGE_RESULT',
                payload: {
                    url,
                    title: tab.title || '',
                    description: '',
                    nodes: [],
                    textContent: '',
                    capturedAt: Date.now(),
                },
            })
            return
        }

        // Ensure content script is injected (idempotent via try/catch)
        try {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['content.js'],
            })
        } catch {
            // Script might already be injected — that's fine
        }

        // Send message to content script
        const response = await chrome.tabs.sendMessage(tab.id, { type: 'CAPTURE_PAGE' })
        sendResponse(response)
    } catch (err: any) {
        console.error('Background: CAPTURE_PAGE failed:', err)
        sendResponse({
            type: 'CAPTURE_PAGE_RESULT',
            payload: null,
            error: err.message || 'Capture failed',
        })
    }
}

async function forwardToActiveTab(
    message: any,
    sendResponse: (response: any) => void
) {
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
        const tab = tabs[0]
        console.log('%c[PageClick:BG] forwardToActiveTab:', 'color: #a78bfa', { tabId: tab?.id, tabUrl: tab?.url, messageType: message.type })
        if (!tab?.id) {
            console.warn('%c[PageClick:BG] No active tab found!', 'color: #ef4444')
            sendResponse({ ok: false, error: 'No active tab' })
            return
        }

        // Ensure content script is injected before forwarding
        const url = tab.url || ''
        const isRestricted =
            url.startsWith('chrome://') ||
            url.startsWith('chrome-extension://') ||
            url.startsWith('about:') ||
            url.startsWith('edge://') ||
            url.startsWith('brave://')

        if (isRestricted) {
            // On restricted pages, silently ignore non-critical messages (highlight/clear)
            if (message.type !== 'EXECUTE_ACTION') {
                sendResponse({ ok: true })
                return
            }
            console.warn('%c[PageClick:BG] BLOCKED: Cannot execute on restricted page:', 'color: #ef4444', url)
            sendResponse({
                type: 'EXECUTE_ACTION_RESULT',
                result: {
                    success: false,
                    action: message.step?.action || 'unknown',
                    selector: message.step?.selector || '',
                    error: 'Cannot execute actions on this page. Try navigating to a regular webpage first.',
                    durationMs: 0,
                },
            })
            return
        }

        if (!isRestricted) {
            console.log('%c[PageClick:BG] Injecting content script...', 'color: #a78bfa')
            try {
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['content.js'],
                })
                console.log('%c[PageClick:BG] Content script injected (or already present)', 'color: #a78bfa')
            } catch (injectErr) {
                console.warn('%c[PageClick:BG] Content script injection failed:', 'color: #f59e0b', injectErr)
            }
        }

        console.log('%c[PageClick:BG] Sending to tab:', 'color: #a78bfa', tab.id, message)
        const response = await chrome.tabs.sendMessage(tab.id, message)
        console.log('%c[PageClick:BG] Response from tab:', 'color: #a78bfa', response)
        sendResponse(response)
    } catch (err: any) {
        console.error('%c[PageClick:BG] forwardToActiveTab FAILED:', 'color: #ef4444; font-weight: bold', err)
        sendResponse({ ok: false, error: err.message })
    }
}

async function handleNavigateAction(
    step: any,
    sendResponse: (response: any) => void
) {
    const start = Date.now()
    console.log('%c[PageClick:BG] handleNavigateAction called:', 'color: #60a5fa; font-weight: bold', step)
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
        const tab = tabs[0]
        if (!tab?.id) {
            console.warn('%c[PageClick:BG] Navigate: No active tab!', 'color: #ef4444')
            sendResponse({
                type: 'EXECUTE_ACTION_RESULT',
                result: {
                    success: false, action: 'navigate', selector: step.selector || '',
                    error: 'No active tab', durationMs: Date.now() - start,
                },
            })
            return
        }

        // Determine the URL to navigate to
        const targetUrl = step.value || step.selector || ''
        console.log('%c[PageClick:BG] Navigate target URL raw:', 'color: #60a5fa', targetUrl)
        if (!targetUrl) {
            console.warn('%c[PageClick:BG] Navigate: No URL provided!', 'color: #ef4444')
            sendResponse({
                type: 'EXECUTE_ACTION_RESULT',
                result: {
                    success: false, action: 'navigate', selector: '',
                    error: 'No URL provided for navigation', durationMs: Date.now() - start,
                },
            })
            return
        }

        // Normalize URL — add https:// if no protocol
        let url = targetUrl
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url
        }

        console.log('%c[PageClick:BG] Navigating tab', 'color: #60a5fa; font-weight: bold', { tabId: tab.id, from: tab.url, to: url })
        // Navigate using chrome.tabs.update (works from any page, including chrome://)
        await chrome.tabs.update(tab.id, { url })

        console.log('%c[PageClick:BG] Navigate SUCCESS in', 'color: #34d399; font-weight: bold', `${Date.now() - start}ms`)
        sendResponse({
            type: 'EXECUTE_ACTION_RESULT',
            result: {
                success: true, action: 'navigate', selector: step.selector || '',
                durationMs: Date.now() - start,
            },
        })
    } catch (err: any) {
        console.error('%c[PageClick:BG] Navigate FAILED:', 'color: #ef4444; font-weight: bold', err)
        sendResponse({
            type: 'EXECUTE_ACTION_RESULT',
            result: {
                success: false, action: 'navigate', selector: step.selector || '',
                error: err.message || 'Navigation failed', durationMs: Date.now() - start,
            },
        })
    }
}

async function handleWaitForPageLoad(
    timeoutMs: number,
    sendResponse: (response: any) => void
) {
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
        const tab = tabs[0]
        if (!tab?.id) {
            sendResponse({ type: 'WAIT_FOR_PAGE_LOAD_RESULT', success: false, error: 'No active tab' })
            return
        }

        // If already loaded, return immediately
        if (tab.status === 'complete') {
            // Wait a brief moment for any JS frameworks to initialize
            setTimeout(() => {
                sendResponse({
                    type: 'WAIT_FOR_PAGE_LOAD_RESULT',
                    success: true,
                    url: tab.url,
                })
            }, 800)
            return
        }

        // Otherwise, listen for the tab to finish loading
        let resolved = false

        const onUpdated = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
            if (tabId === tab.id && changeInfo.status === 'complete' && !resolved) {
                resolved = true
                chrome.tabs.onUpdated.removeListener(onUpdated)
                // Again, brief wait for JS initialization
                setTimeout(async () => {
                    const updatedTabs = await chrome.tabs.query({ active: true, currentWindow: true })
                    sendResponse({
                        type: 'WAIT_FOR_PAGE_LOAD_RESULT',
                        success: true,
                        url: updatedTabs[0]?.url,
                    })
                }, 800)
            }
        }

        chrome.tabs.onUpdated.addListener(onUpdated)

        // Timeout fallback
        setTimeout(() => {
            if (!resolved) {
                resolved = true
                chrome.tabs.onUpdated.removeListener(onUpdated)
                sendResponse({
                    type: 'WAIT_FOR_PAGE_LOAD_RESULT',
                    success: true,
                    url: tab.url,
                })
            }
        }, timeoutMs)
    } catch (err: any) {
        console.error('[PageClick:BG] WAIT_FOR_PAGE_LOAD failed:', err)
        sendResponse({
            type: 'WAIT_FOR_PAGE_LOAD_RESULT',
            success: false,
            error: err.message || 'Wait failed',
        })
    }
}
