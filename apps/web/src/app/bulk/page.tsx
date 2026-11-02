"use client";

import { Layers, Mic, RotateCcw, Send, Square, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { BottomTabBar } from "../../components/BottomTabBar";
import { useAnnounce } from "../../components/LiveRegions";
import {
  BulkWidgetRenderer,
  type BulkWidgetRegistryCallbacks,
} from "../../components/bulk/BulkWidgetRegistry";
import { formatUsdMinor } from "../../lib/demoData";

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
  length: number;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

interface ChatLogEntry {
  id: string;
  role: "user" | "server";
  text: string;
  widgets: unknown[];
}

const SAMPLE_WHATSAPP_3_WITH_MISMATCH = [
  "0700000000",
  "Cleva Bank,",
  "Olayinka Emmanuel",
  "",
  "0123456789 - GTB - Adewale Bello",
  "0801112223 | Access Bank | Chidinma Okafor",
].join("\n");

const SAMPLE_WHATSAPP_5_MATCHED = [
  "0700000000, Cleva Bank, Olayinka Emmanuel",
  "0123456789, GTB, Ade Bello",
  "0801112223, Access Bank, Chidinma Okafor",
  "0902223334, Zenith Bank, Tunde Bakare",
  "0456789012, UBA, Ngozi Eze",
].join("\n");

export default function BulkPayPage(): React.JSX.Element {
  const router = useRouter();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pasteInputId = useId();
  const amountInputId = useId();
  const { announcePolite, announceAssertive } = useAnnounce();

  const [rawPasteText, setRawPasteText] = useState<string>("");
  const [instructionText, setInstructionText] = useState<string>("");
  const [isListening, setIsListening] = useState<boolean>(false);
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const [batchId, setBatchId] = useState<string | null>(null);
  const [batchStatus, setBatchStatus] = useState<string | null>(null);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [runningTotalMinor, setRunningTotalMinor] = useState<number>(0);
  const [plannedTotalMinor, setPlannedTotalMinor] = useState<number>(0);
  const [hasUnresolvedNameChecks, setHasUnresolvedNameChecks] =
    useState<boolean>(false);

  const [chatEntries, setChatEntries] = useState<ChatLogEntry[]>([]);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const silenceTimerRef = useRef<number | null>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const speakServerMessage = useCallback(
    (spoken: string, options?: { skipSpeechSynthesis?: boolean }) => {
      if (!spoken) return;
      announcePolite(spoken);
      if (options?.skipSpeechSynthesis) return;
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        try {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(spoken);
          utterance.lang = "en-US";
          utterance.rate = 1.0;
          window.speechSynthesis.speak(utterance);
        } catch {
          // ignore speech synthesis errors
        }
      }
    },
    [announcePolite],
  );

  const appendTurn = useCallback(
    (role: "user" | "server", text: string, widgets: unknown[] = []) => {
      setChatEntries((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role,
          text,
          widgets,
        },
      ]);
    },
    [],
  );

  const stopListening = useCallback(() => {
    if (silenceTimerRef.current !== null) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  const startListening = useCallback(() => {
    setErrorBanner(null);
    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const SpeechRecCtor =
      win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;

    if (!SpeechRecCtor) {
      announcePolite(
        "Voice capture is not available in this browser. Type your amount instruction below.",
      );
      return;
    }

    try {
      const recognition = new SpeechRecCtor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      recognition.onresult = (event: SpeechRecognitionEventLike) => {
        let combined = "";
        for (let i = 0; i < event.results.length; i += 1) {
          combined += event.results[i][0].transcript;
        }
        setInstructionText(combined.trim());

        if (silenceTimerRef.current !== null) {
          window.clearTimeout(silenceTimerRef.current);
        }
        silenceTimerRef.current = window.setTimeout(() => {
          stopListening();
        }, 2000);
      };

      recognition.onerror = () => {
        stopListening();
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
      setIsListening(true);
      announcePolite(
        "Listening for amount instruction, for example 25 dollars each.",
      );
    } catch {
      setIsListening(false);
    }
  }, [announcePolite, stopListening]);

  const checkPendingNameChecks = (widgets: unknown[]): boolean => {
    return widgets.some(
      (w) =>
        typeof w === "object" &&
        w !== null &&
        (w as { type?: unknown }).type === "name_check",
    );
  };

  const handleParseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = rawPasteText.trim();
    if (!trimmed) {
      const msg = "Please paste recipient details to parse.";
      setErrorBanner(msg);
      announceAssertive(msg);
      return;
    }

    setIsBusy(true);
    setErrorBanner(null);
    appendTurn("user", trimmed);
    console.log(
      `[Bulk Page] Parsing recipients from text (length=${trimmed.length})...`,
    );

    try {
      const res = await fetch("/api/v1/bulk/parse", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText: trimmed }),
      });

      if (res.status === 401) {
        console.warn("[Bulk Page] Parse returned 401, redirecting to login");
        router.replace("/");
        return;
      }

      const data = (await res.json()) as {
        batchId?: string;
        status?: string;
        spoken?: string;
        message?: string;
        widgets?: unknown[];
      };

      if (!res.ok || !data.batchId) {
        console.error(
          `[Bulk Page] Parse failed (${res.status}):`,
          data,
        );
        const errText =
          data.spoken ??
          data.message ??
          "Could not parse recipients from pasted text.";
        setErrorBanner(errText);
        announceAssertive(errText);
        speakServerMessage(errText);
        appendTurn("server", errText, []);
        return;
      }

      const widgets = Array.isArray(data.widgets) ? data.widgets : [];
      console.log(
        `[Bulk Page] Parse succeeded: batchId=${data.batchId}, status=${data.status}, widgets=${widgets.length}`,
      );
      setBatchId(data.batchId);
      setBatchStatus(data.status ?? "PARSED");
      setRunningTotalMinor(0);
      setPlannedTotalMinor(0);
      setHasUnresolvedNameChecks(checkPendingNameChecks(widgets));

      const spokenText = data.spoken ?? "Recipients parsed.";
      appendTurn("server", spokenText, widgets);
      speakServerMessage(spokenText);
    } catch (err) {
      console.error("[Bulk Page] Network error during parse:", err);
      const netErr = "Unable to connect to the KarenPay service.";
      setErrorBanner(netErr);
      announceAssertive(netErr);
    } finally {
      setIsBusy(false);
    }
  };

  const handleResolveName = useCallback(
    async (itemId: string, decision: "USE_DIRECTORY_NAME" | "SKIP") => {
      setIsBusy(true);
      setErrorBanner(null);
      try {
        const res = await fetch(`/api/v1/bulk/items/${itemId}/resolve-name`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision }),
        });

        if (res.status === 401) {
          router.replace("/");
          return;
        }

        const data = (await res.json()) as {
          spoken?: string;
          message?: string;
          widgets?: unknown[];
        };

        if (!res.ok) {
          const errText =
            data.spoken ??
            data.message ??
            "The recipient name choice could not be saved.";
          setErrorBanner(errText);
          announceAssertive(errText);
          return;
        }

        const widgets = Array.isArray(data.widgets) ? data.widgets : [];
        setHasUnresolvedNameChecks(checkPendingNameChecks(widgets));
        const spokenText = data.spoken ?? "Recipient name choice saved.";
        appendTurn("server", spokenText, widgets);
        speakServerMessage(spokenText);
      } catch {
        const netErr = "Unable to save recipient name decision.";
        setErrorBanner(netErr);
        announceAssertive(netErr);
      } finally {
        setIsBusy(false);
      }
    },
    [announceAssertive, appendTurn, router, speakServerMessage],
  );

  const handlePlanSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!batchId) return;
    const cleanInstruction = instructionText.trim();
    if (!cleanInstruction) {
      const msg =
        "Please enter or say an amount, for example 25 dollars each.";
      setErrorBanner(msg);
      announceAssertive(msg);
      return;
    }

    stopListening();
    setIsBusy(true);
    setErrorBanner(null);
    appendTurn("user", cleanInstruction);
    console.log(
      `[Bulk Page] Generating plan for batch ${batchId}: "${cleanInstruction}"...`,
    );

    try {
      const res = await fetch(`/api/v1/bulk/${batchId}/plan`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: cleanInstruction }),
      });

      if (res.status === 401) {
        console.warn("[Bulk Page] Plan returned 401, redirecting to login");
        router.replace("/");
        return;
      }

      const data = (await res.json()) as {
        status?: string;
        totalMinor?: number;
        spoken?: string;
        message?: string;
        widgets?: unknown[];
      };

      if (!res.ok) {
        console.error(
          `[Bulk Page] Plan generation failed (${res.status}):`,
          data,
        );
        const errText =
          data.spoken ??
          data.message ??
          "Please restate the amount clearly, for example 25 dollars each.";
        setErrorBanner(errText);
        announceAssertive(errText);
        speakServerMessage(errText);
        appendTurn("server", errText, []);
        return;
      }

      const widgets = Array.isArray(data.widgets) ? data.widgets : [];
      console.log(
        `[Bulk Page] Plan generated successfully: status=${data.status}, totalMinor=${data.totalMinor}, widgets=${widgets.length}`,
      );
      setBatchStatus(data.status ?? "PLANNED");
      if (typeof data.totalMinor === "number") {
        setPlannedTotalMinor(data.totalMinor);
      }
      const spokenText = data.spoken ?? "Bulk payment plan ready.";
      appendTurn("server", spokenText, widgets);
      speakServerMessage(spokenText);
    } catch (err) {
      console.error("[Bulk Page] Network error during plan generation:", err);
      const netErr = "Unable to create the bulk payment plan.";
      setErrorBanner(netErr);
      announceAssertive(netErr);
    } finally {
      setIsBusy(false);
    }
  };

  const activateNextItem = useCallback(
    async (targetBatchId: string) => {
      setIsBusy(true);
      setErrorBanner(null);
      console.log(
        `[Bulk Page] Activating next transfer item for batch ${targetBatchId}...`,
      );
      try {
        const res = await fetch(`/api/v1/bulk/${targetBatchId}/next`, {
          method: "POST",
          credentials: "include",
        });

        if (res.status === 401) {
          console.warn("[Bulk Page] Next returned 401, redirecting to login");
          router.replace("/");
          return;
        }

        const data = (await res.json()) as {
          status?: string;
          activeItem?: {
            itemId: string;
            position: number;
            mandateId: string;
          } | null;
          runningTotalMinor?: number;
          totalMinor?: number;
          spoken?: string;
          message?: string;
          widgets?: unknown[];
        };

        if (!res.ok) {
          console.error(
            `[Bulk Page] Activate next item failed (${res.status}):`,
            data,
          );
          const errText =
            data.spoken ??
            data.message ??
            "Could not activate the next transfer.";
          setErrorBanner(errText);
          announceAssertive(errText);
          return;
        }

        console.log(`[Bulk Page] Activated transfer item:`, {
          batchStatus: data.status,
          activeItem: data.activeItem,
          runningTotalMinor: data.runningTotalMinor,
          totalMinor: data.totalMinor,
        });

        setBatchStatus(data.status ?? "IN_PROGRESS");
        setActiveItemId(data.activeItem?.itemId ?? null);
        if (typeof data.runningTotalMinor === "number") {
          setRunningTotalMinor(data.runningTotalMinor);
        }
        if (typeof data.totalMinor === "number") {
          setPlannedTotalMinor(data.totalMinor);
        }

        const widgets = Array.isArray(data.widgets) ? data.widgets : [];
        const spokenText = data.spoken ?? "";
        const hasTransferWidget = widgets.some(
          (w) =>
            typeof w === "object" &&
            w !== null &&
            (w as { type?: unknown }).type === "transfer_approval",
        );
        appendTurn("server", spokenText, widgets);
        // TransferApprovalWidgetCard runs the mandatory speechSynthesis readout itself
        speakServerMessage(spokenText, {
          skipSpeechSynthesis: hasTransferWidget,
        });
      } catch (err) {
        console.error("[Bulk Page] Network error activating next item:", err);
        const netErr = "Unable to activate the next transfer in the queue.";
        setErrorBanner(netErr);
        announceAssertive(netErr);
      } finally {
        setIsBusy(false);
      }
    },
    [announceAssertive, appendTurn, router, speakServerMessage],
  );

  const handleConfirmPlan = useCallback(
    async (targetBatchId: string, planHash: string, requestHash: string) => {
      setIsBusy(true);
      setErrorBanner(null);
      console.log(
        `[Bulk Page] Confirming plan for batch ${targetBatchId} (planHash=${planHash})...`,
      );
      try {
        const res = await fetch(
          `/api/v1/bulk/${targetBatchId}/confirm-plan`,
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ planHash, requestHash }),
          },
        );

        if (res.status === 401) {
          console.warn(
            "[Bulk Page] Confirm plan returned 401, redirecting to login",
          );
          router.replace("/");
          return;
        }

        const data = (await res.json()) as {
          status?: string;
          spoken?: string;
          message?: string;
          widgets?: unknown[];
        };

        if (!res.ok) {
          console.error(
            `[Bulk Page] Confirm plan failed (${res.status}):`,
            data,
          );
          const errText =
            data.spoken ??
            data.message ??
            "The payment plan could not be confirmed.";
          setErrorBanner(errText);
          announceAssertive(errText);
          speakServerMessage(errText);
          return;
        }

        console.log(
          `[Bulk Page] Plan confirmed for batch ${targetBatchId}, activating first item...`,
        );
        setBatchStatus(data.status ?? "CONFIRMED");
        // Immediately activate item 1 in the queue
        await activateNextItem(targetBatchId);
      } catch (err) {
        console.error("[Bulk Page] Network error confirming plan:", err);
        const netErr = "Unable to confirm the payment plan.";
        setErrorBanner(netErr);
        announceAssertive(netErr);
      } finally {
        setIsBusy(false);
      }
    },
    [activateNextItem, announceAssertive, router, speakServerMessage],
  );

  const handleCancelItem = useCallback(
    async (targetBatchId: string, itemId: string) => {
      setIsBusy(true);
      setErrorBanner(null);
      console.log(
        `[Bulk Page] Cancelling item ${itemId} in batch ${targetBatchId}...`,
      );
      try {
        const res = await fetch(
          `/api/v1/bulk/${targetBatchId}/items/${itemId}/cancel`,
          {
            method: "POST",
            credentials: "include",
          },
        );

        if (res.status === 401) {
          console.warn(
            "[Bulk Page] Cancel item returned 401, redirecting to login",
          );
          router.replace("/");
          return;
        }

        const data = (await res.json()) as {
          batchStatus?: string;
          spoken?: string;
          message?: string;
          widgets?: unknown[];
        };

        if (!res.ok) {
          console.error(
            `[Bulk Page] Cancel item ${itemId} failed (${res.status}):`,
            data,
          );
          const errText =
            data.spoken ??
            data.message ??
            "This transfer could not be cancelled.";
          setErrorBanner(errText);
          announceAssertive(errText);
          return;
        }

        console.log(
          `[Bulk Page] Cancel item ${itemId} succeeded, new batchStatus=${data.batchStatus}`,
        );
        const widgets = Array.isArray(data.widgets) ? data.widgets : [];
        const spokenText = data.spoken ?? "Transfer cancelled.";
        appendTurn("server", spokenText, widgets);
        speakServerMessage(spokenText);

        if (
          data.batchStatus === "COMPLETED" ||
          data.batchStatus === "CANCELLED"
        ) {
          setBatchStatus(data.batchStatus);
          setActiveItemId(null);
        } else if (batchStatus === "IN_PROGRESS" || batchStatus === "CONFIRMED") {
          await activateNextItem(targetBatchId);
        }
      } catch (err) {
        console.error(`[Bulk Page] Network error cancelling item ${itemId}:`, err);
        const netErr = "Unable to cancel the transfer.";
        setErrorBanner(netErr);
        announceAssertive(netErr);
      } finally {
        setIsBusy(false);
      }
    },
    [
      activateNextItem,
      announceAssertive,
      appendTurn,
      batchStatus,
      router,
      speakServerMessage,
    ],
  );

  const handleCancelRemaining = async () => {
    if (!batchId) return;
    setIsBusy(true);
    setErrorBanner(null);
    console.log(
      `[Bulk Page] Cancelling remaining transfers for batch ${batchId}...`,
    );
    try {
      const res = await fetch(`/api/v1/bulk/${batchId}/cancel-remaining`, {
        method: "POST",
        credentials: "include",
      });

      if (res.status === 401) {
        console.warn(
          "[Bulk Page] Cancel remaining returned 401, redirecting to login",
        );
        router.replace("/");
        return;
      }

      const data = (await res.json()) as {
        status?: string;
        paidMinor?: number;
        totalMinor?: number;
        spoken?: string;
        message?: string;
        widgets?: unknown[];
      };

      if (!res.ok) {
        console.error(
          `[Bulk Page] Cancel remaining failed (${res.status}):`,
          data,
        );
        const errText =
          data.spoken ??
          data.message ??
          "Remaining transfers could not be cancelled.";
        setErrorBanner(errText);
        announceAssertive(errText);
        return;
      }

      console.log(
        `[Bulk Page] Cancel remaining succeeded for batch ${batchId}: status=${data.status}, paidMinor=${data.paidMinor}`,
      );
      setBatchStatus(data.status ?? "CANCELLED");
      setActiveItemId(null);
      if (typeof data.paidMinor === "number") {
        setRunningTotalMinor(data.paidMinor);
      }
      const widgets = Array.isArray(data.widgets) ? data.widgets : [];
      const spokenText = data.spoken ?? "Cancelled remaining pending transfers.";
      appendTurn("server", spokenText, widgets);
      speakServerMessage(spokenText);
    } catch (err) {
      console.error(
        `[Bulk Page] Network error cancelling remaining transfers:`,
        err,
      );
      const netErr = "Unable to cancel remaining transfers.";
      setErrorBanner(netErr);
      announceAssertive(netErr);
    } finally {
      setIsBusy(false);
    }
  };

  const handleTransferApproved = useCallback(
    async (
      targetBatchId: string,
      _mandateId: string,
      _paypalRef: string | null,
      spoken: string,
    ) => {
      console.log(
        `[Bulk Page] Item approved in batch ${targetBatchId}: mandateId=${_mandateId}, paypalRef=${_paypalRef}`,
      );
      speakServerMessage(spoken);
      await activateNextItem(targetBatchId);
    },
    [activateNextItem, speakServerMessage],
  );

  const handleTransferFailed = useCallback(
    async (targetBatchId: string, _mandateId: string, spoken: string) => {
      console.warn(
        `[Bulk Page] Item failed in batch ${targetBatchId}: mandateId=${_mandateId}, spoken="${spoken}"`,
      );
      speakServerMessage(spoken);
      await activateNextItem(targetBatchId);
    },
    [activateNextItem, speakServerMessage],
  );

  const handleResetBatch = () => {
    setBatchId(null);
    setBatchStatus(null);
    setActiveItemId(null);
    setRunningTotalMinor(0);
    setPlannedTotalMinor(0);
    setHasUnresolvedNameChecks(false);
    setErrorBanner(null);
    setRawPasteText("");
    setInstructionText("");
    setChatEntries([]);
  };

  const canCancelRemaining =
    Boolean(batchId) &&
    batchStatus !== "COMPLETED" &&
    batchStatus !== "CANCELLED" &&
    batchStatus !== "EXPIRED";

  const showAmountComposer =
    Boolean(batchId) &&
    (batchStatus === "PARSED" || batchStatus === "PLANNED") &&
    !hasUnresolvedNameChecks;

  const registryCallbacks: BulkWidgetRegistryCallbacks = {
    activeBatchId: batchId,
    activeItemId,
    isBusy,
    onResolveName: handleResolveName,
    onConfirmPlan: handleConfirmPlan,
    onCancelItem: handleCancelItem,
    onTransferApproved: handleTransferApproved,
    onTransferFailed: handleTransferFailed,
  };

  return (
    <div className="flex flex-1 flex-col gap-5 pb-28">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="text-[28px] font-bold leading-[1.2] text-[var(--text)] outline-none"
            >
              Bulk pay
            </h1>
            <span className="rounded-full border border-[var(--border-strong)] bg-[var(--surface-tint)] px-3 py-0.5 text-[13px] font-bold text-[var(--text)]">
              Simulated directory
            </span>
          </div>
          <p className="mt-1 text-[15px] text-[var(--text-muted)]">
            Paste up to 5 recipients from WhatsApp, confirm names against the
            simulated directory, set an amount, and approve each test payment
            one at a time with your passkey (fingerprint or face).
          </p>
        </div>

        {batchId ? (
          <button
            type="button"
            onClick={handleResetBatch}
            className="inline-flex min-h-[48px] items-center justify-center gap-1.5 rounded-xl border-2 border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2 text-[14px] font-bold text-[var(--text)] hover:bg-[var(--surface-tint)]"
          >
            <RotateCcw className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Start new batch</span>
          </button>
        ) : null}
      </header>

      {/* Running Total & Cancel Remaining Bar (Rule 6 & Rule 13) */}
      {batchId ? (
        <section
          aria-label="Batch progress and running total"
          data-testid="bulk-running-total-bar"
          className="on-dark flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[var(--balance-card)] p-4 text-[#FFFFFF] shadow-card"
        >
          <div>
            <span className="block text-[12px] font-bold uppercase tracking-wider text-[var(--peach)]">
              Running total sent ({batchStatus})
            </span>
            <p
              data-testid="bulk-running-total-amount"
              className="num mt-0.5 text-[22px] font-bold text-[#FFFFFF]"
            >
              {formatUsdMinor(runningTotalMinor)} of{" "}
              {formatUsdMinor(plannedTotalMinor)}
            </p>
          </div>

          {canCancelRemaining ? (
            <button
              type="button"
              disabled={isBusy}
              data-testid="cancel-remaining-button"
              onClick={() => void handleCancelRemaining()}
              className="inline-flex min-h-[48px] items-center justify-center gap-1.5 rounded-xl border-2 border-[var(--peach)] bg-[var(--surface)] px-4 py-2.5 text-[14px] font-bold text-[var(--danger)] transition-colors hover:bg-[var(--surface-tint)] disabled:opacity-50"
            >
              <XCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Cancel remaining</span>
            </button>
          ) : null}
        </section>
      ) : null}

      {errorBanner ? (
        <div
          role="alert"
          data-testid="bulk-error-banner"
          className="rounded-2xl border-2 border-[var(--danger)] bg-[var(--warning-bg)] p-4 text-[15px] font-bold text-[var(--warning-text)]"
        >
          {errorBanner}
        </div>
      ) : null}

      {/* Conversation Log & Server Widget Feed (Rule 3) */}
      <div
        role="log"
        aria-live="off"
        aria-label="Bulk payment conversation"
        data-testid="bulk-chat-log"
        className="flex flex-col gap-4"
      >
        {chatEntries.length === 0 ? (
          <div className="rounded-2xl border-2 border-[var(--border-strong)] bg-[var(--surface)] p-5 text-[15px] text-[var(--text-muted)] shadow-card">
            <div className="flex items-center gap-2.5 text-[16px] font-bold text-[var(--text)]">
              <Layers className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span>Step 1: Paste WhatsApp recipient details below</span>
            </div>
            <p className="mt-1.5">
              Include a 10-digit account number, Nigerian bank name or alias,
              and recipient name for up to 5 recipients. Per-transfer sandbox
              limit is <span className="num font-bold">$100.00</span> and batch
              limit is <span className="num font-bold">$300.00</span>.
            </p>
          </div>
        ) : (
          chatEntries.map((entry) => (
            <div key={entry.id} className="flex flex-col gap-3">
              {entry.role === "user" ? (
                <div className="ml-auto max-w-[90%] rounded-2xl border-2 border-[var(--border-strong)] bg-[var(--surface-tint)] px-4 py-3 text-[15px] font-bold whitespace-pre-wrap text-[var(--text)]">
                  {entry.text}
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {entry.text ? (
                    <div className="rounded-2xl border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-3 text-[15px] font-medium text-[var(--text)]">
                      {entry.text}
                    </div>
                  ) : null}
                  {entry.widgets.map((widget, idx) => (
                    <BulkWidgetRenderer
                      key={`${entry.id}-w-${idx}`}
                      rawWidget={widget}
                      callbacks={registryCallbacks}
                    />
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Step 1: Recipient Paste Form */}
      {!batchId ? (
        <form
          onSubmit={(e) => void handleParseSubmit(e)}
          className="flex flex-col gap-4 rounded-2xl border-2 border-[var(--border-strong)] bg-[var(--surface)] p-5 shadow-card"
        >
          <div>
            <label
              htmlFor={pasteInputId}
              className="block text-[16px] font-bold text-[var(--text)]"
            >
              Paste up to 5 recipients (10-digit account number, bank, and name)
            </label>
            <p className="mt-1 text-[13px] text-[var(--text-muted)]">
              Supports multi-line WhatsApp blocks, commas, dashes, or pipes in
              any field order.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="sample-whatsapp-3-button"
              onClick={() => setRawPasteText(SAMPLE_WHATSAPP_3_WITH_MISMATCH)}
              className="inline-flex min-h-[48px] items-center justify-center rounded-xl border border-[var(--border-strong)] bg-[var(--surface-tint)] px-3.5 py-2 text-[13px] font-bold text-[var(--text)] hover:bg-[var(--peach)]"
            >
              Fill sample: 3 recipients (with name check)
            </button>
            <button
              type="button"
              data-testid="sample-whatsapp-5-button"
              onClick={() => setRawPasteText(SAMPLE_WHATSAPP_5_MATCHED)}
              className="inline-flex min-h-[48px] items-center justify-center rounded-xl border border-[var(--border-strong)] bg-[var(--surface-tint)] px-3.5 py-2 text-[13px] font-bold text-[var(--text)] hover:bg-[var(--peach)]"
            >
              Fill sample: 5 matched recipients
            </button>
          </div>

          <textarea
            id={pasteInputId}
            data-testid="bulk-paste-input"
            rows={6}
            value={rawPasteText}
            onChange={(e) => setRawPasteText(e.target.value)}
            placeholder={
              "0700000000\nCleva Bank,\nOlayinka Emmanuel"
            }
            className="w-full rounded-xl border-2 border-[var(--border-strong)] bg-[var(--bg)] p-3.5 text-[15px] font-medium text-[var(--text)] placeholder:text-[var(--text-muted)]"
          />

          <button
            type="submit"
            disabled={isBusy}
            data-testid="bulk-parse-submit"
            className="inline-flex min-h-[64px] w-full items-center justify-center gap-2 rounded-2xl border-2 border-[var(--border-strong)] bg-[var(--primary)] px-6 py-4 text-[17px] font-bold text-[#FFFFFF] transition-colors hover:bg-[var(--primary-hover)] disabled:opacity-50"
          >
            <Send className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span>{isBusy ? "Parsing recipients…" : "Parse recipients"}</span>
          </button>
        </form>
      ) : null}

      {/* Step 2: Amount Instruction Composer (Voice + Text) */}
      {showAmountComposer ? (
        <form
          onSubmit={(e) => void handlePlanSubmit(e)}
          className="flex flex-col gap-4 rounded-2xl border-2 border-[var(--border-strong)] bg-[var(--surface)] p-5 shadow-card"
        >
          <div>
            <label
              htmlFor={amountInputId}
              className="block text-[16px] font-bold text-[var(--text)]"
            >
              Amount instruction (for example: 25 each or 50 dollars each)
            </label>
            <p className="mt-1 text-[13px] text-[var(--text-muted)]">
              Per-transfer limit is $100.00 and batch total limit is $300.00.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setInstructionText("25 each")}
              className="inline-flex min-h-[48px] items-center justify-center rounded-xl border border-[var(--border-strong)] bg-[var(--surface-tint)] px-3.5 py-2 text-[13px] font-bold text-[var(--text)] hover:bg-[var(--peach)]"
            >
              25 each
            </button>
            <button
              type="button"
              onClick={() => setInstructionText("50 dollars each")}
              className="inline-flex min-h-[48px] items-center justify-center rounded-xl border border-[var(--border-strong)] bg-[var(--surface-tint)] px-3.5 py-2 text-[13px] font-bold text-[var(--text)] hover:bg-[var(--peach)]"
            >
              50 dollars each
            </button>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              id={amountInputId}
              type="text"
              data-testid="bulk-amount-input"
              value={instructionText}
              onChange={(e) => setInstructionText(e.target.value)}
              placeholder="25 each"
              className="min-h-[64px] flex-1 rounded-xl border-2 border-[var(--border-strong)] bg-[var(--bg)] px-4 text-[16px] font-bold text-[var(--text)] placeholder:text-[var(--text-muted)]"
            />

            <button
              type="button"
              data-testid="bulk-voice-button"
              onClick={() => {
                if (isListening) {
                  stopListening();
                } else {
                  startListening();
                }
              }}
              aria-label={
                isListening
                  ? "Stop voice capture"
                  : "Speak amount instruction"
              }
              className="inline-flex min-h-[64px] min-w-[64px] items-center justify-center gap-2 rounded-xl border-2 border-[var(--border-strong)] bg-[var(--surface-tint)] px-4 text-[15px] font-bold text-[var(--text)] hover:bg-[var(--peach)]"
            >
              {isListening ? (
                <>
                  <Square className="h-5 w-5 shrink-0" aria-hidden="true" />
                  <span>Stop</span>
                </>
              ) : (
                <>
                  <Mic className="h-5 w-5 shrink-0" aria-hidden="true" />
                  <span>Speak</span>
                </>
              )}
            </button>

            <button
              type="submit"
              disabled={isBusy}
              data-testid="bulk-plan-submit"
              className="inline-flex min-h-[64px] items-center justify-center gap-2 rounded-xl border-2 border-[var(--border-strong)] bg-[var(--primary)] px-6 text-[16px] font-bold text-[#FFFFFF] transition-colors hover:bg-[var(--primary-hover)] disabled:opacity-50"
            >
              <Send className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span>{isBusy ? "Planning…" : "Send"}</span>
            </button>
          </div>
        </form>
      ) : null}

      <BottomTabBar activeTab="bulk" />
    </div>
  );
}
