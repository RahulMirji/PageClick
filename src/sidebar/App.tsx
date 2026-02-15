import { useState, useCallback, useRef } from 'react'
import Header from './components/Header'
import Logo from './components/Logo'
import ChatView from './components/ChatView'
import SearchBox from './components/SearchBox'
import BottomNav from './components/BottomNav'
import PageSuggestions from './components/PageSuggestions'
import ConfirmDialog from './components/ConfirmDialog'
import { triggerPageScan } from './utils/pageScanAnimation'
import { evaluateStep, logAudit } from '../shared/safety-policy'
import type { PolicyVerdict } from '../shared/safety-policy'
import type { Message } from './components/ChatView'
import type { ModelId } from './components/SearchBox'
import type { ActionPlan, ActionStep } from '../shared/messages'

const SUPABASE_URL = 'https://hadfgdqrmxlhrykdwdvb.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhhZGZnZHFybXhsaHJ5a2R3ZHZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5MTYzNzIsImV4cCI6MjA4NjQ5MjM3Mn0.ffIc9kL0bIeCZ50ySPX2bnhGGvz5zS4VwYANLq5E0qk'

/**
 * Attempt to repair common JSON issues from model output:
 * - Missing commas between key-value pairs (e.g. "risk":"low"description" → "risk":"low","description")
 * - Unescaped newlines inside strings
 * - Trailing commas before } or ]
 */
function repairJson(raw: string): string {
    let fixed = raw
    // Fix missing comma between }{ or between "value""key"
    fixed = fixed.replace(/"(\s*)"(\s*)(\w)/g, '",$1"$2$3')
    // Fix missing comma between string values: "low"description → "low","description
    fixed = fixed.replace(/"([a-z]+)"(\s*)"([a-z])/gi, '"$1",$2"$3')
    // Fix unescaped literal newlines inside strings
    fixed = fixed.replace(/([^\\])\n/g, '$1\\n')
    // Fix trailing commas
    fixed = fixed.replace(/,\s*([}\]])/g, '$1')
    return fixed
}

function App() {
    const [messages, setMessages] = useState<Message[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [selectedModel, setSelectedModel] = useState<ModelId>('gpt-oss-20b')
    const [pendingConfirm, setPendingConfirm] = useState<{
        step: ActionStep
        verdict: PolicyVerdict
        resolve: (approved: boolean) => void
    } | null>(null)
    const pageUrlRef = useRef<string>('')

    const handleSend = async (text: string, images?: string[]) => {
        console.log("%c >>> frontend: handleSend called", "color: #20b8cd; font-weight: bold", { text, imageCount: images?.length || 0 });
        const startTime = performance.now();

        const userMessage: Message = { role: 'user', content: text, images }
        setMessages(prev => [...prev, userMessage])
        setIsLoading(true)

        // Fire the page scan animation — returns stop function
        const stopScan = await triggerPageScan()

        try {
            // Fetch page context via message bus → background → content script
            let snapshot: any = null;
            try {
                const response = await chrome.runtime.sendMessage({ type: 'CAPTURE_PAGE' });
                console.log("%c >>> frontend: CAPTURE_PAGE response", "color: #20b8cd; font-weight: bold", response);
                if (response?.type === 'CAPTURE_PAGE_RESULT' && response.payload) {
                    snapshot = response.payload;
                    pageUrlRef.current = snapshot.url || '';
                }
            } catch (ctxErr) {
                console.warn("frontend: failed to get page context:", ctxErr);
            }

            const contextTime = performance.now();
            console.log(`%c >>> frontend: page context fetched in ${((contextTime - startTime) / 1000).toFixed(2)}s`, "color: #20b8cd; font-weight: bold", snapshot);

            // Build the messages array for the API
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const apiMessages: { role: string; content: any }[] = [];

            // Add page context as system message
            if (snapshot && (snapshot.url || snapshot.title)) {
                const parts = [
                    `You are a helpful browser assistant. The user is currently viewing a web page.`,
                    ``,
                    `PAGE CONTEXT:`,
                    `- URL: ${snapshot.url}`,
                    `- Page Title: ${snapshot.title}`,
                ];
                if (snapshot.description) {
                    parts.push(`- Meta Description: ${snapshot.description}`);
                }
                if (snapshot.nodes && snapshot.nodes.length > 0) {
                    parts.push(`- Interactive Elements (${snapshot.nodes.length} found):`);
                    // Include a compact summary of interactive elements for grounding
                    const summary = snapshot.nodes
                        .slice(0, 50) // top 50 most relevant
                        .map((n: any) => {
                            let desc = `  [${n.tag}] "${n.text}"`;
                            if (n.attrs?.['aria-label']) desc += ` (aria: ${n.attrs['aria-label']})`;
                            if (n.attrs?.href) desc += ` → ${n.attrs.href}`;
                            if (n.attrs?.role) desc += ` role=${n.attrs.role}`;
                            if (n.attrs?._redacted) desc += ` [REDACTED]`;
                            desc += ` @ selector: ${n.path}`;
                            return desc;
                        })
                        .join('\n');
                    parts.push(summary);
                }
                if (snapshot.textContent) {
                    parts.push(`- Visible Page Content (excerpt): ${snapshot.textContent}`);
                }
                parts.push('');
                parts.push('INSTRUCTIONS: Use the above page context to make your responses relevant to what the user is currently viewing. Be conversational and proactive — infer what the user might be trying to do based on the page they are on. Always acknowledge what you can see about their current page.');
                parts.push('');
                parts.push('FORMATTING: You are displayed in a narrow sidebar panel (~380px wide). Prefer bullet lists or bold headings over markdown tables for better readability. If you must use a table, keep columns to 2 max and use short cell values. Always ensure each table row is on its own line with proper | separators and a --- header row.');
                parts.push('');
                parts.push('ACTION PLANS: When the user asks you to DO something on the page (click, type, navigate, fill a form, etc.), respond with your explanation AND include a machine-readable action plan block. Format:');
                parts.push('<<<ACTION_PLAN>>>');
                parts.push('{"explanation":"what this plan does","actions":[{"action":"click|input|scroll|extract|navigate","selector":"CSS selector from the Interactive Elements above","value":"optional input value","confidence":0.95,"risk":"low|medium|high","description":"human readable step description"}]}');
                parts.push('<<<END_ACTION_PLAN>>>');
                parts.push('Only include an action plan when the user explicitly asks you to perform an action. For informational questions, just respond normally.');
                apiMessages.push({ role: 'system', content: parts.join('\n') });
            }

            // Helper: build content payload (multimodal or plain text)
            // Only include images for vision-capable models
            const isVisionModel = selectedModel === 'kimi-k2.5' || selectedModel === 'llama-4-scout';
            const buildContent = (msg: Message) => {
                if (isVisionModel && msg.images && msg.images.length > 0) {
                    // Multimodal: array of image_url + text
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const parts: any[] = msg.images.map((dataUrl: string) => ({
                        type: 'image_url',
                        image_url: { url: dataUrl },
                    }));
                    if (msg.content) {
                        parts.push({ type: 'text', text: msg.content });
                    }
                    return parts;
                }
                // Text-only: return plain string (strips images for non-vision models)
                return msg.content;
            };

            // Add conversation history (trim to last 6 messages to avoid token limits)
            const recentMessages = messages.slice(-6);
            for (const m of recentMessages) {
                apiMessages.push({ role: m.role, content: buildContent(m) });
            }

            // Add current user message
            apiMessages.push({ role: userMessage.role, content: buildContent(userMessage) });

            console.log("%c >>> frontend: API messages payload", "color: #20b8cd; font-weight: bold", apiMessages.map(m => ({ role: m.role, contentType: Array.isArray(m.content) ? 'multimodal' : 'text' })));

            console.log("frontend: sending request to edge function (streaming)...");
            const response = await fetch(`${SUPABASE_URL}/functions/v1/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                    'apikey': SUPABASE_ANON_KEY,
                },
                body: JSON.stringify({
                    model: selectedModel,
                    messages: apiMessages,
                }),
            })

            console.log("frontend: response status", response.status);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Server returned ${response.status}: ${errorText}`);
            }

            const reader = response.body?.getReader();
            if (!reader) throw new Error("No reader available");

            const decoder = new TextDecoder();
            let assistantReply = "";
            let isFirstChunk = true;

            // Add an empty assistant message to start with
            setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                if (isFirstChunk) {
                    const endTime = performance.now();
                    const ttft = ((endTime - startTime) / 1000).toFixed(2);
                    console.log(`%c >>> frontend: first chunk received in ${ttft}s`, "color: #20b8cd; font-weight: bold");
                    isFirstChunk = false;
                }

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const dataStr = line.slice(6);
                        if (dataStr === '[DONE]') continue;

                        try {
                            const data = JSON.parse(dataStr);
                            const content = data.choices[0]?.delta?.content || "";
                            if (content) {
                                assistantReply += content;
                                // Update only the last message
                                setMessages(prev => {
                                    const newMessages = [...prev];
                                    newMessages[newMessages.length - 1] = {
                                        role: 'assistant',
                                        content: assistantReply
                                    };
                                    return newMessages;
                                });
                            }
                        } catch (e) {
                            // Some chunks might be partial JSON, ignore them
                        }
                    }
                }
            }

            console.log("frontend: streaming finished");
            console.log("%c[PageClick] Raw assistant reply (last 500 chars):", "color: #ff6b35; font-weight: bold", assistantReply.slice(-500));

            // Parse action plan from the completed response
            // Also handle model typo: <<<_ACTION_PLAN>>> instead of <<<END_ACTION_PLAN>>>
            const planMatch = assistantReply.match(/<<<ACTION_PLAN>>>\s*([\s\S]*?)\s*<<<(?:END_ACTION_PLAN|_ACTION_PLAN)>>>/);
            console.log("%c[PageClick] Action plan regex match:", "color: #ff6b35; font-weight: bold", planMatch ? 'FOUND' : 'NOT FOUND');
            if (planMatch) {
                console.log("%c[PageClick] Raw plan JSON:", "color: #ff6b35", planMatch[1].trim());
                try {
                    const rawJson = planMatch[1].trim();
                    let jsonToParse = rawJson;
                    // Try raw first, then repaired
                    let plan: ActionPlan;
                    try {
                        plan = JSON.parse(jsonToParse) as ActionPlan;
                    } catch {
                        console.warn("%c[PageClick] Raw JSON parse failed, attempting repair...", "color: #f59e0b");
                        jsonToParse = repairJson(rawJson);
                        console.log("%c[PageClick] Repaired JSON:", "color: #f59e0b", jsonToParse);
                        plan = JSON.parse(jsonToParse) as ActionPlan;
                    }
                    console.log("%c[PageClick] Parsed action plan:", "color: #ff6b35; font-weight: bold", {
                        explanation: plan.explanation,
                        actionCount: plan.actions?.length || 0,
                        actions: plan.actions?.map(a => ({ action: a.action, selector: a.selector, risk: a.risk })),
                    });

                    // Strip the action plan block from the displayed message
                    const cleanContent = assistantReply
                        .replace(/<<<ACTION_PLAN>>>\s*[\s\S]*?\s*<<<(?:END_ACTION_PLAN|_ACTION_PLAN)>>>/, '')
                        .trim();
                    setMessages(prev => {
                        const updated = [...prev];
                        updated[updated.length - 1] = { role: 'assistant', content: cleanContent };
                        return updated;
                    });

                    // ── AUTO-EXECUTE all steps immediately ──
                    if (plan.actions && plan.actions.length > 0) {
                        console.log("%c[PageClick] Auto-executing %d actions...", "color: #34d399; font-weight: bold", plan.actions.length);
                        const results: string[] = [];
                        for (const step of plan.actions) {
                            const { success, msg } = await runStep(step);
                            results.push(msg);
                            if (!success) break;
                        }
                        if (results.length > 0) {
                            setMessages(prev => [...prev, {
                                role: 'assistant',
                                content: results.length === 1 ? results[0] : `**Actions:**\n\n${results.join('\n')}`,
                            }]);
                        }
                    } else {
                        console.warn("%c[PageClick] Plan has no actions!", "color: #ff6b35");
                    }
                } catch (parseErr) {
                    console.error("%c[PageClick] FAILED to parse action plan JSON:", "color: #ff0000; font-weight: bold", parseErr);
                    console.error("%c[PageClick] Raw JSON that failed:", "color: #ff0000", planMatch[1]);
                }
            } else {
                console.log("%c[PageClick] No <<<ACTION_PLAN>>> block found in model response. Model may not have generated one.", "color: #ff6b35");
            }

        } catch (err: any) {
            console.error("frontend: catch block triggered", err);
            setMessages(prev => [
                ...prev,
                { role: 'assistant', content: `Connection error: ${err.message || 'Unknown error'}` },
            ])
        } finally {
            setIsLoading(false)
            stopScan()
        }
    }

    // ── Safety-aware step execution ───────────────────────────────

    const runStep = useCallback(async (step: ActionStep): Promise<{ success: boolean; msg: string }> => {
        console.log("%c[PageClick] ┌── runStep called", "color: #34d399; font-weight: bold", {
            action: step.action,
            selector: step.selector,
            value: step.value,
            risk: step.risk,
            description: step.description,
            pageUrl: pageUrlRef.current,
        })

        const verdict = evaluateStep(step, pageUrlRef.current)
        console.log("%c[PageClick] │ Safety verdict:", "color: #34d399", {
            tier: verdict.tier,
            reason: verdict.reason,
            escalatedRisk: verdict.escalatedRisk,
            originalRisk: verdict.originalRisk,
        })

        // BLOCKED
        if (verdict.tier === 'block') {
            console.warn("%c[PageClick] └── BLOCKED by safety policy:", "color: #ef4444; font-weight: bold", verdict.reason)
            await logAudit({
                timestamp: Date.now(), action: step.action, selector: step.selector,
                url: pageUrlRef.current, verdict: 'block', reason: verdict.reason,
                userApproved: false, result: 'blocked',
            })
            return { success: false, msg: `🚫 **Blocked:** ${verdict.reason}` }
        }

        // CONFIRM — show dialog and wait
        if (verdict.tier === 'confirm') {
            console.log("%c[PageClick] │ Showing confirmation dialog...", "color: #f59e0b")
            const approved = await new Promise<boolean>((resolve) => {
                setPendingConfirm({ step, verdict, resolve })
            })
            setPendingConfirm(null)
            console.log("%c[PageClick] │ User decision:", "color: #f59e0b", approved ? 'APPROVED' : 'CANCELLED')

            if (!approved) {
                console.log("%c[PageClick] └── Cancelled by user", "color: #ef4444")
                await logAudit({
                    timestamp: Date.now(), action: step.action, selector: step.selector,
                    url: pageUrlRef.current, verdict: 'confirm', reason: verdict.reason,
                    userApproved: false, result: 'blocked',
                })
                return { success: false, msg: `⏹️ **Cancelled** by user` }
            }
        }

        // EXECUTE
        console.log("%c[PageClick] │ Sending EXECUTE_ACTION to background...", "color: #34d399", { type: 'EXECUTE_ACTION', step })
        try {
            const result = await chrome.runtime.sendMessage({ type: 'EXECUTE_ACTION', step })
            console.log("%c[PageClick] │ EXECUTE_ACTION response:", "color: #34d399", result)
            const r = result?.result
            const success = !!r?.success
            console.log("%c[PageClick] └── Result:", success ? "color: #34d399; font-weight: bold" : "color: #ef4444; font-weight: bold", {
                success,
                action: r?.action,
                durationMs: r?.durationMs,
                error: r?.error,
                extractedData: r?.extractedData,
            })
            await logAudit({
                timestamp: Date.now(), action: step.action, selector: step.selector,
                url: pageUrlRef.current, verdict: verdict.tier, reason: verdict.reason,
                userApproved: true, result: success ? 'success' : 'failed',
            })
            if (success) {
                // After navigate, update pageUrlRef so subsequent steps use the new URL
                if (step.action === 'navigate') {
                    const navTarget = step.value || step.selector || ''
                    if (navTarget) {
                        const newUrl = navTarget.startsWith('http') ? navTarget : `https://${navTarget}`
                        pageUrlRef.current = newUrl
                        console.log("%c[PageClick] │ Updated pageUrlRef after navigate:", "color: #34d399", newUrl)
                    }
                }
                return {
                    success: true,
                    msg: `✅ **${step.description || step.action}** — ${r.durationMs.toFixed(0)}ms${r.extractedData ? `\n> ${r.extractedData}` : ''}`,
                }
            }
            return { success: false, msg: `❌ **${step.description || step.action}** — ${r?.error || 'Failed'}` }
        } catch (err: any) {
            console.error("%c[PageClick] └── EXECUTE_ACTION threw:", "color: #ef4444; font-weight: bold", err)
            return { success: false, msg: `❌ Execution error: ${err.message}` }
        }
    }, [])

    const hasMessages = messages.length > 0

    return (
        <div className="app">
            <Header />
            <main className="main-content">
                {hasMessages ? (
                    <>
                        <ChatView messages={messages} isLoading={isLoading} />

                        {/* Safety confirmation dialog */}
                        {pendingConfirm && (
                            <ConfirmDialog
                                step={pendingConfirm.step}
                                verdict={pendingConfirm.verdict}
                                onConfirm={() => pendingConfirm.resolve(true)}
                                onCancel={() => pendingConfirm.resolve(false)}
                            />
                        )}
                    </>
                ) : (
                    <div className="center-logo">
                        <Logo />
                    </div>
                )}
                <div className="bottom-input">
                    {!hasMessages && <PageSuggestions onSuggestionClick={handleSend} />}
                    <SearchBox onSend={handleSend} isLoading={isLoading} selectedModel={selectedModel} onModelChange={setSelectedModel} />
                </div>
            </main>
            <BottomNav />
        </div>
    )
}

export default App
