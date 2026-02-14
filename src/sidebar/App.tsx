import { useState } from 'react'
import Header from './components/Header'
import Logo from './components/Logo'
import ChatView from './components/ChatView'
import SearchBox from './components/SearchBox'
import BottomNav from './components/BottomNav'
import PageSuggestions from './components/PageSuggestions'
import { triggerPageScan } from './utils/pageScanAnimation'
import type { Message } from './components/ChatView'
import type { ModelId } from './components/SearchBox'

const SUPABASE_URL = 'https://hadfgdqrmxlhrykdwdvb.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhhZGZnZHFybXhsaHJ5a2R3ZHZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5MTYzNzIsImV4cCI6MjA4NjQ5MjM3Mn0.ffIc9kL0bIeCZ50ySPX2bnhGGvz5zS4VwYANLq5E0qk'

function App() {
    const [messages, setMessages] = useState<Message[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [selectedModel, setSelectedModel] = useState<ModelId>('gpt-oss-20b')

    const handleSend = async (text: string, images?: string[]) => {
        console.log("%c >>> frontend: handleSend called", "color: #20b8cd; font-weight: bold", { text, imageCount: images?.length || 0 });
        const startTime = performance.now();

        const userMessage: Message = { role: 'user', content: text, images }
        setMessages(prev => [...prev, userMessage])
        setIsLoading(true)

        // Fire the page scan animation — returns stop function
        const stopScan = await triggerPageScan()

        try {
            // Fetch page context directly via Chrome APIs
            interface PageContext { url: string; title: string; description: string; textContent: string }
            let pageContext: PageContext | null = null;
            try {
                const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
                const tab = tabs[0];
                console.log("%c >>> frontend: active tab found", "color: #20b8cd", { id: tab?.id, url: tab?.url, title: tab?.title });

                if (tab?.id) {
                    const url = tab.url || '';
                    const tabTitle = tab.title || '';

                    // For restricted URLs, use tab metadata only
                    const isRestricted =
                        url.startsWith('chrome://') ||
                        url.startsWith('chrome-extension://') ||
                        url.startsWith('about:') ||
                        url.startsWith('edge://') ||
                        url.startsWith('brave://');

                    if (isRestricted) {
                        pageContext = { url, title: tabTitle, description: '', textContent: '' };
                    } else {
                        // Try executeScript for full page content
                        try {
                            const results = await chrome.scripting.executeScript({
                                target: { tabId: tab.id },
                                func: () => {
                                    const title = document.title || '';
                                    const metaDesc =
                                        document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
                                    // Clone body and strip PageClick-injected elements before reading text
                                    const clone = document.body?.cloneNode(true) as HTMLElement | null;
                                    if (clone) {
                                        clone.querySelectorAll('[id^="__pc-"]').forEach(el => el.remove());
                                    }
                                    let text = clone?.innerText || '';
                                    text = text.replace(/\s+/g, ' ').trim();
                                    if (text.length > 3000) {
                                        text = text.substring(0, 3000) + '...';
                                    }
                                    return {
                                        url: window.location.href,
                                        title,
                                        description: metaDesc,
                                        textContent: text,
                                    };
                                },
                            });
                            if (results?.[0]?.result) {
                                pageContext = results[0].result as PageContext;
                            }
                        } catch (scriptErr) {
                            // executeScript fails on protected pages (Chrome Web Store, etc.)
                            // Fall back to tab metadata which is always available
                            console.warn("frontend: executeScript blocked, falling back to tab metadata:", scriptErr);
                            pageContext = { url, title: tabTitle, description: '', textContent: '' };
                        }
                    }
                }
            } catch (ctxErr) {
                console.warn("frontend: failed to get page context entirely:", ctxErr);
            }

            const contextTime = performance.now();
            console.log(`%c >>> frontend: page context fetched in ${((contextTime - startTime) / 1000).toFixed(2)}s`, "color: #20b8cd; font-weight: bold", pageContext);

            // Build the messages array for the API
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const apiMessages: { role: string; content: any }[] = [];

            // Add page context as system message
            if (pageContext && (pageContext.url || pageContext.title)) {
                const parts = [
                    `You are a helpful browser assistant. The user is currently viewing a web page.`,
                    ``,
                    `PAGE CONTEXT:`,
                    `- URL: ${pageContext.url}`,
                    `- Page Title: ${pageContext.title}`,
                ];
                if (pageContext.description) {
                    parts.push(`- Meta Description: ${pageContext.description}`);
                }
                if (pageContext.textContent) {
                    parts.push(`- Visible Page Content (excerpt): ${pageContext.textContent}`);
                }
                parts.push('');
                parts.push('INSTRUCTIONS: Use the above page context to make your responses relevant to what the user is currently viewing. Be conversational and proactive — infer what the user might be trying to do based on the page they are on. Always acknowledge what you can see about their current page.');
                parts.push('');
                parts.push('FORMATTING: You are displayed in a narrow sidebar panel (~380px wide). Prefer bullet lists or bold headings over markdown tables for better readability. If you must use a table, keep columns to 2 max and use short cell values. Always ensure each table row is on its own line with proper | separators and a --- header row.');
                apiMessages.push({ role: 'system', content: parts.join('\n') });
            }

            // Helper: build content payload (multimodal or plain text)
            // Only include images for vision-capable models
            const isVisionModel = selectedModel === 'kimi-k2.5';
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

            // Add conversation history
            for (const m of messages) {
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

    const hasMessages = messages.length > 0

    return (
        <div className="app">
            <Header />
            <main className="main-content">
                {hasMessages ? (
                    <ChatView messages={messages} isLoading={isLoading} />
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
