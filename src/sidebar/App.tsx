import { useState, useCallback, useRef, useEffect } from 'react'
import Header from './components/Header'
import Logo from './components/Logo'
import ChatView from './components/ChatView'
import SearchBox from './components/SearchBox'
import BottomNav, { type TabId } from './components/BottomNav'
import HistoryView from './components/HistoryView'
import WorkflowsView from './components/WorkflowsView'
import ProfileView from './components/ProfileView'
import PageSuggestions from './components/PageSuggestions'
import ConfirmDialog from './components/ConfirmDialog'
import { triggerPageScan } from './utils/pageScanAnimation'
import { evaluateStep, logAudit } from '../shared/safety-policy'
import type { PolicyVerdict } from '../shared/safety-policy'
import type { Message } from './components/ChatView'
import type { ModelId } from './components/SearchBox'
import type { ActionStep, CheckpointBlock, PageSnapshot } from '../shared/messages'
import type { TaskProgress } from './components/TaskProgressCard'
import type { PlanConfirmData } from './components/TaskPlanConfirm'
import { TaskOrchestrator, type TaskState } from './utils/taskOrchestrator'
import AuthGate from './components/AuthGate'
import {
    getUser,
    getRequestCount,
    incrementRequestCount,
    signInWithGoogle,
    signOut as authSignOut,
    onAuthStateChange,
    FREE_REQUEST_LIMIT,
    type User,
} from './utils/auth'
import {
    createConversation,
    loadMessages,
    saveMessage,
    encodeMessageContent,
} from './utils/conversationStore'
import {
    buildClarificationPrompt,
    buildExecutionPrompt,
    buildInfoPrompt,
    isTaskRequest,
    parseAskUser,
    parseTaskReady,
    parseActionPlan,
    parseCheckpoint,
    parseTaskComplete,
} from './utils/agentPrompt'
import { trimToContextWindow, estimateTokens } from './utils/tokenUtils'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

/**
 * Remove all <<<TAG>>>...<<<END_TAG>>> structured blocks from a message.
 * These are internal agent protocol blocks not meant for human reading.
 */
function stripStructuredBlocks(text: string): string {
    return text
        .replace(/<<<[A-Z_]+>>>.*?<<<END_[A-Z_]+>>>/gs, '') // Remove tagged blocks
        .replace(/<<<[A-Z_]+>>>/g, '')                       // Remove orphaned opening tags
        .trim()
}
function App() {
    const [messages, setMessages] = useState<Message[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [selectedModel, setSelectedModel] = useState<ModelId>('gemini-3-pro')
    const [taskState, setTaskState] = useState<TaskState | null>(null)

    // Auth state
    const [user, setUser] = useState<User | null>(null)
    const [requestCount, setRequestCount] = useState(0)
    const [showAuthGate, setShowAuthGate] = useState(false)

    // Tab + conversation state
    const [activeTab, setActiveTab] = useState<TabId>('home')
    const [currentConversationId, setCurrentConversationId] = useState<string | null>(null)

    // Safety verification state
    const [pendingConfirm, setPendingConfirm] = useState<{
        step: ActionStep
        verdict: PolicyVerdict
        resolve: (approved: boolean) => void
    } | null>(null)

    // Checkpoint state (pauses loop)
    const [pendingCheckpoint, setPendingCheckpoint] = useState<{
        block: CheckpointBlock
        resolve: (approved: boolean) => void
    } | null>(null)

    const orchestratorRef = useRef<TaskOrchestrator>(new TaskOrchestrator())
    const pageUrlRef = useRef<string>('')
    const stopScanRef = useRef<(() => void) | null>(null)
    const abortRef = useRef<AbortController | null>(null)
    const messagesRef = useRef<Message[]>([])

    // Persistent progress tracking across all loop iterations
    const progressMsgIndexRef = useRef<number>(-1)
    const accumulatedProgressRef = useRef<TaskProgress>({
        explanation: '',
        steps: [],
    })

    /** Reset progress tracking for a new task */
    const resetProgressTracking = useCallback(() => {
        progressMsgIndexRef.current = -1
        accumulatedProgressRef.current = { explanation: '', steps: [] }
    }, [])

    /** Update the single persistent progress card */
    const updateProgress = useCallback((progress: TaskProgress) => {
        const msgIndex = progressMsgIndexRef.current
        if (msgIndex < 0) return

        setMessages(prev => {
            const next = [...prev]
            if (next[msgIndex] && next[msgIndex].role === 'assistant') {
                next[msgIndex].taskProgress = { ...progress, steps: [...progress.steps] }
            }
            return next
        })
    }, [])

    /** Set plan confirm on a specific message */
    const updatePlanConfirm = useCallback((msgIndex: number, planConfirm: PlanConfirmData) => {
        setMessages(prev => {
            const next = [...prev]
            if (next[msgIndex]) {
                next[msgIndex].planConfirm = planConfirm
            }
            return next
        })
    }, [])

    // Load auth state on mount + subscribe to auth changes
    useEffect(() => {
        getUser().then(u => setUser(u))
        getRequestCount().then(c => setRequestCount(c))

        const unsub = onAuthStateChange((u) => {
            setUser(u)
        })
        return unsub
    }, [])

    // Subscribe to orchestrator updates
    useEffect(() => {
        return orchestratorRef.current.subscribe(() => {
            setTaskState({ ...orchestratorRef.current.getState() })
        })
    }, [])

    // Keep messagesRef always in sync with messages state
    useEffect(() => {
        messagesRef.current = messages
    }, [messages])

    const callModel = async (systemPrompt: string, userMessage?: string, images?: string[]) => {
        // Use messagesRef.current (always up-to-date) instead of stale closure `messages`
        const currentMessages = messagesRef.current

        // Build raw message list for this turn
        const rawMessages = currentMessages.map(m => ({
            role: m.role,
            content: m.role === 'user' && m.images
                ? [...m.images.map(url => ({ type: 'image_url', image_url: { url } })), { type: 'text', text: m.content }]
                : m.content
        }))

        // Apply sliding window — drops oldest messages if over token budget
        const { trimmed, dropped } = trimToContextWindow(rawMessages)
        if (dropped > 0) {
            console.info(`[PageClick] Context trimmed: dropped ${dropped} oldest messages to stay within token budget.`)
        }

        const apiMessages = [
            { role: 'system', content: systemPrompt },
            ...trimmed,
        ]

        if (userMessage) {
            apiMessages.push({
                role: 'user',
                content: images
                    ? [...images.map(url => ({ type: 'image_url', image_url: { url } })), { type: 'text', text: userMessage }]
                    : userMessage
            })
        }

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
            signal: abortRef.current?.signal,
        })

        if (!response.ok) {
            // Try to extract a meaningful error message
            let errorDetail = `API error: ${response.status}`
            try {
                const errBody = await response.text()
                const parsed = JSON.parse(errBody)
                if (parsed.error) errorDetail = typeof parsed.error === 'string' ? parsed.error : parsed.error.message || errorDetail
            } catch { /* use default */ }
            throw new Error(errorDetail)
        }
        return response
    }

    const capturePage = async (): Promise<PageSnapshot | null> => {
        try {
            const response = await chrome.runtime.sendMessage({ type: 'CAPTURE_PAGE' })
            if (response?.type === 'CAPTURE_PAGE_RESULT' && response.payload) {
                pageUrlRef.current = response.payload.url || ''
                return response.payload
            }
        } catch (e) {
            console.warn('Failed to capture page:', e)
        }
        return null
    }

    const waitForPageLoad = async () => {
        console.log('[App] Waiting for page load...')
        await chrome.runtime.sendMessage({ type: 'WAIT_FOR_PAGE_LOAD', timeoutMs: 8000 })
    }

    const handleStop = useCallback(() => {
        // Abort in-flight fetch
        abortRef.current?.abort()
        abortRef.current = null
        // Abort orchestrator
        orchestratorRef.current.abort('Stopped by user')
        // Stop animation
        stopScanRef.current?.()
        stopScanRef.current = null
        // Reset loading
        setIsLoading(false)
    }, [])

    const handleSignIn = async () => {
        const u = await signInWithGoogle()
        setUser(u)
        setShowAuthGate(false)
    }

    const handleSignOut = async () => {
        await authSignOut()
        setUser(null)
        setRequestCount(0)
        setMessages([])
        setCurrentConversationId(null)
    }

    const handleNewChat = async () => {
        if (!user) {
            const count = await getRequestCount()
            if (count >= FREE_REQUEST_LIMIT) {
                setShowAuthGate(true)
                return
            }
        }
        setMessages([])
        setCurrentConversationId(null)
        setActiveTab('home')
    }

    const handleSelectConversation = async (convId: string) => {
        if (!user) {
            const count = await getRequestCount()
            if (count >= FREE_REQUEST_LIMIT) {
                setShowAuthGate(true)
                return
            }
        }
        const msgs = await loadMessages(convId)
        // Clean any raw structured-block text that may have been saved before the fix
        const cleanedMsgs = msgs.map(m =>
            m.role === 'assistant'
                ? { ...m, content: stripStructuredBlocks(m.content) }
                : m
        ).filter(m => m.content.trim().length > 0 || m.planConfirm || m.taskProgress) // Keep plan/progress cards
        setMessages(cleanedMsgs)
        setCurrentConversationId(convId)
        setActiveTab('home')
    }

    const handleSend = async (text: string, images?: string[]) => {
        if (isLoading) return

        // Auth gate: check if unauthenticated user exceeded free limit
        if (!user) {
            const count = await getRequestCount()
            if (count >= FREE_REQUEST_LIMIT) {
                setShowAuthGate(true)
                return
            }
            const newCount = await incrementRequestCount()
            setRequestCount(newCount)
        }

        // Auto-create conversation on first message
        let convId = currentConversationId
        if (!convId) {
            const conv = await createConversation(text.slice(0, 100) || 'New chat')
            convId = conv.id
            setCurrentConversationId(convId)
        }

        setIsLoading(true)

        // Create a fresh abort controller for this request
        abortRef.current = new AbortController()

        // Add user message to chat (update both state AND ref synchronously)
        const userMsg: Message = { role: 'user', content: text, images }
        setMessages(prev => {
            const next = [...prev, userMsg]
            messagesRef.current = next // Keep ref in sync immediately
            return next
        })

        // Persist user message
        saveMessage(convId, 'user', text, images).catch(console.warn)

        // Check if we are already in a task flow (answering clarification)
        if (orchestratorRef.current.isActive() && orchestratorRef.current.getState().phase === 'clarifying') {
            orchestratorRef.current.addClarifications({ UserResponse: text })
            await runAgentLoop(convId)
            return
        }

        // New request: decide if task or info
        const isTask = isTaskRequest(text)

        if (isTask) {
            resetProgressTracking()
            orchestratorRef.current.startTask(text)
            await runAgentLoop(convId)
        } else {
            // Info request — one-shot answer
            await runInfoRequest(convId, text, images)
        }
    }

    const runInfoRequest = async (convId: string, text: string, images?: string[]) => {
        stopScanRef.current = await triggerPageScan()
        try {
            const snapshot = await capturePage()
            const prompt = buildInfoPrompt(snapshot)
            const response = await callModel(prompt, text, images)
            await streamResponse(response, convId, false)
        } catch (err: any) {
            if (err.name === 'AbortError') return // User stopped
            setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }])
        } finally {
            setIsLoading(false)
            stopScanRef.current?.()
        }
    }

    const runAgentLoop = async (convId: string) => {
        const orchestrator = orchestratorRef.current
        stopScanRef.current = await triggerPageScan()

        try {
            // Loop while active
            let retried = false // Track if we already retried with no-plan fallback
            while (orchestrator.isActive()) {
                const state = orchestrator.getState()
                const snapshot = await capturePage()

                let prompt = ''
                if (state.phase === 'clarifying') {
                    prompt = buildClarificationPrompt(state.goal, snapshot)
                } else if (state.phase === 'executing' || state.phase === 'observing') {
                    prompt = buildExecutionPrompt(orchestrator, snapshot)
                } else {
                    break // Should not happen
                }

                // Call model
                const response = await callModel(prompt)
                const isTaskExec = state.phase === 'executing' || state.phase === 'observing'
                const fullText = await streamResponse(response, convId, isTaskExec) // hide text during task execution

                // Parse response based on phase
                if (state.phase === 'clarifying') {
                    // Check for TASK_READY first (the preferred response)
                    const taskReady = parseTaskReady(fullText)
                    if (taskReady.found && taskReady.block) {
                        // Show plan with Proceed/Reject buttons
                        // Find the current last assistant message index
                        const currentMsgCount = await new Promise<number>(resolve => {
                            setMessages(prev => {
                                resolve(prev.length - 1) // Index of last message
                                return prev
                            })
                        })

                        // Wait for user to proceed or reject
                        const approved = await new Promise<boolean>(resolve => {
                            const planConfirm: PlanConfirmData = {
                                summary: taskReady.block!.summary,
                                status: 'pending',
                                onProceed: () => {
                                    // Update status to approved
                                    updatePlanConfirm(currentMsgCount, {
                                        ...planConfirm,
                                        status: 'approved',
                                    })
                                    resolve(true)
                                },
                                onReject: () => {
                                    // Update status to rejected
                                    updatePlanConfirm(currentMsgCount, {
                                        ...planConfirm,
                                        status: 'rejected',
                                    })
                                    resolve(false)
                                },
                            }
                            updatePlanConfirm(currentMsgCount, planConfirm)
                        })

                        setIsLoading(true) // Re-enable loading state

                        // Save plan confirm card to history
                        const planStatus = approved ? 'approved' : 'rejected'
                        const planMsg: Message = {
                            role: 'assistant',
                            content: '',
                            planConfirm: {
                                summary: taskReady.block!.summary,
                                status: planStatus as 'approved' | 'rejected',
                                onProceed: () => { },
                                onReject: () => { },
                            },
                        }
                        saveMessage(convId, 'assistant', encodeMessageContent(planMsg)).catch(console.warn)

                        if (approved) {
                            // Set up the progress message — reuse the same message
                            progressMsgIndexRef.current = currentMsgCount
                            orchestrator.beginExecution()
                            continue // Continue to execution phase
                        } else {
                            orchestrator.abort('Cancelled by user')
                            const cancelMsg = 'Task cancelled. Let me know if you need anything else!'
                            setMessages(prev => [...prev, { role: 'assistant', content: cancelMsg }])
                            saveMessage(convId, 'assistant', cancelMsg).catch(console.warn)
                            break
                        }
                    }

                    const askUser = parseAskUser(fullText)
                    if (askUser.found && askUser.block) {
                        // AI asked questions (rare) — wait for user input
                        setIsLoading(false)
                        return
                    }

                    // Fallback: if AI didn't output structured block, treat as question
                    setIsLoading(false)
                    return
                }

                if (state.phase === 'executing' || state.phase === 'observing') {
                    // Check for checkpoint
                    const checkpoint = parseCheckpoint(fullText)
                    if (checkpoint.found && checkpoint.block) {
                        orchestrator.checkpoint(checkpoint.block)
                        // Show checkpoint dialog
                        const approved = await new Promise<boolean>(resolve => {
                            setPendingCheckpoint({ block: checkpoint.block!, resolve })
                        })
                        setPendingCheckpoint(null)

                        if (approved) {
                            orchestrator.resumeFromCheckpoint()
                            continue // Continue loop
                        } else {
                            orchestrator.abort('Stopped at checkpoint')
                            break
                        }
                    }

                    // Check for completion
                    const complete = parseTaskComplete(fullText)
                    if (complete.found && complete.block) {
                        orchestrator.complete(complete.block)
                        // Add completion summary as a NEW visible message at the end
                        const summary = complete.block!.summary
                        setMessages(prev => [...prev, { role: 'assistant', content: summary }])
                        saveMessage(convId, 'assistant', summary).catch(console.warn)
                        break
                    }

                    // Check for action plan
                    const plan = parseActionPlan(fullText)
                    if (plan.found && plan.block) {
                        orchestrator.setPlan({ explanation: plan.block.explanation, actions: plan.block.actions })

                        // If this is the first action plan, set the progress message
                        if (progressMsgIndexRef.current < 0) {
                            // Find current last assistant message index
                            const idx = await new Promise<number>(resolve => {
                                setMessages(prev => {
                                    resolve(prev.length - 1)
                                    return prev
                                })
                            })
                            progressMsgIndexRef.current = idx
                            accumulatedProgressRef.current = {
                                explanation: plan.block.explanation,
                                steps: [],
                            }
                        }

                        // Update explanation if it's better/newer
                        accumulatedProgressRef.current.explanation = plan.block.explanation

                        // Append new steps as pending
                        const newStepsStart = accumulatedProgressRef.current.steps.length
                        for (const a of plan.block.actions) {
                            accumulatedProgressRef.current.steps.push({
                                description: a.description || `${a.action} on element`,
                                status: 'pending',
                            })
                        }
                        updateProgress(accumulatedProgressRef.current)

                        // Execute steps with live progress updates
                        const results = []
                        for (let si = 0; si < plan.block.actions.length; si++) {
                            const step = plan.block.actions[si]
                            const globalIndex = newStepsStart + si

                            // Mark current step as running
                            accumulatedProgressRef.current.steps[globalIndex].status = 'running'
                            updateProgress(accumulatedProgressRef.current)

                            const result = await executeStep(step)
                            orchestrator.recordStepResult(result)
                            results.push(result)

                            // Mark step as completed or failed
                            accumulatedProgressRef.current.steps[globalIndex].status = result.success ? 'completed' : 'failed'
                            updateProgress(accumulatedProgressRef.current)

                            if (!result.success) break // Stop on failure

                            // If navigation occurred, wait for load and re-inject animation
                            if (step.action === 'navigate') {
                                await waitForPageLoad()
                                // Re-inject animation on the new page
                                stopScanRef.current?.()
                                stopScanRef.current = await triggerPageScan()
                            }
                        }

                        // Complete loop iteration
                        const cont = orchestrator.completeLoop({
                            iteration: state.loopCount + 1,
                            pageUrl: pageUrlRef.current,
                            plan: { explanation: plan.block.explanation, actions: plan.block.actions },
                            results,
                            timestamp: Date.now()
                        })

                        if (!cont) break // Budget exhausted
                    } else {
                        // No plan found — retry once with stronger instruction
                        if (!retried) {
                            retried = true
                            console.warn('No action plan found, retrying with stronger instruction...')
                            continue // One more loop iteration
                        }
                        // Still no plan after retry
                        console.warn('No action plan found after retry')
                        orchestrator.abort('No plan generated')
                        const noplanMsg = "I wasn't able to generate the right actions. Could you try rephrasing your request?"
                        setMessages(prev => [...prev, { role: 'assistant', content: noplanMsg }])
                        saveMessage(convId, 'assistant', noplanMsg).catch(console.warn)
                        break
                    }
                }
            }
        } catch (err: any) {
            if (err.name === 'AbortError') return // User stopped
            console.error('Agent loop error:', err)
            orchestrator.abort(err.message)
            const errMsg = `Task error: ${err.message}`
            setMessages(prev => [...prev, { role: 'assistant', content: errMsg }])
            saveMessage(convId, 'assistant', errMsg).catch(console.warn)
        } finally {
            setIsLoading(false)
            stopScanRef.current?.()

            // Save final progress card to history if we have one
            if (accumulatedProgressRef.current.steps.length > 0) {
                const progressMsg: Message = {
                    role: 'assistant',
                    content: '',
                    taskProgress: { ...accumulatedProgressRef.current },
                }
                saveMessage(convId, 'assistant', encodeMessageContent(progressMsg)).catch(console.warn)
            }
        }
    }

    const executeStep = useCallback(async (step: ActionStep) => {
        // Evaluate safety
        const verdict = evaluateStep(step, pageUrlRef.current)
        if (verdict.tier === 'block') {
            await logAudit({ timestamp: Date.now(), action: step.action, selector: step.selector, url: pageUrlRef.current, verdict: 'block', reason: verdict.reason, userApproved: false, result: 'blocked' })
            return { success: false, action: step.action, selector: step.selector, error: `Blocked: ${verdict.reason}`, durationMs: 0 }
        }

        if (verdict.tier === 'confirm') {
            const approved = await new Promise<boolean>(resolve => {
                setPendingConfirm({ step, verdict, resolve })
            })
            setPendingConfirm(null)
            if (!approved) {
                await logAudit({ timestamp: Date.now(), action: step.action, selector: step.selector, url: pageUrlRef.current, verdict: 'confirm', reason: verdict.reason, userApproved: false, result: 'blocked' })
                return { success: false, action: step.action, selector: step.selector, error: 'Cancelled by user', durationMs: 0 }
            }
        }

        // Execute via background
        try {
            const res = await chrome.runtime.sendMessage({ type: 'EXECUTE_ACTION', step })
            await logAudit({ timestamp: Date.now(), action: step.action, selector: step.selector, url: pageUrlRef.current, verdict: verdict.tier, reason: verdict.reason, userApproved: true, result: res.result.success ? 'success' : 'failed' })
            return res.result
        } catch (e: any) {
            return { success: false, action: step.action, selector: step.selector, error: e.message, durationMs: 0 }
        }
    }, [])

    const streamResponse = async (response: Response, convId: string, hidden = false): Promise<string> => {
        const reader = response.body?.getReader()
        if (!reader) return ''
        const decoder = new TextDecoder()
        let fullText = ''

        // Add placeholder message
        setMessages(prev => [...prev, { role: 'assistant', content: '', hidden }])

        try {
            while (true) {
                const { done, value } = await reader.read()
                if (done) break
                const chunk = decoder.decode(value, { stream: true })
                const lines = chunk.split('\n')
                for (const line of lines) {
                    if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                        try {
                            const data = JSON.parse(line.slice(6))
                            const content = data.choices[0]?.delta?.content || ''
                            if (content) {
                                fullText += content
                                setMessages(prev => {
                                    const next = [...prev]
                                    const last = next[next.length - 1]
                                    last.content = fullText
                                    return next // Trigger re-render
                                })
                            }
                        } catch { /* ignore partial json */ }
                    }
                }
            }
        } finally {
            reader.releaseLock()
        }

        // Attach estimated token count to the last message
        if (fullText.trim() && !hidden) {
            const tokens = estimateTokens(fullText)
            setMessages(prev => {
                const next = [...prev]
                const last = next[next.length - 1]
                if (last && last.role === 'assistant') {
                    last.tokenCount = tokens
                }
                return next
            })
        }

        // Persist assistant message — include tokenCount so it survives history reload
        const trimmed = fullText.trim()
        if (trimmed && !hidden && convId) {
            const cleanText = stripStructuredBlocks(trimmed)
            if (cleanText) {
                const tokens = estimateTokens(fullText)
                const encoded = encodeMessageContent({
                    role: 'assistant',
                    content: cleanText,
                    tokenCount: tokens || undefined,
                })
                saveMessage(convId, 'assistant', encoded).catch(console.warn)
            }
        }

        return trimmed
    }

    const hasMessages = messages.length > 0

    return (
        <div className="app">
            <Header status={taskState?.statusMessage} user={user} onSignOut={handleSignOut} />
            <main className="main-content">
                {activeTab === 'history' ? (
                    <HistoryView
                        onSelectConversation={handleSelectConversation}
                        onNewChat={handleNewChat}
                        currentConversationId={currentConversationId}
                    />
                ) : activeTab === 'workflows' ? (
                    <WorkflowsView
                        onRunWorkflow={(prompt) => {
                            setActiveTab('home')
                            handleSend(prompt)
                        }}
                    />
                ) : activeTab === 'profile' ? (
                    <ProfileView
                        user={user}
                        onSignIn={handleSignIn}
                        onSignOut={handleSignOut}
                    />
                ) : hasMessages ? (
                    <>
                        <ChatView messages={messages} isLoading={isLoading} />
                        {pendingConfirm && (
                            <ConfirmDialog
                                step={pendingConfirm.step}
                                verdict={pendingConfirm.verdict}
                                onConfirm={() => pendingConfirm.resolve(true)}
                                onCancel={() => pendingConfirm.resolve(false)}
                            />
                        )}
                        {pendingCheckpoint && (
                            <div className="checkpoint-overlay">
                                <div className="checkpoint-dialog">
                                    <h3>⚠️ Checkpoint Reached</h3>
                                    <p>{pendingCheckpoint.block.message}</p>
                                    <div className="checkpoint-actions">
                                        <button onClick={() => pendingCheckpoint.resolve(false)} className="cancel-btn">Stop Here</button>
                                        <button onClick={() => pendingCheckpoint.resolve(true)} className="confirm-btn">Continue Task</button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="center-logo"><Logo /></div>
                )}
                {activeTab !== 'history' && activeTab !== 'profile' && activeTab !== 'workflows' && (
                    <div className="bottom-input">
                        {!hasMessages && <PageSuggestions onSuggestionClick={handleSend} />}
                        <SearchBox onSend={handleSend} onStop={handleStop} isLoading={isLoading} selectedModel={selectedModel} onModelChange={setSelectedModel} />
                    </div>
                )}
            </main>
            <BottomNav activeTab={activeTab} onTabChange={(tab) => {
                if (tab === 'home') {
                    setMessages([])
                    setCurrentConversationId(null)
                }
                setActiveTab(tab)
            }} />

            {showAuthGate && (
                <AuthGate
                    onSignIn={handleSignIn}
                    onDismiss={() => setShowAuthGate(false)}
                    requestCount={requestCount}
                />
            )}
        </div>
    )
}

export default App
