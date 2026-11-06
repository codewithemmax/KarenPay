"use client";

import {
  CheckCircle2,
  Clock,
  Download,
  RefreshCw,
  ReceiptText,
  X,
  XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { BottomTabBar } from "../../components/BottomTabBar";
import { useAnnounce } from "../../components/LiveRegions";
import { formatUsdMinor } from "../../lib/demoData";

interface AuditEventRecord {
  id: string;
  accountId?: string;
  mandateId: string | null;
  eventType: string;
  detail: {
    payeeName?: string;
    recipientName?: string;
    resolvedName?: string;
    pastedName?: string;
    bankName?: string;
    accountLast4?: string;
    batchId?: string;
    itemId?: string;
    planHash?: string;
    decision?: string;
    amountMinor?: number;
    totalMinor?: number;
    paidMinor?: number;
    recipientCount?: number;
    itemCount?: number;
    currency?: string;
    payoutBatchId?: string;
    paypalRef?: string;
    code?: string;
    reason?: string;
    mandateHash?: string;
    requestHash?: string;
    spokenText?: string;
    [key: string]: unknown;
  };
  prevHash: string | null;
  hash: string;
  createdAt: string;
}

interface AuditChainResponse {
  chainValid?: boolean;
  valid?: boolean;
  spoken?: string;
  events: AuditEventRecord[];
}

function getApprovedStatusChip(eventType: string): {
  label:
    | "Test payment sent"
    | "Rejected"
    | "Not sent"
    | "Waiting for your approval";
  isRejected: boolean;
} {
  switch (eventType) {
    case "PAYMENT_SENT":
    case "MANDATE_CONSUMED":
    case "BULK_ITEM_PAID":
    case "BULK_BATCH_COMPLETED":
      return { label: "Test payment sent", isRejected: false };
    case "APPROVAL_REJECTED":
    case "MANDATE_REJECTED":
    case "BULK_PARSE_REJECTED":
    case "BULK_NAME_RESOLVE_REJECTED":
    case "BULK_PLAN_REJECTED":
    case "BULK_PLAN_CONFIRM_REJECTED":
    case "BULK_ITEM_ACTIVATION_REJECTED":
    case "BULK_NEXT_REJECTED":
    case "BULK_MANDATE_FETCH_REJECTED":
    case "BULK_ITEM_CANCEL_REJECTED":
    case "BULK_CANCEL_REMAINING_REJECTED":
      return { label: "Rejected", isRejected: true };
    case "PAYMENT_FAILED":
    case "BULK_ITEM_FAILED":
    case "BULK_ITEM_CANCELLED":
    case "BULK_ITEM_EXPIRED":
      return { label: "Not sent", isRejected: true };
    default:
      return { label: "Waiting for your approval", isRejected: false };
  }
}

function formatBulkAccountSuffix(detail: AuditEventRecord["detail"]): string {
  if (!detail) return "";
  const bank = typeof detail.bankName === "string" ? detail.bankName : "";
  const last4 =
    typeof detail.accountLast4 === "string" ? detail.accountLast4 : "";
  if (bank && last4) {
    return ` at ${bank} (account ending in last 4 digits ${last4})`;
  }
  if (bank) {
    return ` at ${bank}`;
  }
  if (last4) {
    return ` (account ending in last 4 digits ${last4})`;
  }
  return "";
}

function getEventTitle(event: AuditEventRecord): string {
  const payee =
    event.detail && typeof event.detail.payeeName === "string"
      ? event.detail.payeeName
      : null;
  const bulkRecipient =
    event.detail && typeof event.detail.recipientName === "string"
      ? event.detail.recipientName
      : event.detail && typeof event.detail.resolvedName === "string"
        ? event.detail.resolvedName
        : event.detail && typeof event.detail.pastedName === "string"
          ? event.detail.pastedName
          : null;
  const suffix = formatBulkAccountSuffix(event.detail);

  switch (event.eventType) {
    case "PAYMENT_SENT":
      return payee ? `Test payment to ${payee}` : "Test payment sent";
    case "MANDATE_CONSUMED":
      return payee ? `Passkey approved for ${payee}` : "Passkey approved";
    case "MANDATE_CREATED":
      return payee ? `Mandate created for ${payee}` : "Mandate created";
    case "APPROVAL_REJECTED":
    case "MANDATE_REJECTED":
      return payee ? `Blocked payment to ${payee}` : "Blocked payment request";
    case "BULK_BATCH_PARSED": {
      const count =
        typeof event.detail?.recipientCount === "number"
          ? event.detail.recipientCount
          : 0;
      return `Bulk batch parsed (${count} ${count === 1 ? "recipient" : "recipients"})`;
    }
    case "BULK_PARSE_REJECTED":
      return "Bulk recipient paste rejected";
    case "BULK_NAME_RESOLVED":
      return bulkRecipient
        ? `Bulk name decision for ${bulkRecipient}${suffix}`
        : `Bulk name decision${suffix}`;
    case "BULK_NAME_RESOLVE_REJECTED":
      return "Bulk name decision rejected";
    case "BULK_PLAN_CREATED": {
      const count =
        typeof event.detail?.itemCount === "number"
          ? event.detail.itemCount
          : 0;
      return `Bulk payment plan created (${count} ${count === 1 ? "item" : "items"})`;
    }
    case "BULK_PLAN_CONFIRMED":
      return "Bulk payment plan confirmed";
    case "BULK_PLAN_REJECTED":
    case "BULK_PLAN_CONFIRM_REJECTED":
      return "Bulk payment plan rejected";
    case "BULK_ITEM_ACTIVATED":
      return bulkRecipient
        ? `Bulk transfer activated for ${bulkRecipient}${suffix}`
        : `Bulk transfer activated${suffix}`;
    case "BULK_ITEM_PAID":
      return bulkRecipient
        ? `Bulk test payment sent to ${bulkRecipient}${suffix}`
        : "Bulk test payment sent";
    case "BULK_ITEM_FAILED":
      return bulkRecipient
        ? `Bulk transfer not sent to ${bulkRecipient}${suffix}`
        : "Bulk transfer not sent";
    case "BULK_ITEM_CANCELLED":
      return bulkRecipient
        ? `Cancelled bulk transfer to ${bulkRecipient}${suffix}`
        : `Cancelled bulk transfer${suffix}`;
    case "BULK_ITEM_EXPIRED":
      return "Bulk transfer approval expired";
    case "BULK_BATCH_COMPLETED":
      return "Bulk payment batch completed";
    default:
      return event.eventType.replace(/_/g, " ");
  }
}

function getRecipientName(event: AuditEventRecord): string {
  const detail = event.detail;
  return (
    (typeof detail.payeeName === "string" && detail.payeeName) ||
    (typeof detail.recipientName === "string" && detail.recipientName) ||
    (typeof detail.resolvedName === "string" && detail.resolvedName) ||
    (typeof detail.pastedName === "string" && detail.pastedName) ||
    "KarenPay recipient"
  );
}

function getAccountLabel(event: AuditEventRecord): string | null {
  const detail = event.detail;
  if (typeof detail.accountNumber === "string") {
    return `Account: ${detail.accountNumber}`;
  }
  if (typeof detail.accountLast4 === "string") {
    return `Account ending in ${detail.accountLast4}`;
  }
  return null;
}

function formatAuditTimestamp(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return iso;
  }
}

function isConfirmedTransfer(event: AuditEventRecord): boolean {
  return event.eventType === "PAYMENT_SENT" || event.eventType === "BULK_ITEM_PAID";
}

function getEventAmountMinor(event: AuditEventRecord): number | null {
  if (typeof event.detail.amountMinor === "number") {
    return event.detail.amountMinor;
  }
  if (typeof event.detail.totalMinor === "number") {
    return event.detail.totalMinor;
  }
  return null;
}

function buildReceiptText(event: AuditEventRecord): string {
  const amountMinor = getEventAmountMinor(event);
  const currency =
    typeof event.detail.currency === "string" ? event.detail.currency : "USD";
  const recipient = getRecipientName(event);
  const account =
    typeof event.detail.accountLast4 === "string"
      ? `Account ending in ${event.detail.accountLast4}`
      : "Saved PayPal sandbox recipient";
  const reference =
    typeof event.detail.paypalRef === "string"
      ? event.detail.paypalRef
      : typeof event.detail.payoutBatchId === "string"
        ? event.detail.payoutBatchId
        : "Not available";

  return [
    "KARENPAY PAYMENT RECEIPT",
    "========================",
    `Status: CONFIRMED`,
    `Recipient: ${recipient}`,
    `Amount: ${amountMinor === null ? "Not available" : formatUsdMinor(amountMinor)} ${currency}`,
    `Account: ${account}`,
    `Date: ${formatAuditTimestamp(event.createdAt)}`,
    `PayPal reference: ${reference}`,
    `KarenPay event: ${event.eventType}`,
    `Receipt ID: ${event.id}`,
    "",
    "This receipt confirms a KarenPay sandbox transfer record.",
  ].join("\n");
}

export default function ActivityPage(): React.JSX.Element {
  const router = useRouter();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const lastTriggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogTitleId = useId();
  const { announcePolite } = useAnnounce();

  const [events, setEvents] = useState<AuditEventRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<AuditEventRecord | null>(
    null,
  );

  const loadAuditLog = useCallback(
    async (announceRefresh = false) => {
      setIsLoading(true);
      setLoadError(null);
      try {
        const res = await fetch("/api/v1/audit", {
          credentials: "include",
          cache: "no-store",
        });
        if (res.status === 401) {
          router.replace("/");
          return;
        }
        if (res.ok) {
          const data = (await res.json()) as AuditChainResponse;
          const ordered = [...(data.events ?? [])].reverse();
          setEvents(ordered);
          if (announceRefresh) {
            announcePolite(`Activity refreshed. ${ordered.length} transfer events loaded.`);
          }
        } else {
          setLoadError("Unable to load your audit log.");
        }
      } catch {
        setLoadError(
          "Unable to connect to the KarenPay API server. Make sure the backend service is running.",
        );
      } finally {
        setIsLoading(false);
      }
    },
    [announcePolite, router],
  );

  useEffect(() => {
    headingRef.current?.focus();
    void loadAuditLog(false);
  }, [loadAuditLog]);

  useEffect(() => {
    if (!selectedEvent) return;
    const focusTimer = window.setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 20);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setSelectedEvent(null);
        lastTriggerRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedEvent]);

  const handleOpenInspector = (
    event: AuditEventRecord,
    buttonEl: HTMLButtonElement,
  ) => {
    lastTriggerRef.current = buttonEl;
    setSelectedEvent(event);
  };

  const handleCloseInspector = () => {
    setSelectedEvent(null);
    lastTriggerRef.current?.focus();
  };

  const handleDownloadReceipt = () => {
    if (!selectedEvent || !isConfirmedTransfer(selectedEvent)) return;
    const blob = new Blob([buildReceiptText(selectedEvent)], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `karenpay-receipt-${selectedEvent.id}.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    announcePolite("Payment receipt downloaded.");
  };

  return (
    <div className="flex flex-col gap-6 pb-24 pt-7">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-[28px] font-bold leading-[1.2] text-[var(--text)] outline-none"
          >
            Activity
          </h1>
        </div>

        <button
          type="button"
          onClick={() => void loadAuditLog(true)}
          aria-label="Refresh activity log"
          className="inline-flex min-h-[48px] min-w-[110px] shrink-0 items-center justify-center gap-2 rounded-full bg-[var(--surface-tint)] px-4 py-2.5 text-[16px] font-bold text-[var(--text)] hover:bg-[var(--peach)]"
        >
          <RefreshCw className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span>Refresh</span>
        </button>
      </div>

      {loadError ? (
        <div className="rounded-2xl border-2 border-[var(--border-strong)] bg-[var(--warning-bg)] p-5 text-[16px] font-bold text-[var(--warning-text)]">
          {loadError}
        </div>
      ) : null}

      {/* Audit Event List */}
      {isLoading ? (
        <div className="rounded-2xl border-2 border-[var(--border-strong)] bg-[var(--surface)] p-6 text-[16px] font-bold text-[var(--text)]">
          Loading audit events...
        </div>
      ) : events.length === 0 ? (
        <div className="rounded-2xl border-2 border-[var(--border-strong)] bg-[var(--surface)] p-6 text-[16px] text-[var(--text-muted)]">
          No transfers recorded yet. Your completed and pending transfers will
          appear here.
        </div>
      ) : (
        <ul className="flex flex-col gap-4" aria-label="Audit events">
          {events.map((event) => {
            const chip = getApprovedStatusChip(event.eventType);
            const amountMinor =
              event.detail && typeof event.detail.amountMinor === "number"
                ? event.detail.amountMinor
                : event.detail && typeof event.detail.totalMinor === "number"
                  ? event.detail.totalMinor
                  : null;
            return (
              <li key={event.id}>
                <button
                  type="button"
                  onClick={(e) => handleOpenInspector(event, e.currentTarget)}
                  className="flex min-h-[154px] w-full flex-col gap-4 rounded-input border border-[var(--divider)] bg-[var(--surface)] p-5 text-left transition-colors hover:bg-[var(--surface-tint)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <span
                        aria-hidden="true"
                        className={`mt-0.5 flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${
                          chip.isRejected
                            ? "bg-[var(--coral)] text-[var(--text)]"
                            : "bg-[var(--sun)] text-[var(--text)]"
                        }`}
                      >
                        {chip.isRejected ? (
                          <XCircle className="h-5 w-5" />
                        ) : event.eventType === "MANDATE_CREATED" ||
                          event.eventType === "BULK_ITEM_ACTIVATED" ||
                          event.eventType === "BULK_PLAN_CREATED" ? (
                          <Clock className="h-5 w-5" />
                        ) : (
                          <CheckCircle2 className="h-5 w-5" />
                        )}
                      </span>
                      <div>
                        <span className="block text-[17px] font-bold text-[var(--text)]">
                          {getRecipientName(event)}
                        </span>
                        {getAccountLabel(event) ? (
                          <span className="num mt-0.5 block text-[14px] font-bold text-[var(--text-muted)]">
                            {getAccountLabel(event)}
                          </span>
                        ) : null}
                        <span className="mt-0.5 block text-[14px] font-bold text-[var(--text-muted)]">
                          {formatAuditTimestamp(event.createdAt)}
                        </span>
                      </div>
                    </div>

                    {amountMinor !== null ? (
                      <span className="num shrink-0 text-[20px] font-bold text-[var(--text)]">
                        {formatUsdMinor(amountMinor)}
                      </span>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded-full border px-3 py-0.5 text-[13px] font-bold ${
                        chip.isRejected
                          ? "border-[var(--danger)] bg-[var(--surface)] text-[var(--danger)]"
                          : "border-transparent bg-[var(--surface-tint)] text-[var(--text)]"
                      }`}
                    >
                      {chip.label}
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* Slide-Up Bottom Sheet / Modal Inspector */}
      {selectedEvent ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-[#1F0D09]/70 p-0 sm:items-center sm:p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              handleCloseInspector();
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
            className="flex max-h-[90vh] w-full max-w-[560px] flex-col gap-4 overflow-y-auto rounded-t-3xl border-t-2 border-[var(--border-strong)] bg-[var(--surface)] p-6 text-[var(--text)] sm:rounded-3xl sm:border-2"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="text-[13px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  Transfer receipt
                </span>
                <h2
                  id={dialogTitleId}
                  className="mt-0.5 text-[22px] font-bold text-[var(--text)]"
                >
                  {getEventTitle(selectedEvent)}
                </h2>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={handleCloseInspector}
                aria-label="Close transfer receipt"
                className="inline-flex min-h-[48px] min-w-[48px] shrink-0 items-center justify-center rounded-xl border-2 border-[var(--border-strong)] bg-[var(--surface-tint)] text-[var(--text)] hover:bg-[var(--peach)]"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <div className="flex items-center justify-between rounded-xl border-2 border-[var(--border-strong)] bg-[var(--surface-tint)] px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-[15px] font-bold text-[var(--text)]">
                  {getApprovedStatusChip(selectedEvent.eventType).label}
                </span>
            </div>
            </div>

            <dl className="flex flex-col gap-3 rounded-2xl border-2 border-[var(--border-strong)] bg-[var(--bg)] p-4">
              <div>
                <dt className="text-[13px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  Transfer amount
                </dt>
                <dd className="num mt-0.5 text-[24px] font-bold text-[var(--text)]">
                  {typeof selectedEvent.detail.amountMinor === "number"
                    ? formatUsdMinor(selectedEvent.detail.amountMinor)
                    : typeof selectedEvent.detail.totalMinor === "number"
                      ? formatUsdMinor(selectedEvent.detail.totalMinor)
                      : "Not provided"}
                </dd>
                {isConfirmedTransfer(selectedEvent) ? (
                  <button
                    type="button"
                    onClick={handleDownloadReceipt}
                    className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl border-2 border-[var(--border-strong)] bg-[var(--primary)] px-4 py-3 text-[16px] font-bold text-white hover:bg-[var(--primary-hover)]"
                  >
                    <Download className="h-5 w-5" aria-hidden="true" />
                    <ReceiptText className="h-5 w-5" aria-hidden="true" />
                    Download receipt
                  </button>
                ) : null}
              </div>
              <div className="border-t border-[var(--divider)] pt-2.5">
                <dt className="text-[13px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  Recipient
                </dt>
                <dd className="mt-0.5 text-[17px] font-bold text-[var(--text)]">
                  {getEventTitle(selectedEvent)}
                </dd>
              </div>
              {selectedEvent.detail &&
              (typeof selectedEvent.detail.accountLast4 === "string" ||
                typeof selectedEvent.detail.bankName === "string") ? (
                <div className="border-t border-[var(--divider)] pt-2.5">
                  <dt className="text-[13px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                    Account
                  </dt>
                  <dd className="num mt-0.5 text-[15px] font-bold text-[var(--text)]">
                    {typeof selectedEvent.detail.accountLast4 === "string"
                      ? `Ending in ${selectedEvent.detail.accountLast4}`
                      : "Saved contact"}
                    {typeof selectedEvent.detail.bankName === "string"
                      ? ` · ${selectedEvent.detail.bankName}`
                      : ""}
                  </dd>
                </div>
              ) : null}
              <div className="border-t border-[var(--divider)] pt-2.5">
                <dt className="text-[13px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  Date &amp; time
                </dt>
                <dd className="num mt-0.5 text-[15px] font-bold text-[var(--text)]">
                  {formatAuditTimestamp(selectedEvent.createdAt)}
                </dd>
              </div>

              {selectedEvent.detail &&
              typeof selectedEvent.detail.spokenText === "string" ? (
                <div className="border-t border-[var(--divider)] pt-2.5">
                  <dt className="text-[13px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                    Spoken readout
                  </dt>
                  <dd
                    data-testid="inspector-spoken-text"
                    className="mt-1 text-[15px] font-bold leading-relaxed text-[var(--text)]"
                  >
                    &ldquo;{selectedEvent.detail.spokenText}&rdquo;
                  </dd>
                </div>
              ) : null}
            </dl>

            <button
              type="button"
              onClick={handleCloseInspector}
              className="inline-flex min-h-[48px] w-full items-center justify-center rounded-xl border-2 border-[var(--border-strong)] bg-[var(--primary)] px-5 py-3 text-[16px] font-bold text-[#FFFFFF] hover:bg-[var(--primary-hover)]"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}

      <BottomTabBar activeTab="activity" />
    </div>
  );
}
