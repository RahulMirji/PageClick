import { useState } from 'react'
import Header from './components/Header'
import Logo from './components/Logo'
import ChatView from './components/ChatView'
import SearchBox from './components/SearchBox'
import BottomNav from './components/BottomNav'
import type { Message } from './components/ChatView'
import type { ModelId } from './components/SearchBox'

const SUPABASE_URL = 'https://hadfgdqrmxlhrykdwdvb.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhhZGZnZHFybXhsaHJ5a2R3ZHZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5MTYzNzIsImV4cCI6MjA4NjQ5MjM3Mn0.ffIc9kL0bIeCZ50ySPX2bnhGGvz5zS4VwYANLq5E0qk'

function App() {
    const [messages, setMessages] = useState<Message[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [selectedModel, setSelectedModel] = useState<ModelId>('kimi-k2.5')

    const handleSend = async (text: string) => {
        console.log("%c >>> frontend: handleSend called", "color: #20b8cd; font-weight: bold", { text });
        const startTime = performance.now();

        const userMessage: Message = { role: 'user', content: text }
        setMessages(prev => [...prev, userMessage])
        setIsLoading(true)

        try {
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
                    messages: [...messages, userMessage].map((m) => ({
                        role: m.role,
                        content: m.content,
                    })),
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
                    <SearchBox onSend={handleSend} isLoading={isLoading} selectedModel={selectedModel} onModelChange={setSelectedModel} />
                </div>
            </main>
            <BottomNav />
        </div>
    )
}

export default App
