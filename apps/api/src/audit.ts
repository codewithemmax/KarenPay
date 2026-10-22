import { Router, type Request, type Response } from "express";
import {
  computeAuditHash,
  verifyAuditChain,
  type AuditEventRecord,
  type JsonValue,
} from "../../../packages/core/src/index.js";
import { getAuthenticatedAccountId, type AuthConfig } from "./auth.js";

type StoredAuditRow = {
  id: string;
  account_id: string;
  mandate_id: string | null;
  event_type: string;
  detail: JsonValue;
  prev_hash: string | null;
  hash: string;
  created_at: string;
};

/**
 * Appends a hash-chained audit event linked to the account's most recent audit event.
 */
export async function appendAuditEvent(
  config: AuthConfig,
  accountId: string,
  mandateId: string | null,
  eventType: string,
  detail: JsonValue,
): Promise<void> {
  const headers = {
    apikey: config.supabaseServiceRoleKey,
    Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
    "Content-Type": "application/json",
  };
  let prevHash: string | null = null;
  const previousResponse = await fetch(
    `${config.supabaseUrl}/rest/v1/audit_events?select=hash&account_id=eq.${encodeURIComponent(accountId)}&order=created_at.desc,id.desc&limit=1`,
    { headers },
  );
  if (previousResponse.ok) {
    const body = await previousResponse.text();
    if (body) {
      const parsed = JSON.parse(body) as Array<{ hash?: string | null }>;
      if (Array.isArray(parsed) && typeof parsed[0]?.hash === "string") {
        prevHash = parsed[0].hash;
      }
    }
  }

  const hash = computeAuditHash({
    accountId,
    mandateId,
    eventType,
    detail,
    prevHash,
  });

  const insertResponse = await fetch(`${config.supabaseUrl}/rest/v1/audit_events`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({
      account_id: accountId,
      mandate_id: mandateId,
      event_type: eventType,
      detail,
      prev_hash: prevHash,
      hash,
    }),
  });
  if (!insertResponse.ok) {
    throw new Error(`Supabase audit insert failed with status ${insertResponse.status}`);
  }
}

export function createAuditRouter(config: AuthConfig): Router {
  const router = Router();

  router.get("/", async (request: Request, response: Response) => {
    const accountId = getAuthenticatedAccountId(request, config.sessionSecret);
    if (!accountId) {
      return response.status(401).json({
        code: "AUTH_REQUIRED",
        message: "Please sign in to view your audit log.",
        spoken: "Please sign in to view your audit log.",
      });
    }
    try {
      const auditResponse = await fetch(
        `${config.supabaseUrl}/rest/v1/audit_events?select=id,account_id,mandate_id,event_type,detail,prev_hash,hash,created_at&account_id=eq.${encodeURIComponent(accountId)}&order=created_at.asc,id.asc`,
        {
          headers: {
            apikey: config.supabaseServiceRoleKey,
            Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
          },
        },
      );
      if (!auditResponse.ok) {
        throw new Error(`Supabase audit query failed with status ${auditResponse.status}`);
      }
      const rows = (await auditResponse.json()) as StoredAuditRow[];
      const chainRecords: AuditEventRecord[] = rows.map((row) => ({
        accountId: row.account_id,
        mandateId: row.mandate_id,
        eventType: row.event_type,
        detail: row.detail,
        prevHash: row.prev_hash,
        hash: row.hash,
      }));
      const verification = verifyAuditChain(chainRecords);
      return response.json({
        chainValid: verification.valid,
        ...(verification.valid ? {} : { brokenAtIndex: verification.brokenAtIndex, reason: verification.reason }),
        spoken: verification.valid
          ? "Your audit log is intact."
          : "Warning: audit log integrity check failed.",
        events: rows.map((row) => ({
          id: row.id,
          mandateId: row.mandate_id,
          eventType: row.event_type,
          detail: row.detail,
          prevHash: row.prev_hash,
          hash: row.hash,
          createdAt: row.created_at,
        })),
      });
    } catch {
      return response.status(500).json({
        code: "AUDIT_FETCH_FAILED",
        message: "The audit log could not be loaded.",
        spoken: "The audit log could not be loaded.",
      });
    }
  });

  return router;
}
