import {
  composeMandatePayeeName,
  resolveBankName,
} from "../../../../packages/bulk/src/index.js";
import type { JsonValue, MandateState } from "../../../../packages/core/src/index.js";
import type {
  ApproveBulkHook,
  ApproveReceiverResolutionResult,
} from "../approve.js";
import { appendAuditEvent } from "../audit.js";
import type { BulkConfig } from "./config.js";

export type BatchStatus =
  | "PARSED"
  | "PLANNED"
  | "CONFIRMED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED"
  | "EXPIRED";

export type BatchItemStatus =
  | "MATCHED"
  | "NAME_MISMATCH"
  | "NOT_FOUND"
  | "DUPLICATE"
  | "SKIPPED"
  | "READY"
  | "ACTIVE"
  | "CONSUMED"
  | "PAID"
  | "FAILED"
  | "REJECTED"
  | "CANCELLED"
  | "EXPIRED";

export interface BatchRow {
  id: string;
  account_id: string;
  status: BatchStatus;
  plan_hash: string | null;
  total_minor: number;
  currency: string;
  created_at: string;
  expires_at: string;
}

export interface BatchItemRow {
  id: string;
  batch_id: string;
  position: number;
  pasted_name: string;
  resolved_name: string | null;
  bank_name: string;
  account_number: string;
  status: BatchItemStatus;
  amount_minor: number | null;
  mandate_id: string | null;
}

export interface SandboxDirectoryRow {
  account_number: string;
  bank_name: string;
  account_name: string;
  paypal_sandbox_email: string;
}

export interface FullMandateRow {
  id: string;
  account_id: string;
  action: "send_money";
  payee_contact_id: string | null;
  payee_name?: string | null;
  payee_account_number?: string | null;
  amount_minor: number;
  currency: string;
  constraints: Record<string, JsonValue>;
  request_hash: string;
  nonce: string;
  issued_at: string;
  expires_at: string;
  spoken_text: string;
  mandate_hash: string;
  state: MandateState;
  paypal_ref: string | null;
}

export class SupabaseBulkStore {
  constructor(private readonly config: BulkConfig) {}

  async getSandboxDirectory(): Promise<SandboxDirectoryRow[]> {
    return this.request<SandboxDirectoryRow[]>(
      "sandbox_directory?select=account_number,bank_name,account_name,paypal_sandbox_email",
    );
  }

  async createBatch(batch: BatchRow): Promise<void> {
    await this.request("batches", {
      method: "POST",
      body: JSON.stringify(batch),
    });
  }

  async createBatchItems(items: BatchItemRow[]): Promise<void> {
    if (items.length === 0) return;
    await this.request("batch_items", {
      method: "POST",
      body: JSON.stringify(items),
    });
  }

  async getOwnedBatch(
    accountId: string,
    batchId: string,
  ): Promise<BatchRow | undefined> {
    const rows = await this.request<BatchRow[]>(
      `batches?select=id,account_id,status,plan_hash,total_minor,currency,created_at,expires_at&id=eq.${encodeURIComponent(batchId)}&account_id=eq.${encodeURIComponent(accountId)}`,
    );
    return rows[0];
  }

  async getBatchItems(batchId: string): Promise<BatchItemRow[]> {
    return this.request<BatchItemRow[]>(
      `batch_items?select=id,batch_id,position,pasted_name,resolved_name,bank_name,account_number,status,amount_minor,mandate_id&batch_id=eq.${encodeURIComponent(batchId)}&order=position.asc`,
    );
  }

  async getBatchItemById(itemId: string): Promise<BatchItemRow | undefined> {
    const rows = await this.request<BatchItemRow[]>(
      `batch_items?select=id,batch_id,position,pasted_name,resolved_name,bank_name,account_number,status,amount_minor,mandate_id&id=eq.${encodeURIComponent(itemId)}`,
    );
    return rows[0];
  }

  async getBatchItemByMandateId(
    mandateId: string,
  ): Promise<BatchItemRow | undefined> {
    const rows = await this.request<BatchItemRow[]>(
      `batch_items?select=id,batch_id,position,pasted_name,resolved_name,bank_name,account_number,status,amount_minor,mandate_id&mandate_id=eq.${encodeURIComponent(mandateId)}`,
    );
    return rows[0];
  }

  async getOwnedMandate(
    accountId: string,
    mandateId: string,
  ): Promise<FullMandateRow | undefined> {
    const rows = await this.request<FullMandateRow[]>(
      `mandates?select=id,account_id,action,payee_contact_id,payee_name,payee_account_number,amount_minor,currency,constraints,request_hash,nonce,issued_at,expires_at,spoken_text,mandate_hash,state,paypal_ref&id=eq.${encodeURIComponent(mandateId)}&account_id=eq.${encodeURIComponent(accountId)}`,
    );
    return rows[0];
  }

  async updateMandateStateIfCreated(
    accountId: string,
    mandateId: string,
    nextState: "REJECTED" | "EXPIRED",
  ): Promise<void> {
    await this.request(
      `mandates?id=eq.${encodeURIComponent(mandateId)}&account_id=eq.${encodeURIComponent(accountId)}&state=eq.CREATED`,
      {
        method: "PATCH",
        body: JSON.stringify({ state: nextState }),
      },
    );
  }

  async updateBatchItem(
    itemId: string,
    patch: Partial<
      Pick<
        BatchItemRow,
        "resolved_name" | "status" | "amount_minor" | "mandate_id"
      >
    >,
  ): Promise<void> {
    await this.request(`batch_items?id=eq.${encodeURIComponent(itemId)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  }

  async updateBatch(
    batchId: string,
    patch: Partial<Pick<BatchRow, "status" | "plan_hash" | "total_minor">>,
  ): Promise<void> {
    await this.request(`batches?id=eq.${encodeURIComponent(batchId)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  }

  async audit(
    accountId: string,
    mandateId: string | null,
    eventType: string,
    detail: Record<string, JsonValue>,
  ): Promise<void> {
    await appendAuditEvent(
      this.config,
      accountId,
      mandateId,
      eventType,
      detail,
    );
  }

  private async request<T = unknown>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const response = await fetch(`${this.config.supabaseUrl}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: this.config.supabaseServiceRoleKey,
        Authorization: `Bearer ${this.config.supabaseServiceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
        ...init.headers,
      },
    });
    if (!response.ok) {
      throw new Error(
        `Supabase bulk request failed with status ${response.status}`,
      );
    }
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

export function looksLikeComposedBulkPayeeName(
  payeeName: string | null | undefined,
): boolean {
  if (!payeeName) return false;
  const lastAtIdx = payeeName.lastIndexOf(" at ");
  if (lastAtIdx <= 0) return false;
  const bankCandidate = payeeName.slice(lastAtIdx + 4).trim();
  return resolveBankName(bankCandidate) !== null;
}

const TERMINAL_ITEM_STATUSES: ReadonlySet<BatchItemStatus> = new Set([
  "NOT_FOUND",
  "DUPLICATE",
  "SKIPPED",
  "PAID",
  "FAILED",
  "REJECTED",
  "CANCELLED",
  "EXPIRED",
]);

export function isTerminalBatchItemStatus(status: BatchItemStatus): boolean {
  return TERMINAL_ITEM_STATUSES.has(status);
}

/**
 * Decision 4: Fail-closed receiver resolution and batch item state sync hook for bulk mandates.
 * For any non-bulk mandate, returns `{ kind: "non_bulk" }` so `approve.ts` stays byte-for-byte identical.
 */
export function createApproveBulkHook(config: BulkConfig): ApproveBulkHook {
  const store = new SupabaseBulkStore(config);

  return {
    async isBulkMandate(accountId, mandate): Promise<boolean> {
      if (mandate.payee_contact_id) return false;
      const item = await store.getBatchItemByMandateId(mandate.id);
      if (item) return true;
      return looksLikeComposedBulkPayeeName(mandate.payee_name);
    },

    async resolveMandateReceiver(
      accountId,
      mandate,
    ): Promise<ApproveReceiverResolutionResult> {
      const item = await store.getBatchItemByMandateId(mandate.id);
      const isBulkCandidate =
        Boolean(item) ||
        (!mandate.payee_contact_id &&
          looksLikeComposedBulkPayeeName(mandate.payee_name));

      if (!isBulkCandidate) {
        return { kind: "non_bulk" };
      }

      console.log(`[Bulk Hook] Resolving receiver for bulk mandate ${mandate.id} (account ${accountId})...`);

      if (!item || item.mandate_id !== mandate.id) {
        console.warn(`[Bulk Hook] Mandate ID mismatch: expected ${mandate.id}, item has ${item?.mandate_id}`);
        return {
          kind: "bulk_failed",
          reason: "BATCH_ITEM_MANDATE_ID_MISMATCH",
          batchId: item?.batch_id ?? null,
          itemId: item?.id ?? null,
        };
      }

      const batch = await store.getOwnedBatch(accountId, item.batch_id);
      if (!batch || batch.account_id !== accountId) {
        console.warn(`[Bulk Hook] Batch ownership mismatch for batch ${item.batch_id}`);
        return {
          kind: "bulk_failed",
          reason: "BATCH_OWNERSHIP_MISMATCH",
          batchId: item.batch_id,
          itemId: item.id,
        };
      }

      if (
        batch.status !== "CONFIRMED" &&
        batch.status !== "IN_PROGRESS"
      ) {
        console.warn(`[Bulk Hook] Batch ${batch.id} is not active (status: ${batch.status})`);
        await store.updateBatchItem(item.id, { status: "FAILED" });
        return {
          kind: "bulk_failed",
          reason: "BATCH_NOT_ACTIVE",
          batchId: batch.id,
          itemId: item.id,
        };
      }

      if (item.status !== "ACTIVE" && item.status !== "CONSUMED") {
        console.warn(`[Bulk Hook] Batch item ${item.id} is not active or consumed (status: ${item.status})`);
        return {
          kind: "bulk_failed",
          reason: "BATCH_ITEM_NOT_ACTIVE",
          batchId: batch.id,
          itemId: item.id,
        };
      }

      if (
        !mandate.payee_account_number ||
        item.account_number !== mandate.payee_account_number
      ) {
        console.warn(`[Bulk Hook] Account number mismatch: item=${item.account_number}, mandate=${mandate.payee_account_number}`);
        await store.updateBatchItem(item.id, { status: "FAILED" });
        return {
          kind: "bulk_failed",
          reason: "ACCOUNT_NUMBER_MISMATCH",
          batchId: batch.id,
          itemId: item.id,
        };
      }

      if (!item.resolved_name) {
        console.warn(`[Bulk Hook] Item ${item.id} has no resolved name`);
        await store.updateBatchItem(item.id, { status: "FAILED" });
        return {
          kind: "bulk_failed",
          reason: "MISSING_RESOLVED_NAME",
          batchId: batch.id,
          itemId: item.id,
        };
      }

      let expectedPayeeName: string;
      try {
        expectedPayeeName = composeMandatePayeeName(
          item.resolved_name,
          item.bank_name,
        );
      } catch (err) {
        console.warn(`[Bulk Hook] Failed to compose payee name for item ${item.id}:`, err);
        await store.updateBatchItem(item.id, { status: "FAILED" });
        return {
          kind: "bulk_failed",
          reason: "INVALID_COMPOSED_PAYEE_NAME",
          batchId: batch.id,
          itemId: item.id,
        };
      }

      if (expectedPayeeName !== mandate.payee_name) {
        console.warn(`[Bulk Hook] Payee name mismatch: expected '${expectedPayeeName}', mandate has '${mandate.payee_name}'`);
        await store.updateBatchItem(item.id, { status: "FAILED" });
        return {
          kind: "bulk_failed",
          reason: "PAYEE_NAME_MISMATCH",
          batchId: batch.id,
          itemId: item.id,
        };
      }

      if (
        item.amount_minor === null ||
        Number(item.amount_minor) !== Number(mandate.amount_minor) ||
        batch.currency !== mandate.currency
      ) {
        console.warn(`[Bulk Hook] Amount or currency mismatch: item=${item.amount_minor} ${batch.currency}, mandate=${mandate.amount_minor} ${mandate.currency}`);
        await store.updateBatchItem(item.id, { status: "FAILED" });
        return {
          kind: "bulk_failed",
          reason: "AMOUNT_OR_CURRENCY_MISMATCH",
          batchId: batch.id,
          itemId: item.id,
        };
      }

      const directoryRows = await store.getSandboxDirectory();
      const directoryEntry = directoryRows.find(
        (row) =>
          row.account_number === item.account_number &&
          row.bank_name.toLowerCase() === item.bank_name.toLowerCase(),
      );

      if (
        !directoryEntry ||
        directoryEntry.account_name !== item.resolved_name ||
        !directoryEntry.paypal_sandbox_email
      ) {
        console.warn(`[Bulk Hook] Sandbox directory entry missing or mismatch for item ${item.id}:`, {
          accountNumber: item.account_number,
          bankName: item.bank_name,
          resolvedName: item.resolved_name,
          foundEntry: directoryEntry
            ? {
                accountName: directoryEntry.account_name,
                email: directoryEntry.paypal_sandbox_email,
              }
            : null,
        });
        await store.updateBatchItem(item.id, { status: "FAILED" });
        return {
          kind: "bulk_failed",
          reason: "DIRECTORY_RECORD_MISSING",
          batchId: batch.id,
          itemId: item.id,
        };
      }

      console.log(`[Bulk Hook] Successfully resolved receiver email for item ${item.id}: ${directoryEntry.paypal_sandbox_email}`);
      return {
        kind: "bulk_resolved",
        receiverEmail: directoryEntry.paypal_sandbox_email,
        batchId: batch.id,
        itemId: item.id,
      };
    },

    async onBulkMandateConsumed(_accountId, _batchId, itemId): Promise<void> {
      await store.updateBatchItem(itemId, { status: "CONSUMED" });
    },

    async onBulkMandateOutcome(
      accountId,
      batchId,
      itemId,
      mandateId,
      outcome,
      paypalRef,
    ): Promise<void> {
      await store.updateBatchItem(itemId, { status: outcome });
      const item = await store.getBatchItemById(itemId);
      await store.audit(
        accountId,
        mandateId,
        outcome === "PAID" ? "BULK_ITEM_PAID" : "BULK_ITEM_FAILED",
        {
          batchId,
          itemId,
          outcome,
          ...(item?.amount_minor !== null && item?.amount_minor !== undefined
            ? { amountMinor: item.amount_minor }
            : {}),
          ...(item ? { recipientName: item.resolved_name ?? item.pasted_name } : {}),
          ...(item ? { bankName: item.bank_name, accountLast4: item.account_number.slice(-4) } : {}),
          ...(paypalRef ? { paypalRef } : {}),
        },
      );

      const allItems = await store.getBatchItems(batchId);
      if (allItems.every((i) => isTerminalBatchItemStatus(i.status))) {
        await store.updateBatch(batchId, { status: "COMPLETED" });
      }
    },
  };
}
