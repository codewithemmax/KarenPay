import { createHmac } from "node:crypto";
import express from "express";
import { describe, expect, it, vi } from "vitest";
import { createMandateRouter, type MandateConfig } from "../../apps/api/src/mandates.js";

const secret = "a-long-test-session-secret-that-is-at-least-32-characters";
const accountId = "22222222-2222-4222-8222-222222222222";
const contactId = "33333333-3333-4333-8333-333333333333";

const config: MandateConfig = {
  rpID: "localhost",
  rpName: "KarenPay",
  webOrigin: "http://localhost:3000",
  sessionSecret: secret,
  supabaseUrl: "https://example.supabase.co",
  supabaseServiceRoleKey: "test-service-role-key",
  mandateTtlSeconds: 120,
  paymentPolicy: { maximumAmountMinor: 10_000, allowedCurrencies: ["USD"] },
};

function sessionCookie(): string {
  const encoded = Buffer.from(JSON.stringify({ accountId, expiresAt: Date.now() + 60_000 })).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `kp_session=${encoded}.${signature}`;
}

function requestBody(): object {
  return {
    proposal: { action: "send_money", payeeContactId: contactId, amountMinor: 5000, currency: "USD" },
    requestConstraints: { action: "send_money", payeeContactId: contactId, maximumAmountMinor: 10_000, currency: "USD" },
    requestHash: "request-hash",
  };
}

async function withServer(run: (url: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/mandates", createMandateRouter(config));
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

describe("POST /api/v1/mandates", () => {
  it("requires a valid signed session before processing a mandate", async () => {
    await withServer(async (url) => {
      const response = await fetch(`${url}/api/v1/mandates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody()),
      });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        code: "AUTH_REQUIRED",
        message: "Please sign in before creating a test payment.",
      });
    });
  });

  it("stores a CREATED mandate and uses its hash as the approval challenge", async () => {
    const nativeFetch = globalThis.fetch;
    const supabaseFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://example.supabase.co") && url.includes("contacts?")) {
        return new Response(JSON.stringify([{
          id: contactId,
          display_name: "Ade Bello",
          paypal_sandbox_email: "ade@example.com",
        }]));
      }
      if (url.startsWith("https://example.supabase.co")) {
        return new Response("", { status: 201 });
      }
      return nativeFetch(input, init);
    });
    globalThis.fetch = supabaseFetch as typeof fetch;
    try {
      await withServer(async (url) => {
        const response = await fetch(`${url}/api/v1/mandates`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: sessionCookie() },
          body: JSON.stringify(requestBody()),
        });
        expect(response.status).toBe(201);
        const body = await response.json() as {
          mandateId: string;
          mandateHash: string;
          spoken: string;
          readoutRequired: boolean;
          approvalOptions: { challenge: string; userVerification: string };
        };
        expect(body.readoutRequired).toBe(true);
        expect(body.spoken).toContain("Ade Bello");
        expect(body.approvalOptions.challenge).toBe(body.mandateHash);
        expect(body.approvalOptions.userVerification).toBe("required");
        expect(supabaseFetch).toHaveBeenCalledWith(
          expect.stringContaining("/rest/v1/mandates"),
          expect.objectContaining({ method: "POST" }),
        );
      });
    } finally {
      globalThis.fetch = nativeFetch;
    }
  });

  it("rejects a mismatched intent with a spoken-safe response and audit event", async () => {
    const nativeFetch = globalThis.fetch;
    const supabaseFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://example.supabase.co")) return new Response("", { status: 201 });
      return nativeFetch(input, init);
    });
    globalThis.fetch = supabaseFetch as typeof fetch;
    try {
      await withServer(async (url) => {
        const body = requestBody() as { proposal: { amountMinor: number } };
        body.proposal.amountMinor = 10_001;
        const response = await fetch(`${url}/api/v1/mandates`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: sessionCookie() },
          body: JSON.stringify(body),
        });
        expect(response.status).toBe(422);
        expect(await response.json()).toEqual({
          code: "AMOUNT_EXCEEDS_REQUEST",
          message: "The payment details do not match your request.",
        });
        expect(supabaseFetch).toHaveBeenCalledWith(
          expect.stringContaining("/rest/v1/audit_events"),
          expect.objectContaining({ method: "POST" }),
        );
      });
    } finally {
      globalThis.fetch = nativeFetch;
    }
  });
});
