import { createHmac } from "node:crypto";
import express from "express";
import { describe, expect, it, vi } from "vitest";
import {
  computeAuditHash,
  verifyAuditChain,
  type AuditEventRecord,
} from "../../packages/core/src/index.js";
import { createApproveRouter, type ApproveConfig } from "../../apps/api/src/approve.js";
import { createAuditRouter } from "../../apps/api/src/audit.js";
import type { AuthConfig } from "../../apps/api/src/auth.js";

const secret = "a-long-test-session-secret-that-is-at-least-32-characters";
const accountId = "22222222-2222-4222-8222-222222222222";
const mandateId = "11111111-1111-4111-8111-111111111111";

const authConfig: AuthConfig = {
  rpID: "localhost",
  rpName: "KarenPay",
  webOrigin: "http://localhost:3000",
  sessionSecret: secret,
  supabaseUrl: "https://example.supabase.co",
  supabaseServiceRoleKey: "test-service-role-key",
};

const approveConfig: ApproveConfig = {
  ...authConfig,
  paypalClientId: "client-id",
  paypalClientSecret: "client-secret",
  paypalBaseUrl: "https://api-m.sandbox.paypal.com",
};

function sessionCookie(forAccountId = accountId): string {
  const encoded = Buffer.from(JSON.stringify({ accountId: forAccountId, expiresAt: Date.now() + 60_000 })).toString("base64url");
  return `kp_session=${encoded}.${createHmac("sha256", secret).update(encoded).digest("base64url")}`;
}

describe("Unit 14: Hash-chained audit log and retry safety", () => {
  it("verifies a valid hash chain and detects tampering or broken links", () => {
    const firstInput = {
      accountId,
      mandateId,
      eventType: "MANDATE_CREATED",
      detail: { mandateHash: "hash-1" },
      prevHash: null,
    };
    const first: AuditEventRecord = { ...firstInput, hash: computeAuditHash(firstInput) };

    const secondInput = {
      accountId,
      mandateId,
      eventType: "MANDATE_CONSUMED",
      detail: {},
      prevHash: first.hash,
    };
    const second: AuditEventRecord = { ...secondInput, hash: computeAuditHash(secondInput) };

    const thirdInput = {
      accountId,
      mandateId,
      eventType: "PAYMENT_SENT",
      detail: { payoutBatchId: "batch-1" },
      prevHash: second.hash,
    };
    const third: AuditEventRecord = { ...thirdInput, hash: computeAuditHash(thirdInput) };

    expect(verifyAuditChain([first, second, third])).toEqual({ valid: true });

    const tamperedDetail: AuditEventRecord = {
      ...third,
      detail: { payoutBatchId: "batch-tampered" },
    };
    expect(verifyAuditChain([first, second, tamperedDetail])).toEqual({
      valid: false,
      brokenAtIndex: 2,
      reason: "HASH_MISMATCH",
    });

    const brokenLink: AuditEventRecord = {
      ...second,
      prevHash: "wrong-prev-hash",
    };
    expect(verifyAuditChain([first, brokenLink, third])).toEqual({
      valid: false,
      brokenAtIndex: 1,
      reason: "PREV_HASH_MISMATCH",
    });
  });

  it("returns the caller's own audit events and verifies chain integrity on GET /api/v1/audit", async () => {
    const e1Input = {
      accountId,
      mandateId,
      eventType: "MANDATE_CREATED",
      detail: { mandateHash: "h1" },
      prevHash: null,
    };
    const e1Hash = computeAuditHash(e1Input);
    const e2Input = {
      accountId,
      mandateId,
      eventType: "PAYMENT_SENT",
      detail: { payoutBatchId: "payout-1" },
      prevHash: e1Hash,
    };
    const e2Hash = computeAuditHash(e2Input);

    const storedRows = [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
        account_id: accountId,
        mandate_id: mandateId,
        event_type: "MANDATE_CREATED",
        detail: { mandateHash: "h1" },
        prev_hash: null,
        hash: e1Hash,
        created_at: "2026-10-22T10:00:00.000Z",
      },
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
        account_id: accountId,
        mandate_id: mandateId,
        event_type: "PAYMENT_SENT",
        detail: { payoutBatchId: "payout-1" },
        prev_hash: e1Hash,
        hash: e2Hash,
        created_at: "2026-10-22T10:00:05.000Z",
      },
    ];

    const nativeFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://example.supabase.co") && url.includes(`account_id=eq.${accountId}`)) {
        return new Response(JSON.stringify(storedRows));
      }
      if (url.startsWith("https://example.supabase.co")) {
        return new Response(JSON.stringify([]));
      }
      return nativeFetch(input, init);
    }) as typeof fetch;

    const app = express();
    app.use(express.json());
    app.use("/api/v1/audit", createAuditRouter(authConfig));
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const listener = app.listen(0, () => resolve(listener));
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No TCP address");
      const url = `http://127.0.0.1:${address.port}`;

      const response = await nativeFetch(`${url}/api/v1/audit`, {
        headers: { Cookie: sessionCookie(accountId) },
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        chainValid: boolean;
        spoken: string;
        events: unknown[];
      };
      expect(body.chainValid).toBe(true);
      expect(body.spoken).toBe("Your audit log is intact.");
      expect(body.events).toHaveLength(2);
    } finally {
      globalThis.fetch = nativeFetch;
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("never triggers a second PayPal payout when retrying after a dropped network response", async () => {
    let paypalPayoutCalls = 0;
    const nativeFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://api-m.sandbox.paypal.com")) {
        paypalPayoutCalls += 1;
        return new Response(JSON.stringify({ batch_header: { payout_batch_id: "batch-1" } }), { status: 201 });
      }
      if (url.startsWith("https://example.supabase.co") && url.includes("mandates?")) {
        return new Response(JSON.stringify([{
          id: mandateId,
          state: "PAID",
          mandate_hash: "hash-1",
          payee_contact_id: "33333333-3333-4333-8333-333333333333",
          amount_minor: 5000,
          currency: "USD",
          paypal_ref: "batch-1",
          spoken_text: "Test payment sent.",
        }]));
      }
      return nativeFetch(input, init);
    }) as typeof fetch;

    const app = express();
    app.use(express.json());
    app.use("/api/v1/mandates", createApproveRouter(approveConfig));
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const listener = app.listen(0, () => resolve(listener));
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No TCP address");
      const url = `http://127.0.0.1:${address.port}`;

      const retry1 = await nativeFetch(`${url}/api/v1/mandates/${mandateId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: sessionCookie() },
        body: JSON.stringify({ id: "credential-id" }),
      });
      const retry2 = await nativeFetch(`${url}/api/v1/mandates/${mandateId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: sessionCookie() },
        body: JSON.stringify({ id: "credential-id" }),
      });

      expect(retry1.status).toBe(200);
      expect(retry2.status).toBe(200);
      expect(await retry1.json()).toEqual({
        code: "PAID",
        message: "Test payment sent.",
        spoken: "Test payment sent.",
        paypalRef: "batch-1",
      });
      expect(await retry2.json()).toEqual({
        code: "PAID",
        message: "Test payment sent.",
        spoken: "Test payment sent.",
        paypalRef: "batch-1",
      });
      expect(paypalPayoutCalls).toBe(0);
    } finally {
      globalThis.fetch = nativeFetch;
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
});
