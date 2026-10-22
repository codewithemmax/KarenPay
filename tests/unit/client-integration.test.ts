import { createHmac } from "node:crypto";
import express from "express";
import { describe, expect, it, vi } from "vitest";
import { describeMandateState } from "../../packages/core/src/index.js";
import { createAuthRouter, type AuthConfig } from "../../apps/api/src/auth.js";
import { createClientCorsMiddleware, createContactsRouter } from "../../apps/api/src/index.js";
import { createMandateRouter, type MandateConfig } from "../../apps/api/src/mandates.js";

const secret = "a-long-test-session-secret-that-is-at-least-32-characters";
const accountId = "22222222-2222-4222-8222-222222222222";
const mandateId = "11111111-1111-4111-8111-111111111111";

const authConfig: AuthConfig = {
  rpID: "karenpay-web.onrender.com",
  rpName: "KarenPay",
  webOrigin: "https://karenpay-web.onrender.com",
  sessionSecret: secret,
  supabaseUrl: "https://example.supabase.co",
  supabaseServiceRoleKey: "test-service-role-key",
};

const mandateConfig: MandateConfig = {
  ...authConfig,
  mandateTtlSeconds: 120,
  paymentPolicy: { maximumAmountMinor: 10_000, allowedCurrencies: ["USD"] },
};

function sessionCookie(forAccountId = accountId): string {
  const encoded = Buffer.from(JSON.stringify({ accountId: forAccountId, expiresAt: Date.now() + 60_000 })).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `kp_session=${encoded}.${signature}`;
}

describe("Unit 12: Client integration support", () => {
  it("maps every mandate state to the approved status vocabulary in 3-ui-context.md", () => {
    expect(describeMandateState("CREATED")).toBe("Waiting for your approval");
    expect(describeMandateState("CONSUMED")).toBe("Approved and sending");
    expect(describeMandateState("PAID")).toBe("Test payment sent");
    expect(describeMandateState("FAILED")).toBe("Not sent");
    expect(describeMandateState("REJECTED")).toBe("Rejected");
    expect(describeMandateState("EXPIRED")).toBe("Expired");
  });

  it("allows CORS with credentials for WEB_ORIGIN and rejects untrusted preflight origins", async () => {
    const app = express();
    app.use(createClientCorsMiddleware(authConfig.webOrigin));
    app.get("/api/v1/health", (_req, res) => res.json({ status: "ok", sandbox: true }));

    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const listener = app.listen(0, () => resolve(listener));
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No TCP address");
      const url = `http://127.0.0.1:${address.port}`;

      const allowed = await fetch(`${url}/api/v1/health`, {
        method: "OPTIONS",
        headers: { Origin: "https://karenpay-web.onrender.com" },
      });
      expect(allowed.status).toBe(204);
      expect(allowed.headers.get("access-control-allow-origin")).toBe("https://karenpay-web.onrender.com");
      expect(allowed.headers.get("access-control-allow-credentials")).toBe("true");

      const denied = await fetch(`${url}/api/v1/health`, {
        method: "OPTIONS",
        headers: { Origin: "https://evil.example.com" },
      });
      expect(denied.status).toBe(403);
      expect(await denied.json()).toEqual({
        code: "ORIGIN_NOT_ALLOWED",
        message: "This origin is not allowed.",
        spoken: "This origin is not allowed.",
      });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("sets SameSite=Strict, HttpOnly, Secure cookies and returns spoken-safe auth errors", async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/v1/auth", createAuthRouter(authConfig));

    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const listener = app.listen(0, () => resolve(listener));
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No TCP address");
      const url = `http://127.0.0.1:${address.port}`;

      const loginOptions = await fetch(`${url}/api/v1/auth/login/options`, { method: "POST" });
      expect(loginOptions.status).toBe(200);
      const setCookie = loginOptions.headers.get("set-cookie") ?? "";
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("Secure");
      expect(setCookie).toContain("SameSite=Strict");
      expect(setCookie).toContain("Path=/api/v1");

      const badRegister = await fetch(`${url}/api/v1/auth/register/options`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: "" }),
      });
      expect(badRegister.status).toBe(400);
      expect(await badRegister.json()).toEqual({
        code: "INVALID_AUTH_REQUEST",
        message: "Please provide a valid display name.",
        spoken: "Please provide a valid display name.",
      });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("returns owned mandate state with approved spoken status vocabulary on GET /api/v1/mandates/:id", async () => {
    const nativeFetch = globalThis.fetch;
    const supabaseFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://example.supabase.co") && url.includes(`account_id=eq.${accountId}`)) {
        return new Response(JSON.stringify([{
          id: mandateId,
          state: "PAID",
          mandate_hash: "hash-1",
          spoken_text: "You asked to send fifty dollars to Ade Bello.",
          paypal_ref: "batch-1",
        }]));
      }
      if (url.startsWith("https://example.supabase.co")) {
        return new Response(JSON.stringify([]));
      }
      return nativeFetch(input, init);
    });
    globalThis.fetch = supabaseFetch as typeof fetch;

    const app = express();
    app.use(express.json());
    app.use("/api/v1/mandates", createMandateRouter(mandateConfig));
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const listener = app.listen(0, () => resolve(listener));
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No TCP address");
      const url = `http://127.0.0.1:${address.port}`;

      const owned = await nativeFetch(`${url}/api/v1/mandates/${mandateId}`, {
        headers: { Cookie: sessionCookie(accountId) },
      });
      expect(owned.status).toBe(200);
      expect(await owned.json()).toEqual({
        mandateId,
        state: "PAID",
        status: "Test payment sent",
        spoken: "Test payment sent.",
        readoutRequired: false,
        paypalRef: "batch-1",
      });

      const otherAccount = await nativeFetch(`${url}/api/v1/mandates/${mandateId}`, {
        headers: { Cookie: sessionCookie("99999999-9999-4999-8999-999999999999") },
      });
      expect(otherAccount.status).toBe(404);
      expect(await otherAccount.json()).toEqual({
        code: "MANDATE_NOT_FOUND",
        message: "This test payment was not found.",
        spoken: "This test payment was not found.",
      });
    } finally {
      globalThis.fetch = nativeFetch;
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("enforces the 5-contact limit and ownership on /api/v1/contacts", async () => {
    const nativeFetch = globalThis.fetch;
    const fiveContacts = [0, 1, 2, 3, 4].map((index) => ({
      id: `33333333-3333-4333-8333-33333333333${index}`,
      display_name: `Contact ${index}`,
      paypal_sandbox_email: `contact${index}@example.com`,
    }));
    const supabaseFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://example.supabase.co") && url.includes("contacts")) {
        return new Response(JSON.stringify(fiveContacts));
      }
      return nativeFetch(input, init);
    });
    globalThis.fetch = supabaseFetch as typeof fetch;

    const app = express();
    app.use(express.json());
    app.use("/api/v1/contacts", createContactsRouter(authConfig));
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const listener = app.listen(0, () => resolve(listener));
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No TCP address");
      const url = `http://127.0.0.1:${address.port}`;

      const listResponse = await nativeFetch(`${url}/api/v1/contacts`, {
        headers: { Cookie: sessionCookie() },
      });
      expect(listResponse.status).toBe(200);
      const listed = (await listResponse.json()) as { contacts: unknown[] };
      expect(listed.contacts).toHaveLength(5);

      const sixthResponse = await nativeFetch(`${url}/api/v1/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: sessionCookie() },
        body: JSON.stringify({ displayName: "Sixth Contact", paypalSandboxEmail: "sixth@example.com" }),
      });
      expect(sixthResponse.status).toBe(422);
      expect(await sixthResponse.json()).toEqual({
        code: "CONTACT_LIMIT_REACHED",
        message: "You can save at most five contacts.",
        spoken: "You can save at most five contacts.",
      });
    } finally {
      globalThis.fetch = nativeFetch;
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
});
