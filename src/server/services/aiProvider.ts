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
  maxTokens = 4096
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
      maxTokens
    );
  }

  // 2. Default: project provider + Anthropic env fallback
  return callLLM(
    prompt,
    project?.providerType ?? "ollama",
    project?.targetUrl ?? "",
    project?.providerConfig ?? {},
    maxTokens
  );
}

// ─── Internal helpers ────────────────────────────────────────────────────────

async function callLLM(
  prompt: string,
  providerType: string,
  targetUrl: string,
  providerConfig: Record<string, unknown>,
  maxTokens: number
): Promise<string> {
  const model = (providerConfig.model as string) || "";
  let lastError: string | undefined;

  // 1. Try the specified provider
  try {
    const text = await callProvider(prompt, providerType, targetUrl, providerConfig, model, maxTokens);
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
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const client = new Anthropic({ apiKey: anthropicKey });
      const message = await client.messages.create({
        model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      });
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
  maxTokens: number
): Promise<string | null> {
  switch (providerType) {
    case "ollama": {
      const url = resolveForHost((targetUrl || "http://localhost:11434").replace(/\/+$/, ""));
      const ollamaBody = {
        model: model || "llama3",
        messages: [{ role: "user", content: prompt }],
        stream: false,
      };

      // Try direct connection first
      try {
        const resp = await fetch(`${url}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(ollamaBody),
          signal: AbortSignal.timeout(120_000),
        });
        if (resp.ok) {
          const data = (await resp.json()) as { message?: { content?: string } };
          return data.message?.content ?? null;
        }
      } catch {
        // Fall through to browser relay.
      }

      // Browser relay fallback
      const { queueRelayRequest } = await import("./ollamaRelay.js");
      const data = (await queueRelayRequest(url, "/api/chat", ollamaBody)) as {
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
          max_tokens: maxTokens,
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!resp.ok) throw new Error(`OpenAI returned ${resp.status}`);
      const data = (await resp.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      return data.choices?.[0]?.message?.content ?? null;
    }

    case "anthropic": {
      const apiKey = providerConfig.apiKey as string | undefined;
      if (!apiKey) throw new Error("Anthropic API key not configured — save your key in Settings → AI Remediation");
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const client = new Anthropic({ apiKey });
      const message = await client.messages.create({
        model: model || "claude-haiku-4-5-20251001",
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      });
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
          max_tokens: maxTokens,
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!resp.ok) throw new Error(`Custom endpoint returned ${resp.status}`);
      const data = (await resp.json()) as {
        choices?: { message?: { content?: string } }[];
        message?: { content?: string };
        response?: string;
      };
      return (
        data.choices?.[0]?.message?.content ??
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
  const text = await callProvider(
    "Respond with exactly: OK",
    providerType,
    targetUrl,
    providerConfig,
    model,
    32
  );
  if (!text) throw new Error(`${providerType} returned an empty response`);
}
