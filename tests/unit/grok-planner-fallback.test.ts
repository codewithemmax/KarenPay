import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { GrokClient } from "../../apps/api/src/grok.js";
import { GoogleBulkGeminiPlannerClient } from "../../apps/api/src/bulk/planner.js";

describe("GrokClient & Multi-Provider LLM Fallback", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("GrokClient", () => {
    it("sends a valid chat completions request to xAI endpoint and parses JSON", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: "chatcmpl-test-123",
          choices: [
            {
              message: {
                content: JSON.stringify({
                  needsClarification: false,
                  items: [
                    { recipientId: "11111111-1111-4111-8111-111111111111", amountMinor: 2500 },
                  ],
                }),
              },
            },
          ],
        }),
      });
      globalThis.fetch = mockFetch;

      const client = new GrokClient({
        apiKey: "xai-test-key-abc",
        model: "grok-2-latest",
        baseUrl: "https://api.x.ai/v1",
      });

      const result = await client.generateJson<{
        needsClarification: boolean;
        items: Array<{ recipientId: string; amountMinor: number }>;
      }>("Send 25 each to Ade");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.x.ai/v1/chat/completions");
      expect(init.method).toBe("POST");
      expect(init.headers["Authorization"]).toBe("Bearer xai-test-key-abc");
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe("grok-2-latest");
      expect(body.response_format).toEqual({ type: "json_object" });

      expect(result.needsClarification).toBe(false);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].amountMinor).toBe(2500);
    });

    it("auto-detects GroqCloud gsk_ key format and routes to api.groq.com with llama-3.3-70b-versatile", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  needsClarification: false,
                  items: [{ recipientId: "test-recip-1", amountMinor: 2500 }],
                }),
              },
            },
          ],
        }),
      });
      globalThis.fetch = mockFetch;

      const client = new GrokClient({
        apiKey: "gsk_live_groq_cloud_key_test_123",
      });

      const result = await client.generateJson<{
        needsClarification: boolean;
        items: Array<{ recipientId: string; amountMinor: number }>;
      }>("Send 25 each");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
      expect(init.method).toBe("POST");
      expect(init.headers["Authorization"]).toBe("Bearer gsk_live_groq_cloud_key_test_123");
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe("llama-3.3-70b-versatile");
      expect(result.items[0].amountMinor).toBe(2500);
    });

    it("throws a descriptive error when Grok API returns non-200 status", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ error: "Invalid API Key" }),
      });
      globalThis.fetch = mockFetch;

      const client = new GrokClient({
        apiKey: "invalid-key",
      });

      await expect(client.generateJson("test prompt")).rejects.toThrow(
        /API error \(401\)/,
      );
    });
  });

  describe("GoogleBulkGeminiPlannerClient fallback behavior", () => {
    const recipients = [
      {
        recipientId: "d9e93f9d-8164-4596-aa65-120edd3c5f53",
        displayName: "Ade Bello",
      },
      {
        recipientId: "9bb02885-e26a-4a79-af96-16b393fa4e36",
        displayName: "Chidinma Okafor",
      },
    ];

    it("uses deterministic parsing before contacting Grok for a uniform amount", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  needsClarification: false,
                  items: [
                    { recipientId: "d9e93f9d-8164-4596-aa65-120edd3c5f53", amountMinor: 5000 },
                    { recipientId: "9bb02885-e26a-4a79-af96-16b393fa4e36", amountMinor: 5000 },
                  ],
                }),
              },
            },
          ],
        }),
      });
      globalThis.fetch = mockFetch;

      const planner = new GoogleBulkGeminiPlannerClient(
        "mock-gemini-key",
        "gemini-2.5-flash",
        {
          grokApiKey: "xai-test-key",
          grokModel: "grok-2-latest",
        },
      );

      // Force Gemini client models.generateContent to throw 503
      (planner as any).client = {
        models: {
          generateContent: vi.fn().mockRejectedValue({
            status: 503,
            message: "This model is currently experiencing high demand.",
          }),
        },
      };

      const result = (await planner.planAmounts("Send 50 each", recipients)) as {
        needsClarification: boolean;
        items: Array<{ recipientId: string; amountMinor: number }>;
      };

      expect(result.needsClarification).toBe(false);
      expect(result.items).toHaveLength(2);
      expect(result.items[0].amountMinor).toBe(5000);
      expect(result.items[1].amountMinor).toBe(5000);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("uses deterministic parsing before contacting Groq for a uniform amount", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  needsClarification: false,
                  items: [
                    { recipientId: "d9e93f9d-8164-4596-aa65-120edd3c5f53", amountMinor: 2500 },
                    { recipientId: "9bb02885-e26a-4a79-af96-16b393fa4e36", amountMinor: 2500 },
                  ],
                }),
              },
            },
          ],
        }),
      });
      globalThis.fetch = mockFetch;

      const planner = new GoogleBulkGeminiPlannerClient(
        "mock-gemini-key",
        "gemini-2.5-flash",
        {
          groqApiKey: "gsk-test-groq-key",
          groqModel: "llama-3.3-70b-versatile",
        },
      );

      (planner as any).client = {
        models: {
          generateContent: vi.fn().mockRejectedValue({
            status: 503,
            message: "Overloaded",
          }),
        },
      };

      const result = (await planner.planAmounts("25 dollars each", recipients)) as {
        needsClarification: boolean;
        items: Array<{ recipientId: string; amountMinor: number }>;
      };

      expect(result.needsClarification).toBe(false);
      expect(result.items).toHaveLength(2);
      expect(result.items[0].amountMinor).toBe(2500);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("falls back to deterministic parsing when Gemini 503s and no fallback key is configured", async () => {
      const planner = new GoogleBulkGeminiPlannerClient(
        "mock-gemini-key",
        "gemini-2.5-flash",
        {},
      );

      (planner as any).client = {
        models: {
          generateContent: vi.fn().mockRejectedValue({
            status: 503,
            message: "This model is currently experiencing high demand. Spikes in demand are usually temporary.",
          }),
        },
      };

      const result = (await planner.planAmounts("25 each", recipients)) as {
        needsClarification: boolean;
        items: Array<{ recipientId: string; amountMinor: number }>;
      };

      expect(result.needsClarification).toBe(false);
      expect(result.items).toHaveLength(2);
      expect(result.items[0].recipientId).toBe("d9e93f9d-8164-4596-aa65-120edd3c5f53");
      expect(result.items[0].amountMinor).toBe(2500);
      expect(result.items[1].recipientId).toBe("9bb02885-e26a-4a79-af96-16b393fa4e36");
      expect(result.items[1].amountMinor).toBe(2500);
    });

    it("returns clarification required when Gemini fails and instruction has ambiguous amounts", async () => {
      const planner = new GoogleBulkGeminiPlannerClient(
        "mock-gemini-key",
        "gemini-2.5-flash",
        {},
      );

      (planner as any).client = {
        models: {
          generateContent: vi.fn().mockRejectedValue({
            status: 503,
            message: "High demand",
          }),
        },
      };

      const result = (await planner.planAmounts("send some money", recipients)) as {
        needsClarification: boolean;
        items: Array<{ recipientId: string; amountMinor: number }>;
      };

      expect(result.needsClarification).toBe(true);
      expect(result.items).toHaveLength(0);
    });
  });
});
