import { useState, useCallback, useRef, useEffect } from 'react'
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
import type { ActionStep, CheckpointBlock, PageSnapshot } from '../shared/messages'
import type { TaskProgress } from './components/TaskProgressCard'
import { TaskOrchestrator, type TaskState } from './utils/taskOrchestrator'
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

const SUPABASE_URL = 'https://hadfgdqrmxlhrykdwdvb.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhhZGZnZHFybXhsaHJ5a2R3ZHZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5MTYzNzIsImV4cCI6MjA4NjQ5MjM3Mn0.ffIc9kL0bIeCZ50ySPX2bnhGGvz5zS4VwYANLq5E0qk'

function App() {
    const [messages, setMessages] = useState<Message[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [selectedModel, setSelectedModel] = useState<ModelId>('gemini-3-flash')
    const [taskState, setTaskState] = useState<TaskState | null>(null)

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

    /** Update taskProgress on the last assistant message */
    const updateLastMessageProgress = useCallback((progress: TaskProgress) => {
        setMessages(prev => {
            const next = [...prev]
            const last = next[next.length - 1]
            if (last && last.role === 'assistant') {
                last.taskProgress = { ...progress }
            }
            return next
        })
    }, [])

    // Subscribe to orchestrator updates
    useEffect(() => {
        return orchestratorRef.current.subscribe(() => {
            setTaskState({ ...orchestratorRef.current.getState() })
        })
    }, [])

    const callModel = async (systemPrompt: string, userMessage?: string, images?: string[]) => {
        const apiMessages = [
            { role: 'system', content: systemPrompt },
            ...messages.slice(-10).map(m => ({
                role: m.role,
                content: m.role === 'user' && m.images ?
                    [...m.images.map(url => ({ type: 'image_url', image_url: { url } })), { type: 'text', text: m.content }]
                    : m.content
            }))
        ]

        if (userMessage) {
            apiMessages.push({
                role: 'user',
                content: images ?
                    [...images.map(url => ({ type: 'image_url', image_url: { url } })), { type: 'text', text: userMessage }]
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
        })

        if (!response.ok) throw new Error(`API error: ${response.status}`)
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

    const handleSend = async (text: string, images?: string[]) => {
        if (isLoading) return
        setIsLoading(true)

        // Add user message to chat
        const userMsg: Message = { role: 'user', content: text, images }
        setMessages(prev => [...prev, userMsg])

        // Check if we are already in a task flow (answering clarification)
        if (orchestratorRef.current.isActive() && orchestratorRef.current.getState().phase === 'clarifying') {
            orchestratorRef.current.addClarifications({ UserResponse: text })
            await runAgentLoop()
            return
        }

        // New request: decide if task or info
        const isTask = isTaskRequest(text)

        if (isTask) {
            orchestratorRef.current.startTask(text)
            await runAgentLoop()
        } else {
            // Info request — one-shot answer
            await runInfoRequest(text, images)
        }
    }

    const runInfoRequest = async (text: string, images?: string[]) => {
        stopScanRef.current = await triggerPageScan()
        try {
            const snapshot = await capturePage()
            const prompt = buildInfoPrompt(snapshot)
            const response = await callModel(prompt, text, images)
            await streamResponse(response)
        } catch (err: any) {
            setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }])
        } finally {
            setIsLoading(false)
            stopScanRef.current?.()
        }
    }

    const runAgentLoop = async () => {
        const orchestrator = orchestratorRef.current
        stopScanRef.current = await triggerPageScan()

        try {
            // Loop while active
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
                const fullText = await streamResponse(response) // Streams to UI and returns full text

                // Parse response based on phase
                if (state.phase === 'clarifying') {
                    const askUser = parseAskUser(fullText)
                    if (askUser.found && askUser.block) {
                        // AI asked questions — wait for user input
                        // The loop pauses here until user replies via handleSend
                        setIsLoading(false)
                        stopScanRef.current?.()
                        return
                    }

                    const taskReady = parseTaskReady(fullText)
                    if (taskReady.found) {
                        // AI is ready to execute
                        orchestrator.beginExecution()
                        continue // Loop immediately to execution phase
                    }

                    // Fallback: if AI didn't output structured block, treat as question
                    setIsLoading(false)
                    stopScanRef.current?.()
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
                        break
                    }

                    // Check for action plan
                    const plan = parseActionPlan(fullText)
                    if (plan.found && plan.block) {
                        orchestrator.setPlan({ explanation: plan.block.explanation, actions: plan.block.actions })

                        // Build initial task progress with all steps pending
                        const taskProgress: TaskProgress = {
                            explanation: plan.block.explanation,
                            steps: plan.block.actions.map(a => ({
                                description: a.description || `${a.action} on element`,
                                status: 'pending' as const,
                            }))
                        }
                        updateLastMessageProgress(taskProgress)

                        // Execute steps with live progress updates
                        const results = []
                        for (let si = 0; si < plan.block.actions.length; si++) {
                            const step = plan.block.actions[si]

                            // Mark current step as running
                            taskProgress.steps[si].status = 'running'
                            updateLastMessageProgress(taskProgress)

                            const result = await executeStep(step)
                            orchestrator.recordStepResult(result)
                            results.push(result)

                            // Mark step as completed or failed
                            taskProgress.steps[si].status = result.success ? 'completed' : 'failed'
                            updateLastMessageProgress(taskProgress)

                            if (!result.success) break // Stop on failure

                            // If navigation occurred, wait for load
                            if (step.action === 'navigate') {
                                await waitForPageLoad()
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
                        // No plan found?
                        console.warn('No action plan found in execution response')
                        orchestrator.abort('No plan generated')
                        break
                    }
                }
            }
        } catch (err: any) {
            console.error('Agent loop error:', err)
            orchestrator.abort(err.message)
            setMessages(prev => [...prev, { role: 'assistant', content: `Task error: ${err.message}` }])
        } finally {
            setIsLoading(false)
            stopScanRef.current?.()
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

    const streamResponse = async (response: Response): Promise<string> => {
        const reader = response.body?.getReader()
        if (!reader) return ''
        const decoder = new TextDecoder()
        let fullText = ''

        // Add placeholder message
        setMessages(prev => [...prev, { role: 'assistant', content: '' }])

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
        return fullText.trim()
    }

    const hasMessages = messages.length > 0

    return (
        <div className="app">
            <Header status={taskState?.statusMessage} />
            <main className="main-content">
                {hasMessages ? (
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
