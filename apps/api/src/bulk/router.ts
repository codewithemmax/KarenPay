import { createHash, randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  BatchSummaryWidgetSchema,
  NameCheckWidgetSchema,
  PlanWidgetSchema,
  RecipientListWidgetSchema,
  TransferApprovalWidgetSchema,
  compareRecipientNames,
  composeMandatePayeeName,
  computePlanHash,
  parseBulkRecipients,
  sanitizeDisplayNameForGemini,
  speakLast4Digits,
  verifyDualAmountCheck,
  type BatchSummaryWidget,
  type BulkWidget,
  type NameCheckWidget,
  type PlanWidget,
  type RecipientListWidget,
  type TransferApprovalWidget,
} from "../../../../packages/bulk/src/index.js";
import { buildMandate } from "../../../../packages/core/src/index.js";
import { getAuthenticatedAccountId } from "../auth.js";
import {
  buildMandateApprovalOptions,
  createAccountMandate,
} from "../mandates.js";
import type { BulkConfig } from "./config.js";
import {
  GoogleBulkGeminiPlannerClient,
  geminiBulkPlanOutputSchema,
  type BulkGeminiPlannerClient,
} from "./planner.js";
import {
  SupabaseBulkStore,
  isTerminalBatchItemStatus,
  type BatchItemRow,
  type BatchRow,
  type SandboxDirectoryRow,
} from "./store.js";

const parseRequestSchema = z
  .object({
    rawText: z.string().trim().min(1).max(4000).optional(),
    text: z.string().trim().min(1).max(4000).optional(),
  })
  .strict()
  .refine((data) => Boolean(data.rawText || data.text), {
    message: "rawText is required",
  });

const resolveNameRequestSchema = z
  .object({
    decision: z.enum(["USE_DIRECTORY_NAME", "SKIP"]),
  })
  .strict();

const planRequestSchema = z
  .object({
    instruction: z.string().trim().min(1).max(1000),
  })
  .strict();

const confirmPlanRequestSchema = z
  .object({
    planHash: z.string().min(1).max(256).optional(),
    requestHash: z.string().min(1).max(256).optional(),
  })
  .strict();

const uuidParamSchema = z.string().uuid();

function formatUsdDollars(amountMinor: number): string {
  const whole = Math.floor(amountMinor / 100);
  const cents = String(amountMinor % 100).padStart(2, "0");
  return `$${whole}.${cents}`;
}

export function encodeStoredPlanHashes(
  planHash: string,
  requestHash: string,
): string {
  return `${planHash}.${requestHash}`;
}

export function decodeStoredPlanHashes(stored: string | null): {
  planHash: string | null;
  requestHash: string | null;
} {
  if (!stored) return { planHash: null, requestHash: null };
  const dotIdx = stored.indexOf(".");
  if (dotIdx === -1) {
    return { planHash: stored, requestHash: null };
  }
  return {
    planHash: stored.slice(0, dotIdx),
    requestHash: stored.slice(dotIdx + 1) || null,
  };
}

function mapStatusToRecipientListLabel(
  status: BatchItemRow["status"],
):
  | "Name matches"
  | "Name differs"
  | "Not in simulated directory"
  | "Duplicate account"
  | "Skipped" {
  switch (status) {
    case "MATCHED":
    case "READY":
      return "Name matches";
    case "NAME_MISMATCH":
      return "Name differs";
    case "NOT_FOUND":
      return "Not in simulated directory";
    case "DUPLICATE":
      return "Duplicate account";
    case "SKIPPED":
    default:
      return "Skipped";
  }
}

export function mapStatusToSummaryLabel(status: BatchItemRow["status"]): string {
  switch (status) {
    case "PAID":
      return "Test payment sent";
    case "CONSUMED":
      return "Approved and sending";
    case "ACTIVE":
    case "READY":
      return "Waiting for your approval";
    case "FAILED":
      return "Not sent";
    case "REJECTED":
      return "Rejected";
    case "CANCELLED":
      return "Cancelled";
    case "EXPIRED":
      return "Expired";
    case "SKIPPED":
      return "Skipped";
    case "NOT_FOUND":
      return "Not in simulated directory";
    case "DUPLICATE":
      return "Duplicate account";
    case "NAME_MISMATCH":
      return "Name differs";
    case "MATCHED":
    default:
      return "Name matches";
  }
}

function buildParseAndResolveWidgets(
  batchId: string,
  items: readonly BatchItemRow[],
  directoryMap: ReadonlyMap<string, SandboxDirectoryRow>,
  unreadable: ReadonlyArray<{ rawText: string; reason: string }>,
): { widgets: BulkWidget[]; spoken: string } {
  const recipientListItems = items.map((item) => {
    const normalizedStatus:
      | "MATCHED"
      | "NAME_MISMATCH"
      | "NOT_FOUND"
      | "DUPLICATE"
      | "SKIPPED"
      | "READY" =
      item.status === "MATCHED" ||
      item.status === "NAME_MISMATCH" ||
      item.status === "NOT_FOUND" ||
      item.status === "DUPLICATE" ||
      item.status === "SKIPPED" ||
      item.status === "READY"
        ? item.status
        : "SKIPPED";
    return {
      itemId: item.id,
      position: item.position,
      pastedName: item.pasted_name,
      resolvedName: item.resolved_name,
      bankName: item.bank_name,
      accountLast4: item.account_number.slice(-4),
      status: normalizedStatus,
      statusLabel: mapStatusToRecipientListLabel(item.status),
    };
  });

  const spokenParts: string[] = [];
  for (const item of items) {
    const last4Phrase = speakLast4Digits(item.account_number);
    const label = mapStatusToRecipientListLabel(item.status);
    const displayName = item.resolved_name ?? item.pasted_name;
    spokenParts.push(
      `${displayName} at ${item.bank_name}, ${last4Phrase}: ${label}.`,
    );
  }
  if (unreadable.length > 0) {
    spokenParts.push(
      `${unreadable.length} ${unreadable.length === 1 ? "line was" : "lines were"} unreadable.`,
    );
  }

  const listSpoken =
    spokenParts.length > 0
      ? `Parsed ${items.length} ${items.length === 1 ? "recipient" : "recipients"} against the simulated directory. ${spokenParts.join(" ")}`
      : "No recipients parsed.";

  const recipientListWidget: RecipientListWidget =
    RecipientListWidgetSchema.parse({
      type: "recipient_list",
      batchId,
      recipients: recipientListItems,
      unreadable: [...unreadable],
      spoken: listSpoken,
    });

  const nameCheckWidgets: NameCheckWidget[] = [];
  for (const item of items) {
    if (item.status === "NAME_MISMATCH") {
      const dirKey = `${item.account_number}:${item.bank_name.toLowerCase()}`;
      const dirRow = directoryMap.get(dirKey);
      const directoryName = dirRow?.account_name ?? item.pasted_name;
      const last4Phrase = speakLast4Digits(item.account_number);
      const checkSpoken = `Name differs for ${item.bank_name}, ${last4Phrase}. You pasted ${item.pasted_name}, and the simulated directory lists ${directoryName}. Choose whether to use the simulated directory name or skip this recipient.`;
      nameCheckWidgets.push(
        NameCheckWidgetSchema.parse({
          type: "name_check",
          batchId,
          itemId: item.id,
          position: item.position,
          pastedName: item.pasted_name,
          directoryName,
          bankName: item.bank_name,
          accountLast4: item.account_number.slice(-4),
          statusLabel: "Name differs",
          choices: ["USE_DIRECTORY_NAME", "SKIP"],
          spoken: checkSpoken,
        }),
      );
    }
  }

  const combinedSpoken = [
    recipientListWidget.spoken,
    ...nameCheckWidgets.map((w) => w.spoken),
  ].join(" ");

  return {
    widgets: [recipientListWidget, ...nameCheckWidgets],
    spoken: combinedSpoken,
  };
}

export function buildPlanWidgetFromRows(
  batch: BatchRow,
  readyItems: readonly BatchItemRow[],
  planHash: string,
  requestHash: string,
  status: "PLANNED" | "CONFIRMED",
): PlanWidget {
  const totalMinor = readyItems.reduce(
    (sum, item) => sum + (item.amount_minor ?? 0),
    0,
  );
  const itemSpoken = readyItems
    .map((item) => {
      const name = item.resolved_name ?? item.pasted_name;
      return `${formatUsdDollars(item.amount_minor ?? 0)} to ${name} at ${item.bank_name}, ${speakLast4Digits(item.account_number)}`;
    })
    .join("; ");

  const spoken =
    status === "PLANNED"
      ? `Bulk plan ready for ${readyItems.length} ${readyItems.length === 1 ? "recipient" : "recipients"}, total ${formatUsdDollars(totalMinor)}: ${itemSpoken}. Confirm the plan to begin individual passkey approvals.`
      : `Plan confirmed for ${readyItems.length} ${readyItems.length === 1 ? "recipient" : "recipients"}, total ${formatUsdDollars(totalMinor)}. Each transfer will be read aloud and approved one at a time with your fingerprint or face.`;

  return PlanWidgetSchema.parse({
    type: "plan",
    batchId: batch.id,
    status,
    planHash,
    requestHash,
    totalMinor,
    currency: batch.currency,
    expiresAt: new Date(batch.expires_at).toISOString(),
    items: readyItems.map((item) => ({
      itemId: item.id,
      position: item.position,
      recipientName: item.resolved_name ?? item.pasted_name,
      bankName: item.bank_name,
      accountLast4: item.account_number.slice(-4),
      amountMinor: item.amount_minor ?? 0,
      currency: batch.currency,
      statusLabel:
        status === "CONFIRMED"
          ? "Waiting for your approval"
          : "Name matches",
    })),
    spoken,
  });
}

export function buildBatchSummaryWidgetFromRows(
  batch: BatchRow,
  items: readonly BatchItemRow[],
  paypalRefsByMandateId: ReadonlyMap<string, string | null> = new Map(),
): BatchSummaryWidget {
  const paidMinor = items
    .filter((i) => i.status === "PAID")
    .reduce((sum, i) => sum + (i.amount_minor ?? 0), 0);
  const totalMinor = Number(batch.total_minor) || 0;
  const paidCount = items.filter((i) => i.status === "PAID").length;
  const cancelledCount = items.filter((i) => i.status === "CANCELLED").length;
  const failedCount = items.filter(
    (i) =>
      i.status === "FAILED" ||
      i.status === "REJECTED" ||
      i.status === "EXPIRED",
  ).length;

  const itemSpoken = items
    .map((item) => {
      const name = item.resolved_name ?? item.pasted_name;
      const label = mapStatusToSummaryLabel(item.status);
      const amtPhrase =
        typeof item.amount_minor === "number" && item.amount_minor > 0
          ? ` (${formatUsdDollars(item.amount_minor)})`
          : "";
      return `${name} at ${item.bank_name}, ${speakLast4Digits(item.account_number)}${amtPhrase}: ${label}`;
    })
    .join("; ");

  const spoken = `Batch summary: ${paidCount} test ${paidCount === 1 ? "payment" : "payments"} sent totaling ${formatUsdDollars(paidMinor)} of ${formatUsdDollars(totalMinor)}, ${cancelledCount} cancelled, ${failedCount} not sent. ${itemSpoken}.`;

  return BatchSummaryWidgetSchema.parse({
    type: "batch_summary",
    batchId: batch.id,
    status: batch.status,
    totalMinor,
    paidMinor,
    currency: batch.currency,
    items: items.map((item) => ({
      itemId: item.id,
      position: item.position,
      recipientName: item.resolved_name ?? item.pasted_name,
      bankName: item.bank_name,
      accountLast4: item.account_number.slice(-4),
      amountMinor: Math.max(0, item.amount_minor ?? 0),
      currency: batch.currency,
      status: item.status,
      statusLabel: mapStatusToSummaryLabel(item.status),
      paypalRef: item.mandate_id
        ? (paypalRefsByMandateId.get(item.mandate_id) ?? null)
        : null,
    })),
    spoken,
  });
}

async function syncBatchItemsWithMandates(
  store: SupabaseBulkStore,
  accountId: string,
  batch: BatchRow,
  items: BatchItemRow[],
): Promise<{
  items: BatchItemRow[];
  paypalRefs: Map<string, string | null>;
}> {
  const paypalRefs = new Map<string, string | null>();
  const synced: BatchItemRow[] = [];

  for (const item of items) {
    if (!item.mandate_id) {
      synced.push(item);
      continue;
    }

    const mandateRow = await store.getOwnedMandate(accountId, item.mandate_id);
    if (!mandateRow) {
      synced.push(item);
      continue;
    }

    paypalRefs.set(item.mandate_id, mandateRow.paypal_ref ?? null);

    if (
      mandateRow.state === "CREATED" &&
      new Date(mandateRow.expires_at).getTime() <= Date.now()
    ) {
      await store.updateMandateStateIfCreated(
        accountId,
        mandateRow.id,
        "EXPIRED",
      );
      if (item.status === "ACTIVE") {
        await store.updateBatchItem(item.id, { status: "EXPIRED" });
        await store.audit(accountId, mandateRow.id, "BULK_ITEM_EXPIRED", {
          batchId: batch.id,
          itemId: item.id,
          position: item.position,
        });
        synced.push({ ...item, status: "EXPIRED" });
        continue;
      }
    }

    if (
      item.status === "ACTIVE" &&
      (mandateRow.state === "CONSUMED" ||
        mandateRow.state === "PAID" ||
        mandateRow.state === "FAILED" ||
        mandateRow.state === "REJECTED" ||
        mandateRow.state === "EXPIRED")
    ) {
      await store.updateBatchItem(item.id, { status: mandateRow.state });
      synced.push({ ...item, status: mandateRow.state });
      continue;
    }

    synced.push(item);
  }

  return { items: synced, paypalRefs };
}

export function createBulkRouter(
  config: BulkConfig,
  plannerClient: BulkGeminiPlannerClient = new GoogleBulkGeminiPlannerClient(
    config.geminiApiKey,
    config.geminiModel,
  ),
): Router {
  const router = Router();
  const store = new SupabaseBulkStore(config);

  router.post("/parse", async (request: Request, response: Response) => {
    const accountId = getAuthenticatedAccountId(request, config.sessionSecret);
    if (!accountId) {
      return response.status(401).json({
        code: "AUTH_REQUIRED",
        message: "Please sign in before creating a bulk test payment.",
        spoken: "Please sign in before creating a bulk test payment.",
      });
    }

    try {
      const body = parseRequestSchema.parse(request.body);
      const rawText = (body.rawText ?? body.text ?? "").trim();
      const parsed = parseBulkRecipients(rawText);

      if (parsed.errorCode === "TOO_MANY_RECIPIENTS") {
        await store.audit(accountId, null, "BULK_PARSE_REJECTED", {
          code: "TOO_MANY_RECIPIENTS",
        });
        return response.status(422).json({
          code: "TOO_MANY_RECIPIENTS",
          message: "You can include at most 5 recipients in one batch.",
          spoken: "You can include at most 5 recipients in one batch.",
        });
      }

      if (parsed.recipients.length === 0) {
        const firstReason =
          parsed.unreadable[0]?.reason ??
          parsed.errorMessage ??
          "Could not read any valid recipient with a 10-digit account number and bank name.";
        await store.audit(accountId, null, "BULK_PARSE_REJECTED", {
          code: "NO_VALID_RECIPIENTS",
          unreadableCount: parsed.unreadable.length,
        });
        return response.status(422).json({
          code: "NO_VALID_RECIPIENTS",
          message: firstReason,
          spoken: firstReason,
          unreadable: parsed.unreadable,
        });
      }

      const directoryRows = await store.getSandboxDirectory();
      const directoryMap = new Map<string, SandboxDirectoryRow>();
      for (const row of directoryRows) {
        directoryMap.set(
          `${row.account_number}:${row.bank_name.toLowerCase()}`,
          row,
        );
      }

      const now = new Date();
      const expiresAt = new Date(
        now.getTime() + config.batchTtlSeconds * 1000,
      );
      const batchId = randomUUID();
      const defaultCurrency =
        config.paymentPolicy.allowedCurrencies[0] ?? "USD";

      await store.createBatch({
        id: batchId,
        account_id: accountId,
        status: "PARSED",
        plan_hash: null,
        total_minor: 0,
        currency: defaultCurrency,
        created_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
      });

      const itemRows: BatchItemRow[] = parsed.recipients.map(
        (candidate, position) => {
          const dirKey = `${candidate.accountNumber}:${candidate.bankName.toLowerCase()}`;
          const dirEntry = directoryMap.get(dirKey);

          let status: BatchItemRow["status"];
          let resolvedName: string | null = null;

          if (candidate.isDuplicate) {
            status = "DUPLICATE";
          } else if (!dirEntry) {
            status = "NOT_FOUND";
          } else {
            const cmp = compareRecipientNames(
              candidate.pastedName,
              dirEntry.account_name,
            );
            if (cmp.matched) {
              status = "MATCHED";
              resolvedName = dirEntry.account_name;
            } else {
              status = "NAME_MISMATCH";
            }
          }

          return {
            id: randomUUID(),
            batch_id: batchId,
            position,
            pasted_name: candidate.pastedName,
            resolved_name: resolvedName,
            bank_name: candidate.bankName,
            account_number: candidate.accountNumber,
            status,
            amount_minor: null,
            mandate_id: null,
          };
        },
      );

      await store.createBatchItems(itemRows);

      const { widgets, spoken } = buildParseAndResolveWidgets(
        batchId,
        itemRows,
        directoryMap,
        parsed.unreadable,
      );

      await store.audit(accountId, null, "BULK_BATCH_PARSED", {
        batchId,
        recipientCount: itemRows.length,
        matchedCount: itemRows.filter((i) => i.status === "MATCHED").length,
        mismatchCount: itemRows.filter((i) => i.status === "NAME_MISMATCH")
          .length,
        notFoundCount: itemRows.filter((i) => i.status === "NOT_FOUND").length,
        duplicateCount: itemRows.filter((i) => i.status === "DUPLICATE").length,
        unreadableCount: parsed.unreadable.length,
      });

      return response.status(201).json({
        batchId,
        status: "PARSED",
        spoken,
        widgets,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return response.status(400).json({
          code: "INVALID_BULK_PARSE_REQUEST",
          message: "Please paste recipient details to parse.",
          spoken: "Please paste recipient details to parse.",
        });
      }
      return response.status(500).json({
        code: "BULK_PARSE_FAILED",
        message: "The pasted recipients could not be processed.",
        spoken: "The pasted recipients could not be processed.",
      });
    }
  });

  router.post(
    "/items/:id/resolve-name",
    async (request: Request, response: Response) => {
      const accountId = getAuthenticatedAccountId(
        request,
        config.sessionSecret,
      );
      if (!accountId) {
        return response.status(401).json({
          code: "AUTH_REQUIRED",
          message: "Please sign in before resolving a recipient name.",
          spoken: "Please sign in before resolving a recipient name.",
        });
      }

      try {
        const itemId = uuidParamSchema.parse(request.params.id);
        const { decision } = resolveNameRequestSchema.parse(request.body);

        const item = await store.getBatchItemById(itemId);
        if (!item) {
          await store.audit(accountId, null, "BULK_NAME_RESOLVE_REJECTED", {
            itemId,
            code: "BATCH_ITEM_NOT_FOUND",
          });
          return response.status(404).json({
            code: "BATCH_ITEM_NOT_FOUND",
            message: "This recipient item was not found.",
            spoken: "This recipient item was not found.",
          });
        }

        const batch = await store.getOwnedBatch(accountId, item.batch_id);
        if (!batch) {
          await store.audit(accountId, null, "BULK_NAME_RESOLVE_REJECTED", {
            itemId,
            batchId: item.batch_id,
            code: "BATCH_ITEM_NOT_OWNED",
          });
          return response.status(404).json({
            code: "BATCH_ITEM_NOT_FOUND",
            message: "This recipient item was not found.",
            spoken: "This recipient item was not found.",
          });
        }

        if (new Date(batch.expires_at).getTime() <= Date.now()) {
          await store.updateBatch(batch.id, { status: "EXPIRED" });
          await store.audit(accountId, null, "BULK_NAME_RESOLVE_REJECTED", {
            itemId,
            batchId: batch.id,
            code: "BATCH_EXPIRED",
          });
          return response.status(422).json({
            code: "BATCH_EXPIRED",
            message: "This bulk batch has expired. Please start a new batch.",
            spoken: "This bulk batch has expired. Please start a new batch.",
          });
        }

        if (batch.status !== "PARSED") {
          await store.audit(accountId, null, "BULK_NAME_RESOLVE_REJECTED", {
            itemId,
            batchId: batch.id,
            code: "BATCH_NOT_EDITABLE",
          });
          return response.status(422).json({
            code: "BATCH_NOT_EDITABLE",
            message:
              "Recipient names cannot be changed after a plan is confirmed.",
            spoken:
              "Recipient names cannot be changed after a plan is confirmed.",
          });
        }

        if (item.status !== "NAME_MISMATCH") {
          await store.audit(accountId, null, "BULK_NAME_RESOLVE_REJECTED", {
            itemId,
            batchId: batch.id,
            code: "ITEM_NOT_MISMATCHED",
          });
          return response.status(422).json({
            code: "ITEM_NOT_MISMATCHED",
            message: "This recipient does not have a pending name check.",
            spoken: "This recipient does not have a pending name check.",
          });
        }

        const directoryRows = await store.getSandboxDirectory();
        const directoryMap = new Map<string, SandboxDirectoryRow>();
        for (const row of directoryRows) {
          directoryMap.set(
            `${row.account_number}:${row.bank_name.toLowerCase()}`,
            row,
          );
        }

        const dirKey = `${item.account_number}:${item.bank_name.toLowerCase()}`;
        const dirEntry = directoryMap.get(dirKey);
        if (!dirEntry) {
          return response.status(422).json({
            code: "DIRECTORY_ENTRY_MISSING",
            message: "This recipient is not in the simulated directory.",
            spoken: "This recipient is not in the simulated directory.",
          });
        }

        const nextStatus: BatchItemRow["status"] =
          decision === "USE_DIRECTORY_NAME" ? "MATCHED" : "SKIPPED";
        const nextResolvedName =
          decision === "USE_DIRECTORY_NAME" ? dirEntry.account_name : null;

        await store.updateBatchItem(itemId, {
          status: nextStatus,
          resolved_name: nextResolvedName,
        });

        await store.audit(accountId, null, "BULK_NAME_RESOLVED", {
          batchId: batch.id,
          itemId,
          decision,
          pastedName: item.pasted_name,
          resolvedName: nextResolvedName,
          bankName: item.bank_name,
          accountLast4: item.account_number.slice(-4),
        });

        const updatedItems = await store.getBatchItems(batch.id);
        const { widgets } = buildParseAndResolveWidgets(
          batch.id,
          updatedItems,
          directoryMap,
          [],
        );

        const last4Phrase = speakLast4Digits(item.account_number);
        const actionSpoken =
          decision === "USE_DIRECTORY_NAME"
            ? `Updated recipient to simulated directory name ${dirEntry.account_name} at ${item.bank_name}, ${last4Phrase}.`
            : `Skipped ${item.pasted_name} at ${item.bank_name}, ${last4Phrase}.`;

        return response.json({
          batchId: batch.id,
          itemId,
          decision,
          status: nextStatus,
          resolvedName: nextResolvedName,
          spoken: actionSpoken,
          widgets,
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return response.status(400).json({
            code: "INVALID_RESOLVE_NAME_REQUEST",
            message:
              "Please choose to use the simulated directory name or skip this recipient.",
            spoken:
              "Please choose to use the simulated directory name or skip this recipient.",
          });
        }
        return response.status(500).json({
          code: "BULK_RESOLVE_NAME_FAILED",
          message: "The recipient name choice could not be saved.",
          spoken: "The recipient name choice could not be saved.",
        });
      }
    },
  );

  router.post(
    "/:batchId/plan",
    async (request: Request, response: Response) => {
      const accountId = getAuthenticatedAccountId(
        request,
        config.sessionSecret,
      );
      if (!accountId) {
        return response.status(401).json({
          code: "AUTH_REQUIRED",
          message: "Please sign in before planning a bulk test payment.",
          spoken: "Please sign in before planning a bulk test payment.",
        });
      }

      try {
        const batchId = uuidParamSchema.parse(request.params.batchId);
        const { instruction } = planRequestSchema.parse(request.body);

        const batch = await store.getOwnedBatch(accountId, batchId);
        if (!batch) {
          await store.audit(accountId, null, "BULK_PLAN_REJECTED", {
            batchId,
            code: "BATCH_NOT_FOUND",
          });
          return response.status(404).json({
            code: "BATCH_NOT_FOUND",
            message: "This bulk batch was not found.",
            spoken: "This bulk batch was not found.",
          });
        }

        if (new Date(batch.expires_at).getTime() <= Date.now()) {
          await store.updateBatch(batch.id, { status: "EXPIRED" });
          await store.audit(accountId, null, "BULK_PLAN_REJECTED", {
            batchId: batch.id,
            code: "BATCH_EXPIRED",
          });
          return response.status(422).json({
            code: "BATCH_EXPIRED",
            message: "This bulk batch has expired. Please start a new batch.",
            spoken: "This bulk batch has expired. Please start a new batch.",
          });
        }

        if (batch.status !== "PARSED" && batch.status !== "PLANNED") {
          await store.audit(accountId, null, "BULK_PLAN_REJECTED", {
            batchId: batch.id,
            code: "BATCH_ALREADY_CONFIRMED",
          });
          return response.status(422).json({
            code: "BATCH_ALREADY_CONFIRMED",
            message: "This batch plan has already been confirmed.",
            spoken: "This batch plan has already been confirmed.",
          });
        }

        const allItems = await store.getBatchItems(batch.id);
        const hasPendingMismatch = allItems.some(
          (i) => i.status === "NAME_MISMATCH",
        );
        if (hasPendingMismatch) {
          await store.audit(accountId, null, "BULK_PLAN_REJECTED", {
            batchId: batch.id,
            code: "UNRESOLVED_NAME_MISMATCH",
          });
          return response.status(422).json({
            code: "UNRESOLVED_NAME_MISMATCH",
            message:
              "Please resolve all recipient name checks before setting an amount.",
            spoken:
              "Please resolve all recipient name checks before setting an amount.",
          });
        }

        const payableItems = allItems.filter(
          (i) => i.status === "MATCHED" || i.status === "READY",
        );
        if (payableItems.length === 0) {
          await store.audit(accountId, null, "BULK_PLAN_REJECTED", {
            batchId: batch.id,
            code: "NO_PAYABLE_RECIPIENTS",
          });
          return response.status(422).json({
            code: "NO_PAYABLE_RECIPIENTS",
            message:
              "No payable recipients remain in this batch. Paste recipients in the simulated directory to continue.",
            spoken:
              "No payable recipients remain in this batch. Paste recipients in the simulated directory to continue.",
          });
        }

        // Decision 7: Sanitize display names before passing to Gemini
        const geminiRecipients = payableItems.map((item, idx) => ({
          recipientId: item.id,
          displayName: sanitizeDisplayNameForGemini(
            item.resolved_name ?? item.pasted_name,
            idx + 1,
          ),
        }));

        const rawModelOutput = await plannerClient.planAmounts(
          instruction,
          geminiRecipients,
        );
        const modelPlan = geminiBulkPlanOutputSchema.parse(rawModelOutput);

        if (
          modelPlan.needsClarification ||
          modelPlan.items.length !== payableItems.length
        ) {
          const msg =
            "Please restate the amount clearly, for example 25 dollars each.";
          await store.audit(accountId, null, "BULK_PLAN_REJECTED", {
            batchId: batch.id,
            code: "CLARIFICATION_REQUIRED",
          });
          return response.status(422).json({
            code: "CLARIFICATION_REQUIRED",
            message: msg,
            spoken: msg,
          });
        }

        const amountByItemId = new Map<string, number>();
        for (const planned of modelPlan.items) {
          amountByItemId.set(planned.recipientId, planned.amountMinor);
        }

        // Verify every payable item received an amount
        for (const item of payableItems) {
          if (!amountByItemId.has(item.id)) {
            const msg =
              "Please restate the amount clearly for each recipient.";
            await store.audit(accountId, null, "BULK_PLAN_REJECTED", {
              batchId: batch.id,
              code: "INCOMPLETE_PLAN_AMOUNTS",
            });
            return response.status(422).json({
              code: "INCOMPLETE_PLAN_AMOUNTS",
              message: msg,
              spoken: msg,
            });
          }
        }

        const proposedAmounts = payableItems.map(
          (item) => amountByItemId.get(item.id)!,
        );

        // Rule 10: Dual amount check (Gemini output vs deterministic parser)
        const dualCheck = verifyDualAmountCheck(instruction, proposedAmounts);
        if (!dualCheck.accepted) {
          await store.audit(accountId, null, "BULK_PLAN_REJECTED", {
            batchId: batch.id,
            code: dualCheck.code,
          });
          return response.status(422).json({
            code: dualCheck.code,
            message: dualCheck.spoken,
            spoken: dualCheck.spoken,
          });
        }

        // Rule 14: Check per-transfer limit (MAX_AMOUNT_MINOR)
        const maxSingleMinor = config.paymentPolicy.maximumAmountMinor;
        const overSingle = proposedAmounts.find((amt) => amt > maxSingleMinor);
        if (overSingle !== undefined) {
          const limitFormatted = formatUsdDollars(maxSingleMinor);
          const msg = `Amount ${formatUsdDollars(overSingle)} exceeds the ${limitFormatted} per-transfer limit. Please choose an amount up to ${limitFormatted}.`;
          await store.audit(accountId, null, "BULK_PLAN_REJECTED", {
            batchId: batch.id,
            code: "AMOUNT_EXCEEDS_POLICY",
            attemptedMinor: overSingle,
            maxAmountMinor: maxSingleMinor,
          });
          return response.status(422).json({
            code: "AMOUNT_EXCEEDS_POLICY",
            message: msg,
            spoken: msg,
          });
        }

        // Rule 14: Check batch total limit (MAX_BATCH_MINOR)
        const totalMinor = proposedAmounts.reduce((sum, amt) => sum + amt, 0);
        if (totalMinor > config.maxBatchMinor) {
          const batchLimitFormatted = formatUsdDollars(config.maxBatchMinor);
          const msg = `Total batch amount of ${formatUsdDollars(totalMinor)} exceeds the ${batchLimitFormatted} batch limit. Please reduce the amount or number of recipients.`;
          await store.audit(accountId, null, "BULK_PLAN_REJECTED", {
            batchId: batch.id,
            code: "BATCH_TOTAL_EXCEEDS_LIMIT",
            totalMinor,
            maxBatchMinor: config.maxBatchMinor,
          });
          return response.status(422).json({
            code: "BATCH_TOTAL_EXCEEDS_LIMIT",
            message: msg,
            spoken: msg,
          });
        }

        // Persist planned amounts on payable items
        const updatedPayable: BatchItemRow[] = [];
        for (const item of payableItems) {
          const amt = amountByItemId.get(item.id)!;
          await store.updateBatchItem(item.id, {
            amount_minor: amt,
            status: "READY",
          });
          updatedPayable.push({
            ...item,
            amount_minor: amt,
            status: "READY",
          });
        }

        const requestHash = createHash("sha256")
          .update(instruction.trim(), "utf8")
          .digest("base64url");

        const planHash = computePlanHash({
          batchId: batch.id,
          accountId,
          currency: batch.currency,
          totalMinor,
          requestHash,
          items: updatedPayable.map((item) => ({
            itemId: item.id,
            position: item.position,
            accountNumber: item.account_number,
            bankName: item.bank_name,
            resolvedName: item.resolved_name ?? item.pasted_name,
            amountMinor: item.amount_minor!,
          })),
        });

        await store.updateBatch(batch.id, {
          status: "PLANNED",
          plan_hash: encodeStoredPlanHashes(planHash, requestHash),
          total_minor: totalMinor,
        });

        const planWidget = buildPlanWidgetFromRows(
          { ...batch, status: "PLANNED", total_minor: totalMinor },
          updatedPayable,
          planHash,
          requestHash,
          "PLANNED",
        );

        await store.audit(accountId, null, "BULK_PLAN_CREATED", {
          batchId: batch.id,
          planHash,
          requestHash,
          totalMinor,
          currency: batch.currency,
          itemCount: updatedPayable.length,
        });

        return response.json({
          batchId: batch.id,
          status: "PLANNED",
          planHash,
          requestHash,
          totalMinor,
          currency: batch.currency,
          spoken: planWidget.spoken,
          widgets: [planWidget],
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return response.status(422).json({
            code: "INVALID_PLAN_REQUEST",
            message:
              "Please state the amount for your recipients, for example 25 dollars each.",
            spoken:
              "Please state the amount for your recipients, for example 25 dollars each.",
          });
        }
        return response.status(502).json({
          code: "BULK_PLAN_UNAVAILABLE",
          message:
            "The amount instruction could not be processed. Please try again.",
          spoken:
            "The amount instruction could not be processed. Please try again.",
        });
      }
    },
  );

  router.post(
    "/:batchId/confirm-plan",
    async (request: Request, response: Response) => {
      const accountId = getAuthenticatedAccountId(
        request,
        config.sessionSecret,
      );
      if (!accountId) {
        return response.status(401).json({
          code: "AUTH_REQUIRED",
          message: "Please sign in before confirming a bulk payment plan.",
          spoken: "Please sign in before confirming a bulk payment plan.",
        });
      }

      try {
        const batchId = uuidParamSchema.parse(request.params.batchId);
        const body = confirmPlanRequestSchema.parse(request.body ?? {});

        const batch = await store.getOwnedBatch(accountId, batchId);
        if (!batch) {
          await store.audit(accountId, null, "BULK_PLAN_CONFIRM_REJECTED", {
            batchId,
            code: "BATCH_NOT_FOUND",
          });
          return response.status(404).json({
            code: "BATCH_NOT_FOUND",
            message: "This bulk batch was not found.",
            spoken: "This bulk batch was not found.",
          });
        }

        if (new Date(batch.expires_at).getTime() <= Date.now()) {
          await store.updateBatch(batch.id, { status: "EXPIRED" });
          await store.audit(accountId, null, "BULK_PLAN_CONFIRM_REJECTED", {
            batchId: batch.id,
            code: "BATCH_EXPIRED",
          });
          return response.status(422).json({
            code: "BATCH_EXPIRED",
            message: "This bulk plan has expired. Please start a new batch.",
            spoken: "This bulk plan has expired. Please start a new batch.",
          });
        }

        if (batch.status !== "PLANNED") {
          await store.audit(accountId, null, "BULK_PLAN_CONFIRM_REJECTED", {
            batchId: batch.id,
            code: "BATCH_NOT_IN_PLANNED_STATE",
          });
          return response.status(422).json({
            code: "BATCH_NOT_IN_PLANNED_STATE",
            message: "Create a payment plan before confirming.",
            spoken: "Create a payment plan before confirming.",
          });
        }

        const { planHash: storedPlanHash, requestHash: storedRequestHash } =
          decodeStoredPlanHashes(batch.plan_hash);
        const effectiveRequestHash = body.requestHash ?? storedRequestHash;

        if (!storedPlanHash || !effectiveRequestHash) {
          await store.audit(accountId, null, "BULK_PLAN_CONFIRM_REJECTED", {
            batchId: batch.id,
            code: "MISSING_PLAN_HASH",
          });
          return response.status(422).json({
            code: "PLAN_HASH_MISMATCH",
            message: "The payment plan could not be confirmed.",
            spoken: "The payment plan could not be confirmed.",
          });
        }

        const allItems = await store.getBatchItems(batch.id);
        const readyItems = allItems.filter((i) => i.status === "READY");
        if (
          readyItems.length === 0 ||
          readyItems.some(
            (i) =>
              typeof i.amount_minor !== "number" ||
              i.amount_minor <= 0 ||
              !i.resolved_name,
          )
        ) {
          await store.audit(accountId, null, "BULK_PLAN_CONFIRM_REJECTED", {
            batchId: batch.id,
            code: "INVALID_READY_ITEMS",
          });
          return response.status(422).json({
            code: "PLAN_HASH_MISMATCH",
            message:
              "The payment plan items were modified and cannot be confirmed.",
            spoken:
              "The payment plan items were modified and cannot be confirmed.",
          });
        }

        const recomputedTotal = readyItems.reduce(
          (sum, i) => sum + (i.amount_minor ?? 0),
          0,
        );
        const recomputedPlanHash = computePlanHash({
          batchId: batch.id,
          accountId,
          currency: batch.currency,
          totalMinor: recomputedTotal,
          requestHash: effectiveRequestHash,
          items: readyItems.map((item) => ({
            itemId: item.id,
            position: item.position,
            accountNumber: item.account_number,
            bankName: item.bank_name,
            resolvedName: item.resolved_name!,
            amountMinor: item.amount_minor!,
          })),
        });

        if (
          recomputedPlanHash !== storedPlanHash ||
          recomputedTotal !== Number(batch.total_minor) ||
          (body.planHash && body.planHash !== storedPlanHash) ||
          (body.requestHash &&
            storedRequestHash &&
            body.requestHash !== storedRequestHash)
        ) {
          await store.audit(accountId, null, "BULK_PLAN_CONFIRM_REJECTED", {
            batchId: batch.id,
            code: "PLAN_HASH_MISMATCH",
          });
          return response.status(422).json({
            code: "PLAN_HASH_MISMATCH",
            message:
              "The payment plan was altered after creation and has been rejected.",
            spoken:
              "The payment plan was altered after creation and has been rejected.",
          });
        }

        await store.updateBatch(batch.id, { status: "CONFIRMED" });

        const confirmedWidget = buildPlanWidgetFromRows(
          { ...batch, status: "CONFIRMED" },
          readyItems,
          storedPlanHash,
          effectiveRequestHash,
          "CONFIRMED",
        );

        await store.audit(accountId, null, "BULK_PLAN_CONFIRMED", {
          batchId: batch.id,
          planHash: storedPlanHash,
          requestHash: effectiveRequestHash,
          totalMinor: recomputedTotal,
          currency: batch.currency,
          itemCount: readyItems.length,
        });

        return response.json({
          batchId: batch.id,
          status: "CONFIRMED",
          planHash: storedPlanHash,
          requestHash: effectiveRequestHash,
          totalMinor: recomputedTotal,
          currency: batch.currency,
          spoken: confirmedWidget.spoken,
          widgets: [confirmedWidget],
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return response.status(400).json({
            code: "INVALID_CONFIRM_PLAN_REQUEST",
            message: "The plan confirmation request is invalid.",
            spoken: "The plan confirmation request is invalid.",
          });
        }
        return response.status(500).json({
          code: "BULK_CONFIRM_PLAN_FAILED",
          message: "The payment plan could not be confirmed.",
          spoken: "The payment plan could not be confirmed.",
        });
      }
    },
  );

  // ==========================================================================
  // Unit B5: Sequential Activation, Mandate Fetch, Cancellation, and Batch State
  // ==========================================================================

  router.post(
    "/:batchId/next",
    async (request: Request, response: Response) => {
      const accountId = getAuthenticatedAccountId(
        request,
        config.sessionSecret,
      );
      if (!accountId) {
        return response.status(401).json({
          code: "AUTH_REQUIRED",
          message: "Please sign in before activating the next transfer.",
          spoken: "Please sign in before activating the next transfer.",
        });
      }

      try {
        const batchId = uuidParamSchema.parse(request.params.batchId);
        const batch = await store.getOwnedBatch(accountId, batchId);
        if (!batch) {
          await store.audit(accountId, null, "BULK_NEXT_REJECTED", {
            batchId,
            code: "BATCH_NOT_FOUND",
          });
          return response.status(404).json({
            code: "BATCH_NOT_FOUND",
            message: "This bulk batch was not found.",
            spoken: "This bulk batch was not found.",
          });
        }

        if (
          batch.status !== "COMPLETED" &&
          batch.status !== "CANCELLED" &&
          new Date(batch.expires_at).getTime() <= Date.now()
        ) {
          await store.updateBatch(batch.id, { status: "EXPIRED" });
          await store.audit(accountId, null, "BULK_NEXT_REJECTED", {
            batchId: batch.id,
            code: "BATCH_EXPIRED",
          });
          return response.status(422).json({
            code: "BATCH_EXPIRED",
            message: "This bulk plan has expired. Please start a new batch.",
            spoken: "This bulk plan has expired. Please start a new batch.",
          });
        }

        if (batch.status === "PARSED" || batch.status === "PLANNED") {
          await store.audit(accountId, null, "BULK_NEXT_REJECTED", {
            batchId: batch.id,
            code: "BATCH_NOT_CONFIRMED",
          });
          return response.status(422).json({
            code: "BATCH_NOT_CONFIRMED",
            message:
              "Please confirm the payment plan before activating transfers.",
            spoken:
              "Please confirm the payment plan before activating transfers.",
          });
        }

        if (batch.status === "CANCELLED" || batch.status === "EXPIRED") {
          await store.audit(accountId, null, "BULK_NEXT_REJECTED", {
            batchId: batch.id,
            code: `BATCH_${batch.status}`,
          });
          return response.status(422).json({
            code: `BATCH_${batch.status}`,
            message: "This bulk batch is no longer active.",
            spoken: "This bulk batch is no longer active.",
          });
        }

        const rawItems = await store.getBatchItems(batch.id);
        const { items: syncedItems, paypalRefs } =
          await syncBatchItemsWithMandates(store, accountId, batch, rawItems);

        const paidMinor = syncedItems
          .filter((i) => i.status === "PAID")
          .reduce((sum, i) => sum + (i.amount_minor ?? 0), 0);

        const currentlyConsumed = syncedItems.find(
          (i) => i.status === "CONSUMED",
        );
        if (currentlyConsumed) {
          return response.status(409).json({
            code: "ITEM_APPROVAL_IN_PROGRESS",
            message: "A transfer in this batch is currently being sent.",
            spoken: "A transfer in this batch is currently being sent.",
          });
        }

        const currentlyActive = syncedItems.find((i) => i.status === "ACTIVE");
        if (currentlyActive && currentlyActive.mandate_id) {
          const activeMandate = await store.getOwnedMandate(
            accountId,
            currentlyActive.mandate_id,
          );
          if (activeMandate && activeMandate.state === "CREATED") {
            const approvalWidget: TransferApprovalWidget =
              TransferApprovalWidgetSchema.parse({
                type: "transfer_approval",
                mandateId: currentlyActive.mandate_id,
              });
            return response.json({
              batchId: batch.id,
              status: batch.status,
              activeItem: {
                itemId: currentlyActive.id,
                position: currentlyActive.position,
                mandateId: currentlyActive.mandate_id,
              },
              runningTotalMinor: paidMinor,
              totalMinor: Number(batch.total_minor),
              currency: batch.currency,
              spoken: activeMandate.spoken_text,
              widgets: [approvalWidget],
            });
          }
        }

        const nextReady = syncedItems.find((i) => i.status === "READY");
        if (!nextReady) {
          // All items have reached terminal states
          const completedBatch: BatchRow = {
            ...batch,
            status: "COMPLETED",
          };
          if (batch.status !== "COMPLETED") {
            await store.updateBatch(batch.id, { status: "COMPLETED" });
            await store.audit(accountId, null, "BULK_BATCH_COMPLETED", {
              batchId: batch.id,
              paidMinor,
              totalMinor: Number(batch.total_minor),
              currency: batch.currency,
            });
          }
          const summaryWidget = buildBatchSummaryWidgetFromRows(
            completedBatch,
            syncedItems,
            paypalRefs,
          );
          return response.json({
            batchId: batch.id,
            status: "COMPLETED",
            activeItem: null,
            runningTotalMinor: paidMinor,
            paidMinor,
            totalMinor: Number(batch.total_minor),
            currency: batch.currency,
            spoken: summaryWidget.spoken,
            widgets: [summaryWidget],
          });
        }

        const { requestHash: storedRequestHash } = decodeStoredPlanHashes(
          batch.plan_hash,
        );
        if (
          !storedRequestHash ||
          !nextReady.resolved_name ||
          typeof nextReady.amount_minor !== "number" ||
          nextReady.amount_minor <= 0
        ) {
          await store.audit(accountId, null, "BULK_NEXT_REJECTED", {
            batchId: batch.id,
            itemId: nextReady.id,
            code: "INVALID_BATCH_ITEM_STATE",
          });
          return response.status(422).json({
            code: "INVALID_BATCH_ITEM_STATE",
            message: "This transfer item could not be prepared.",
            spoken: "This transfer item could not be prepared.",
          });
        }

        const composedPayeeName = composeMandatePayeeName(
          nextReady.resolved_name,
          nextReady.bank_name,
        );

        const mandateResult = await createAccountMandate(config, accountId, {
          proposal: {
            action: "send_money",
            payeeName: composedPayeeName,
            payeeAccountNumber: nextReady.account_number,
            amountMinor: nextReady.amount_minor,
            currency: batch.currency,
          },
          requestConstraints: {
            action: "send_money",
            payeeName: composedPayeeName,
            payeeAccountNumber: nextReady.account_number,
            maximumAmountMinor: nextReady.amount_minor,
            currency: batch.currency,
          },
          requestHash: storedRequestHash,
        });

        if (!mandateResult.accepted) {
          await store.updateBatchItem(nextReady.id, { status: "FAILED" });
          await store.audit(accountId, null, "BULK_ITEM_ACTIVATION_REJECTED", {
            batchId: batch.id,
            itemId: nextReady.id,
            code: mandateResult.code,
          });
          return response.status(mandateResult.status).json({
            code: mandateResult.code,
            message: mandateResult.message,
            spoken: mandateResult.message,
          });
        }

        await store.updateBatchItem(nextReady.id, {
          status: "ACTIVE",
          mandate_id: mandateResult.mandateId,
        });

        if (batch.status !== "IN_PROGRESS") {
          await store.updateBatch(batch.id, { status: "IN_PROGRESS" });
        }

        await store.audit(
          accountId,
          mandateResult.mandateId,
          "BULK_ITEM_ACTIVATED",
          {
            batchId: batch.id,
            itemId: nextReady.id,
            position: nextReady.position,
            mandateId: mandateResult.mandateId,
            mandateHash: mandateResult.mandateHash,
            recipientName: nextReady.resolved_name,
            bankName: nextReady.bank_name,
            accountLast4: nextReady.account_number.slice(-4),
            amountMinor: nextReady.amount_minor,
            currency: batch.currency,
          },
        );

        const approvalWidget: TransferApprovalWidget =
          TransferApprovalWidgetSchema.parse({
            type: "transfer_approval",
            mandateId: mandateResult.mandateId,
          });

        return response.json({
          batchId: batch.id,
          status: "IN_PROGRESS",
          activeItem: {
            itemId: nextReady.id,
            position: nextReady.position,
            mandateId: mandateResult.mandateId,
          },
          runningTotalMinor: paidMinor,
          totalMinor: Number(batch.total_minor),
          currency: batch.currency,
          spoken: mandateResult.spoken,
          widgets: [approvalWidget],
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return response.status(400).json({
            code: "INVALID_NEXT_REQUEST",
            message: "The batch identifier is invalid.",
            spoken: "The batch identifier is invalid.",
          });
        }
        return response.status(500).json({
          code: "BULK_NEXT_FAILED",
          message: "The next transfer could not be activated.",
          spoken: "The next transfer could not be activated.",
        });
      }
    },
  );

  router.get(
    "/:batchId/items/:itemId/mandate",
    async (request: Request, response: Response) => {
      const accountId = getAuthenticatedAccountId(
        request,
        config.sessionSecret,
      );
      if (!accountId) {
        return response.status(401).json({
          code: "AUTH_REQUIRED",
          message: "Please sign in before loading a transfer approval.",
          spoken: "Please sign in before loading a transfer approval.",
        });
      }

      try {
        const batchId = uuidParamSchema.parse(request.params.batchId);
        const itemId = uuidParamSchema.parse(request.params.itemId);

        const batch = await store.getOwnedBatch(accountId, batchId);
        if (!batch) {
          await store.audit(accountId, null, "BULK_MANDATE_FETCH_REJECTED", {
            batchId,
            itemId,
            code: "BATCH_NOT_FOUND",
          });
          return response.status(404).json({
            code: "BATCH_NOT_FOUND",
            message: "This bulk batch was not found.",
            spoken: "This bulk batch was not found.",
          });
        }

        const item = await store.getBatchItemById(itemId);
        if (!item || item.batch_id !== batch.id) {
          await store.audit(accountId, null, "BULK_MANDATE_FETCH_REJECTED", {
            batchId: batch.id,
            itemId,
            code: "BATCH_ITEM_NOT_FOUND",
          });
          return response.status(404).json({
            code: "BATCH_ITEM_NOT_FOUND",
            message: "This transfer item was not found in this batch.",
            spoken: "This transfer item was not found in this batch.",
          });
        }

        if (!item.mandate_id) {
          return response.status(409).json({
            code: "ITEM_HAS_NO_ACTIVE_MANDATE",
            message:
              "This recipient does not have an active transfer mandate yet.",
            spoken:
              "This recipient does not have an active transfer mandate yet.",
          });
        }

        const mandateRow = await store.getOwnedMandate(
          accountId,
          item.mandate_id,
        );
        if (!mandateRow) {
          return response.status(404).json({
            code: "MANDATE_NOT_FOUND",
            message: "This transfer mandate was not found.",
            spoken: "This transfer mandate was not found.",
          });
        }

        if (
          mandateRow.state === "CREATED" &&
          new Date(mandateRow.expires_at).getTime() <= Date.now()
        ) {
          await store.updateMandateStateIfCreated(
            accountId,
            mandateRow.id,
            "EXPIRED",
          );
          await store.updateBatchItem(item.id, { status: "EXPIRED" });
          return response.status(410).json({
            code: "MANDATE_EXPIRED",
            message: "This transfer approval has expired.",
            spoken: "This transfer approval has expired.",
          });
        }

        if (item.status !== "ACTIVE" || mandateRow.state !== "CREATED") {
          return response.status(409).json({
            code: "ITEM_MANDATE_NOT_ACTIVE",
            message: "This transfer is no longer waiting for approval.",
            spoken: "This transfer is no longer waiting for approval.",
          });
        }

        const mandate = buildMandate({
          id: mandateRow.id,
          accountId: mandateRow.account_id,
          action: mandateRow.action,
          ...(mandateRow.payee_contact_id
            ? { payeeContactId: mandateRow.payee_contact_id }
            : {}),
          ...(mandateRow.payee_name
            ? { payeeName: mandateRow.payee_name }
            : {}),
          ...(mandateRow.payee_account_number
            ? { payeeAccountNumber: mandateRow.payee_account_number }
            : {}),
          amountMinor: Number(mandateRow.amount_minor),
          currency: mandateRow.currency,
          constraints: mandateRow.constraints,
          requestHash: mandateRow.request_hash,
          nonce: mandateRow.nonce,
          issuedAt: new Date(mandateRow.issued_at).toISOString(),
          expiresAt: new Date(mandateRow.expires_at).toISOString(),
          spokenText: mandateRow.spoken_text,
        });

        const approvalOptions = await buildMandateApprovalOptions(
          config.rpID,
          mandateRow.mandate_hash,
        );

        return response.json({
          mandate,
          mandateHash: mandateRow.mandate_hash,
          approvalOptions,
          spoken: mandateRow.spoken_text,
          readoutRequired: mandateRow.state === "CREATED",
          state: mandateRow.state,
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return response.status(400).json({
            code: "INVALID_MANDATE_FETCH_REQUEST",
            message: "The transfer identifier is invalid.",
            spoken: "The transfer identifier is invalid.",
          });
        }
        return response.status(500).json({
          code: "BULK_MANDATE_FETCH_FAILED",
          message: "The transfer approval details could not be loaded.",
          spoken: "The transfer approval details could not be loaded.",
        });
      }
    },
  );

  router.post(
    "/:batchId/items/:id/cancel",
    async (request: Request, response: Response) => {
      const accountId = getAuthenticatedAccountId(
        request,
        config.sessionSecret,
      );
      if (!accountId) {
        return response.status(401).json({
          code: "AUTH_REQUIRED",
          message: "Please sign in before cancelling a transfer.",
          spoken: "Please sign in before cancelling a transfer.",
        });
      }

      try {
        const batchId = uuidParamSchema.parse(request.params.batchId);
        const itemId = uuidParamSchema.parse(request.params.id);

        const batch = await store.getOwnedBatch(accountId, batchId);
        if (!batch) {
          await store.audit(accountId, null, "BULK_ITEM_CANCEL_REJECTED", {
            batchId,
            itemId,
            code: "BATCH_NOT_FOUND",
          });
          return response.status(404).json({
            code: "BATCH_NOT_FOUND",
            message: "This bulk batch was not found.",
            spoken: "This bulk batch was not found.",
          });
        }

        const rawItems = await store.getBatchItems(batch.id);
        const { items: syncedItems, paypalRefs } =
          await syncBatchItemsWithMandates(store, accountId, batch, rawItems);

        const item = syncedItems.find((i) => i.id === itemId);
        if (!item) {
          await store.audit(accountId, null, "BULK_ITEM_CANCEL_REJECTED", {
            batchId: batch.id,
            itemId,
            code: "BATCH_ITEM_NOT_FOUND",
          });
          return response.status(404).json({
            code: "BATCH_ITEM_NOT_FOUND",
            message: "This transfer item was not found in this batch.",
            spoken: "This transfer item was not found in this batch.",
          });
        }

        // Rule 13: Never touch an item that is CONSUMED or PAID
        if (item.status === "CONSUMED" || item.status === "PAID") {
          await store.audit(
            accountId,
            item.mandate_id,
            "BULK_ITEM_CANCEL_REJECTED",
            {
              batchId: batch.id,
              itemId: item.id,
              status: item.status,
              code: "ITEM_ALREADY_PROCESSED",
            },
          );
          return response.status(409).json({
            code: "ITEM_ALREADY_PROCESSED",
            message:
              "This transfer has already been approved and cannot be cancelled.",
            spoken:
              "This transfer has already been approved and cannot be cancelled.",
          });
        }

        if (isTerminalBatchItemStatus(item.status)) {
          await store.audit(
            accountId,
            item.mandate_id,
            "BULK_ITEM_CANCEL_REJECTED",
            {
              batchId: batch.id,
              itemId: item.id,
              status: item.status,
              code: "ITEM_NOT_CANCELLABLE",
            },
          );
          return response.status(409).json({
            code: "ITEM_NOT_CANCELLABLE",
            message: "This transfer is no longer pending.",
            spoken: "This transfer is no longer pending.",
          });
        }

        if (item.mandate_id) {
          await store.updateMandateStateIfCreated(
            accountId,
            item.mandate_id,
            "REJECTED",
          );
        }

        await store.updateBatchItem(item.id, { status: "CANCELLED" });

        await store.audit(accountId, item.mandate_id, "BULK_ITEM_CANCELLED", {
          batchId: batch.id,
          itemId: item.id,
          position: item.position,
          recipientName: item.resolved_name ?? item.pasted_name,
          bankName: item.bank_name,
          accountLast4: item.account_number.slice(-4),
          amountMinor: item.amount_minor,
          reason: "SINGLE_ITEM_CANCEL",
        });

        const updatedItems = syncedItems.map((i) =>
          i.id === item.id ? { ...i, status: "CANCELLED" as const } : i,
        );

        const allTerminal = updatedItems.every((i) =>
          isTerminalBatchItemStatus(i.status),
        );
        const anyPaid = updatedItems.some((i) => i.status === "PAID");
        let nextBatchStatus = batch.status;
        const widgets: BulkWidget[] = [];

        if (allTerminal) {
          nextBatchStatus = anyPaid ? "COMPLETED" : "CANCELLED";
          await store.updateBatch(batch.id, { status: nextBatchStatus });
          widgets.push(
            buildBatchSummaryWidgetFromRows(
              { ...batch, status: nextBatchStatus },
              updatedItems,
              paypalRefs,
            ),
          );
        }

        const displayName = item.resolved_name ?? item.pasted_name;
        const spoken = `Cancelled transfer to ${displayName} at ${item.bank_name}, ${speakLast4Digits(item.account_number)}.`;

        return response.json({
          batchId: batch.id,
          itemId: item.id,
          status: "CANCELLED",
          batchStatus: nextBatchStatus,
          spoken,
          widgets,
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return response.status(400).json({
            code: "INVALID_CANCEL_ITEM_REQUEST",
            message: "The transfer identifier is invalid.",
            spoken: "The transfer identifier is invalid.",
          });
        }
        return response.status(500).json({
          code: "BULK_CANCEL_ITEM_FAILED",
          message: "The transfer could not be cancelled.",
          spoken: "The transfer could not be cancelled.",
        });
      }
    },
  );

  router.post(
    "/:batchId/cancel-remaining",
    async (request: Request, response: Response) => {
      const accountId = getAuthenticatedAccountId(
        request,
        config.sessionSecret,
      );
      if (!accountId) {
        return response.status(401).json({
          code: "AUTH_REQUIRED",
          message: "Please sign in before cancelling remaining transfers.",
          spoken: "Please sign in before cancelling remaining transfers.",
        });
      }

      try {
        const batchId = uuidParamSchema.parse(request.params.batchId);
        const batch = await store.getOwnedBatch(accountId, batchId);
        if (!batch) {
          await store.audit(
            accountId,
            null,
            "BULK_CANCEL_REMAINING_REJECTED",
            {
              batchId,
              code: "BATCH_NOT_FOUND",
            },
          );
          return response.status(404).json({
            code: "BATCH_NOT_FOUND",
            message: "This bulk batch was not found.",
            spoken: "This bulk batch was not found.",
          });
        }

        const rawItems = await store.getBatchItems(batch.id);
        const { items: syncedItems, paypalRefs } =
          await syncBatchItemsWithMandates(store, accountId, batch, rawItems);

        const cancelledItemIds: string[] = [];
        const updatedItems: BatchItemRow[] = [];

        for (const item of syncedItems) {
          // Rule 13: Cancel every pending item (status CANCELLED, one audit event each)
          // and NEVER touch an item that is CONSUMED or PAID (or already terminal).
          if (
            item.status === "READY" ||
            item.status === "ACTIVE" ||
            item.status === "MATCHED" ||
            item.status === "NAME_MISMATCH"
          ) {
            if (item.mandate_id) {
              await store.updateMandateStateIfCreated(
                accountId,
                item.mandate_id,
                "REJECTED",
              );
            }
            await store.updateBatchItem(item.id, { status: "CANCELLED" });
            await store.audit(
              accountId,
              item.mandate_id,
              "BULK_ITEM_CANCELLED",
              {
                batchId: batch.id,
                itemId: item.id,
                position: item.position,
                recipientName: item.resolved_name ?? item.pasted_name,
                bankName: item.bank_name,
                accountLast4: item.account_number.slice(-4),
                amountMinor: item.amount_minor,
                reason: "CANCEL_REMAINING",
              },
            );
            cancelledItemIds.push(item.id);
            updatedItems.push({ ...item, status: "CANCELLED" });
          } else {
            updatedItems.push(item);
          }
        }

        const anyPaid = updatedItems.some((i) => i.status === "PAID");
        const anyConsumed = updatedItems.some((i) => i.status === "CONSUMED");
        const nextBatchStatus: BatchRow["status"] = anyConsumed
          ? "IN_PROGRESS"
          : anyPaid
            ? "COMPLETED"
            : "CANCELLED";

        await store.updateBatch(batch.id, { status: nextBatchStatus });

        const paidMinor = updatedItems
          .filter((i) => i.status === "PAID")
          .reduce((sum, i) => sum + (i.amount_minor ?? 0), 0);

        const summaryWidget = buildBatchSummaryWidgetFromRows(
          { ...batch, status: nextBatchStatus },
          updatedItems,
          paypalRefs,
        );

        return response.json({
          batchId: batch.id,
          status: nextBatchStatus,
          cancelledItemIds,
          cancelledCount: cancelledItemIds.length,
          runningTotalMinor: paidMinor,
          paidMinor,
          totalMinor: Number(batch.total_minor),
          currency: batch.currency,
          spoken: summaryWidget.spoken,
          widgets: [summaryWidget],
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return response.status(400).json({
            code: "INVALID_CANCEL_REMAINING_REQUEST",
            message: "The batch identifier is invalid.",
            spoken: "The batch identifier is invalid.",
          });
        }
        return response.status(500).json({
          code: "BULK_CANCEL_REMAINING_FAILED",
          message: "The remaining transfers could not be cancelled.",
          spoken: "The remaining transfers could not be cancelled.",
        });
      }
    },
  );

  router.get(
    "/:batchId",
    async (request: Request, response: Response) => {
      const accountId = getAuthenticatedAccountId(
        request,
        config.sessionSecret,
      );
      if (!accountId) {
        return response.status(401).json({
          code: "AUTH_REQUIRED",
          message: "Please sign in before viewing a bulk batch.",
          spoken: "Please sign in before viewing a bulk batch.",
        });
      }

      try {
        const batchId = uuidParamSchema.parse(request.params.batchId);
        const batch = await store.getOwnedBatch(accountId, batchId);
        if (!batch) {
          return response.status(404).json({
            code: "BATCH_NOT_FOUND",
            message: "This bulk batch was not found.",
            spoken: "This bulk batch was not found.",
          });
        }

        const rawItems = await store.getBatchItems(batch.id);
        const { items: syncedItems, paypalRefs } =
          await syncBatchItemsWithMandates(store, accountId, batch, rawItems);

        const paidMinor = syncedItems
          .filter((i) => i.status === "PAID")
          .reduce((sum, i) => sum + (i.amount_minor ?? 0), 0);

        const activeItem = syncedItems.find(
          (i) => i.status === "ACTIVE" && i.mandate_id,
        );

        let widgets: BulkWidget[] = [];
        let spoken = `Batch status is ${batch.status}.`;

        if (batch.status === "PARSED") {
          const directoryRows = await store.getSandboxDirectory();
          const directoryMap = new Map<string, SandboxDirectoryRow>();
          for (const row of directoryRows) {
            directoryMap.set(
              `${row.account_number}:${row.bank_name.toLowerCase()}`,
              row,
            );
          }
          const built = buildParseAndResolveWidgets(
            batch.id,
            syncedItems,
            directoryMap,
            [],
          );
          widgets = built.widgets;
          spoken = built.spoken;
        } else if (
          (batch.status === "PLANNED" || batch.status === "CONFIRMED") &&
          batch.plan_hash
        ) {
          const { planHash, requestHash } = decodeStoredPlanHashes(
            batch.plan_hash,
          );
          const readyItems = syncedItems.filter((i) => i.status === "READY");
          if (planHash && requestHash && readyItems.length > 0) {
            const planWidget = buildPlanWidgetFromRows(
              batch,
              readyItems,
              planHash,
              requestHash,
              batch.status,
            );
            widgets = [planWidget];
            spoken = planWidget.spoken;
          }
        } else if (activeItem && activeItem.mandate_id) {
          widgets = [
            TransferApprovalWidgetSchema.parse({
              type: "transfer_approval",
              mandateId: activeItem.mandate_id,
            }),
          ];
          spoken = `Waiting for your approval on item ${activeItem.position + 1}.`;
        } else if (
          batch.status === "COMPLETED" ||
          batch.status === "CANCELLED" ||
          batch.status === "EXPIRED"
        ) {
          const summaryWidget = buildBatchSummaryWidgetFromRows(
            batch,
            syncedItems,
            paypalRefs,
          );
          widgets = [summaryWidget];
          spoken = summaryWidget.spoken;
        }

        return response.json({
          batchId: batch.id,
          status: batch.status,
          totalMinor: Number(batch.total_minor),
          runningTotalMinor: paidMinor,
          paidMinor,
          currency: batch.currency,
          expiresAt: batch.expires_at,
          activeItem: activeItem
            ? {
                itemId: activeItem.id,
                position: activeItem.position,
                mandateId: activeItem.mandate_id,
              }
            : null,
          items: syncedItems.map((item) => ({
            itemId: item.id,
            position: item.position,
            pastedName: item.pasted_name,
            resolvedName: item.resolved_name,
            bankName: item.bank_name,
            accountLast4: item.account_number.slice(-4),
            status: item.status,
            statusLabel: mapStatusToSummaryLabel(item.status),
            amountMinor: item.amount_minor,
            mandateId: item.mandate_id,
            paypalRef: item.mandate_id
              ? (paypalRefs.get(item.mandate_id) ?? null)
              : null,
          })),
          spoken,
          widgets,
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return response.status(400).json({
            code: "INVALID_BATCH_FETCH_REQUEST",
            message: "The batch identifier is invalid.",
            spoken: "The batch identifier is invalid.",
          });
        }
        return response.status(500).json({
          code: "BULK_BATCH_FETCH_FAILED",
          message: "The bulk batch could not be loaded.",
          spoken: "The bulk batch could not be loaded.",
        });
      }
    },
  );

  return router;
}
