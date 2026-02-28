import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// --- Model Configurations ---

/** Models using OpenAI-compatible chat/completions API */
const OPENAI_COMPAT_MODELS: Record<
  string,
  { apiUrl: string; model: string; apiKeyEnv: string }
> = {
  "kimi-k2.5": {
    apiUrl: "https://integrate.api.nvidia.com/v1/chat/completions",
    model: "moonshotai/kimi-k2.5",
    apiKeyEnv: "KIMI_API_KEY",
  },
  "gpt-oss-20b": {
    apiUrl: "https://api.groq.com/openai/v1/chat/completions",
    model: "openai/gpt-oss-20b",
    apiKeyEnv: "GROQ_API_KEY",
  },
  "llama-4-scout": {
    apiUrl: "https://api.groq.com/openai/v1/chat/completions",
    model: "meta-llama/llama-4-scout-17b-16e-instruct",
    apiKeyEnv: "GROQ_API_KEY",
  },
};

/** Gemini model configuration */
const GEMINI_CONFIG = {
  id: "gemini-3-pro",
  model: "gemini-3-flash-preview",
  apiKeyEnv: "GEMINI_API_KEY",
  baseUrl: "https://generativelanguage.googleapis.com/v1beta/models",
};

const DEFAULT_MODEL = "gemini-3-pro";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// --- Gemini helpers ---

/**
 * Converts OpenAI-style messages to Gemini's `contents` + `systemInstruction`.
 * Handles multimodal content (image_url with base64 data URLs).
 */
function convertToGeminiFormat(messages: any[]): {
  contents: any[];
  systemInstruction?: any;
} {
  let systemInstruction: any = undefined;
  const contents: any[] = [];

  for (const msg of messages) {
    // Extract system messages as systemInstruction
    if (msg.role === "system") {
      const text =
        typeof msg.content === "string"
          ? msg.content
          : msg.content
            .filter((p: any) => p.type === "text")
            .map((p: any) => p.text)
            .join("\n");
      systemInstruction = { parts: [{ text }] };
      continue;
    }

    // Map role: assistant → model
    const role = msg.role === "assistant" ? "model" : "user";

    // Build parts from content
    const parts: any[] = [];

    if (typeof msg.content === "string") {
      parts.push({ text: msg.content });
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "text") {
          parts.push({ text: part.text });
        } else if (part.type === "image_url" && part.image_url?.url) {
          // Convert data URL to Gemini inline_data format
          const dataUrl: string = part.image_url.url;
          if (dataUrl.startsWith("data:")) {
            const commaIdx = dataUrl.indexOf(",");
            const meta = dataUrl.substring(5, commaIdx); // e.g. "image/png;base64"
            const mimeType = meta.split(";")[0];
            const base64Data = dataUrl.substring(commaIdx + 1);
            parts.push({
              inline_data: {
                mime_type: mimeType,
                data: base64Data,
              },
            });
          }
        }
      }
    }

    if (parts.length > 0) {
      contents.push({ role, parts });
    }
  }

  return { contents, systemInstruction };
}

/**
 * Calls Gemini's streaming endpoint and returns a ReadableStream
 * that emits OpenAI-compatible SSE chunks, so the frontend
 * `streamResponse()` works unchanged.
 */
async function callGeminiStreaming(
  messages: any[],
  apiKey: string,
): Promise<ReadableStream<Uint8Array>> {
  const { contents, systemInstruction } = convertToGeminiFormat(messages);

  const url = `${GEMINI_CONFIG.baseUrl}/${GEMINI_CONFIG.model}:streamGenerateContent?alt=sse&key=${apiKey}`;

  const body: any = {
    contents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 4096,
    },
  };

  if (systemInstruction) {
    body.systemInstruction = systemInstruction;
  }

  const requestBody = JSON.stringify(body);
  const MAX_RETRIES = 3;
  let response: Response | null = null;
  let lastError = "";
  let lastStatus = 0;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 4000);
      console.log(
        `Gemini retry ${attempt + 1}/${MAX_RETRIES} after ${delayMs}ms...`,
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody,
      });

      if (res.ok) {
        response = res;
        if (attempt > 0)
          console.log(`Gemini succeeded on attempt ${attempt + 1}`);
        break;
      }

      lastStatus = res.status;
      lastError = await res.text();
      console.error(
        `Gemini API error (attempt ${attempt + 1}, status ${lastStatus}): ${lastError.substring(0, 500)}`,
      );
    } catch (fetchErr: any) {
      lastError = fetchErr.message || String(fetchErr);
      console.error(
        `Gemini fetch error (attempt ${attempt + 1}): ${lastError}`,
      );
    }
  }

  if (!response) {
    throw new Error(
      `Gemini API failed after ${MAX_RETRIES} attempts (last status: ${lastStatus}): ${lastError.substring(0, 200)}`,
    );
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  // Transform Gemini SSE → OpenAI-compatible SSE
  return new ReadableStream({
    async pull(controller) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          // Send [DONE] marker
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          return;
        }

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;

          try {
            const geminiChunk = JSON.parse(jsonStr);

            // Skip error-only chunks (e.g., transient Gemini errors mid-stream)
            if (geminiChunk?.error) {
              console.error(
                "Gemini SSE error chunk:",
                JSON.stringify(geminiChunk.error),
              );
              continue;
            }

            const text =
              geminiChunk?.candidates?.[0]?.content?.parts?.[0]?.text || "";

            if (text) {
              // Re-wrap as OpenAI-compatible delta
              const openaiChunk = {
                choices: [
                  {
                    delta: { content: text },
                    index: 0,
                  },
                ],
              };
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(openaiChunk)}\n\n`),
              );
            }
          } catch {
            // Skip malformed chunks
          }
        }
      }
    },
    cancel() {
      reader.cancel();
    },
  });
}

// ── NEW: Tool-call helpers ─────────────────────────────────────────

/**
 * Calls Gemini generateContent (non-streaming) with function declarations.
 * Used for agentic loop turns where we need a structured tool_call back.
 */
async function callGeminiToolCall(
  messages: any[],
  tools: any,
  apiKey: string,
): Promise<any> {
  const { contents, systemInstruction } = convertToGeminiFormat(messages);

  const url = `${GEMINI_CONFIG.baseUrl}/${GEMINI_CONFIG.model}:generateContent?key=${apiKey}`;

  const body: any = {
    contents,
    tools: [tools], // tools = { functionDeclarations: [...] }
    toolConfig: {
      functionCallingConfig: {
        mode: "AUTO", // Model decides when to call a function
      },
    },
    generationConfig: {
      temperature: 0.1, // Low temp for deterministic action selection
      maxOutputTokens: 512, // Actions are small payloads
    },
  };

  if (systemInstruction) {
    body.systemInstruction = systemInstruction;
  }

  const MAX_RETRIES = 3;
  let lastError = "";

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise((r) =>
        setTimeout(r, Math.min(1000 * Math.pow(2, attempt - 1), 4000)),
      );
    }
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        return await res.json();
      }
      lastError = await res.text();
      console.error(`Gemini tool-call error (attempt ${attempt + 1}): ${lastError.substring(0, 500)}`);
    } catch (err: any) {
      lastError = err.message;
    }
  }
  throw new Error(`Gemini tool-call failed: ${lastError.substring(0, 200)}`);
}

/**
 * Calls an OpenAI-compatible endpoint (Groq / NVIDIA) with tools array.
 * Non-streaming — returns the complete message object.
 */
async function callOpenAIToolCall(
  apiUrl: string,
  model: string,
  apiKey: string,
  messages: any[],
  tools: any[],
): Promise<any> {
  const MAX_RETRIES = 3;
  let lastError = "";

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise((r) =>
        setTimeout(r, Math.min(1000 * Math.pow(2, attempt - 1), 4000)),
      );
    }
    try {
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          tools,
          tool_choice: "auto",
          stream: false,
          temperature: 0.1, // Low temp for deterministic action selection
          max_tokens: 512,  // Actions are small payloads
        }),
      });

      if (res.ok) {
        return await res.json();
      }
      lastError = await res.text();
      console.error(`OpenAI tool-call error (attempt ${attempt + 1}): ${lastError.substring(0, 500)}`);
    } catch (err: any) {
      lastError = err.message;
    }
  }
  throw new Error(`OpenAI tool-call failed: ${lastError.substring(0, 200)}`);
}

// --- Main handler ---

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { messages, model: requestedModel, mode, tools } = await req.json();

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      throw new Error("messages array is required");
    }

    // ── TOOL-CALL mode (agentic loop) ──────────────────────────────
    // mode="tool" → non-streaming, returns raw provider JSON
    // The sidebar's toolCallAdapter.ts translates this to ActionPlan etc.
    if (mode === "tool") {
      if (!tools) {
        throw new Error("tools array is required for mode=tool");
      }

      // Gemini path
      if (requestedModel === GEMINI_CONFIG.id || !requestedModel) {
        const apiKey = Deno.env.get(GEMINI_CONFIG.apiKeyEnv);
        if (!apiKey) throw new Error(`${GEMINI_CONFIG.apiKeyEnv} is not configured`);

        console.log(`[tool-call] Routing to Gemini → ${GEMINI_CONFIG.model}`);
        const result = await callGeminiToolCall(messages, tools, apiKey);

        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // OpenAI-compatible path (Groq / NVIDIA)
      const modelKey = requestedModel && OPENAI_COMPAT_MODELS[requestedModel]
        ? requestedModel
        : null;

      if (!modelKey) {
        throw new Error(`Unknown model for tool-call mode: ${requestedModel}`);
      }

      const config = OPENAI_COMPAT_MODELS[modelKey];
      const apiKey = Deno.env.get(config.apiKeyEnv);
      if (!apiKey) throw new Error(`${config.apiKeyEnv} is not configured`);

      console.log(`[tool-call] Routing to ${modelKey} → ${config.model}`);
      const result = await callOpenAIToolCall(
        config.apiUrl,
        config.model,
        apiKey,
        messages,
        tools,
      );

      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── STREAM mode (chat / informational) ─────────────────────────
    // mode="stream" or no mode → SSE streaming (existing behaviour)

    // --- Gemini path ---
    if (requestedModel === GEMINI_CONFIG.id) {
      const apiKey = Deno.env.get(GEMINI_CONFIG.apiKeyEnv);
      if (!apiKey) {
        throw new Error(`${GEMINI_CONFIG.apiKeyEnv} is not configured`);
      }

      console.log(`Routing to Gemini → ${GEMINI_CONFIG.model}`);

      const stream = await callGeminiStreaming(messages, apiKey);

      return new Response(stream, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    // --- OpenAI-compatible path (Kimi, Groq, etc.) ---
    const modelKey =
      requestedModel && OPENAI_COMPAT_MODELS[requestedModel]
        ? requestedModel
        : DEFAULT_MODEL;

    // If modelKey fell through to default AND default is Gemini, handle it
    if (modelKey === GEMINI_CONFIG.id) {
      const apiKey = Deno.env.get(GEMINI_CONFIG.apiKeyEnv);
      if (!apiKey)
        throw new Error(`${GEMINI_CONFIG.apiKeyEnv} is not configured`);
      console.log(`Routing to Gemini (fallback) → ${GEMINI_CONFIG.model}`);
      const stream = await callGeminiStreaming(messages, apiKey);
      return new Response(stream, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    const config = OPENAI_COMPAT_MODELS[modelKey];
    const apiKey = Deno.env.get(config.apiKeyEnv);
    if (!apiKey) {
      throw new Error(`${config.apiKeyEnv} is not configured`);
    }

    console.log(
      `Routing to ${modelKey} → ${config.model} via ${config.apiUrl}`,
    );

    const response = await fetch(config.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: "system",
            content:
              "You are PageClick AI, a helpful assistant inside a browser sidebar. Be concise and lightning fast.",
          },
          ...messages,
        ],
        temperature: 0.7,
        max_tokens: 2048,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`API error (${modelKey}): ${errorText}`);
      throw new Error(`API error (${response.status}): ${errorText}`);
    }

    return new Response(response.body, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Edge function error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  }
});
