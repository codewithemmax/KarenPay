import { createHmac } from "node:crypto";
import express from "express";
import { describe, expect, it, vi } from "vitest";
import { createApproveRouter, type ApproveConfig } from "../../apps/api/src/approve.js";

const secret = "a-long-test-session-secret-that-is-at-least-32-characters";
const accountId = "22222222-2222-4222-8222-222222222222";
const mandateId = "11111111-1111-4111-8111-111111111111";

const config: ApproveConfig = {
  rpID: "localhost",
  rpName: "KarenPay",
  webOrigin: "http://localhost:3000",
  sessionSecret: secret,
  supabaseUrl: "https://example.supabase.co",
  supabaseServiceRoleKey: "test-service-role-key",
  paypalClientId: "client-id",
  paypalClientSecret: "client-secret",
  paypalBaseUrl: "https://api-m.sandbox.paypal.com",
};

function sessionCookie(): string {
  const encoded = Buffer.from(JSON.stringify({ accountId, expiresAt: Date.now() + 60_000 })).toString("base64url");
  return `kp_session=${encoded}.${createHmac("sha256", secret).update(encoded).digest("base64url")}`;
}

async function withServer(run: (url: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/mandates", createApproveRouter(config));
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not receive a TCP address");
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

describe("POST /api/v1/mandates/:id/approve", () => {
  it("requires a signed session", async () => {
    await withServer(async (url) => {
      const response = await fetch(`${url}/api/v1/mandates/${mandateId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "credential-id" }),
      });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        code: "AUTH_REQUIRED",
        message: "Please sign in before approving a test payment.",
      });
    });
  });

  it("returns a stored PAID outcome without another PayPal request", async () => {
    const nativeFetch = globalThis.fetch;
    const supabaseFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://example.supabase.co") && url.includes("mandates?")) {
        return new Response(JSON.stringify([{
          id: mandateId,
          state: "PAID",
          mandate_hash: "hash",
          payee_contact_id: "33333333-3333-4333-8333-333333333333",
          amount_minor: 5000,
          currency: "USD",
          paypal_ref: "payout-1",
          spoken_text: "Test payment sent.",
        }]));
      }
      if (url.startsWith("https://example.supabase.co")) throw new Error(`Unexpected Supabase request: ${url}`);
      return nativeFetch(input, init);
    });
    globalThis.fetch = supabaseFetch as typeof fetch;
    try {
      await withServer(async (url) => {
        const response = await fetch(`${url}/api/v1/mandates/${mandateId}/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: sessionCookie() },
          body: JSON.stringify({ id: "credential-id" }),
        });
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          code: "PAID",
          message: "Test payment sent.",
          spoken: "Test payment sent.",
          paypalRef: "payout-1",
        });
        expect(supabaseFetch.mock.calls.filter(([input]) => String(input).startsWith("https://example.supabase.co")))
          .toHaveLength(1);
      });
    } finally {
      globalThis.fetch = nativeFetch;
    }
  });
});
