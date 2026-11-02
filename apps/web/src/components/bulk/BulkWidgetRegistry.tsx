"use client";

import { startAuthentication } from "@simplewebauthn/browser";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Fingerprint,
  Lock,
  RotateCcw,
  ShieldAlert,
  Square,
  Volume2,
  XCircle,
} from "lucide-react";
import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  BulkWidgetSchema,
  type BatchSummaryWidget,
  type BulkWidget,
  type NameCheckWidget,
  type PlanWidget,
  type RecipientListWidget,
  type TransferApprovalWidget,
} from "../../../../../packages/bulk/src/index.js";
import {
  buildMandate,
  hashMandate,
  type Mandate,
} from "../../../../../packages/core/src/index.js";
import { formatUsdMinor } from "../../lib/demoData";
import { useAnnounce } from "../LiveRegions";

function truncateHash(hash: string): string {
  if (!hash || hash.length <= 16) return hash;
  return `${hash.slice(0, 8)}...${hash.slice(-6)}`;
}

function formatGroupedTenDigitAccount(accountNumber: string): string {
  const digits = accountNumber.replace(/\D/g, "");
  if (digits.length === 10) {
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 10)}`;
  }
  return accountNumber;
}

function splitComposedPayeeName(payeeName: string): {
  recipientName: string;
  bankName: string | null;
} {
  const lastAt = payeeName.lastIndexOf(" at ");
  if (lastAt <= 0) {
    return { recipientName: payeeName, bankName: null };
  }
  return {
    recipientName: payeeName.slice(0, lastAt),
    bankName: payeeName.slice(lastAt + 4),
  };
}

export interface BulkWidgetRegistryCallbacks {
  activeBatchId: string | null;
  activeItemId: string | null;
  isBusy: boolean;
  onResolveName: (
    itemId: string,
    decision: "USE_DIRECTORY_NAME" | "SKIP",
  ) => Promise<void>;
  onConfirmPlan: (
    batchId: string,
    planHash: string,
    requestHash: string,
  ) => Promise<void>;
  onCancelItem: (batchId: string, itemId: string) => Promise<void>;
  onTransferApproved: (
    batchId: string,
    mandateId: string,
    paypalRef: string | null,
    spoken: string,
  ) => Promise<void>;
  onTransferFailed: (
    batchId: string,
    mandateId: string,
    spoken: string,
  ) => Promise<void>;
}

interface FetchedBulkMandatePayload {
  mandate: Mandate;
  mandateHash: string;
  approvalOptions: {
    challenge: string;
    rpId?: string;
    timeout?: number;
    userVerification?: "required" | "preferred" | "discouraged";
    allowCredentials?: { id: string; type: "public-key" }[];
  };
  spoken: string;
  readoutRequired: boolean;
  state: string;
}

function RecipientListWidgetCard({
  widget,
}: {
  widget: RecipientListWidget;
}): React.JSX.Element {
  return (
    <section
      aria-label="Parsed recipients"
      data-testid="widget-recipient-list"
      className="rounded-2xl border-2 border-[var(--border-strong)] bg-[var(--surface)] p-5 shadow-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[18px] font-bold text-[var(--text)]">
          Parsed recipients ({widget.recipients.length})
        </h3>
        <span className="rounded-full border border-[var(--border-strong)] bg-[var(--surface-tint)] px-3 py-0.5 text-[13px] font-bold text-[var(--text)]">
          Simulated directory
        </span>
      </div>

      <ul className="mt-4 flex flex-col divide-y divide-[var(--divider)]">
        {widget.recipients.map((r) => {
          const isMatch =
            r.statusLabel === "Name matches" || r.status === "READY";
          const isDiff = r.statusLabel === "Name differs";
          return (
            <li
              key={r.itemId}
              className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <p className="text-[16px] font-bold text-[var(--text)]">
                  {r.resolvedName ?? r.pastedName}
                </p>
                <p className="num text-[14px] text-[var(--text-muted)]">
                  {r.bankName} · account ending in last 4 digits{" "}
                  <span className="font-bold text-[var(--text)]">
                    {r.accountLast4}
                  </span>
                </p>
              </div>

              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-bold ${
                  isMatch
                    ? "border-[var(--border-strong)] bg-[var(--sun)] text-[var(--text)]"
                    : isDiff
                      ? "border-[var(--border-strong)] bg-[var(--warning-bg)] text-[var(--warning-text)]"
                      : "border-[var(--danger)] bg-[var(--bg)] text-[var(--danger)]"
                }`}
              >
                {isMatch ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                ) : isDiff ? (
                  <AlertTriangle
                    className="h-4 w-4 shrink-0"
                    aria-hidden="true"
                  />
                ) : (
                  <XCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                )}
                <span>{r.statusLabel}</span>
              </span>
            </li>
          );
        })}
      </ul>

      {widget.unreadable.length > 0 ? (
        <div className="mt-4 rounded-xl border border-[var(--danger)] bg-[var(--warning-bg)] p-3 text-[14px] text-[var(--warning-text)]">
          <p className="font-bold">Unreadable entries Rejected:</p>
          <ul className="mt-1 list-disc pl-5">
            {widget.unreadable.map((u, idx) => (
              <li key={`${u.rawText}-${idx}`}>
                <span className="font-bold">{u.rawText}</span>: {u.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function NameCheckWidgetCard({
  widget,
  isBusy,
  onResolveName,
}: {
  widget: NameCheckWidget;
  isBusy: boolean;
  onResolveName: BulkWidgetRegistryCallbacks["onResolveName"];
}): React.JSX.Element {
  const [resolvedChoice, setResolvedChoice] = useState<
    "USE_DIRECTORY_NAME" | "SKIP" | null
  >(null);

  const handleChoose = async (decision: "USE_DIRECTORY_NAME" | "SKIP") => {
    setResolvedChoice(decision);
    await onResolveName(widget.itemId, decision);
  };

  return (
    <section
      aria-label={`Name check for ${widget.bankName} account ending in ${widget.accountLast4}`}
      data-testid={`widget-name-check-${widget.itemId}`}
      className="rounded-2xl border-2 border-[var(--border-strong)] bg-[var(--warning-bg)] p-5 text-[var(--warning-text)] shadow-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-[16px] font-bold text-[var(--text)]">
          <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span>{widget.statusLabel}</span>
        </span>
        <span className="rounded-full border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-0.5 text-[13px] font-bold text-[var(--text)]">
          Simulated directory check
        </span>
      </div>

      <p className="num mt-2 text-[14px] font-medium text-[var(--text)]">
        {widget.bankName} · account ending in last 4 digits{" "}
        <span className="font-bold">{widget.accountLast4}</span>
      </p>

      <div className="mt-3 grid grid-cols-1 gap-2 rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] p-3 text-[15px] text-[var(--text)] sm:grid-cols-2">
        <div>
          <span className="block text-[12px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
            You pasted
          </span>
          <span className="font-bold">{widget.pastedName}</span>
        </div>
        <div>
          <span className="block text-[12px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
            Simulated directory name
          </span>
          <span className="font-bold">{widget.directoryName}</span>
        </div>
      </div>

      {resolvedChoice ? (
        <p className="mt-3 text-[14px] font-bold text-[var(--text)]">
          {resolvedChoice === "USE_DIRECTORY_NAME"
            ? `Using simulated directory name: ${widget.directoryName}`
            : `Skipped ${widget.pastedName}`}
        </p>
      ) : (
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={isBusy}
            data-testid={`name-check-use-dir-${widget.itemId}`}
            onClick={() => void handleChoose("USE_DIRECTORY_NAME")}
            className="inline-flex min-h-[48px] flex-1 items-center justify-center rounded-xl border-2 border-[var(--border-strong)] bg-[var(--primary)] px-4 py-2.5 text-[15px] font-bold text-[#FFFFFF] transition-colors hover:bg-[var(--primary-hover)] disabled:opacity-50"
          >
            Use directory name ({widget.directoryName})
          </button>
          <button
            type="button"
            disabled={isBusy}
            data-testid={`name-check-skip-${widget.itemId}`}
            onClick={() => void handleChoose("SKIP")}
            className="inline-flex min-h-[48px] items-center justify-center rounded-xl border-2 border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2.5 text-[15px] font-bold text-[var(--text)] transition-colors hover:bg-[var(--surface-tint)] disabled:opacity-50"
          >
            Skip this recipient
          </button>
        </div>
      )}
    </section>
  );
}

function PlanWidgetCard({
  widget,
  isBusy,
  onConfirmPlan,
  onCancelItem,
}: {
  widget: PlanWidget;
  isBusy: boolean;
  onConfirmPlan: BulkWidgetRegistryCallbacks["onConfirmPlan"];
  onCancelItem: BulkWidgetRegistryCallbacks["onCancelItem"];
}): React.JSX.Element {
  return (
    <section
      aria-label="Bulk payment plan"
      data-testid="widget-plan"
      className="rounded-2xl border-2 border-[var(--border-strong)] bg-[var(--surface)] p-5 shadow-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[19px] font-bold text-[var(--text)]">
            {widget.status === "CONFIRMED"
              ? "Confirmed payment plan"
              : "Payment plan ready"}
          </h3>
          <p className="num mt-0.5 text-[13px] font-bold text-[var(--text-muted)]">
            planHash: {truncateHash(widget.planHash)} · 10-minute plan window
          </p>
        </div>
        <div className="text-right">
          <span className="block text-[12px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
            Batch total
          </span>
          <span
            data-testid="plan-total-amount"
            className="num text-[24px] font-bold text-[var(--text)]"
          >
            {formatUsdMinor(widget.totalMinor)}
          </span>
        </div>
      </div>

      <ul className="mt-4 flex flex-col divide-y divide-[var(--divider)]">
        {widget.items.map((item) => (
          <li
            key={item.itemId}
            className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
          >
            <div className="min-w-0">
              <p className="text-[16px] font-bold text-[var(--text)]">
                {item.position + 1}. {item.recipientName}
              </p>
              <p className="num text-[14px] text-[var(--text-muted)]">
                {item.bankName} · account ending in last 4 digits{" "}
                <span className="font-bold text-[var(--text)]">
                  {item.accountLast4}
                </span>
              </p>
            </div>

            <div className="flex items-center gap-3">
              <span className="num text-[18px] font-bold text-[var(--text)]">
                {formatUsdMinor(item.amountMinor)}
              </span>
              <button
                type="button"
                disabled={isBusy}
                data-testid={`plan-cancel-item-${item.itemId}`}
                onClick={() => void onCancelItem(widget.batchId, item.itemId)}
                aria-label={`Cancel transfer to ${item.recipientName}`}
                className="inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-xl border border-[var(--border-strong)] bg-[var(--bg)] px-3 py-2 text-[13px] font-bold text-[var(--danger)] transition-colors hover:bg-[var(--surface-tint)] disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </li>
        ))}
      </ul>

      {widget.status === "PLANNED" ? (
        <div className="mt-5">
          <button
            type="button"
            disabled={isBusy}
            data-testid="confirm-plan-button"
            onClick={() =>
              void onConfirmPlan(
                widget.batchId,
                widget.planHash,
                widget.requestHash,
              )
            }
            className="inline-flex min-h-[64px] w-full items-center justify-center gap-2 rounded-2xl border-2 border-[var(--border-strong)] bg-[var(--primary)] px-6 py-4 text-[17px] font-bold text-[#FFFFFF] transition-colors hover:bg-[var(--primary-hover)] disabled:opacity-50"
          >
            <Fingerprint className="h-6 w-6 shrink-0" aria-hidden="true" />
            <span>Confirm plan &amp; start passkey approvals</span>
          </button>
        </div>
      ) : null}
    </section>
  );
}

function TransferApprovalWidgetCard({
  widget,
  activeBatchId,
  activeItemId,
  isBusy,
  onCancelItem,
  onTransferApproved,
  onTransferFailed,
}: {
  widget: TransferApprovalWidget;
  activeBatchId: string | null;
  activeItemId: string | null;
  isBusy: boolean;
  onCancelItem: BulkWidgetRegistryCallbacks["onCancelItem"];
  onTransferApproved: BulkWidgetRegistryCallbacks["onTransferApproved"];
  onTransferFailed: BulkWidgetRegistryCallbacks["onTransferFailed"];
}): React.JSX.Element {
  const tamperSwitchId = useId();
  const { announcePolite, announceAssertive } = useAnnounce();

  const [fetched, setFetched] = useState<FetchedBulkMandatePayload | null>(
    null,
  );
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isLoadingMandate, setIsLoadingMandate] = useState<boolean>(true);

  // Hard Readout Lock state (Rule 5)
  const [isSpeakingReadout, setIsSpeakingReadout] = useState<boolean>(false);
  const [readoutCompletedCleanly, setReadoutCompletedCleanly] =
    useState<boolean>(false);
  const [readoutInterrupted, setReadoutInterrupted] = useState<boolean>(false);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(120);

  // Judge Demo Tamper Switch (tampers displayed amount so client hashMandate recomputation fails)
  const [tamperDisplayedFields, setTamperDisplayedFields] =
    useState<boolean>(false);

  const [isApproving, setIsApproving] = useState<boolean>(false);
  const [finalOutcome, setFinalOutcome] = useState<
    "PAID" | "FAILED" | "CANCELLED" | null
  >(null);
  const [outcomeRef, setOutcomeRef] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const speechWatchdogRef = useRef<number | null>(null);
  const speechCancelledByUserRef = useRef<boolean>(false);

  const clearSpeechTimers = useCallback(() => {
    if (speechWatchdogRef.current !== null) {
      window.clearTimeout(speechWatchdogRef.current);
      speechWatchdogRef.current = null;
    }
  }, []);

  const stopReadout = useCallback(
    (markInterrupted: boolean) => {
      clearSpeechTimers();
      if (markInterrupted) {
        speechCancelledByUserRef.current = true;
        setReadoutInterrupted(true);
        setReadoutCompletedCleanly(false);
      }
      setIsSpeakingReadout(false);
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          // ignore
        }
      }
    },
    [clearSpeechTimers],
  );

  const startMandatoryReadout = useCallback(
    (spokenText: string) => {
      clearSpeechTimers();
      speechCancelledByUserRef.current = false;
      setReadoutCompletedCleanly(false);
      setReadoutInterrupted(false);
      setIsSpeakingReadout(true);
      announcePolite(spokenText);

      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        setIsSpeakingReadout(false);
        setReadoutCompletedCleanly(true);
        return;
      }

      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }

      const utterance = new SpeechSynthesisUtterance(spokenText);
      utterance.lang = "en-US";
      utterance.rate = 1.0;

      let settled = false;
      const finishCleanly = () => {
        if (settled) return;
        settled = true;
        clearSpeechTimers();
        if (speechCancelledByUserRef.current) {
          setIsSpeakingReadout(false);
          setReadoutCompletedCleanly(false);
          return;
        }
        setIsSpeakingReadout(false);
        setReadoutInterrupted(false);
        setReadoutCompletedCleanly(true);
      };

      utterance.onend = () => {
        finishCleanly();
      };

      utterance.onerror = () => {
        if (settled) return;
        settled = true;
        clearSpeechTimers();
        setIsSpeakingReadout(false);
        if (speechCancelledByUserRef.current) {
          setReadoutCompletedCleanly(false);
          setReadoutInterrupted(true);
        }
      };

      try {
        window.speechSynthesis.speak(utterance);
      } catch {
        setIsSpeakingReadout(false);
      }

      speechWatchdogRef.current = window.setTimeout(() => {
        if (!speechCancelledByUserRef.current) {
          finishCleanly();
        }
      }, 15000);
    },
    [announcePolite, clearSpeechTimers],
  );

  useEffect(() => {
    return () => {
      clearSpeechTimers();
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          // ignore
        }
      }
    };
  }, [clearSpeechTimers]);

  useEffect(() => {
    if (!activeBatchId || !activeItemId || finalOutcome) return;
    let cancelled = false;
    setIsLoadingMandate(true);
    setFetchError(null);

    void (async () => {
      try {
        console.log(
          `[Bulk Transfer UI] Fetching mandate for batch ${activeBatchId}, item ${activeItemId}...`,
        );
        const res = await fetch(
          `/api/v1/bulk/${activeBatchId}/items/${activeItemId}/mandate`,
          {
            method: "GET",
            credentials: "include",
            cache: "no-store",
          },
        );
        const data = (await res.json()) as FetchedBulkMandatePayload & {
          message?: string;
          spoken?: string;
        };
        if (cancelled) return;
        if (!res.ok || !data.mandate) {
          console.error(
            `[Bulk Transfer UI] Mandate fetch failed (${res.status}):`,
            data,
          );
          setFetchError(
            data.spoken ??
              data.message ??
              "This transfer mandate could not be loaded.",
          );
          setIsLoadingMandate(false);
          return;
        }
        console.log(
          `[Bulk Transfer UI] Mandate fetched for item ${activeItemId}:`,
          {
            mandateId: data.mandate.id,
            hash: data.mandateHash,
            amountMinor: data.mandate.amountMinor,
            payee: data.mandate.payeeName,
          },
        );
        setFetched(data);
        setIsLoadingMandate(false);
        startMandatoryReadout(data.spoken);
      } catch (err) {
        if (!cancelled) {
          console.error(
            `[Bulk Transfer UI] Network error while fetching mandate:`,
            err,
          );
          setFetchError("Unable to load transfer mandate details.");
          setIsLoadingMandate(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeBatchId, activeItemId, finalOutcome, startMandatoryReadout]);

  useEffect(() => {
    if (!fetched?.mandate?.expiresAt || finalOutcome) return;
    const expiresMs = new Date(fetched.mandate.expiresAt).getTime();
    const tick = () => {
      const diff = Math.max(0, Math.ceil((expiresMs - Date.now()) / 1000));
      setSecondsRemaining(diff);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [fetched, finalOutcome]);

  if (isLoadingMandate) {
    return (
      <section
        aria-label="Loading transfer approval"
        data-testid={`widget-transfer-approval-${widget.mandateId}`}
        className="rounded-2xl border-2 border-[var(--border-strong)] bg-[var(--surface)] p-5 text-[16px] font-bold text-[var(--text)] shadow-card"
      >
        Loading transfer mandate {truncateHash(widget.mandateId)}…
      </section>
    );
  }

  if (fetchError || !fetched) {
    return (
      <section
        aria-label="Transfer approval unavailable"
        data-testid={`widget-transfer-approval-${widget.mandateId}`}
        className="rounded-2xl border-2 border-[var(--danger)] bg-[var(--warning-bg)] p-5 text-[var(--warning-text)] shadow-card"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[16px] font-bold">
            Transfer approval unavailable
          </span>
          <span className="rounded-full border border-[var(--danger)] bg-[var(--surface)] px-3 py-0.5 text-[13px] font-bold text-[var(--danger)]">
            Not sent
          </span>
        </div>
        <p className="mt-2 text-[15px]">{fetchError}</p>
      </section>
    );
  }

  // Displayed fields (subject to Judge Demo Tamper Switch)
  const rawPayeeName = fetched.mandate.payeeName ?? "Recipient";
  const { recipientName: splitRecipient, bankName: splitBank } =
    splitComposedPayeeName(rawPayeeName);
  const displayedComposedName = splitBank
    ? `${splitRecipient} at ${splitBank}`
    : splitRecipient;
  const displayedAccountNumber = fetched.mandate.payeeAccountNumber ?? "";
  const displayedAmountMinor = tamperDisplayedFields
    ? fetched.mandate.amountMinor + 5000
    : fetched.mandate.amountMinor;
  const displayedCurrency = fetched.mandate.currency;

  // Rule 4: Recompute the canonical hash of the displayed fields with @karenpay/core
  let recomputedHash = "";
  let hashMatches = false;
  try {
    const recomputedMandate = buildMandate({
      ...fetched.mandate,
      payeeName: displayedComposedName,
      payeeAccountNumber: displayedAccountNumber,
      amountMinor: displayedAmountMinor,
      currency: displayedCurrency,
    });
    recomputedHash = hashMandate(recomputedMandate);
    hashMatches = recomputedHash === fetched.mandateHash;
    if (!hashMatches) {
      console.warn(
        `[Bulk Transfer UI] Mandate hash mismatch for item ${widget.mandateId}:`,
        {
          recomputedHash,
          fetchedHash: fetched.mandateHash,
          tampered: tamperDisplayedFields,
          displayedComposedName,
          displayedAccountNumber,
          displayedAmountMinor,
        },
      );
    }
  } catch (err) {
    console.error(
      `[Bulk Transfer UI] Failed to recompute mandate hash for item ${widget.mandateId}:`,
      err,
    );
    recomputedHash = "INVALID_MANDATE_SHAPE";
    hashMatches = false;
  }

  const isExpired = secondsRemaining <= 0 && !finalOutcome;
  const statusChipLabel =
    finalOutcome === "PAID"
      ? "Test payment sent"
      : finalOutcome === "FAILED" || !hashMatches
        ? "Not sent"
        : finalOutcome === "CANCELLED"
          ? "Cancelled"
          : isExpired
            ? "Expired"
            : "Waiting for your approval";

  const canApprove =
    !finalOutcome &&
    !isExpired &&
    hashMatches &&
    readoutCompletedCleanly &&
    !isSpeakingReadout &&
    !isApproving &&
    !isBusy;

  const handlePasskeyApprove = async () => {
    if (!canApprove || !activeBatchId) return;
    setIsApproving(true);
    setLocalError(null);

    try {
      console.log(
        `[Bulk Transfer UI] Starting passkey authentication for mandate ${widget.mandateId}...`,
        {
          rpId: fetched.approvalOptions.rpId || window.location.hostname,
          challenge: fetched.approvalOptions.challenge,
          allowCredentialsCount:
            fetched.approvalOptions.allowCredentials?.length ?? 0,
        },
      );
      const credential = await startAuthentication({
        optionsJSON: {
          challenge: fetched.approvalOptions.challenge,
          rpId: fetched.approvalOptions.rpId || window.location.hostname,
          timeout: fetched.approvalOptions.timeout ?? 60000,
          userVerification:
            fetched.approvalOptions.userVerification ?? "required",
          allowCredentials: fetched.approvalOptions.allowCredentials ?? [],
        },
      });
      console.log(
        `[Bulk Transfer UI] Passkey signature acquired (${credential.id}), sending approval to /api/v1/mandates/${widget.mandateId}/approve...`,
      );

      const res = await fetch(`/api/v1/mandates/${widget.mandateId}/approve`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credential),
      });

      const body = (await res.json()) as {
        code?: string;
        message?: string;
        spoken?: string;
        paypalRef?: string;
      };

      console.log(
        `[Bulk Transfer UI] Approval response status=${res.status}:`,
        body,
      );

      if (res.ok && body.code === "PAID") {
        console.log(
          `[Bulk Transfer UI] Transfer PAID successfully: paypalRef=${body.paypalRef}`,
        );
        setFinalOutcome("PAID");
        setOutcomeRef(body.paypalRef ?? null);
        const spokenMsg = body.spoken ?? "Test payment sent.";
        announcePolite(spokenMsg);
        await onTransferApproved(
          activeBatchId,
          widget.mandateId,
          body.paypalRef ?? null,
          spokenMsg,
        );
      } else {
        console.warn(
          `[Bulk Transfer UI] Transfer NOT sent (status=${res.status}, code=${body.code}):`,
          body.message,
        );
        setFinalOutcome("FAILED");
        const failMsg =
          body.spoken ?? body.message ?? "Test payment not sent.";
        setLocalError(failMsg);
        announceAssertive(failMsg);
        await onTransferFailed(activeBatchId, widget.mandateId, failMsg);
      }
    } catch (err) {
      console.error(
        `[Bulk Transfer UI] Passkey prompt or approval exception for mandate ${widget.mandateId}:`,
        err,
      );
      const msg =
        "Passkey prompt was cancelled or could not be completed. Tap Approve to try again with your fingerprint or face.";
      setLocalError(msg);
      announceAssertive(msg);
    } finally {
      setIsApproving(false);
    }
  };

  return (
    <section
      aria-label={`Transfer approval for ${splitRecipient}`}
      data-testid={`widget-transfer-approval-${widget.mandateId}`}
      className="rounded-2xl border-2 border-[var(--border-strong)] bg-[var(--surface)] p-5 shadow-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
            Single transfer approval
          </span>
          <span className="num rounded-full border border-[var(--border-strong)] bg-[var(--bg)] px-2.5 py-0.5 text-[12px] font-bold text-[var(--text)]">
            {secondsRemaining}s TTL
          </span>
        </div>

        <span
          data-testid={`transfer-status-${widget.mandateId}`}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-bold ${
            statusChipLabel === "Test payment sent"
              ? "border-[var(--border-strong)] bg-[var(--sun)] text-[var(--text)]"
              : statusChipLabel === "Not sent" ||
                  statusChipLabel === "Cancelled" ||
                  statusChipLabel === "Expired"
                ? "border-[var(--danger)] bg-[var(--bg)] text-[var(--danger)]"
                : "border-[var(--border-strong)] bg-[var(--surface-tint)] text-[var(--text)]"
          }`}
        >
          {statusChipLabel === "Test payment sent" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          ) : statusChipLabel === "Not sent" ? (
            <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
          ) : (
            <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          <span>{statusChipLabel}</span>
        </span>
      </div>

      {/* Signed Mandate Details (Decision 1 & Decision 2) */}
      <div className="mt-4 rounded-xl border-2 border-[var(--border-strong)] bg-[var(--bg)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[13px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              Recipient &amp; Bank (Simulated directory)
            </p>
            <p
              data-testid="transfer-approval-recipient"
              className="mt-0.5 text-[20px] font-bold text-[var(--text)]"
            >
              {splitRecipient}
            </p>
            {splitBank ? (
              <p className="text-[15px] font-bold text-[var(--text-muted)]">
                {splitBank}
              </p>
            ) : null}
          </div>

          <div className="text-right">
            <p className="text-[13px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              Amount
            </p>
            <p
              data-testid="transfer-approval-amount"
              className="num mt-0.5 text-[28px] font-bold text-[var(--text)]"
            >
              {formatUsdMinor(displayedAmountMinor)}
            </p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 border-t border-[var(--divider)] pt-3 sm:grid-cols-2">
          <div>
            <span className="block text-[12px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              Full 10-digit account number
            </span>
            <span
              data-testid="transfer-approval-account-full"
              className="num text-[17px] font-bold text-[var(--text)]"
            >
              {formatGroupedTenDigitAccount(displayedAccountNumber)}
            </span>
          </div>
          <div>
            <span className="block text-[12px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              Mandate hash code (RFC 8785)
            </span>
            <span
              data-testid="transfer-approval-hash-short"
              className="num text-[14px] font-bold text-[var(--text)]"
            >
              {truncateHash(fetched.mandateHash)}
            </span>
          </div>
        </div>
      </div>

      {/* Spoken Readout & Hard Readout Lock Banner */}
      <div className="mt-3 rounded-xl border border-[var(--border-strong)] bg-[var(--surface-tint)] p-3.5 text-[14px] text-[var(--text)]">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 font-bold">
            <Volume2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              {isSpeakingReadout
                ? "Speaking mandatory readout…"
                : readoutCompletedCleanly
                  ? "Readout complete — ready for passkey"
                  : readoutInterrupted
                    ? "Readout interrupted — replay required"
                    : "Mandatory readout pending"}
            </span>
          </span>
          <button
            type="button"
            data-testid="bulk-replay-readout-button"
            onClick={() => {
              if (isSpeakingReadout) {
                stopReadout(true);
              } else {
                startMandatoryReadout(fetched.spoken);
              }
            }}
            className="inline-flex min-h-[48px] items-center justify-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-1.5 text-[13px] font-bold text-[var(--text)] hover:bg-[var(--peach)]"
          >
            {isSpeakingReadout ? (
              <>
                <Square className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>Stop readout</span>
              </>
            ) : (
              <>
                <RotateCcw
                  className="h-3.5 w-3.5 shrink-0"
                  aria-hidden="true"
                />
                <span>Replay readout</span>
              </>
            )}
          </button>
        </div>
        <p className="mt-1.5 text-[14px] font-medium leading-relaxed">
          &ldquo;{fetched.spoken}&rdquo;
        </p>
      </div>

      {/* Judge Demo Tamper Switch (Rule 4 verification) */}
      {!finalOutcome ? (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-[var(--border-strong)] bg-[var(--bg)] px-3.5 py-2.5">
          <label
            htmlFor={tamperSwitchId}
            className="text-[13px] font-bold text-[var(--text)]"
          >
            Judge Demo: Tamper displayed amount (+$50.00)
          </label>
          <input
            id={tamperSwitchId}
            type="checkbox"
            data-testid="bulk-tamper-switch"
            checked={tamperDisplayedFields}
            onChange={(e) => setTamperDisplayedFields(e.target.checked)}
            className="h-5 w-5 accent-[var(--primary)]"
          />
        </div>
      ) : null}

      {!hashMatches ? (
        <div
          role="alert"
          data-testid="bulk-hash-mismatch-banner"
          className="mt-3 rounded-xl border-2 border-[var(--danger)] bg-[var(--warning-bg)] p-3.5 text-[14px] font-bold text-[var(--danger)]"
        >
          Not sent: Displayed fields hash ({truncateHash(recomputedHash)}) does
          not equal signed mandateHash ({truncateHash(fetched.mandateHash)}).
          Approve is locked.
        </div>
      ) : null}

      {localError ? (
        <div
          role="alert"
          className="mt-3 rounded-xl border border-[var(--danger)] bg-[var(--warning-bg)] p-3 text-[14px] font-bold text-[var(--warning-text)]"
        >
          {localError}
        </div>
      ) : null}

      {finalOutcome === "PAID" ? (
        <div className="mt-4 rounded-xl border-2 border-[var(--border-strong)] bg-[var(--sun)] p-3.5 text-[15px] font-bold text-[var(--text)]">
          Test payment sent{" "}
          {outcomeRef ? (
            <span className="num">({outcomeRef})</span>
          ) : null}
        </div>
      ) : !finalOutcome ? (
        <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
          <button
            type="button"
            disabled={!canApprove}
            data-testid={`approve-transfer-${widget.mandateId}`}
            onClick={() => void handlePasskeyApprove()}
            className="inline-flex min-h-[64px] flex-1 items-center justify-center gap-2 rounded-2xl border-2 border-[var(--border-strong)] bg-[var(--primary)] px-5 py-3.5 text-[16px] font-bold text-[#FFFFFF] transition-colors hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {canApprove ? (
              <Fingerprint className="h-5 w-5 shrink-0" aria-hidden="true" />
            ) : (
              <Lock className="h-5 w-5 shrink-0" aria-hidden="true" />
            )}
            <span>
              {!hashMatches
                ? "Not sent — Hash mismatch"
                : isSpeakingReadout
                  ? "Listening to readout…"
                  : !readoutCompletedCleanly
                    ? "Replay readout to unlock"
                    : isApproving
                      ? "Waiting for passkey…"
                      : "Approve with passkey (fingerprint or face)"}
            </span>
          </button>

          {activeBatchId && activeItemId ? (
            <button
              type="button"
              disabled={isApproving || isBusy}
              data-testid={`cancel-active-item-${activeItemId}`}
              onClick={() => {
                stopReadout(false);
                setFinalOutcome("CANCELLED");
                void onCancelItem(activeBatchId, activeItemId);
              }}
              className="inline-flex min-h-[64px] items-center justify-center rounded-2xl border-2 border-[var(--border-strong)] bg-[var(--bg)] px-4 py-3 text-[15px] font-bold text-[var(--danger)] transition-colors hover:bg-[var(--surface-tint)] disabled:opacity-50"
            >
              Cancel transfer
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function BatchSummaryWidgetCard({
  widget,
}: {
  widget: BatchSummaryWidget;
}): React.JSX.Element {
  return (
    <section
      aria-label="Bulk batch summary"
      data-testid="widget-batch-summary"
      className="rounded-2xl border-2 border-[var(--border-strong)] bg-[var(--surface)] p-5 shadow-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[19px] font-bold text-[var(--text)]">
            Batch summary ({widget.status})
          </h3>
          <p className="text-[13px] font-bold text-[var(--text-muted)]">
            Simulated directory · All test payments
          </p>
        </div>
        <div className="text-right">
          <span className="block text-[12px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
            Sent of planned total
          </span>
          <span
            data-testid="summary-paid-total"
            className="num text-[22px] font-bold text-[var(--text)]"
          >
            {formatUsdMinor(widget.paidMinor)} /{" "}
            {formatUsdMinor(widget.totalMinor)}
          </span>
        </div>
      </div>

      <ul className="mt-4 flex flex-col divide-y divide-[var(--divider)]">
        {widget.items.map((item) => {
          const isSent = item.statusLabel === "Test payment sent";
          return (
            <li
              key={item.itemId}
              className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <p className="text-[16px] font-bold text-[var(--text)]">
                  {item.position + 1}. {item.recipientName}
                </p>
                <p className="num text-[14px] text-[var(--text-muted)]">
                  {item.bankName} · account ending in last 4 digits{" "}
                  <span className="font-bold text-[var(--text)]">
                    {item.accountLast4}
                  </span>
                </p>
              </div>

              <div className="flex items-center gap-3">
                <span className="num text-[16px] font-bold text-[var(--text)]">
                  {formatUsdMinor(item.amountMinor)}
                </span>
                <span
                  className={`inline-flex items-center rounded-full border px-3 py-0.5 text-[13px] font-bold ${
                    isSent
                      ? "border-[var(--border-strong)] bg-[var(--sun)] text-[var(--text)]"
                      : "border-[var(--danger)] bg-[var(--bg)] text-[var(--danger)]"
                  }`}
                >
                  {item.statusLabel}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Rule 3: Fixed client widget registry. Unknown or invalid widget objects are rejected.
 * Never renders HTML or markdown from the server or the AI.
 */
export function BulkWidgetRenderer({
  rawWidget,
  callbacks,
}: {
  rawWidget: unknown;
  callbacks: BulkWidgetRegistryCallbacks;
}): React.JSX.Element {
  const parsed = BulkWidgetSchema.safeParse(rawWidget);
  if (!parsed.success) {
    return (
      <div
        role="alert"
        data-testid="widget-rejected"
        className="rounded-2xl border-2 border-[var(--danger)] bg-[var(--warning-bg)] p-4 text-[15px] font-bold text-[var(--danger)]"
      >
        Unsupported widget rejected by client registry.
      </div>
    );
  }

  const widget: BulkWidget = parsed.data;
  switch (widget.type) {
    case "recipient_list":
      return <RecipientListWidgetCard widget={widget} />;
    case "name_check":
      return (
        <NameCheckWidgetCard
          widget={widget}
          isBusy={callbacks.isBusy}
          onResolveName={callbacks.onResolveName}
        />
      );
    case "plan":
      return (
        <PlanWidgetCard
          widget={widget}
          isBusy={callbacks.isBusy}
          onConfirmPlan={callbacks.onConfirmPlan}
          onCancelItem={callbacks.onCancelItem}
        />
      );
    case "transfer_approval":
      return (
        <TransferApprovalWidgetCard
          widget={widget}
          activeBatchId={callbacks.activeBatchId}
          activeItemId={callbacks.activeItemId}
          isBusy={callbacks.isBusy}
          onCancelItem={callbacks.onCancelItem}
          onTransferApproved={callbacks.onTransferApproved}
          onTransferFailed={callbacks.onTransferFailed}
        />
      );
    case "batch_summary":
      return <BatchSummaryWidgetCard widget={widget} />;
  }
}
