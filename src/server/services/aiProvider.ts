/**
 * Shared AI provider resolution for remediation & narrative generation.
 *
 * Resolution order:
 *   1. Admin-configured dedicated provider (Settings → AI Remediation)
 *   2. Project's own LLM provider (Ollama, OpenAI, Anthropic, custom)
 *   3. ANTHROPIC_API_KEY env var as cloud fallback
 */
import { logger } from "../utils/logger.js";
import { resolveForHost } from "../utils/resolveEndpoint.js";
import { getSetting } from "./settingsService.js";
import { getContextWindow, getContextWindowWithDefault } from "../utils/tokenBudget.js";
import { getOllamaTimeoutMs } from "../utils/ollamaTimeout.js";

/** Lazily import the Anthropic SDK (avoids top-level import when unused). */
async function loadAnthropicSdk() {
  return (await import("@anthropic-ai/sdk")).default;
}

export interface ProjectInfo {
  providerType: string;
  targetUrl: string;
  providerConfig: Record<string, unknown>;
}

/**
 * High-level call that checks the admin remediation settings first, then falls
 * back to the project's provider, then to the ANTHROPIC_API_KEY env var.
 */
export async function callWithSettingsFallback(
  prompt: string,
  project: ProjectInfo | null,
  maxTokens = 4096,
  contextWindow?: number
): Promise<string> {
  // 1. Check if admin configured a dedicated remediation provider in settings
  const remProviderType = await getSetting("remediation.providerType");

  if (remProviderType && remProviderType !== "project") {
    const remConfigRaw = await getSetting("remediation.providerConfig");
    const remConfig: Record<string, unknown> = remConfigRaw
      ? JSON.parse(remConfigRaw)
      : {};
    logger.debug(
      `[AI] Using remediation provider: ${remProviderType}, hasApiKey: ${!!remConfig.apiKey}, model: ${(remConfig.model as string) ?? "(default)"}`
    );
    return callLLM(
      prompt,
      remProviderType,
      (remConfig.endpoint as string) ?? "",
      remConfig,
      maxTokens,
      contextWindow
    );
  }

  // 2. Default: project provider + Anthropic env fallback
  return callLLM(
    prompt,
    project?.providerType ?? "ollama",
    project?.targetUrl ?? "",
    project?.providerConfig ?? {},
    maxTokens,
    contextWindow
  );
}

// ─── Internal helpers ────────────────────────────────────────────────────────

async function callLLM(
  prompt: string,
  providerType: string,
  targetUrl: string,
  providerConfig: Record<string, unknown>,
  maxTokens: number,
  contextWindow?: number
): Promise<string> {
  const model = (providerConfig.model as string) || "";
  const effectiveCtx = contextWindow ?? getContextWindowWithDefault(model, providerType);
  let lastError: string | undefined;

  // 1. Try the specified provider
  try {
    const text = await callProvider(prompt, providerType, targetUrl, providerConfig, model, maxTokens, effectiveCtx);
    if (text) return text;
    lastError = `${providerType} provider returned an empty response`;
    logger.warn(`[AI] ${lastError}`);
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    logger.warn(`[AI] Provider (${providerType}) failed: ${lastError}`);
  }

  // 2. Fall back to Anthropic API if configured
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    try {
      const Anthropic = await loadAnthropicSdk();
      const client = new Anthropic({ apiKey: anthropicKey });
      const message = await client.messages.create({
        model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      });
      if (message.stop_reason === "max_tokens") {
        logger.warn("[AI] Anthropic fallback response was truncated (stop_reason=max_tokens)");
      }
      const block = message.content[0];
      if (block?.type === "text") return block.text;
    } catch (err) {
      logger.warn(`[AI] Anthropic fallback failed: ${err}`);
    }
  }

  // Surface the actual provider error so the user can diagnose
  throw new Error(
    lastError ??
      "No AI provider available. Configure a provider in Settings → AI Remediation."
  );
}

async function callProvider(
  prompt: string,
  providerType: string,
  targetUrl: string,
  providerConfig: Record<string, unknown>,
  model: string,
  maxTokens: number,
  contextWindow: number
): Promise<string | null> {
  switch (providerType) {
    case "ollama": {
      const originalUrl = (targetUrl || "http://localhost:11434").replace(/\/+$/, "");
      const url = resolveForHost(originalUrl);

      // Only set num_ctx when the model is known — for unknown models, let
      // Ollama use its built-in default.  Forcing 32 768 on a small local
      // model can exhaust VRAM and cause Ollama to crash (→ "Failed to fetch").
      const knownCtx = getContextWindow(model || "llama3", "ollama");
      const ollamaOptions = knownCtx !== null ? { num_ctx: knownCtx } : {};

      const ollamaBody = {
        model: model || "llama3",
        messages: [{ role: "user", content: prompt }],
        stream: false,
        options: ollamaOptions,
      };

      logger.debug(
        `[AI] Ollama request: model=${ollamaBody.model}` +
          (knownCtx !== null ? `, num_ctx=${knownCtx}` : ` (num_ctx: Ollama default)`)
      );

      // Try direct connection first (backend → Ollama).
      const timeoutMs = getOllamaTimeoutMs();
      let directResp: Response | null = null;
      try {
        directResp = await fetch(`${url}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(ollamaBody),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        // Timeout = model IS reachable but slow. Don't fall through to relay.
        if (err instanceof DOMException && err.name === "TimeoutError") {
          const mins = Math.round(timeoutMs / 60_000);
          throw new Error(
            `Ollama is responding but the request timed out after ${mins} minutes. ` +
            "This can happen with large prompts on smaller models. " +
            "Try a faster model, reduce the number of findings, or increase OLLAMA_TIMEOUT."
          );
        }
        // Connection error (ECONNREFUSED, DNS failure) — fall through to relay.
      }

      if (directResp !== null) {
        if (directResp.ok) {
          const data = (await directResp.json()) as { message?: { content?: string } };
          return data.message?.content ?? null;
        }
        // Ollama returned an HTTP error — surface it immediately.
        const errText = await directResp.text().catch(() => "");
        throw new Error(`Ollama returned HTTP ${directResp.status}: ${errText || "(no body)"}`);
      }

      // Direct connection failed (network error) — relay through the browser.
      // Use originalUrl (not the Docker-resolved one) so the browser can reach
      // localhost:11434 on the user's machine.
      const { queueRelayRequest } = await import("./ollamaRelay.js");
      const data = (await queueRelayRequest(originalUrl, "/api/chat", ollamaBody, timeoutMs)) as {
        message?: { content?: string };
      };
      return data.message?.content ?? null;
    }

    case "openai": {
      const apiKey = providerConfig.apiKey as string | undefined;
      if (!apiKey) throw new Error("OpenAI API key not configured — save your key in Settings → AI Remediation");
      const base = resolveForHost((targetUrl || "https://api.openai.com").replace(/\/+$/, ""));
      const resp = await fetch(`${base}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model || "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
          max_completion_tokens: maxTokens,
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!resp.ok) {
        const errBody = await resp.text().catch(() => "");
        let detail = "";
        try {
          const parsed = JSON.parse(errBody);
          detail = parsed?.error?.message ?? errBody;
        } catch {
          detail = errBody;
        }
        throw new Error(`OpenAI returned ${resp.status}: ${detail}`);
      }
      const data = (await resp.json()) as {
        choices?: { message?: { content?: string }; finish_reason?: string }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };

      const choice = data.choices?.[0];
      if (choice?.finish_reason === "length") {
        logger.warn(
          `[AI] OpenAI response truncated (finish_reason=length). ` +
          `prompt_tokens=${data.usage?.prompt_tokens}, completion_tokens=${data.usage?.completion_tokens}`
        );
        throw new Error(
          "AI response was truncated — the model ran out of output tokens. " +
          "Try a model with a larger context window or reduce the number of findings."
        );
      }

      return choice?.message?.content ?? null;
    }

    case "anthropic": {
      const apiKey = providerConfig.apiKey as string | undefined;
      if (!apiKey) throw new Error("Anthropic API key not configured — save your key in Settings → AI Remediation");
      const Anthropic = await loadAnthropicSdk();
      const client = new Anthropic({ apiKey });
      const message = await client.messages.create({
        model: model || "claude-haiku-4-5-20251001",
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      });
      if (message.stop_reason === "max_tokens") {
        logger.warn("[AI] Anthropic response truncated (stop_reason=max_tokens)");
      }
      const block = message.content[0];
      return block?.type === "text" ? block.text : null;
    }

    case "custom":
    default: {
      if (!targetUrl) throw new Error("Custom provider endpoint URL not configured");
      const resolvedUrl = resolveForHost(targetUrl);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(providerConfig.headers as Record<string, string> | undefined),
      };
      const apiKey = providerConfig.apiKey as string | undefined;
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

      const resp = await fetch(resolvedUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          max_completion_tokens: maxTokens,
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!resp.ok) {
        const errBody = await resp.text().catch(() => "");
        let detail = "";
        try {
          const parsed = JSON.parse(errBody);
          detail = parsed?.error?.message ?? errBody;
        } catch {
          detail = errBody;
        }
        throw new Error(`Custom endpoint returned ${resp.status}: ${detail}`);
      }
      const data = (await resp.json()) as {
        choices?: { message?: { content?: string }; finish_reason?: string }[];
        message?: { content?: string };
        response?: string;
      };

      // Check for truncation on OpenAI-compatible custom endpoints
      const customChoice = data.choices?.[0];
      if (customChoice?.finish_reason === "length") {
        logger.warn("[AI] Custom endpoint response truncated (finish_reason=length)");
        throw new Error(
          "AI response was truncated — the model ran out of output tokens. " +
          "Try a model with a larger context window or reduce the number of findings."
        );
      }

      return (
        customChoice?.message?.content ??
        data.message?.content ??
        data.response ??
        null
      );
    }
  }
}

/**
 * Test a provider configuration with a minimal prompt.
 * Throws on failure with a descriptive error message.
 */
export async function testProvider(
  providerType: string,
  providerConfig: Record<string, unknown>,
  endpoint?: string
): Promise<void> {
  const model = (providerConfig.model as string) || "";
  const targetUrl = endpoint ?? (providerConfig.endpoint as string) ?? "";
  const ctxWindow = getContextWindowWithDefault(model, providerType);
  const text = await callProvider(
    "Respond with exactly: OK",
    providerType,
    targetUrl,
    providerConfig,
    model,
    32,
    ctxWindow
  );
  if (!text) throw new Error(`${providerType} returned an empty response`);
}
