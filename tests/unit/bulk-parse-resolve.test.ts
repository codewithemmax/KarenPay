import { createHmac } from "node:crypto";
import express from "express";
import { describe, expect, it, vi } from "vitest";
import { verifyAuditChain, type AuditEventRecord } from "../../packages/core/src/index.js";
import { BulkWidgetSchema } from "../../packages/bulk/src/index.js";
import { createBulkRouter, type BulkConfig } from "../../apps/api/src/bulk/index.js";

const secret = "a-long-test-session-secret-that-is-at-least-32-characters";
const accountId = "22222222-2222-4222-8222-222222222222";
const otherAccountId = "99999999-9999-4999-8999-999999999999";

const bulkConfig: BulkConfig = {
  rpID: "localhost",
  rpName: "KarenPay",
  webOrigin: "http://localhost:3000",
  sessionSecret: secret,
  supabaseUrl: "https://example.supabase.co",
  supabaseServiceRoleKey: "test-service-role-key",
  mandateTtlSeconds: 120,
  paymentPolicy: { maximumAmountMinor: 10_000, allowedCurrencies: ["USD"] },
  maxBatchMinor: 30_000,
  batchTtlSeconds: 600,
};

function sessionCookie(forAccount = accountId): string {
  const encoded = Buffer.from(
    JSON.stringify({ accountId: forAccount, expiresAt: Date.now() + 60_000 }),
  ).toString("base64url");
  return `kp_session=${encoded}.${createHmac("sha256", secret).update(encoded).digest("base64url")}`;
}

interface InMemoryBulkDb {
  batches: Array<Record<string, unknown>>;
  batchItems: Array<Record<string, unknown>>;
  auditEvents: Array<Record<string, unknown>>;
  directory: Array<{
    account_number: string;
    bank_name: string;
    account_name: string;
    paypal_sandbox_email: string;
  }>;
}

function createMockBulkDb(): InMemoryBulkDb {
  return {
    batches: [],
    batchItems: [],
    auditEvents: [],
    directory: [
      {
        account_number: "0700000000",
        bank_name: "Cleva Bank",
        account_name: "Olayinka Emmanuel",
        paypal_sandbox_email: "olayinka.cleva@sandbox.karenpay.test",
      },
      {
        account_number: "0234567890",
        bank_name: "Access Bank",
        account_name: "Chidinma Okafor",
        paypal_sandbox_email: "chidinma.access@sandbox.karenpay.test",
      },
      {
        account_number: "0123456789",
        bank_name: "Guaranty Trust Bank",
        account_name: "Ade Bello",
        paypal_sandbox_email: "ade.gtb@sandbox.karenpay.test",
      },
    ],
  };
}

async function withBulkServer(
  db: InMemoryBulkDb,
  run: (url: string) => Promise<void>,
): Promise<void> {
  const nativeFetch = globalThis.fetch;
  const supabaseFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const urlStr = String(input);
    if (!urlStr.startsWith("https://example.supabase.co/rest/v1/")) {
      return nativeFetch(input, init);
    }
    const method = (init?.method ?? "GET").toUpperCase();
    const pathAndQuery = urlStr.slice("https://example.supabase.co/rest/v1/".length);
    const [table, queryString = ""] = pathAndQuery.split("?");
    const params = new URLSearchParams(queryString);

    if (table === "sandbox_directory" && method === "GET") {
      return new Response(JSON.stringify(db.directory), { status: 200 });
    }

    if (table === "audit_events") {
      if (method === "GET") {
        const acctFilter = params.get("account_id")?.replace(/^eq\./, "");
        const matching = db.auditEvents.filter(
          (row) => !acctFilter || row.account_id === acctFilter,
        );
        const latest = matching.length > 0 ? [matching[matching.length - 1]] : [];
        return new Response(JSON.stringify(latest), { status: 200 });
      }
      if (method === "POST") {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        db.auditEvents.push(body);
        return new Response("", { status: 201 });
      }
    }

    if (table === "batches") {
      if (method === "POST") {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        db.batches.push(body);
        return new Response(JSON.stringify([body]), { status: 201 });
      }
      if (method === "GET") {
        const idFilter = params.get("id")?.replace(/^eq\./, "");
        const acctFilter = params.get("account_id")?.replace(/^eq\./, "");
        const rows = db.batches.filter(
          (b) =>
            (!idFilter || b.id === idFilter) &&
            (!acctFilter || b.account_id === acctFilter),
        );
        return new Response(JSON.stringify(rows), { status: 200 });
      }
    }

    if (table === "batch_items") {
      if (method === "POST") {
        const parsed = JSON.parse(String(init?.body ?? "[]")) as
          | Record<string, unknown>
          | Array<Record<string, unknown>>;
        const items = Array.isArray(parsed) ? parsed : [parsed];
        db.batchItems.push(...items);
        return new Response(JSON.stringify(items), { status: 201 });
      }
      if (method === "GET") {
        const idFilter = params.get("id")?.replace(/^eq\./, "");
        const batchIdFilter = params.get("batch_id")?.replace(/^eq\./, "");
        const rows = db.batchItems
          .filter(
            (item) =>
              (!idFilter || item.id === idFilter) &&
              (!batchIdFilter || item.batch_id === batchIdFilter),
          )
          .sort((a, b) => Number(a.position) - Number(b.position));
        return new Response(JSON.stringify(rows), { status: 200 });
      }
      if (method === "PATCH") {
        const idFilter = params.get("id")?.replace(/^eq\./, "");
        const patch = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        const updated: Array<Record<string, unknown>> = [];
        db.batchItems = db.batchItems.map((item) => {
          if (idFilter && item.id === idFilter) {
            const next = { ...item, ...patch };
            updated.push(next);
            return next;
          }
          return item;
        });
        return new Response(JSON.stringify(updated), { status: 200 });
      }
    }

    throw new Error(`Unhandled mock Supabase request: ${method} ${urlStr}`);
  });

  globalThis.fetch = supabaseFetch as typeof fetch;
  const app = express();
  app.use(express.json());
  app.use("/api/v1/bulk", createBulkRouter(bulkConfig));
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
    globalThis.fetch = nativeFetch;
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
}

describe("Unit B3: POST /api/v1/bulk/parse and POST /api/v1/bulk/items/:id/resolve-name", () => {
  it("requires authentication on both endpoints", async () => {
    const db = createMockBulkDb();
    await withBulkServer(db, async (url) => {
      const parseRes = await fetch(`${url}/api/v1/bulk/parse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText: "0700000000, Cleva Bank, Olayinka Emmanuel" }),
      });
      expect(parseRes.status).toBe(401);

      const resolveRes = await fetch(
        `${url}/api/v1/bulk/items/11111111-1111-4111-8111-111111111111/resolve-name`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision: "USE_DIRECTORY_NAME" }),
        },
      );
      expect(resolveRes.status).toBe(401);
    });
  });

  it("parses recipients, checks the simulated directory, emits recipient_list and name_check widgets, and logs an audit event", async () => {
    const db = createMockBulkDb();
    await withBulkServer(db, async (url) => {
      const paste = [
        "0700000000",
        "Cleva Bank,",
        "Olayinka Emmanuel",
        "",
        "0234567890, Access Bank, Chidi Okafor",
        "9999999999, Zenith Bank, Unknown Person",
      ].join("\n");

      const res = await fetch(`${url}/api/v1/bulk/parse`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: sessionCookie(accountId),
        },
        body: JSON.stringify({ rawText: paste }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        batchId: string;
        status: string;
        spoken: string;
        widgets: unknown[];
      };

      expect(body.status).toBe("PARSED");
      expect(body.spoken).toContain("last 4 digits");
      expect(JSON.stringify(body).toLowerCase()).not.toContain("verified");
      expect(body.widgets).toHaveLength(2); // 1 recipient_list + 1 name_check for Chidi Okafor

      const parsedWidgets = body.widgets.map((w) => BulkWidgetSchema.parse(w));
      expect(parsedWidgets[0]?.type).toBe("recipient_list");
      expect(parsedWidgets[1]?.type).toBe("name_check");

      if (parsedWidgets[0]?.type === "recipient_list") {
        expect(parsedWidgets[0].recipients).toHaveLength(3);
        expect(parsedWidgets[0].recipients[0]).toMatchObject({
          pastedName: "Olayinka Emmanuel",
          resolvedName: "Olayinka Emmanuel",
          bankName: "Cleva Bank",
          accountLast4: "0000",
          status: "MATCHED",
          statusLabel: "Name matches",
        });
        expect(parsedWidgets[0].recipients[1]).toMatchObject({
          pastedName: "Chidi Okafor",
          resolvedName: null,
          bankName: "Access Bank",
          accountLast4: "7890",
          status: "NAME_MISMATCH",
          statusLabel: "Name differs",
        });
        expect(parsedWidgets[0].recipients[2]).toMatchObject({
          pastedName: "Unknown Person",
          resolvedName: null,
          bankName: "Zenith Bank",
          accountLast4: "9999",
          status: "NOT_FOUND",
          statusLabel: "Not in simulated directory",
        });
      }

      if (parsedWidgets[1]?.type === "name_check") {
        expect(parsedWidgets[1]).toMatchObject({
          pastedName: "Chidi Okafor",
          directoryName: "Chidinma Okafor",
          bankName: "Access Bank",
          accountLast4: "7890",
          statusLabel: "Name differs",
          choices: ["USE_DIRECTORY_NAME", "SKIP"],
        });
      }

      expect(db.auditEvents).toHaveLength(1);
      expect(db.auditEvents[0]?.event_type).toBe("BULK_BATCH_PARSED");
    });
  });

  it("resolves a name mismatch with USE_DIRECTORY_NAME or SKIP, enforces ownership, and preserves audit chain integrity", async () => {
    const db = createMockBulkDb();
    await withBulkServer(db, async (url) => {
      const parseRes = await fetch(`${url}/api/v1/bulk/parse`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: sessionCookie(accountId),
        },
        body: JSON.stringify({
          rawText: "0234567890, Access Bank, Chidi Okafor",
        }),
      });
      expect(parseRes.status).toBe(201);
      const parseBody = (await parseRes.json()) as {
        batchId: string;
        widgets: Array<{ type: string; itemId?: string }>;
      };
      const nameCheck = parseBody.widgets.find((w) => w.type === "name_check");
      expect(nameCheck?.itemId).toBeDefined();
      const itemId = nameCheck!.itemId!;

      // Other account cannot resolve this item
      const wrongOwnerRes = await fetch(
        `${url}/api/v1/bulk/items/${itemId}/resolve-name`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: sessionCookie(otherAccountId),
          },
          body: JSON.stringify({ decision: "USE_DIRECTORY_NAME" }),
        },
      );
      expect(wrongOwnerRes.status).toBe(404);

      // Owner resolves with USE_DIRECTORY_NAME
      const resolveRes = await fetch(
        `${url}/api/v1/bulk/items/${itemId}/resolve-name`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: sessionCookie(accountId),
          },
          body: JSON.stringify({ decision: "USE_DIRECTORY_NAME" }),
        },
      );
      expect(resolveRes.status).toBe(200);
      const resolveBody = (await resolveRes.json()) as {
        status: string;
        resolvedName: string;
        spoken: string;
        widgets: unknown[];
      };
      expect(resolveBody.status).toBe("MATCHED");
      expect(resolveBody.resolvedName).toBe("Chidinma Okafor");
      expect(resolveBody.spoken).toContain("Chidinma Okafor");
      expect(resolveBody.widgets).toHaveLength(1); // Only recipient_list remains; no pending name_check

      // Verify hash chain for accountId's audit events
      const ownerEvents: AuditEventRecord[] = db.auditEvents
        .filter((e) => e.account_id === accountId)
        .map((e) => ({
          accountId: String(e.account_id),
          mandateId: (e.mandate_id as string | null) ?? null,
          eventType: String(e.event_type),
          detail: e.detail as AuditEventRecord["detail"],
          prevHash: (e.prev_hash as string | null) ?? null,
          hash: String(e.hash),
        }));
      expect(ownerEvents).toHaveLength(2);
      expect(verifyAuditChain(ownerEvents)).toEqual({ valid: true });
    });
  });
});
