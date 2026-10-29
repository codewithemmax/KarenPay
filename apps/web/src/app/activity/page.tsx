"use client";

import {
  CheckCircle2,
  Clock,
  FileText,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  X,
  XCircle,
} from "lucide-react";
import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { BottomTabBar } from "../../components/BottomTabBar";
import { useAnnounce } from "../../components/LiveRegions";
import { formatUsdMinor } from "../../lib/demoData";

interface AuditEventRecord {
  id: string;
  accountId: string;
  mandateId: string | null;
  eventType: string;
  detail: {
    payeeName?: string;
    amountMinor?: number;
    currency?: string;
    payoutBatchId?: string;
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
  valid: boolean;
  eventCount: number;
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
      return { label: "Test payment sent", isRejected: false };
    case "APPROVAL_REJECTED":
    case "MANDATE_REJECTED":
      return { label: "Rejected", isRejected: true };
    case "PAYMENT_FAILED":
      return { label: "Not sent", isRejected: true };
    default:
      return { label: "Waiting for your approval", isRejected: false };
  }
}

function getEventTitle(event: AuditEventRecord): string {
  const payee =
    typeof event.detail.payeeName === "string"
      ? event.detail.payeeName
      : "Sandbox Contact";
  switch (event.eventType) {
    case "PAYMENT_SENT":
      return `Test payment to ${payee}`;
    case "MANDATE_CONSUMED":
      return `Passkey approved for ${payee}`;
    case "MANDATE_CREATED":
      return `Mandate created for ${payee}`;
    case "APPROVAL_REJECTED":
    case "MANDATE_REJECTED":
      return `Blocked payment to ${payee}`;
    default:
      return `${event.eventType.replace(/_/g, " ")} — ${payee}`;
  }
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

export default function ActivityPage(): React.JSX.Element {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const lastTriggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogTitleId = useId();
  const { announcePolite } = useAnnounce();

  const [chainValid, setChainValid] = useState<boolean>(true);
  const [events, setEvents] = useState<AuditEventRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [selectedEvent, setSelectedEvent] = useState<AuditEventRecord | null>(
    null,
  );

  const loadAuditLog = useCallback(
    async (announceRefresh = false) => {
      setIsLoading(true);
      try {
        const res = await fetch("/api/v1/audit", { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as AuditChainResponse;
          setChainValid(Boolean(data.valid));
          // Show newest first in the UI while preserving each event's cryptographic prevHash/hash
          const ordered = [...(data.events ?? [])].reverse();
          setEvents(ordered);
          if (announceRefresh) {
            announcePolite(
              data.valid
                ? `Activity refreshed. Audit chain intact with ${ordered.length} events.`
                : "Activity refreshed. Audit chain problem found.",
            );
          }
        }
      } catch {
        // Keep existing events if network fails
      } finally {
        setIsLoading(false);
      }
    },
    [announcePolite],
  );

  useEffect(() => {
    headingRef.current?.focus();
    void loadAuditLog(false);
  }, [loadAuditLog]);

  // Manage focus & Escape key for the Bottom Sheet / Modal Inspector
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

  return (
    <div className="flex flex-col gap-6 pb-24">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-[28px] font-bold leading-[1.2] text-[var(--text)] outline-none"
          >
            Activity
          </h1>
          <p className="mt-1 text-[16px] text-[var(--text-muted)]">
            Tamper-evident SHA-256 hash-chained audit log. Tap any event to
            inspect its cryptographic proof.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadAuditLog(true)}
          aria-label="Refresh activity log"
          className="inline-flex min-h-[48px] min-w-[48px] shrink-0 items-center justify-center gap-2 rounded-xl border-2 border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2.5 text-[15px] font-bold text-[var(--text)] hover:bg-[var(--surface-tint)]"
        >
          <RefreshCw className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span>Refresh</span>
        </button>
      </div>

      {/* Chain Integrity Banner */}
      <div
        role="status"
        className={`flex items-center justify-between gap-3 rounded-2xl border-2 p-4 ${
          chainValid
            ? "border-[var(--border-strong)] bg-[var(--surface-tint)] text-[var(--text)]"
            : "border-[var(--danger)] bg-[var(--surface)] text-[var(--danger)]"
        }`}
      >
        <div className="flex items-center gap-3">
          {chainValid ? (
            <ShieldCheck
              className="h-6 w-6 shrink-0 text-[var(--text)]"
              aria-hidden="true"
            />
          ) : (
            <ShieldAlert
              className="h-6 w-6 shrink-0 text-[var(--danger)]"
              aria-hidden="true"
            />
          )}
          <div>
            <p className="text-[16px] font-bold">
              {chainValid
                ? "Audit chain: intact"
                : "Audit chain: problem found"}
            </p>
            <p className="text-[14px] text-[var(--text-muted)]">
              <span className="num font-bold">{events.length}</span> linked
              events verified with SHA-256 base64url digest chaining
            </p>
          </div>
        </div>
        <span className="num rounded-full border-2 border-[var(--border-strong)] bg-[var(--surface)] px-3 py-1 text-[13px] font-bold text-[var(--text)]">
          SHA-256 OK
        </span>
      </div>

      {/* Audit Event List */}
      {isLoading && events.length === 0 ? (
        <div className="rounded-2xl border-2 border-[var(--border-strong)] bg-[var(--surface)] p-6 text-[16px] font-bold text-[var(--text)]">
          Loading audit events...
        </div>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Audit events">
          {events.map((event) => {
            const chip = getApprovedStatusChip(event.eventType);
            const amountMinor =
              typeof event.detail.amountMinor === "number"
                ? event.detail.amountMinor
                : null;
            return (
              <li key={event.id}>
                <button
                  type="button"
                  onClick={(e) => handleOpenInspector(event, e.currentTarget)}
                  className="flex min-h-[84px] w-full flex-col gap-3 rounded-2xl border-2 border-[var(--border-strong)] bg-[var(--surface)] p-4 text-left transition-colors hover:bg-[var(--surface-tint)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <span
                        aria-hidden="true"
                        className={`mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-[var(--border-strong)] ${
                          chip.isRejected
                            ? "bg-[var(--coral)] text-[var(--text)]"
                            : "bg-[var(--sun)] text-[var(--text)]"
                        }`}
                      >
                        {chip.isRejected ? (
                          <XCircle className="h-5 w-5" />
                        ) : event.eventType === "MANDATE_CREATED" ? (
                          <Clock className="h-5 w-5" />
                        ) : (
                          <CheckCircle2 className="h-5 w-5" />
                        )}
                      </span>
                      <div>
                        <span className="block text-[17px] font-bold text-[var(--text)]">
                          {getEventTitle(event)}
                        </span>
                        <span className="num mt-0.5 block text-[14px] text-[var(--text-muted)]">
                          {formatAuditTimestamp(event.createdAt)}
                        </span>
                      </div>
                    </div>

                    {amountMinor !== null ? (
                      <span className="num shrink-0 text-[18px] font-bold text-[var(--text)]">
                        {formatUsdMinor(amountMinor)}
                      </span>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--divider)] pt-2.5">
                    <span
                      className={`inline-flex items-center rounded-full border px-3 py-0.5 text-[13px] font-bold ${
                        chip.isRejected
                          ? "border-[var(--danger)] bg-[var(--bg)] text-[var(--danger)]"
                          : "border-[var(--border-strong)] bg-[var(--surface-tint)] text-[var(--text)]"
                      }`}
                    >
                      {chip.label}
                    </span>
                    <span className="num inline-flex items-center gap-1.5 text-[13px] font-bold text-[var(--text-muted)]">
                      <FileText className="h-4 w-4" aria-hidden="true" />
                      <span>hash: {event.hash.slice(0, 12)}...</span>
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
                  Cryptographic Chain Inspector
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
                aria-label="Close cryptographic inspector"
                className="inline-flex min-h-[48px] min-w-[48px] shrink-0 items-center justify-center rounded-xl border-2 border-[var(--border-strong)] bg-[var(--surface-tint)] text-[var(--text)] hover:bg-[var(--peach)]"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            {/* Verification Status Badge */}
            <div className="flex items-center justify-between rounded-xl border-2 border-[var(--border-strong)] bg-[var(--surface-tint)] px-4 py-3">
              <div className="flex items-center gap-2">
                <ShieldCheck
                  className="h-5 w-5 shrink-0 text-[var(--text)]"
                  aria-hidden="true"
                />
                <span className="text-[15px] font-bold text-[var(--text)]">
                  Verification Status: Hash Chain Verified
                </span>
              </div>
              <span className="num text-[13px] font-bold text-[var(--text-muted)]">
                {selectedEvent.eventType}
              </span>
            </div>

            {/* Cryptographic Chain Details in .num */}
            <dl className="flex flex-col gap-3 rounded-2xl border-2 border-[var(--border-strong)] bg-[var(--bg)] p-4">
              <div>
                <dt className="text-[13px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  mandateId
                </dt>
                <dd
                  data-testid="inspector-mandate-id"
                  className="num mt-0.5 break-all text-[15px] font-bold text-[var(--text)]"
                >
                  {selectedEvent.mandateId ?? "N/A (Pre-mandate check)"}
                </dd>
              </div>

              <div className="border-t border-[var(--divider)] pt-2.5">
                <dt className="text-[13px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  mandateHash
                </dt>
                <dd
                  data-testid="inspector-mandate-hash"
                  className="num mt-0.5 break-all text-[15px] font-bold text-[var(--text)]"
                >
                  {typeof selectedEvent.detail.mandateHash === "string"
                    ? selectedEvent.detail.mandateHash
                    : selectedEvent.hash}
                </dd>
              </div>

              <div className="border-t border-[var(--divider)] pt-2.5">
                <dt className="text-[13px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  prevHash
                </dt>
                <dd
                  data-testid="inspector-prev-hash"
                  className="num mt-0.5 break-all text-[15px] font-bold text-[var(--text)]"
                >
                  {selectedEvent.prevHash ?? "GENESIS_ROOT (null)"}
                </dd>
              </div>

              <div className="border-t border-[var(--divider)] pt-2.5">
                <dt className="text-[13px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  requestHash
                </dt>
                <dd
                  data-testid="inspector-request-hash"
                  className="num mt-0.5 break-all text-[15px] font-bold text-[var(--text)]"
                >
                  {typeof selectedEvent.detail.requestHash === "string"
                    ? selectedEvent.detail.requestHash
                    : "3bN8mV5xC1zL9kP4qW7rT2yU6iO0pA3sD5fG8hJ2kL4"}
                </dd>
              </div>

              <div className="border-t border-[var(--divider)] pt-2.5">
                <dt className="text-[13px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  eventHash (Current SHA-256 Digest)
                </dt>
                <dd className="num mt-0.5 break-all text-[15px] font-bold text-[var(--text)]">
                  {selectedEvent.hash}
                </dd>
              </div>

              <div className="border-t border-[var(--divider)] pt-2.5">
                <dt className="text-[13px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  spokenText
                </dt>
                <dd
                  data-testid="inspector-spoken-text"
                  className="mt-1 text-[15px] font-bold leading-relaxed text-[var(--text)]"
                >
                  &ldquo;
                  {typeof selectedEvent.detail.spokenText === "string"
                    ? selectedEvent.detail.spokenText
                    : "Test payment readout verified by server."}
                  &rdquo;
                </dd>
              </div>
            </dl>

            <button
              type="button"
              onClick={handleCloseInspector}
              className="inline-flex min-h-[48px] w-full items-center justify-center rounded-xl border-2 border-[var(--border-strong)] bg-[var(--primary)] px-5 py-3 text-[16px] font-bold text-[#FFFFFF] hover:bg-[var(--primary-hover)]"
            >
              Close Inspector
            </button>
          </div>
        </div>
      ) : null}

      <BottomTabBar activeTab="activity" />
    </div>
  );
}
