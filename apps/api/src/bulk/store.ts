import type { JsonValue } from "../../../../packages/core/src/index.js";
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
      throw new Error(`Supabase bulk request failed with status ${response.status}`);
    }
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
}
