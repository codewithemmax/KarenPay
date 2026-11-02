export interface GroqClientConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

export type GrokClientConfig = GroqClientConfig;

export interface GroqChatCompletionResponse {
  id?: string;
  choices?: Array<{
    message?: {
      content?: string;
    };
    finish_reason?: string;
  }>;
}

/**
 * Lightweight OpenAI-compatible JSON client for GroqCloud (and xAI Grok / generic providers).
 * Uses native fetch without requiring third-party SDKs.
 * Automatically defaults to GroqCloud (llama-3.3-70b-versatile) when using a Groq key (e.g. gsk_...).
 */
export class GroqClient {
  constructor(private readonly config: GroqClientConfig) {}

  async generateJson<T = unknown>(
    prompt: string,
    systemPrompt = "You are a financial planning parser. Always output valid JSON strictly matching the requested format.",
  ): Promise<T> {
    const isGroqKey =
      this.config.apiKey.startsWith("gsk_") ||
      (this.config.baseUrl && this.config.baseUrl.includes("groq.com"));

    const defaultBaseUrl = isGroqKey
      ? "https://api.groq.com/openai/v1"
      : "https://api.x.ai/v1";

    const defaultModel = isGroqKey
      ? "llama-3.3-70b-versatile"
      : "grok-2-latest";

    const baseUrl = (this.config.baseUrl || defaultBaseUrl).replace(/\/+$/, "");
    const model = this.config.model || defaultModel;
    const url = `${baseUrl}/chat/completions`;

    const providerName = isGroqKey ? "GroqCloud" : "Grok/xAI";
    console.log(
      `[${providerName}] Sending request to ${url} (model=${model}, promptLength=${prompt.length})...`,
    );

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system" as const, content: systemPrompt },
          { role: "user" as const, content: prompt },
        ],
        temperature: 0,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      let errText: string;
      try {
        errText = await response.text();
      } catch {
        errText = "(could not read response text)";
      }
      console.error(
        `[${providerName} Error] Request failed with status ${response.status}:`,
        errText,
      );
      throw new Error(`${providerName} API error (${response.status}): ${errText}`);
    }

    const data = (await response.json()) as GroqChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      console.error(`[${providerName} Error] Response missing message content:`, data);
      throw new Error(`${providerName} returned empty response text`);
    }

    console.log(
      `[${providerName}] Response received successfully (${content.length} chars).`,
    );
    return JSON.parse(content) as T;
  }
}

// Backward-compatible alias
export const GrokClient = GroqClient;
