import {
  createHash,
  createHmac,
  generateKeyPairSync,
  sign,
} from "node:crypto";
import express from "express";
import { describe, expect, it, vi } from "vitest";
import {
  createApproveRouter,
  type ApproveConfig,
} from "../../apps/api/src/approve.js";
import {
  createApproveBulkHook,
  createBulkRouter,
  type BatchItemRow,
  type BatchRow,
  type BulkConfig,
  type BulkGeminiPlannerClient,
  type FullMandateRow,
  type SandboxDirectoryRow,
} from "../../apps/api/src/bulk/index.js";
import {
  computeAuditHash,
  hashMandate,
  MandateSchema,
  verifyAuditChain,
  type AuditEventRecord,
} from "../../packages/core/src/index.js";

const secret = "a-long-test-session-secret-that-is-at-least-32-characters";
const accountId = "22222222-2222-4222-8222-222222222222";
const otherAccountId = "99999999-9999-4999-8999-999999999999";
const rpID = "karenpay-web.onrender.com";
const expectedOrigin = "https://karenpay-web.onrender.com";
const credentialId = Buffer.from("bulk-passkey-cred-1").toString("base64url");
const rpIdHash = createHash("sha256").update(rpID, "utf8").digest();

const bulkConfig: BulkConfig = {
  rpID,
  rpName: "KarenPay",
  webOrigin: expectedOrigin,
  sessionSecret: secret,
  supabaseUrl: "https://example.supabase.co",
  supabaseServiceRoleKey: "test-service-role-key",
  mandateTtlSeconds: 120,
  maxBatchMinor: 30_000,
  batchTtlSeconds: 600,
  paymentPolicy: { maximumAmountMinor: 10_000, allowedCurrencies: ["USD"] },
};

function encodeP256CosePublicKeyBytea(x: Uint8Array, y: Uint8Array): string {
  const cose = new Uint8Array([
    0xa5,
    0x01, 0x02,
    0x03, 0x26,
    0x20, 0x01,
    0x21, 0x58, 0x20, ...x,
    0x22, 0x58, 0x20, ...y,
  ]);
  return `\\x${Buffer.from(cose).toString("hex")}`;
}

function sessionCookie(forAccount = accountId): string {
  const encoded = Buffer.from(
    JSON.stringify({ accountId: forAccount, expiresAt: Date.now() + 60_000 }),
  ).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(encoded)
    .digest("base64url");
  return `kp_session=${encoded}.${signature}`;
}

const seededDirectory: SandboxDirectoryRow[] = [
  {
    account_number: "0700000000",
    bank_name: "Cleva Bank",
    account_name: "Olayinka Emmanuel",
    paypal_sandbox_email: "olayinka.cleva@sandbox.karenpay.test",
  },
  {
    account_number: "0123456789",
    bank_name: "Guaranty Trust Bank",
    account_name: "Ade Bello",
    paypal_sandbox_email: "ade.gtb@sandbox.karenpay.test",
  },
  {
    account_number: "0801112223",
    bank_name: "Access Bank",
    account_name: "Chidinma Okafor",
    paypal_sandbox_email: "chidinma.access@sandbox.karenpay.test",
  },
];

interface MockEnv {
  batches: Map<string, BatchRow>;
  batchItems: Map<string, BatchItemRow>;
  mandates: Map<string, FullMandateRow>;
  directory: SandboxDirectoryRow[];
  auditEvents: Array<
    AuditEventRecord & { id: string; created_at: string }
  >;
  paypalCalls: Array<{ receiver: string; value: string; currency: string }>;
  signPasskeyAssertion: (challenge: string) => Record<string, unknown>;
  restoreFetch: () => void;
}

function createMockEnv(): MockEnv {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const cosePublicKeyHex = encodeP256CosePublicKeyBytea(
    Buffer.from(jwk.x, "base64url"),
    Buffer.from(jwk.y, "base64url"),
  );
  let signCounter = 0;

  const batches = new Map<string, BatchRow>();
  const batchItems = new Map<string, BatchItemRow>();
  const mandates = new Map<string, FullMandateRow>();
  const directory = [...seededDirectory];
  const auditEvents: Array<
    AuditEventRecord & { id: string; created_at: string }
  > = [];
  const paypalCalls: Array<{
    receiver: string;
    value: string;
    currency: string;
  }> = [];

  const nativeFetch = globalThis.fetch;
  const mockFetch = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.startsWith("https://api-m.sandbox.paypal.com/v1/oauth2/token")) {
        return new Response(
          JSON.stringify({
            access_token: "sandbox-token",
            token_type: "Bearer",
            expires_in: 3600,
          }),
          { status: 200 },
        );
      }

      if (
        url.startsWith("https://api-m.sandbox.paypal.com/v1/payments/payouts")
      ) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          items?: Array<{
            receiver: string;
            amount: { value: string; currency: string };
          }>;
        };
        for (const item of body.items ?? []) {
          paypalCalls.push({
            receiver: item.receiver,
            value: item.amount.value,
            currency: item.amount.currency,
          });
        }
        return new Response(
          JSON.stringify({
            batch_header: {
              payout_batch_id: `payout-${paypalCalls.length}`,
              batch_status: "PENDING",
            },
          }),
          { status: 201 },
        );
      }

      if (!url.startsWith("https://example.supabase.co/rest/v1/")) {
        return nativeFetch(input, init);
      }

      const pathAndQuery = url.slice(
        "https://example.supabase.co/rest/v1/".length,
      );

      if (pathAndQuery.startsWith("sandbox_directory")) {
        return new Response(JSON.stringify(directory), { status: 200 });
      }

      if (pathAndQuery.startsWith("passkey_credentials")) {
        if (method === "PATCH") {
          return new Response("[]", { status: 200 });
        }
        return new Response(
          JSON.stringify([
            {
              id: "cred-row-1",
              credential_id: credentialId,
              public_key: cosePublicKeyHex,
              counter: 0,
              transports: ["internal"],
            },
          ]),
          { status: 200 },
        );
      }

      if (pathAndQuery.startsWith("rpc/consume_mandate")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          p_mandate_id: string;
          p_account_id: string;
        };
        const mandate = mandates.get(body.p_mandate_id);
        if (
          !mandate ||
          mandate.account_id !== body.p_account_id ||
          mandate.state !== "CREATED"
        ) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        const consumed: FullMandateRow = { ...mandate, state: "CONSUMED" };
        mandates.set(mandate.id, consumed);
        return new Response(JSON.stringify([consumed]), { status: 200 });
      }

      if (pathAndQuery.startsWith("mandates")) {
        if (method === "POST") {
          const row = JSON.parse(String(init?.body ?? "{}")) as FullMandateRow;
          mandates.set(row.id, { ...row, paypal_ref: row.paypal_ref ?? null });
          return new Response(JSON.stringify([row]), { status: 201 });
        }
        if (method === "GET") {
          const idMatch = pathAndQuery.match(/id=eq\.([^&]+)/);
          const accountMatch = pathAndQuery.match(/account_id=eq\.([^&]+)/);
          const id = idMatch ? decodeURIComponent(idMatch[1]) : "";
          const acct = accountMatch ? decodeURIComponent(accountMatch[1]) : "";
          const m = mandates.get(id);
          if (m && (!acct || m.account_id === acct)) {
            return new Response(JSON.stringify([m]), { status: 200 });
          }
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (method === "PATCH") {
          const idMatch = pathAndQuery.match(/id=eq\.([^&]+)/);
          const stateMatch = pathAndQuery.match(/state=eq\.([^&]+)/);
          const id = idMatch ? decodeURIComponent(idMatch[1]) : "";
          const expectedState = stateMatch
            ? decodeURIComponent(stateMatch[1])
            : null;
          const existing = mandates.get(id);
          const patch = JSON.parse(
            String(init?.body ?? "{}"),
          ) as Partial<FullMandateRow>;
          if (
            existing &&
            (!expectedState || existing.state === expectedState)
          ) {
            mandates.set(id, { ...existing, ...patch });
          }
          return new Response(JSON.stringify([]), { status: 200 });
        }
      }

      if (pathAndQuery.startsWith("batches")) {
        if (method === "POST") {
          const row = JSON.parse(String(init?.body ?? "{}")) as BatchRow;
          batches.set(row.id, row);
          return new Response(JSON.stringify([row]), { status: 201 });
        }
        if (method === "GET") {
          const idMatch = pathAndQuery.match(/id=eq\.([^&]+)/);
          const accountMatch = pathAndQuery.match(/account_id=eq\.([^&]+)/);
          const id = idMatch ? decodeURIComponent(idMatch[1]) : "";
          const acct = accountMatch ? decodeURIComponent(accountMatch[1]) : "";
          const row = batches.get(id);
          if (row && row.account_id === acct) {
            return new Response(JSON.stringify([row]), { status: 200 });
          }
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (method === "PATCH") {
          const idMatch = pathAndQuery.match(/id=eq\.([^&]+)/);
          const id = idMatch ? decodeURIComponent(idMatch[1]) : "";
          const existing = batches.get(id);
          const patch = JSON.parse(
            String(init?.body ?? "{}"),
          ) as Partial<BatchRow>;
          if (existing) {
            batches.set(id, { ...existing, ...patch });
          }
          return new Response(JSON.stringify([]), { status: 200 });
        }
      }

      if (pathAndQuery.startsWith("batch_items")) {
        if (method === "POST") {
          const rows = JSON.parse(String(init?.body ?? "[]")) as BatchItemRow[];
          for (const row of rows) {
            batchItems.set(row.id, row);
          }
          return new Response(JSON.stringify(rows), { status: 201 });
        }
        if (method === "GET") {
          const batchMatch = pathAndQuery.match(/batch_id=eq\.([^&]+)/);
          const idMatch = pathAndQuery.match(/(?:^|&)id=eq\.([^&]+)/);
          const mandateMatch = pathAndQuery.match(/mandate_id=eq\.([^&]+)/);
          if (batchMatch) {
            const bId = decodeURIComponent(batchMatch[1]);
            const items = Array.from(batchItems.values())
              .filter((i) => i.batch_id === bId)
              .sort((a, b) => a.position - b.position);
            return new Response(JSON.stringify(items), { status: 200 });
          }
          if (mandateMatch) {
            const mId = decodeURIComponent(mandateMatch[1]);
            const item = Array.from(batchItems.values()).find(
              (i) => i.mandate_id === mId,
            );
            return new Response(JSON.stringify(item ? [item] : []), {
              status: 200,
            });
          }
          if (idMatch) {
            const iId = decodeURIComponent(idMatch[1]);
            const item = batchItems.get(iId);
            return new Response(JSON.stringify(item ? [item] : []), {
              status: 200,
            });
          }
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (method === "PATCH") {
          const idMatch = pathAndQuery.match(/id=eq\.([^&]+)/);
          const id = idMatch ? decodeURIComponent(idMatch[1]) : "";
          const existing = batchItems.get(id);
          const patch = JSON.parse(
            String(init?.body ?? "{}"),
          ) as Partial<BatchItemRow>;
          if (existing) {
            batchItems.set(id, { ...existing, ...patch });
          }
          return new Response(JSON.stringify([]), { status: 200 });
        }
      }

      if (pathAndQuery.startsWith("audit_events")) {
        if (method === "GET") {
          const last = auditEvents[auditEvents.length - 1];
          return new Response(
            JSON.stringify(last ? [{ hash: last.hash }] : []),
            { status: 200 },
          );
        }
        if (method === "POST") {
          const body = JSON.parse(String(init?.body ?? "{}")) as {
            account_id: string;
            mandate_id: string | null;
            event_type: string;
            detail: Record<string, unknown>;
            prev_hash: string | null;
            hash: string;
          };
          auditEvents.push({
            id: `audit-${auditEvents.length + 1}`,
            accountId: body.account_id,
            mandateId: body.mandate_id,
            eventType: body.event_type,
            detail: body.detail as AuditEventRecord["detail"],
            prevHash: body.prev_hash,
            hash: body.hash,
            created_at: new Date().toISOString(),
          });
          return new Response(JSON.stringify([body]), { status: 201 });
        }
      }

      throw new Error(`Unhandled mock fetch: ${method} ${url}`);
    },
  );

  globalThis.fetch = mockFetch as unknown as typeof fetch;

  const signPasskeyAssertion = (challenge: string): Record<string, unknown> => {
    signCounter += 1;
    const signCountBuf = Buffer.alloc(4);
    signCountBuf.writeUInt32BE(signCounter, 0);
    const authenticatorData = Buffer.concat([
      rpIdHash,
      Buffer.from([0x05]), // UP=1, UV=1
      signCountBuf,
    ]);
    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: "webauthn.get",
        challenge,
        origin: expectedOrigin,
        crossOrigin: false,
      }),
      "utf8",
    );
    const clientDataHash = createHash("sha256").update(clientDataJSON).digest();
    const signedBytes = Buffer.concat([authenticatorData, clientDataHash]);
    const signatureDer = sign("sha256", signedBytes, privateKey);

    return {
      id: credentialId,
      rawId: credentialId,
      type: "public-key",
      clientExtensionResults: {},
      response: {
        authenticatorData: authenticatorData.toString("base64url"),
        clientDataJSON: clientDataJSON.toString("base64url"),
        signature: signatureDer.toString("base64url"),
      },
    };
  };

  return {
    batches,
    batchItems,
    mandates,
    directory,
    auditEvents,
    paypalCalls,
    signPasskeyAssertion,
    restoreFetch: () => {
      globalThis.fetch = nativeFetch;
    },
  };
}

async function withBulkAndApproveServer(
  planner: BulkGeminiPlannerClient,
  run: (url: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  const approveConfig: ApproveConfig = {
    ...bulkConfig,
    paypalClientId: "client-id",
    paypalClientSecret: "client-secret",
    paypalBaseUrl: "https://api-m.sandbox.paypal.com",
    bulkHook: createApproveBulkHook(bulkConfig),
  };
  app.use("/api/v1/mandates", createApproveRouter(approveConfig));
  app.use("/api/v1/bulk", createBulkRouter(bulkConfig, planner));
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("No TCP address");
    }
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
}

describe("Unit B5: Queue execution, mandate fetch, fail-closed approve hook, and cancellation", () => {
  it("activates items one at a time via /next, fetches full MandateSchema with matching hash and challenge, approves via WebAuthn passkey, and cancels remaining items without touching PAID items", async () => {
    const mock = createMockEnv();
    const planner: BulkGeminiPlannerClient = {
      planAmounts: vi.fn(
        async (
          _instruction: string,
          recipients: ReadonlyArray<{
            recipientId: string;
            displayName: string;
          }>,
        ) => ({
          needsClarification: false,
          items: recipients.map((r) => ({
            recipientId: r.recipientId,
            amountMinor: 2500,
          })),
        }),
      ),
    };

    try {
      await withBulkAndApproveServer(planner, async (url) => {
        // 1. Parse 3 recipients
        const parseRes = await fetch(`${url}/api/v1/bulk/parse`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: sessionCookie(),
          },
          body: JSON.stringify({
            rawText: [
              "0700000000, Cleva Bank, Olayinka Emmanuel",
              "0123456789, GTB, Ade Bello",
              "0801112223, Access Bank, Chidinma Okafor",
            ].join("\n"),
          }),
        });
        expect(parseRes.status).toBe(201);
        const { batchId } = (await parseRes.json()) as { batchId: string };

        // 2. Plan & Confirm "$25 each"
        const planRes = await fetch(`${url}/api/v1/bulk/${batchId}/plan`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: sessionCookie(),
          },
          body: JSON.stringify({ instruction: "25 each" }),
        });
        expect(planRes.status).toBe(200);
        const { planHash, requestHash } = (await planRes.json()) as {
          planHash: string;
          requestHash: string;
        };

        const confirmRes = await fetch(
          `${url}/api/v1/bulk/${batchId}/confirm-plan`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Cookie: sessionCookie(),
            },
            body: JSON.stringify({ planHash, requestHash }),
          },
        );
        expect(confirmRes.status).toBe(200);

        // No mandates exist before /next is called (Rule 6)
        expect(mock.mandates.size).toBe(0);

        // 3. Activate Item 1 via POST /api/v1/bulk/:batchId/next
        const next1Res = await fetch(`${url}/api/v1/bulk/${batchId}/next`, {
          method: "POST",
          headers: { Cookie: sessionCookie() },
        });
        expect(next1Res.status).toBe(200);
        const next1Body = (await next1Res.json()) as {
          status: string;
          activeItem: { itemId: string; position: number; mandateId: string };
          runningTotalMinor: number;
          totalMinor: number;
          widgets: Array<{ type: string; mandateId: string }>;
        };
        expect(next1Body.status).toBe("IN_PROGRESS");
        expect(next1Body.activeItem.position).toBe(0);
        expect(next1Body.runningTotalMinor).toBe(0);
        expect(next1Body.totalMinor).toBe(7500);
        // Rule 4: transfer_approval widget carries ONLY mandateId
        expect(next1Body.widgets).toEqual([
          {
            type: "transfer_approval",
            mandateId: next1Body.activeItem.mandateId,
          },
        ]);
        expect(mock.mandates.size).toBe(1);

        // 4. Fetch mandate via GET /api/v1/bulk/:batchId/items/:itemId/mandate (Decision 3)
        const otherAccountFetch = await fetch(
          `${url}/api/v1/bulk/${batchId}/items/${next1Body.activeItem.itemId}/mandate`,
          { headers: { Cookie: sessionCookie(otherAccountId) } },
        );
        expect(otherAccountFetch.status).toBe(404);

        const mandateFetchRes = await fetch(
          `${url}/api/v1/bulk/${batchId}/items/${next1Body.activeItem.itemId}/mandate`,
          { headers: { Cookie: sessionCookie() } },
        );
        expect(mandateFetchRes.status).toBe(200);
        const mandateFetchBody = (await mandateFetchRes.json()) as {
          mandate: unknown;
          mandateHash: string;
          approvalOptions: { challenge: string; userVerification: string };
          spoken: string;
          readoutRequired: boolean;
          state: string;
        };

        const parsedMandate = MandateSchema.parse(mandateFetchBody.mandate);
        // Decision 1 & 2: Full 10-digit account number and "{directory account name} at {bank name}"
        expect(parsedMandate.payeeAccountNumber).toBe("0700000000");
        expect(parsedMandate.payeeName).toBe(
          "Olayinka Emmanuel at Cleva Bank",
        );
        // Rule 4: Client-side hash recomputation equals mandateHash
        expect(hashMandate(parsedMandate)).toBe(mandateFetchBody.mandateHash);
        expect(mandateFetchBody.approvalOptions.challenge).toBe(
          mandateFetchBody.mandateHash,
        );
        expect(mandateFetchBody.readoutRequired).toBe(true);
        expect(mandateFetchBody.state).toBe("CREATED");

        // Rule 5: App PIN fallback is rejected on bulk mandates
        const pinApproveAttempt = await fetch(
          `${url}/api/v1/mandates/${parsedMandate.id}/approve`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Cookie: sessionCookie(),
            },
            body: JSON.stringify({
              fallbackMethod: "pin",
              pin: "123456",
              challenge: mandateFetchBody.mandateHash,
            }),
          },
        );
        expect(pinApproveAttempt.status).toBe(401);

        // 5. Approve Item 1 with WebAuthn passkey assertion
        const approve1Res = await fetch(
          `${url}/api/v1/mandates/${parsedMandate.id}/approve`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Cookie: sessionCookie(),
            },
            body: JSON.stringify(
              mock.signPasskeyAssertion(mandateFetchBody.mandateHash),
            ),
          },
        );
        expect(approve1Res.status).toBe(200);
        expect(await approve1Res.json()).toEqual({
          code: "PAID",
          message: "Test payment sent.",
          spoken: "Test payment sent.",
          paypalRef: "payout-1",
        });
        expect(mock.paypalCalls).toEqual([
          {
            receiver: "olayinka.cleva@sandbox.karenpay.test",
            value: "25.00",
            currency: "USD",
          },
        ]);

        // Attempting to cancel an already PAID item is rejected (Rule 13)
        const cancelPaidRes = await fetch(
          `${url}/api/v1/bulk/${batchId}/items/${next1Body.activeItem.itemId}/cancel`,
          {
            method: "POST",
            headers: { Cookie: sessionCookie() },
          },
        );
        expect(cancelPaidRes.status).toBe(409);

        // 6. Activate Item 2 via /next
        const next2Res = await fetch(`${url}/api/v1/bulk/${batchId}/next`, {
          method: "POST",
          headers: { Cookie: sessionCookie() },
        });
        expect(next2Res.status).toBe(200);
        const next2Body = (await next2Res.json()) as {
          activeItem: { itemId: string; position: number; mandateId: string };
          runningTotalMinor: number;
        };
        expect(next2Body.activeItem.position).toBe(1);
        expect(next2Body.runningTotalMinor).toBe(2500);
        expect(mock.mandates.size).toBe(2);

        // 7. Cancel remaining (cancels Item 2 [ACTIVE] and Item 3 [READY], never touches Item 1 [PAID])
        const cancelRemRes = await fetch(
          `${url}/api/v1/bulk/${batchId}/cancel-remaining`,
          {
            method: "POST",
            headers: { Cookie: sessionCookie() },
          },
        );
        expect(cancelRemRes.status).toBe(200);
        const cancelRemBody = (await cancelRemRes.json()) as {
          status: string;
          cancelledCount: number;
          paidMinor: number;
          totalMinor: number;
          widgets: Array<{
            type: string;
            paidMinor: number;
            items: Array<{ position: number; status: string }>;
          }>;
        };
        expect(cancelRemBody.status).toBe("COMPLETED");
        expect(cancelRemBody.cancelledCount).toBe(2);
        expect(cancelRemBody.paidMinor).toBe(2500);
        expect(cancelRemBody.widgets[0].type).toBe("batch_summary");
        expect(
          cancelRemBody.widgets[0].items.map((i) => ({
            position: i.position,
            status: i.status,
          })),
        ).toEqual([
          { position: 0, status: "PAID" },
          { position: 1, status: "CANCELLED" },
          { position: 2, status: "CANCELLED" },
        ]);

        // Verify the entire hash-chained audit log passes verifyAuditChain
        expect(verifyAuditChain(mock.auditEvents)).toEqual({ valid: true });
      });
    } finally {
      mock.restoreFetch();
    }
  });

  it("fails closed in the approve hook (Decision 4) when batch_items or sandbox_directory is tampered before approval, making zero PayPal calls", async () => {
    const mock = createMockEnv();
    const planner: BulkGeminiPlannerClient = {
      planAmounts: vi.fn(
        async (
          _instruction: string,
          recipients: ReadonlyArray<{
            recipientId: string;
            displayName: string;
          }>,
        ) => ({
          needsClarification: false,
          items: recipients.map((r) => ({
            recipientId: r.recipientId,
            amountMinor: 2500,
          })),
        }),
      ),
    };

    try {
      await withBulkAndApproveServer(planner, async (url) => {
        const parseRes = await fetch(`${url}/api/v1/bulk/parse`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: sessionCookie(),
          },
          body: JSON.stringify({
            rawText: "0700000000, Cleva Bank, Olayinka Emmanuel",
          }),
        });
        const { batchId } = (await parseRes.json()) as { batchId: string };

        const planRes = await fetch(`${url}/api/v1/bulk/${batchId}/plan`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: sessionCookie(),
          },
          body: JSON.stringify({ instruction: "25 dollars" }),
        });
        const { planHash, requestHash } = (await planRes.json()) as {
          planHash: string;
          requestHash: string;
        };

        await fetch(`${url}/api/v1/bulk/${batchId}/confirm-plan`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: sessionCookie(),
          },
          body: JSON.stringify({ planHash, requestHash }),
        });

        const nextRes = await fetch(`${url}/api/v1/bulk/${batchId}/next`, {
          method: "POST",
          headers: { Cookie: sessionCookie() },
        });
        const nextBody = (await nextRes.json()) as {
          activeItem: { itemId: string; mandateId: string };
        };

        const mandateFetchRes = await fetch(
          `${url}/api/v1/bulk/${batchId}/items/${nextBody.activeItem.itemId}/mandate`,
          { headers: { Cookie: sessionCookie() } },
        );
        const { mandateHash } = (await mandateFetchRes.json()) as {
          mandateHash: string;
        };

        // Tamper with batch_items.account_number in the database after mandate creation
        const activeRow = mock.batchItems.get(nextBody.activeItem.itemId)!;
        mock.batchItems.set(nextBody.activeItem.itemId, {
          ...activeRow,
          account_number: "9999999999",
        });

        const approveRes = await fetch(
          `${url}/api/v1/mandates/${nextBody.activeItem.mandateId}/approve`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Cookie: sessionCookie(),
            },
            body: JSON.stringify(mock.signPasskeyAssertion(mandateHash)),
          },
        );

        expect(approveRes.status).toBe(502);
        expect(await approveRes.json()).toEqual({
          code: "PAYMENT_FAILED",
          message: "Test payment not sent.",
          spoken: "Test payment not sent.",
        });
        // Decision 4: Outcome is FAILED, zero PayPal calls made, and audit event recorded
        expect(mock.paypalCalls).toHaveLength(0);
        expect(
          mock.mandates.get(nextBody.activeItem.mandateId)?.state,
        ).toBe("FAILED");
        expect(
          mock.batchItems.get(nextBody.activeItem.itemId)?.status,
        ).toBe("FAILED");
        expect(
          mock.auditEvents.some(
            (e) =>
              e.eventType === "PAYMENT_FAILED" &&
              typeof e.detail === "object" &&
              e.detail !== null &&
              !Array.isArray(e.detail) &&
              e.detail.reason === "ACCOUNT_NUMBER_MISMATCH",
          ),
        ).toBe(true);
        expect(verifyAuditChain(mock.auditEvents)).toEqual({ valid: true });
      });
    } finally {
      mock.restoreFetch();
    }
  });
});
