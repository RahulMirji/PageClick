import { useState, useCallback, useRef, useEffect } from "react";
import Header from "./components/Header";
import Logo from "./components/Logo";
import ChatView from "./components/ChatView";
import SearchBox from "./components/SearchBox";
import BottomNav, { type TabId } from "./components/BottomNav";
import WorkflowsView from "./components/WorkflowsView";
import ProfileView from "./components/ProfileView";
import ProjectsView from "./components/ProjectsView";
import PageSuggestions from "./components/PageSuggestions";
import ConfirmDialog from "./components/ConfirmDialog";
import { triggerPageScan } from "./utils/pageScanAnimation";
import { evaluateStep, logAudit } from "../shared/safety-policy";
import type { PolicyVerdict } from "../shared/safety-policy";
import type { Message } from "./components/ChatView";
import type { ModelId } from "./components/SearchBox";
import type {
  ActionStep,
  CheckpointBlock,
  PageSnapshot,
} from "../shared/messages";
import type { TaskProgress } from "./components/TaskProgressCard";
import type { PlanConfirmData } from "./components/TaskPlanConfirm";
import { TaskOrchestrator } from "./utils/taskOrchestrator";
import AuthGate from "./components/AuthGate";
import {
  getUser,
  getRequestCount,
  incrementRequestCount,
  signInWithGoogle,
  signOut as authSignOut,
  onAuthStateChange,
  FREE_REQUEST_LIMIT,
  type User,
} from "./utils/auth";
import {
  createConversation,
  loadMessages,
  saveMessage,
  encodeMessageContent,
} from "./utils/conversationStore";
import {
  buildClarificationPrompt,
  buildExecutionPrompt,
  buildInfoPrompt,
  isTaskRequest,
} from "./utils/agentPrompt";
import { parseToolCallResponse, extractToolHistoryMessages } from "./utils/toolCallAdapter";
import { PAGECLICK_TOOLS, CLARIFICATION_TOOLS, toGeminiTools } from "../shared/toolSchemas";
import { trimToContextWindow, estimateTokens } from "./utils/tokenUtils";
import { requestTaskNotification } from "./utils/notificationService";
import { matchProject, type Project } from "./utils/projectStore";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

/**
 * Remove all <<<TAG>>>...<<<END_TAG>>> structured blocks from a message.
 * These are internal agent protocol blocks not meant for human reading.
 */
function stripStructuredBlocks(text: string): string {
  return text
    .replace(/<<<[A-Z_]+>>>.*?<<<END_[A-Z_]+>>>/gs, "") // Remove tagged blocks
    .replace(/<<<[A-Z_]+>>>/g, "") // Remove orphaned opening tags
    .trim();
}

function extractQuotedText(input: string): string | null {
  const match = input.match(/["']([^"']+)["']/);
  return match?.[1]?.trim() || null;
}

/** Turn raw API error strings into human-friendly messages. */
function humanizeApiError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("rate limit") || lower.includes("tokens per minute") || lower.includes("requests per minute")) {
    return "Rate limit reached — the AI provider is throttling requests. Please wait a minute and try again, or switch to a different model.";
  }
  if (lower.includes("context length") || lower.includes("maximum.*token") || lower.includes("too many tokens")) {
    return "The conversation is too long for this model's context window. Try starting a new chat.";
  }
  if (lower.includes("invalid api key") || lower.includes("authentication")) {
    return "Authentication error with the AI provider. Please check your configuration.";
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return "The AI provider took too long to respond. Please try again.";
  }
  if (lower.includes("invalid json schema")) {
    return "The AI provider rejected the tool schema. This model may not support structured tool calling.";
  }
  // Fallback: return the original but cap length
  return raw.length > 200 ? raw.slice(0, 200) + "…" : raw;
}

function buildNativeStepFromGoal(goal: string): ActionStep | null {
  const text = goal.trim();

  if (
    /\b(read|show|check|what(?:'s| is)?)\b.*\bclipboard\b/i.test(text) ||
    /\bclipboard\b.*\b(read|show|check)\b/i.test(text)
  ) {
    return {
      action: "native",
      selector: "",
      value: JSON.stringify({ op: "clipboard.read", args: {} }),
      confidence: 0.98,
      risk: "high",
      description: "Read current clipboard text via native host",
    };
  }

  if (
    /\b(copy|write)\b.*\bclipboard\b/i.test(text) ||
    /\bclipboard\b.*\b(copy|write)\b/i.test(text)
  ) {
    const quoted = extractQuotedText(text);
    const inferred =
      quoted ||
      text
        .replace(/.*\b(copy|write)\b/i, "")
        .replace(/\b(to|into)\b.*\bclipboard\b.*/i, "")
        .replace(/\bclipboard\b.*/i, "")
        .trim();
    const content = inferred || " ";
    return {
      action: "native",
      selector: "",
      value: JSON.stringify({ op: "clipboard.write", args: { text: content } }),
      confidence: 0.98,
      risk: "high",
      description: "Write text to clipboard via native host",
    };
  }

  const filePathMatch = text.match(/(~\/[^\s]+|\/[^\s]+(?:\.[a-zA-Z0-9]+)?)/);
  if (
    /\b(read|open|show)\b.*\b(file|text)\b/i.test(text) ||
    /\b(read|open|show)\b.*(?:~\/|\/)/i.test(text)
  ) {
    const filePath = filePathMatch?.[1];
    if (!filePath) return null;
    return {
      action: "native",
      selector: "",
      value: JSON.stringify({ op: "fs.readText", args: { path: filePath } }),
      confidence: 0.97,
      risk: "high",
      description: `Read local text file ${filePath} via native host`,
    };
  }

  return null;
}

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ModelId>("gemini-3-pro");

  // Auth state
  const [user, setUser] = useState<User | null>(null);
  const [requestCount, setRequestCount] = useState(0);
  const [showAuthGate, setShowAuthGate] = useState(false);

  // Tab + conversation state
  const [activeTab, setActiveTab] = useState<TabId>("home");
  const [currentConversationId, setCurrentConversationId] = useState<
    string | null
  >(null);

  // Safety verification state
  const [pendingConfirm, setPendingConfirm] = useState<{
    step: ActionStep;
    verdict: PolicyVerdict;
    resolve: (approved: boolean) => void;
  } | null>(null);

  // Checkpoint state (pauses loop)
  const [pendingCheckpoint, setPendingCheckpoint] = useState<{
    block: CheckpointBlock;
    resolve: (approved: boolean) => void;
  } | null>(null);

  const orchestratorRef = useRef<TaskOrchestrator>(new TaskOrchestrator());
  const pageUrlRef = useRef<string>("");
  const stopScanRef = useRef<(() => void) | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<Message[]>([]);
  /** Tool-call history (assistant+tool message pairs) for the current task — API-only, not shown in UI */
  const toolHistoryRef = useRef<any[]>([]);
  const activeProjectRef = useRef<Project | null>(null);

  // Persistent progress tracking across all loop iterations
  const progressMsgIndexRef = useRef<number>(-1);
  const accumulatedProgressRef = useRef<TaskProgress>({
    explanation: "",
    steps: [],
  });

  /** Reset progress tracking for a new task */
  const resetProgressTracking = useCallback(() => {
    progressMsgIndexRef.current = -1;
    accumulatedProgressRef.current = { explanation: "", steps: [] };
  }, []);

  /** Update the single persistent progress card */
  const updateProgress = useCallback((progress: TaskProgress) => {
    const msgIndex = progressMsgIndexRef.current;
    if (msgIndex < 0) return;

    setMessages((prev) => {
      const next = [...prev];
      if (next[msgIndex] && next[msgIndex].role === "assistant") {
        next[msgIndex].taskProgress = {
          ...progress,
          steps: [...progress.steps],
        };
      }
      return next;
    });
  }, []);

  /** Set plan confirm on a specific message */
  const updatePlanConfirm = useCallback(
    (msgIndex: number, planConfirm: PlanConfirmData) => {
      setMessages((prev) => {
        const next = [...prev];
        if (next[msgIndex]) {
          next[msgIndex].planConfirm = planConfirm;
        }
        return next;
      });
    },
    [],
  );

  // Load auth state on mount + subscribe to auth changes
  useEffect(() => {
    getUser().then((u) => setUser(u));
    getRequestCount().then((c) => setRequestCount(c));

    const unsub = onAuthStateChange((u) => {
      setUser(u);
    });
    return unsub;
  }, []);

  // Keep messagesRef always in sync with messages state
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const callModel = async (
    systemPrompt: string,
    userMessage?: string,
    images?: string[],
  ) => {
    // Use messagesRef.current (always up-to-date) instead of stale closure `messages`
    const currentMessages = messagesRef.current;

    // Build raw message list for this turn
    const rawMessages = currentMessages.map((m) => ({
      role: m.role,
      content:
        m.role === "user" && m.images
          ? [
            ...m.images.map((url) => ({
              type: "image_url",
              image_url: { url },
            })),
            { type: "text", text: m.content },
          ]
          : m.content,
    }));

    // Apply sliding window — drops oldest messages if over token budget
    const { trimmed, dropped } = trimToContextWindow(rawMessages);
    if (dropped > 0) {
      console.info(
        `[PageClick] Context trimmed: dropped ${dropped} oldest messages to stay within token budget.`,
      );
    }

    const apiMessages = [{ role: "system", content: systemPrompt }, ...trimmed];

    if (userMessage) {
      apiMessages.push({
        role: "user",
        content: images
          ? [
            ...images.map((url) => ({
              type: "image_url",
              image_url: { url },
            })),
            { type: "text", text: userMessage },
          ]
          : userMessage,
      });
    }

    const response = await fetch(`${SUPABASE_URL}/functions/v1/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: apiMessages,
      }),
      signal: abortRef.current?.signal,
    });

    if (!response.ok) {
      // Try to extract a meaningful error message
      let errorDetail = `API error: ${response.status}`;
      try {
        const errBody = await response.text();
        const parsed = JSON.parse(errBody);
        if (parsed.error)
          errorDetail =
            typeof parsed.error === "string"
              ? parsed.error
              : parsed.error.message || errorDetail;
      } catch {
        /* use default */
      }
      throw new Error(errorDetail);
    }
    return response;
  };

  /**
   * Calls the edge function in tool-call mode (non-streaming).
   * Returns the raw provider JSON — caller passes to parseToolCallResponse().
   */
  const callToolTurn = async (
    systemPrompt: string,
    tools: any[],
  ): Promise<any> => {
    const t0 = performance.now();
    const currentMessages = messagesRef.current;
    console.log(`[Agent] callToolTurn: ${tools.length} tools, ${currentMessages.length} messages, ${toolHistoryRef.current.length} history entries, model=${selectedModel}`);

    const rawMessages = currentMessages.map((m) => ({
      role: m.role,
      content:
        m.role === "user" && m.images
          ? [
            ...m.images.map((url) => ({
              type: "image_url",
              image_url: { url },
            })),
            { type: "text", text: m.content },
          ]
          : m.content,
    }));

    const { trimmed, dropped } = trimToContextWindow(rawMessages);
    if (dropped > 0) {
      console.info(`[PageClick] Context trimmed: dropped ${dropped} oldest messages.`);
    }

    // Inject tool-call history (assistant+tool pairs) so the model remembers
    // what it called and what happened — without this it "forgets" between turns.
    const apiMessages = [
      { role: "system", content: systemPrompt },
      ...trimmed,
      ...toolHistoryRef.current,
    ];

    // Build tool schema — Gemini needs functionDeclarations format, others use tools[]
    const isGemini = selectedModel === "gemini-3-pro";
    const toolPayload = isGemini ? toGeminiTools(tools) : tools;

    console.log(`[Agent] callToolTurn: fetching edge function (${apiMessages.length} API messages)...`);
    const response = await fetch(`${SUPABASE_URL}/functions/v1/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: apiMessages,
        mode: "tool",
        tools: toolPayload,
      }),
      signal: abortRef.current?.signal,
    });
    console.log(`[Agent] callToolTurn: response status=${response.status} in ${(performance.now() - t0).toFixed(0)}ms`);

    if (!response.ok) {
      let errorDetail = `API error: ${response.status}`;
      try {
        const errBody = await response.text();
        const parsed = JSON.parse(errBody);
        if (parsed.error)
          errorDetail =
            typeof parsed.error === "string"
              ? parsed.error
              : parsed.error.message || errorDetail;
      } catch {
        /* use default */
      }
      throw new Error(humanizeApiError(errorDetail));
    }

    const json = await response.json();
    console.log(`[Agent] callToolTurn: total ${(performance.now() - t0).toFixed(0)}ms`);
    return json;
  };

  const capturePage = async (): Promise<PageSnapshot | null> => {
    const t0 = performance.now();
    try {
      const response = await chrome.runtime.sendMessage({
        type: "CAPTURE_PAGE",
      });
      if (response?.type === "CAPTURE_PAGE_RESULT" && response.payload) {
        pageUrlRef.current = response.payload.url || "";
        console.log(`[Agent] capturePage: ${response.payload.url} (${(performance.now() - t0).toFixed(0)}ms)`);
        // Auto-detect project context for this URL
        try {
          activeProjectRef.current = await matchProject(
            response.payload.url || "",
          );
        } catch {
          /* not critical */
        }
        return response.payload;
      }
    } catch (e) {
      console.warn("Failed to capture page:", e);
    }
    console.warn(`[Agent] capturePage: FAILED or empty (${(performance.now() - t0).toFixed(0)}ms)`);
    return null;
  };

  const waitForPageLoad = async () => {
    const t0 = performance.now();
    console.log("[Agent] waitForPageLoad: waiting (timeout=8s)...");
    await chrome.runtime.sendMessage({
      type: "WAIT_FOR_PAGE_LOAD",
      timeoutMs: 8000,
    });
    console.log(`[Agent] waitForPageLoad: done in ${(performance.now() - t0).toFixed(0)}ms`);
  };

  const handleStop = useCallback(() => {
    // Abort in-flight fetch
    abortRef.current?.abort();
    abortRef.current = null;
    // Abort orchestrator
    orchestratorRef.current.abort("Stopped by user");
    // Stop animation
    stopScanRef.current?.();
    stopScanRef.current = null;
    // Reset loading
    setIsLoading(false);
  }, []);

  const handleSignIn = async () => {
    const u = await signInWithGoogle();
    setUser(u);
    setShowAuthGate(false);
  };

  const handleSignOut = async () => {
    await authSignOut();
    setUser(null);
    setRequestCount(0);
    setMessages([]);
    setCurrentConversationId(null);
  };

  const handleNewChat = async () => {
    if (!user) {
      const count = await getRequestCount();
      if (count >= FREE_REQUEST_LIMIT) {
        setShowAuthGate(true);
        return;
      }
    }
    setMessages([]);
    setCurrentConversationId(null);
    setActiveTab("home");
  };

  const handleSelectConversation = async (convId: string) => {
    if (!user) {
      const count = await getRequestCount();
      if (count >= FREE_REQUEST_LIMIT) {
        setShowAuthGate(true);
        return;
      }
    }
    const msgs = await loadMessages(convId);
    // Clean any raw structured-block text that may have been saved before the fix
    const cleanedMsgs = msgs
      .map((m) =>
        m.role === "assistant"
          ? { ...m, content: stripStructuredBlocks(m.content) }
          : m,
      )
      .filter(
        (m) => m.content.trim().length > 0 || m.planConfirm || m.taskProgress,
      ); // Keep plan/progress cards
    setMessages(cleanedMsgs);
    setCurrentConversationId(convId);
    setActiveTab("home");
  };

  const handleSend = async (text: string, images?: string[]) => {
    if (isLoading) return;

    // Auth gate: check if unauthenticated user exceeded free limit
    if (!user) {
      const count = await getRequestCount();
      if (count >= FREE_REQUEST_LIMIT) {
        setShowAuthGate(true);
        return;
      }
      const newCount = await incrementRequestCount();
      setRequestCount(newCount);
    }

    // Auto-create conversation on first message
    let convId = currentConversationId;
    if (!convId) {
      const conv = await createConversation(text.slice(0, 100) || "New chat");
      convId = conv.id;
      setCurrentConversationId(convId);
    }

    setIsLoading(true);

    // Create a fresh abort controller for this request
    abortRef.current = new AbortController();

    // Add user message to chat (update both state AND ref synchronously)
    const userMsg: Message = { role: "user", content: text, images };
    setMessages((prev) => {
      const next = [...prev, userMsg];
      messagesRef.current = next; // Keep ref in sync immediately
      return next;
    });

    // Persist user message
    saveMessage(convId, "user", text, images).catch(console.warn);

    // Check if we are already in a task flow (answering clarification)
    if (
      orchestratorRef.current.isActive() &&
      orchestratorRef.current.getState().phase === "clarifying"
    ) {
      orchestratorRef.current.addClarifications({ UserResponse: text });
      await runAgentLoop(convId);
      return;
    }

    // New request: decide if task or info
    const isTask = isTaskRequest(text);
    console.log(`[Agent] handleSend: "${text.slice(0, 80)}" → isTask=${isTask}`);

    if (isTask) {
      resetProgressTracking();
      orchestratorRef.current.startTask(text);
      console.log("[Agent] Starting agent loop...");
      await runAgentLoop(convId);
    } else {
      // Info request — one-shot answer
      await runInfoRequest(convId, text, images);
    }
  };

  const runInfoRequest = async (
    convId: string,
    text: string,
    images?: string[],
  ) => {
    stopScanRef.current = await triggerPageScan();
    try {
      const snapshot = await capturePage();
      const prompt = buildInfoPrompt(snapshot, activeProjectRef.current);
      const response = await callModel(prompt, text, images);
      await streamResponse(response, convId, false);
    } catch (err: any) {
      if (err.name === "AbortError") return; // User stopped
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${err.message}` },
      ]);
    } finally {
      setIsLoading(false);
      stopScanRef.current?.();
    }
  };

  const runAgentLoop = async (convId: string) => {
    const orchestrator = orchestratorRef.current;
    toolHistoryRef.current = []; // Reset tool history for new task
    stopScanRef.current = await triggerPageScan();

    try {
      // Loop while active
      let retried = false; // Track if we already retried with no-plan fallback
      while (orchestrator.isActive()) {
        const loopT0 = performance.now();
        const state = orchestrator.getState();
        console.log(`[Agent] ── Loop iteration ${state.loopCount} | phase=${state.phase} | goal="${state.goal.slice(0, 60)}"`);
        const snapshot = await capturePage();

        // Poll CDP runtime context (network log, console, JS errors)
        const cdpRes = await chrome.runtime
          .sendMessage({ type: "GET_CDP_SNAPSHOT" })
          .catch(() => null);
        const cdpSnapshot = cdpRes?.snapshot ?? null;
        console.log(`[Agent] CDP snapshot: ${cdpSnapshot ? 'received' : 'null'} (${(performance.now() - loopT0).toFixed(0)}ms elapsed)`);

        // Deterministic fast-path for native-intent tasks.
        // This prevents model drift into eval/navigate loops for clipboard/file requests.
        if (
          (state.phase === "executing" || state.phase === "observing") &&
          state.loopCount === 0
        ) {
          const forcedNativeStep = buildNativeStepFromGoal(state.goal);
          if (forcedNativeStep) {
            const forcedPlan = {
              explanation: `Executing ${forcedNativeStep.description?.toLowerCase() || "native operation"} safely via local native host.`,
              actions: [forcedNativeStep],
            };
            orchestrator.setPlan(forcedPlan);

            if (progressMsgIndexRef.current < 0) {
              const idx = await new Promise<number>((resolve) => {
                setMessages((prev) => {
                  resolve(prev.length - 1);
                  return prev;
                });
              });
              progressMsgIndexRef.current = idx;
            }

            accumulatedProgressRef.current.explanation = forcedPlan.explanation;
            accumulatedProgressRef.current.steps.push({
              description:
                forcedNativeStep.description || "Run native operation",
              status: "running",
            });
            updateProgress(accumulatedProgressRef.current);

            const result = await executeStep(forcedNativeStep);
            orchestrator.recordStepResult(result);

            const lastIdx = accumulatedProgressRef.current.steps.length - 1;
            accumulatedProgressRef.current.steps[lastIdx].status =
              result.success ? "completed" : "failed";
            updateProgress(accumulatedProgressRef.current);

            if (result.success) {
              const details = result.extractedData
                ? `\n\nResult: ${result.extractedData}`
                : "";
              const summary = `Completed: ${forcedNativeStep.description}.${details}`;
              orchestrator.complete({ summary, nextSteps: [] });
              setMessages((prev) => [
                ...prev,
                { role: "assistant", content: summary },
              ]);
              saveMessage(convId, "assistant", summary).catch(console.warn);
              requestTaskNotification(
                "✅ Task Complete",
                forcedNativeStep.description || "Native action completed",
              );
            } else {
              const errMsg = `Task error: ${result.error || "Native action failed"}`;
              orchestrator.abort(result.error || "Native action failed");
              setMessages((prev) => [
                ...prev,
                { role: "assistant", content: errMsg },
              ]);
              saveMessage(convId, "assistant", errMsg).catch(console.warn);
              requestTaskNotification(
                "❌ Task Failed",
                result.error || "Native action failed",
              );
            }
            break;
          }
        }

        let prompt = "";
        if (state.phase === "clarifying") {
          prompt = buildClarificationPrompt(
            state.goal,
            snapshot,
            activeProjectRef.current,
          );
        } else if (state.phase === "executing" || state.phase === "observing") {
          prompt = buildExecutionPrompt(
            orchestrator,
            snapshot,
            cdpSnapshot,
            activeProjectRef.current,
          );
        } else {
          break; // Should not happen
        }

        // ── Clarification phase — use CLARIFICATION_TOOLS ───────────
        if (state.phase === "clarifying") {
          console.log(`[Agent] Clarification phase: calling tool turn...`);
          const rawResponse = await callToolTurn(prompt, CLARIFICATION_TOOLS);
          const parsed = parseToolCallResponse(selectedModel, rawResponse);
          console.log(`[Agent] Clarification response: type=${parsed.type}`);

          if (parsed.type === "task_ready") {
            console.log(`[Agent] task_ready: showing plan — "${parsed.summary.slice(0, 80)}" — waiting for user approval...`);
            // Insert a new assistant message to host the plan confirmation card
            const planMsgIndex = await new Promise<number>((resolve) => {
              setMessages((prev) => {
                const next = [...prev, { role: "assistant" as const, content: "" }];
                messagesRef.current = next;
                resolve(next.length - 1); // index of the new assistant message
                return next;
              });
            });

            const approved = await new Promise<boolean>((resolve) => {
              const planConfirm: PlanConfirmData = {
                summary: parsed.summary,
                status: "pending",
                onProceed: () => {
                  updatePlanConfirm(planMsgIndex, { ...planConfirm, status: "approved" });
                  resolve(true);
                },
                onReject: () => {
                  updatePlanConfirm(planMsgIndex, { ...planConfirm, status: "rejected" });
                  resolve(false);
                },
              };
              updatePlanConfirm(planMsgIndex, planConfirm);
            });

            setIsLoading(true);
            console.log(`[Agent] Plan ${approved ? 'APPROVED' : 'REJECTED'} by user`);

            const planStatus = approved ? "approved" : "rejected";
            const planMsg: Message = {
              role: "assistant",
              content: "",
              planConfirm: {
                summary: parsed.summary,
                status: planStatus as "approved" | "rejected",
                onProceed: () => { },
                onReject: () => { },
              },
            };
            saveMessage(convId, "assistant", encodeMessageContent(planMsg)).catch(console.warn);

            if (approved) {
              progressMsgIndexRef.current = planMsgIndex;
              orchestrator.beginExecution();
              continue;
            } else {
              orchestrator.abort("Cancelled by user");
              const cancelMsg = "Task cancelled. Let me know if you need anything else!";
              setMessages((prev) => [...prev, { role: "assistant", content: cancelMsg }]);
              saveMessage(convId, "assistant", cancelMsg).catch(console.warn);
              break;
            }
          }

          if (parsed.type === "ask_user") {
            // Show questions as assistant message and wait
            const questionText = parsed.block.questions.join("\n");
            setMessages((prev) => [...prev, { role: "assistant", content: questionText }]);
            setIsLoading(false);
            return;
          }

          // Fallback — treat as question
          setIsLoading(false);
          return;
        }

        // ── Execution/observing phase — use PAGECLICK_TOOLS ─────────
        if (state.phase === "executing" || state.phase === "observing") {
          console.log(`[Agent] Execution phase (${state.phase}): calling tool turn...`);
          const rawResponse = await callToolTurn(prompt, PAGECLICK_TOOLS);
          const parsed = parseToolCallResponse(selectedModel, rawResponse);
          console.log(`[Agent] Execution response: type=${parsed.type}${parsed.type === 'action' ? `, actions=[${parsed.plan.actions.map((a: any) => a.action).join(',')}]` : ''}${parsed.type === 'error' ? `, error=${(parsed as any).message?.slice(0, 100)}` : ''}`);

          if (parsed.type === "checkpoint") {
            // Record checkpoint tool call in history
            const historyMsgs = extractToolHistoryMessages(selectedModel, rawResponse, { success: true });
            toolHistoryRef.current.push(...historyMsgs);

            orchestrator.checkpoint(parsed.block);
            const approved = await new Promise<boolean>((resolve) => {
              setPendingCheckpoint({ block: parsed.block, resolve });
            });
            setPendingCheckpoint(null);
            if (approved) {
              orchestrator.resumeFromCheckpoint();
              continue;
            } else {
              orchestrator.abort("Stopped at checkpoint");
              break;
            }
          }

          if (parsed.type === "complete") {
            // Record complete tool call in history
            const historyMsgs = extractToolHistoryMessages(selectedModel, rawResponse, { success: true });
            toolHistoryRef.current.push(...historyMsgs);

            orchestrator.complete(parsed.block);
            const summary = parsed.block.summary;
            setMessages((prev) => [...prev, { role: "assistant", content: summary }]);
            saveMessage(convId, "assistant", summary).catch(console.warn);
            requestTaskNotification("✅ Task Complete", summary.slice(0, 100));
            break;
          }

          if (parsed.type === "action") {
            const plan = parsed.plan;
            orchestrator.setPlan(plan);

            if (progressMsgIndexRef.current < 0) {
              const idx = await new Promise<number>((resolve) => {
                setMessages((prev) => {
                  resolve(prev.length - 1);
                  return prev;
                });
              });
              progressMsgIndexRef.current = idx;
              accumulatedProgressRef.current = { explanation: plan.explanation, steps: [] };
            }

            accumulatedProgressRef.current.explanation = plan.explanation;

            const newStepsStart = accumulatedProgressRef.current.steps.length;
            for (const a of plan.actions) {
              accumulatedProgressRef.current.steps.push({
                description: a.description || `${a.action} on element`,
                status: "pending",
              });
            }
            updateProgress(accumulatedProgressRef.current);

            const results = [];
            for (let si = 0; si < plan.actions.length; si++) {
              const step = plan.actions[si];
              const globalIndex = newStepsStart + si;
              accumulatedProgressRef.current.steps[globalIndex].status = "running";
              updateProgress(accumulatedProgressRef.current);

              const stepT0 = performance.now();
              console.log(`[Agent] Executing step ${si + 1}/${plan.actions.length}: ${step.action} selector="${step.selector?.slice(0, 40) || ''}" value="${step.value?.slice(0, 40) || ''}"`);
              const result = await executeStep(step);
              console.log(`[Agent] Step ${si + 1} result: success=${result.success}${result.error ? ` error="${result.error}"` : ''} (${(performance.now() - stepT0).toFixed(0)}ms)`);
              orchestrator.recordStepResult(result);
              results.push(result);

              accumulatedProgressRef.current.steps[globalIndex].status = result.success ? "completed" : "failed";
              updateProgress(accumulatedProgressRef.current);

              if (!result.success) break;

              if (step.action === "navigate") {
                console.log(`[Agent] Navigate detected — waiting for page load...`);
                await waitForPageLoad();
                console.log(`[Agent] Page loaded — re-triggering scan`);
                stopScanRef.current?.();
                stopScanRef.current = await triggerPageScan();
              }
            }

            // Record the tool call + execution result in history so the model
            // sees what it did and what happened on subsequent turns.
            const lastResult = results[results.length - 1];
            const historyMsgs = extractToolHistoryMessages(
              selectedModel,
              rawResponse,
              lastResult || { success: false, error: "No actions executed" },
            );
            toolHistoryRef.current.push(...historyMsgs);

            const cont = orchestrator.completeLoop({
              iteration: state.loopCount + 1,
              pageUrl: pageUrlRef.current,
              plan,
              results,
              timestamp: Date.now(),
            });
            console.log(`[Agent] Loop iteration ${state.loopCount + 1} complete in ${(performance.now() - loopT0).toFixed(0)}ms — continue=${cont}`);
            if (!cont) break;

          } else {
            // error / unknown — retry once
            if (!retried) {
              retried = true;
              console.warn("[Tool calling] Unexpected result, retrying:", parsed);
              continue; // One more loop iteration
            }
            // Still no plan after retry
            console.warn("[Tool calling] No valid action after retry:", parsed);
            orchestrator.abort("No valid action generated");
            const noplanMsg =
              "I wasn't able to generate the right actions. Could you try rephrasing your request?";
            setMessages((prev) => [
              ...prev,
              { role: "assistant", content: noplanMsg },
            ]);
            saveMessage(convId, "assistant", noplanMsg).catch(console.warn);
            break;
          }
        }
      } // end while(orchestrator.isActive())
      console.log(`[Agent] Agent loop exited normally. Final state: phase=${orchestrator.getState().phase}, loopCount=${orchestrator.getState().loopCount}`);
    } catch (err: any) {
      if (err.name === "AbortError") { console.log("[Agent] Aborted by user"); return; }
      console.error("[Agent] Agent loop error:", err);

      // Check if the task actually completed its steps before the error hit
      const state = orchestrator.getState();
      const allStepsDone = accumulatedProgressRef.current.steps.length > 0 &&
        accumulatedProgressRef.current.steps.every((s) => s.status === "completed");

      if (allStepsDone && state.loopCount > 0) {
        // Task finished its work — the error was on a follow-up loop iteration
        orchestrator.complete({ summary: "All steps completed successfully.", nextSteps: [] });
        const doneMsg = "✅ All steps completed! (The agent ran into a limit while wrapping up, but your task is done.)";
        setMessages((prev) => [...prev, { role: "assistant", content: doneMsg }]);
        saveMessage(convId, "assistant", doneMsg).catch(console.warn);
        requestTaskNotification("✅ Task Complete", "All steps finished successfully.");
      } else {
        orchestrator.abort(err.message);
        const errMsg = `Task error: ${err.message}`;
        setMessages((prev) => [...prev, { role: "assistant", content: errMsg }]);
        saveMessage(convId, "assistant", errMsg).catch(console.warn);
        requestTaskNotification(
          "❌ Task Failed",
          err.message || "Something went wrong.",
        );
      }
    } finally {
      setIsLoading(false);
      stopScanRef.current?.();

      // Save final progress card to history if we have one
      if (accumulatedProgressRef.current.steps.length > 0) {
        const progressMsg: Message = {
          role: "assistant",
          content: "",
          taskProgress: { ...accumulatedProgressRef.current },
        };
        saveMessage(
          convId,
          "assistant",
          encodeMessageContent(progressMsg),
        ).catch(console.warn);
      }
    }
  };

  const executeStep = useCallback(async (step: ActionStep) => {
    // Evaluate safety
    const verdict = evaluateStep(step, pageUrlRef.current);
    const logOutcome = async (result: { success: boolean }) => {
      await logAudit({
        timestamp: Date.now(),
        action: step.action,
        selector: step.selector,
        url: pageUrlRef.current,
        verdict: verdict.tier,
        reason: verdict.reason,
        userApproved: true,
        result: result.success ? "success" : "failed",
      });
    };

    if (verdict.tier === "block") {
      await logAudit({
        timestamp: Date.now(),
        action: step.action,
        selector: step.selector,
        url: pageUrlRef.current,
        verdict: "block",
        reason: verdict.reason,
        userApproved: false,
        result: "blocked",
      });
      return {
        success: false,
        action: step.action,
        selector: step.selector,
        error: `Blocked: ${verdict.reason}`,
        durationMs: 0,
      };
    }

    if (verdict.tier === "confirm" || verdict.tier === "checkpoint") {
      const approved = await new Promise<boolean>((resolve) => {
        setPendingConfirm({ step, verdict, resolve });
      });
      setPendingConfirm(null);
      if (!approved) {
        await logAudit({
          timestamp: Date.now(),
          action: step.action,
          selector: step.selector,
          url: pageUrlRef.current,
          verdict: "confirm",
          reason: verdict.reason,
          userApproved: false,
          result: "blocked",
        });
        return {
          success: false,
          action: step.action,
          selector: step.selector,
          error: "Cancelled by user",
          durationMs: 0,
        };
      }
    }

    // Execute via background
    try {
      // Handle 'eval' action — runs a JS expression via CDP Runtime
      if (step.action === "eval") {
        // Lazy-attach CDP debugger only when needed (avoids the yellow banner for non-eval tasks)
        await chrome.runtime.sendMessage({ type: "ATTACH_DEBUGGER" }).catch(() => { });
        const evalRes = await chrome.runtime.sendMessage({
          type: "EVAL_JS",
          expression: step.value || step.selector,
        });
        // Detach immediately after eval to remove the banner
        chrome.runtime.sendMessage({ type: "DETACH_DEBUGGER" }).catch(() => { });
        const result = {
          success: !evalRes?.error,
          action: "eval",
          selector: step.selector,
          extractedData: evalRes?.result ?? undefined,
          error: evalRes?.error ?? undefined,
          durationMs: 0,
        };
        await logOutcome(result);
        return result;
      }
      // Handle 'download' action — saves a file found on the page
      if (step.action === "download") {
        let targetUrl = step.value || step.selector;
        // If it looks like a CSS selector (not a URL), resolve the href via eval
        if (targetUrl && !targetUrl.startsWith("http")) {
          const evalRes = await chrome.runtime.sendMessage({
            type: "EVAL_JS",
            expression: `document.querySelector(${JSON.stringify(targetUrl)})?.href || document.querySelector(${JSON.stringify(targetUrl)})?.src || ''`,
          });
          targetUrl = evalRes?.result || "";
        }
        if (!targetUrl) {
          return {
            success: false,
            action: "download",
            selector: step.selector,
            error: "Could not resolve download URL",
            durationMs: 0,
          };
        }
        const dlRes = await chrome.runtime.sendMessage({
          type: "DOWNLOAD_FILE",
          url: targetUrl,
          filename: step.description?.replace(/[^a-z0-9.]/gi, "_") || undefined,
        });
        const result = {
          success: dlRes?.ok ?? false,
          action: "download",
          selector: step.selector,
          error: dlRes?.error,
          durationMs: 0,
        };
        await logOutcome(result);
        return result;
      }
      // Handle 'tabgroup' action — organize tabs into groups
      if (step.action === "tabgroup") {
        try {
          const params = JSON.parse(step.value || "{}");
          const op = params.op || "list";
          if (op === "create") {
            const res = await chrome.runtime.sendMessage({
              type: "TAB_GROUP_CREATE",
              title: params.title,
              color: params.color,
              urls: params.urls || [],
              collapsed: params.collapsed,
            });
            const result = {
              success: res?.ok ?? false,
              action: "tabgroup",
              selector: "",
              extractedData: res?.ok
                ? `Created group "${params.title}" with ${res.tabCount} tabs`
                : undefined,
              error: res?.error,
              durationMs: 0,
            };
            await logOutcome(result);
            return result;
          } else if (op === "add") {
            const res = await chrome.runtime.sendMessage({
              type: "TAB_GROUP_ADD",
              title: params.title,
              urls: params.urls || [],
            });
            const result = {
              success: res?.ok ?? false,
              action: "tabgroup",
              selector: "",
              extractedData: res?.ok
                ? `Added ${res.addedCount} tabs to group "${params.title}"`
                : undefined,
              error: res?.error,
              durationMs: 0,
            };
            await logOutcome(result);
            return result;
          } else {
            // list
            const res = await chrome.runtime.sendMessage({
              type: "TAB_GROUP_LIST",
            });
            const summary =
              res?.groups
                ?.map((g: any) => `${g.title} (${g.color}, ${g.tabCount} tabs)`)
                .join(", ") || "No groups";
            const result = {
              success: res?.ok ?? false,
              action: "tabgroup",
              selector: "",
              extractedData: summary,
              error: res?.error,
              durationMs: 0,
            };
            await logOutcome(result);
            return result;
          }
        } catch (e: any) {
          return {
            success: false,
            action: "tabgroup",
            selector: "",
            error: `Tab group error: ${e.message}`,
            durationMs: 0,
          };
        }
      }
      // Handle 'native' action — execute local host operation via Native Messaging
      if (step.action === "native") {
        let payload: any;
        try {
          payload = JSON.parse(step.value || "{}");
        } catch {
          const result = {
            success: false,
            action: "native",
            selector: "",
            error: "Invalid native action JSON payload",
            durationMs: 0,
          };
          await logOutcome(result);
          return result;
        }
        const nativeRes = await chrome.runtime.sendMessage({
          type: "NATIVE_HOST_CALL",
          payload,
        });
        const result = {
          success: nativeRes?.ok ?? false,
          action: "native",
          selector: "",
          extractedData: nativeRes?.ok
            ? typeof nativeRes.data === "string"
              ? nativeRes.data
              : JSON.stringify(nativeRes.data ?? {})
            : undefined,
          error: nativeRes?.error,
          durationMs: 0,
        };
        await logOutcome(result);
        return result;
      }
      console.log(`[Agent] executeStep: sending EXECUTE_ACTION to background for ${step.action}`);
      const res = await chrome.runtime.sendMessage({
        type: "EXECUTE_ACTION",
        step,
      });
      console.log(`[Agent] executeStep: EXECUTE_ACTION response:`, res?.result?.success, res?.result?.error || '');
      await logOutcome(res.result);
      return res.result;
    } catch (e: any) {
      return {
        success: false,
        action: step.action,
        selector: step.selector,
        error: e.message,
        durationMs: 0,
      };
    }
  }, []);

  const streamResponse = async (
    response: Response,
    convId: string,
    hidden = false,
  ): Promise<string> => {
    const reader = response.body?.getReader();
    if (!reader) return "";
    const decoder = new TextDecoder();
    let fullText = "";

    // Add placeholder message
    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: "", hidden },
    ]);

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ") && line !== "data: [DONE]") {
            try {
              const data = JSON.parse(line.slice(6));
              const content = data.choices[0]?.delta?.content || "";
              if (content) {
                fullText += content;
                setMessages((prev) => {
                  const next = [...prev];
                  const last = next[next.length - 1];
                  last.content = fullText;
                  return next; // Trigger re-render
                });
              }
            } catch {
              /* ignore partial json */
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Attach estimated token count to the last message
    if (fullText.trim() && !hidden) {
      const tokens = estimateTokens(fullText);
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === "assistant") {
          last.tokenCount = tokens;
        }
        return next;
      });
    }

    // Persist assistant message — include tokenCount so it survives history reload
    const trimmed = fullText.trim();
    if (trimmed && !hidden && convId) {
      const cleanText = stripStructuredBlocks(trimmed);
      if (cleanText) {
        const tokens = estimateTokens(fullText);
        const encoded = encodeMessageContent({
          role: "assistant",
          content: cleanText,
          tokenCount: tokens || undefined,
        });
        saveMessage(convId, "assistant", encoded).catch(console.warn);
      }
    }

    return trimmed;
  };

  const hasMessages = messages.length > 0;

  return (
    <div className="app">
      <Header
        user={user}
        onSignOut={handleSignOut}
        activeProject={activeProjectRef.current}
      />
      <main className="main-content">
        {activeTab === "projects" ? (
          <ProjectsView />
        ) : activeTab === "workflows" ? (
          <WorkflowsView
            onRunWorkflow={(prompt) => {
              setActiveTab("home");
              handleSend(prompt);
            }}
          />
        ) : activeTab === "profile" ? (
          <ProfileView
            user={user}
            onSignIn={handleSignIn}
            onSignOut={handleSignOut}
            onSelectConversation={handleSelectConversation}
            onNewChat={handleNewChat}
            currentConversationId={currentConversationId}
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
                    <button
                      onClick={() => pendingCheckpoint.resolve(false)}
                      className="cancel-btn"
                    >
                      Stop Here
                    </button>
                    <button
                      onClick={() => pendingCheckpoint.resolve(true)}
                      className="confirm-btn"
                    >
                      Continue Task
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="center-logo">
            <Logo />
          </div>
        )}
        {activeTab !== "projects" &&
          activeTab !== "profile" &&
          activeTab !== "workflows" && (
            <div className="bottom-input">
              {!hasMessages && (
                <PageSuggestions onSuggestionClick={handleSend} />
              )}
              <SearchBox
                onSend={handleSend}
                onStop={handleStop}
                isLoading={isLoading}
                selectedModel={selectedModel}
                onModelChange={setSelectedModel}
              />
            </div>
          )}
      </main>
      <BottomNav
        activeTab={activeTab}
        onTabChange={(tab) => {
          if (tab === "home") {
            setMessages([]);
            setCurrentConversationId(null);
          }
          setActiveTab(tab);
        }}
      />

      {showAuthGate && (
        <AuthGate
          onSignIn={handleSignIn}
          onDismiss={() => setShowAuthGate(false)}
          requestCount={requestCount}
        />
      )}
    </div>
  );
}

export default App;
