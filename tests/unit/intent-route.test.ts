import { createHmac } from "node:crypto";
import express from "express";
import { describe, expect, it, vi } from "vitest";
import { createIntentRouter, type GeminiIntentClient, type IntentConfig } from "../../apps/api/src/intents.js";

const secret = "a-long-test-session-secret-that-is-at-least-32-characters";
const accountId = "22222222-2222-4222-8222-222222222222";
const contacts = [
  { id: "33333333-3333-4333-8333-333333333333", display_name: "Ade Bello" },
  { id: "44444444-4444-4444-8444-444444444444", display_name: "Ada Bello" },
];

const config: IntentConfig = {
  rpID: "localhost",
  rpName: "KarenPay",
  webOrigin: "http://localhost:3000",
  sessionSecret: secret,
  supabaseUrl: "https://example.supabase.co",
  supabaseServiceRoleKey: "test-service-role-key",
  geminiApiKey: "test-key",
  geminiModel: "test-model",
  maxRequestsPerMinute: 10,
};

function sessionCookie(): string {
  const encoded = Buffer.from(JSON.stringify({ accountId, expiresAt: Date.now() + 60_000 })).toString("base64url");
  return `kp_session=${encoded}.${createHmac("sha256", secret).update(encoded).digest("base64url")}`;
}

async function withServer(client: GeminiIntentClient, run: (url: string) => Promise<void>): Promise<void> {
  const nativeFetch = globalThis.fetch;
  const supabaseFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).startsWith("https://example.supabase.co")) return new Response(JSON.stringify(contacts));
    return nativeFetch(input, init);
  });
  globalThis.fetch = supabaseFetch as typeof fetch;
  const app = express();
  app.use(express.json());
  app.use("/api/v1/intent", createIntentRouter(config, client));
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not receive a TCP address");
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    globalThis.fetch = nativeFetch;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function intentRequest(url: string): Promise<Response> {
  return fetch(`${url}/api/v1/intent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: sessionCookie() },
    body: JSON.stringify({ transcript: "Send fifty dollars to Ade Bello" }),
  });
}

describe("POST /api/v1/intent", () => {
  it("maps a strict Gemini proposal to an owned contact without exposing account data", async () => {
    const client: GeminiIntentClient = { extract: async (_transcript, names) => {
      expect(names).toEqual(["Ade Bello", "Ada Bello"]);
      return { action: "send_money", contactIndex: 0, amountMinor: 5000, currency: "USD", needsClarification: false, candidateIndexes: [0] };
    } };
    await withServer(client, async (url) => {
      const response = await intentRequest(url);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        needsClarification: false,
        proposal: { action: "send_money", payeeContactId: contacts[0].id, amountMinor: 5000, currency: "USD" },
      });
    });
  });

  it("returns clarification instead of silently choosing between contacts", async () => {
    const client: GeminiIntentClient = { extract: async () => ({
      action: "send_money", contactIndex: null, amountMinor: 5000, currency: "USD", needsClarification: true, candidateIndexes: [0, 1],
    }) };
    await withServer(client, async (url) => {
      const response = await intentRequest(url);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ needsClarification: true, candidates: ["Ade Bello", "Ada Bello"] });
    });
  });

  it("rejects malformed model output without crashing", async () => {
    const client: GeminiIntentClient = { extract: async () => ({ action: "send_money", contactIndex: 9 }) };
    await withServer(client, async (url) => {
      const response = await intentRequest(url);
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ code: "INTENT_INVALID", message: "Please say the recipient, amount, and currency." });
    });
  });
});
