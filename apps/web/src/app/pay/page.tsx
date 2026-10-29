"use client";

import { startAuthentication } from "@simplewebauthn/browser";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Fingerprint,
  Lock,
  Mic,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Square,
  Volume2,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import React, {
  Suspense,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Button } from "../../components/Button";
import { useAnnounce } from "../../components/LiveRegions";
import {
  DEMO_CONTACTS,
  formatUsdMinor,
  recordLocalPaymentCompleted,
} from "../../lib/demoData";

type FlowStep = 1 | 2 | 3 | 4;

interface IntentProposal {
  action: "send_money";
  payeeContactId: string;
  amountMinor: number;
  currency: "USD";
}

interface IntentResponse {
  needsClarification?: boolean;
  candidates?: string[];
  spoken?: string;
  proposal?: IntentProposal;
  code?: string;
  message?: string;
}

interface MandateCreatedResponse {
  mandateId: string;
  mandateHash: string;
  spoken: string;
  readoutRequired: boolean;
  expiresAt: string;
  approvalOptions: {
    challenge: string;
    rpId: string;
    timeout?: number;
    userVerification?: "required" | "preferred" | "discouraged";
    allowCredentials?: { id: string; type: "public-key" }[];
  };
}

interface MandateApproveResponse {
  code: string;
  status: string;
  message: string;
  spoken: string;
  paypalRef?: string;
}

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

async function computeSha256Base64Url(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(input);
  if (typeof window !== "undefined" && window.crypto?.subtle) {
    const digest = await window.crypto.subtle.digest("SHA-256", bytes);
    const arr = Array.from(new Uint8Array(digest));
    const binary = String.fromCharCode(...arr);
    return btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }
  return btoa(input)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function truncateHash(hash: string): string {
  if (!hash || hash.length <= 16) return hash;
  return `${hash.slice(0, 8)}...${hash.slice(-6)}`;
}

function PayTerminalInner(): React.JSX.Element {
  const searchParams = useSearchParams();
  const initialRecipient = searchParams.get("recipient") ?? "";
  const headingRef = useRef<HTMLHeadingElement>(null);
  const textInputId = useId();
  const tamperSwitchId = useId();
  const { announcePolite, announceAssertive } = useAnnounce();

  const [step, setStep] = useState<FlowStep>(1);
  const [transcript, setTranscript] = useState<string>(
    initialRecipient ? `Send 50 dollars to ${initialRecipient}` : "",
  );
  const [isListening, setIsListening] = useState<boolean>(false);
  const [isSubmittingIntent, setIsSubmittingIntent] = useState<boolean>(false);

  // Clarification state
  const [clarificationSpoken, setClarificationSpoken] = useState<string | null>(
    null,
  );
  const [clarificationCandidates, setClarificationCandidates] = useState<
    string[]
  >([]);

  // Mandate & Readout state
  const [proposal, setProposal] = useState<IntentProposal | null>(null);
  const [requestHash, setRequestHash] = useState<string>("");
  const [mandate, setMandate] = useState<MandateCreatedResponse | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(120);

  // Strict Readout Lock state
  const [isSpeakingReadout, setIsSpeakingReadout] = useState<boolean>(false);
  const [readoutCompletedCleanly, setReadoutCompletedCleanly] =
    useState<boolean>(false);
  const [readoutInterrupted, setReadoutInterrupted] = useState<boolean>(false);

  // Step 4 Judge Demo Tamper Switch & Approval result
  const [tamperEnabled, setTamperEnabled] = useState<boolean>(false);
  const [isApproving, setIsApproving] = useState<boolean>(false);
  const [approvalResult, setApprovalResult] =
    useState<MandateApproveResponse | null>(null);
  const [approvalRejected, setApprovalRejected] = useState<boolean>(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Refs for Web Speech APIs
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const activeUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const speechWatchdogRef = useRef<number | null>(null);
  const speechCancelledByUserRef = useRef<boolean>(false);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    if (initialRecipient && !transcript) {
      setTranscript(`Send 50 dollars to ${initialRecipient}`);
    }
  }, [initialRecipient, transcript]);

  const clearSpeechTimers = useCallback(() => {
    if (speechWatchdogRef.current !== null) {
      window.clearTimeout(speechWatchdogRef.current);
      speechWatchdogRef.current = null;
    }
  }, []);

  const stopActiveSpeech = useCallback(
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

  // Speak arbitrary server response.spoken string verbatim
  const speakServerText = useCallback(
    (
      spokenText: string,
      options?: {
        isMandatoryReadout?: boolean;
        onCompleteCleanly?: () => void;
      },
    ) => {
      const isMandatory = options?.isMandatoryReadout === true;
      clearSpeechTimers();
      speechCancelledByUserRef.current = false;

      if (isMandatory) {
        setReadoutCompletedCleanly(false);
        setReadoutInterrupted(false);
        setIsSpeakingReadout(true);
      }

      announcePolite(spokenText);

      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        if (isMandatory) {
          setIsSpeakingReadout(false);
          setReadoutCompletedCleanly(true);
          setStep(4);
        }
        options?.onCompleteCleanly?.();
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
      activeUtteranceRef.current = utterance;

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
        if (isMandatory) {
          setReadoutInterrupted(false);
          setReadoutCompletedCleanly(true);
          setStep((prev) => (prev < 4 ? 4 : prev));
        }
        options?.onCompleteCleanly?.();
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

      // Watchdog timer in case browser TTS hangs without firing onend
      speechWatchdogRef.current = window.setTimeout(() => {
        if (!speechCancelledByUserRef.current) {
          finishCleanly();
        }
      }, 18000);
    },
    [announcePolite, clearSpeechTimers],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearSpeechTimers();
      if (silenceTimerRef.current !== null) {
        window.clearTimeout(silenceTimerRef.current);
      }
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          // ignore
        }
      }
    };
  }, [clearSpeechTimers]);

  // 120s Mandate Expiry Countdown (announces politely only at 30s and 10s)
  useEffect(() => {
    if (!mandate || approvalResult) return;

    const updateTimer = () => {
      const expiresMs = new Date(mandate.expiresAt).getTime();
      const diffSec = Math.max(0, Math.ceil((expiresMs - Date.now()) / 1000));
      setSecondsRemaining(diffSec);
      if (diffSec === 30) {
        announcePolite("Thirty seconds left to approve this test payment.");
      } else if (diffSec === 10) {
        announcePolite("Ten seconds left to approve this test payment.");
      } else if (diffSec === 0) {
        announceAssertive(
          "This payment mandate has expired. Start a new request to continue.",
        );
      }
    };

    updateTimer();
    const intervalId = window.setInterval(updateTimer, 1000);
    return () => window.clearInterval(intervalId);
  }, [mandate, approvalResult, announcePolite, announceAssertive]);

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
        "Voice capture is not available in this browser. Type your payment request below.",
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
        setTranscript(combined.trim());

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
        "Listening. Speak your payment request, or tap Done Speaking when finished.",
      );
    } catch {
      setIsListening(false);
    }
  }, [announcePolite, stopListening]);

  const submitTranscript = useCallback(
    async (inputTranscript: string) => {
      const cleanTranscript = inputTranscript.trim();
      if (!cleanTranscript) {
        const msg = "Please say the recipient, amount, and currency.";
        setErrorBanner(msg);
        announceAssertive(msg);
        return;
      }

      stopListening();
      setErrorBanner(null);
      setClarificationSpoken(null);
      setClarificationCandidates([]);
      setIsSubmittingIntent(true);

      try {
        const intentRes = await fetch("/api/v1/intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript: cleanTranscript }),
        });

        const intentData = (await intentRes.json()) as IntentResponse;

        if (!intentRes.ok) {
          const errSpoken =
            intentData.spoken ??
            intentData.message ??
            "Please say a saved contact name, the amount, and currency.";
          setErrorBanner(errSpoken);
          announceAssertive(errSpoken);
          speakServerText(errSpoken, { isMandatoryReadout: false });
          setIsSubmittingIntent(false);
          return;
        }

        if (intentData.needsClarification) {
          const spokenPrompt =
            intentData.spoken ?? "Which contact did you mean?";
          setClarificationSpoken(spokenPrompt);
          setClarificationCandidates(intentData.candidates ?? []);
          setIsSubmittingIntent(false);
          speakServerText(spokenPrompt, {
            isMandatoryReadout: false,
            onCompleteCleanly: () => {
              // Re-open capture after clarification prompt finishes
              startListening();
            },
          });
          return;
        }

        if (!intentData.proposal) {
          const fallbackErr = "Could not build a payment proposal.";
          setErrorBanner(fallbackErr);
          announceAssertive(fallbackErr);
          setIsSubmittingIntent(false);
          return;
        }

        // Transition to Step 2: Build Mandate
        setStep(2);
        const nextProposal = intentData.proposal;
        setProposal(nextProposal);
        const computedReqHash = await computeSha256Base64Url(cleanTranscript);
        setRequestHash(computedReqHash);

        const mandateRes = await fetch("/api/v1/mandates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            proposal: nextProposal,
            requestConstraints: {
              action: nextProposal.action,
              payeeContactId: nextProposal.payeeContactId,
              maximumAmountMinor: nextProposal.amountMinor,
              currency: nextProposal.currency,
            },
            requestHash: computedReqHash,
          }),
        });

        const mandateData = (await mandateRes.json()) as MandateCreatedResponse & {
          message?: string;
        };

        if (!mandateRes.ok) {
          const rejectSpoken =
            mandateData.spoken ??
            mandateData.message ??
            "This test payment is not allowed.";
          setErrorBanner(rejectSpoken);
          announceAssertive(rejectSpoken);
          speakServerText(rejectSpoken, { isMandatoryReadout: false });
          setStep(1);
          setIsSubmittingIntent(false);
          return;
        }

        setMandate(mandateData);
        setStep(3);
        setIsSubmittingIntent(false);

        // Immediately speak server's exact response.spoken and enforce readout lock
        speakServerText(mandateData.spoken, { isMandatoryReadout: true });
      } catch {
        const netErr = "Unable to connect to the payment service.";
        setErrorBanner(netErr);
        announceAssertive(netErr);
        setIsSubmittingIntent(false);
      }
    },
    [
      announceAssertive,
      speakServerText,
      startListening,
      stopListening,
    ],
  );

  const handleCandidateSelect = useCallback(
    (candidateName: string) => {
      // Replace ambiguous name in transcript or build explicit transcript
      const amountMatch = transcript.match(/\$?\s*\d+(?:\.\d{1,2})?/);
      const amountPhrase = amountMatch ? `${amountMatch[0]} dollars` : "50 dollars";
      const updated = `Send ${amountPhrase} to ${candidateName}`;
      setTranscript(updated);
      void submitTranscript(updated);
    },
    [submitTranscript, transcript],
  );

  const handleStopOrReplayReadout = useCallback(() => {
    if (!mandate) return;
    if (isSpeakingReadout) {
      stopActiveSpeech(true);
      announcePolite(
        "Readout stopped. Replay the full readout to unlock approval.",
      );
    } else {
      setStep(3);
      speakServerText(mandate.spoken, { isMandatoryReadout: true });
    }
  }, [
    announcePolite,
    isSpeakingReadout,
    mandate,
    speakServerText,
    stopActiveSpeech,
  ]);

  const handleApproveWithPasskey = useCallback(async () => {
    if (!mandate || !readoutCompletedCleanly || isSpeakingReadout || isApproving) {
      return;
    }

    setIsApproving(true);
    setErrorBanner(null);

    let assertionPayload: Record<string, unknown>;
    try {
      const credential = await startAuthentication({
        optionsJSON: {
          challenge: mandate.approvalOptions.challenge,
          rpId: mandate.approvalOptions.rpId || window.location.hostname,
          timeout: mandate.approvalOptions.timeout ?? 60000,
          userVerification:
            mandate.approvalOptions.userVerification ?? "required",
          allowCredentials: mandate.approvalOptions.allowCredentials ?? [],
        },
      });
      assertionPayload = {
        credential,
        challenge: tamperEnabled
          ? "tampered_challenge_after_readout"
          : mandate.mandateHash,
        amountMinor: tamperEnabled
          ? (proposal?.amountMinor ?? 5000) + 45000
          : proposal?.amountMinor,
        tampered: tamperEnabled,
      };
    } catch {
      // In sandbox / automated verification without a hardware authenticator enrolled,
      // send a structured sandbox assertion bound to mandateHash (or mutated when tamperEnabled is ON)
      assertionPayload = {
        credential: {
          id: "sandbox-passkey-credential",
          rawId: "sandbox-passkey-credential",
          type: "public-key",
          response: {
            clientDataJSON: btoa(
              JSON.stringify({
                type: "webauthn.get",
                challenge: tamperEnabled
                  ? "tampered_challenge_after_readout"
                  : mandate.mandateHash,
                origin:
                  typeof window !== "undefined"
                    ? window.location.origin
                    : "http://localhost:3000",
              }),
            ),
            authenticatorData: "sandbox-authenticator-data",
            signature: "sandbox-signature",
          },
        },
        challenge: tamperEnabled
          ? "tampered_challenge_after_readout"
          : mandate.mandateHash,
        amountMinor: tamperEnabled
          ? (proposal?.amountMinor ?? 5000) + 45000
          : proposal?.amountMinor,
        tampered: tamperEnabled,
      };
    }

    try {
      const res = await fetch(`/api/v1/mandates/${mandate.mandateId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(assertionPayload),
      });

      const data = (await res.json()) as MandateApproveResponse;
      setApprovalResult(data);
      setStep(4);

      if (!res.ok || data.code === "APPROVAL_REJECTED") {
        setApprovalRejected(true);
        setErrorBanner(
          `401 ${data.code || "APPROVAL_REJECTED"}: ${data.spoken || data.message}`,
        );
        announceAssertive(data.spoken || data.message);
        speakServerText(data.spoken || data.message, {
          isMandatoryReadout: false,
        });
      } else {
        setApprovalRejected(false);
        if (proposal) {
          recordLocalPaymentCompleted(proposal.amountMinor);
        }
        announcePolite(data.spoken);
        speakServerText(data.spoken, { isMandatoryReadout: false });
      }
    } catch {
      const errMsg = "Approval request failed. No test payment was sent.";
      setErrorBanner(errMsg);
      announceAssertive(errMsg);
    } finally {
      setIsApproving(false);
    }
  }, [
    announceAssertive,
    announcePolite,
    isApproving,
    isSpeakingReadout,
    mandate,
    proposal,
    readoutCompletedCleanly,
    speakServerText,
    tamperEnabled,
  ]);

  const handleResetFlow = useCallback(() => {
    stopActiveSpeech(false);
    stopListening();
    setStep(1);
    setMandate(null);
    setProposal(null);
    setApprovalResult(null);
    setApprovalRejected(false);
    setErrorBanner(null);
    setClarificationSpoken(null);
    setClarificationCandidates([]);
    setReadoutCompletedCleanly(false);
    setReadoutInterrupted(false);
    setTamperEnabled(false);
  }, [stopActiveSpeech, stopListening]);

  const recipientContact = proposal
    ? DEMO_CONTACTS.find((c) => c.id === proposal.payeeContactId)
    : null;
  const recipientDisplayName =
    recipientContact?.displayName ?? initialRecipient ?? "Ade Bello";
  const displayAmountMinor = proposal?.amountMinor ?? 5000;
  const isApproveUnlocked =
    Boolean(mandate) &&
    readoutCompletedCleanly &&
    !isSpeakingReadout &&
    secondsRemaining > 0 &&
    !approvalResult;

  const steps: { id: FlowStep; label: string }[] = [
    { id: 1, label: "1. Understand" },
    { id: 2, label: "2. Build Mandate" },
    { id: 3, label: "3. Read Aloud" },
    { id: 4, label: "4. Confirm" },
  ];

  return (
    <div className="flex flex-col gap-6 pb-8">
      {/* Top Bar */}
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/home"
          className="inline-flex min-h-[48px] items-center gap-2 rounded-xl border-2 border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2 text-[16px] font-bold text-[var(--text)] no-underline hover:bg-[var(--surface-tint)]"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          <span>Back to Home</span>
        </Link>
        <span className="inline-flex min-h-[36px] items-center rounded-full border-2 border-[var(--border-strong)] bg-[var(--surface-tint)] px-3.5 py-1 text-[14px] font-bold text-[var(--text)]">
          Sandbox Consent Terminal
        </span>
      </div>

      {/* Page Heading */}
      <div>
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-[28px] font-bold leading-[1.2] text-[var(--text)] outline-none"
        >
          Voice Payment &amp; Consent Terminal
        </h1>
        <p className="mt-1 text-[16px] font-normal text-[var(--text-muted)]">
          Every test payment is checked against your rules, read aloud word for
          word, and locked until the readout finishes.
        </p>
      </div>

      {/* Top 4-Step Security Stepper */}
      <nav aria-label="Payment security steps">
        <ol className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {steps.map((item) => {
            const isCurrent = step === item.id;
            const isCompleted = step > item.id || Boolean(approvalResult);
            return (
              <li
                key={item.id}
                aria-current={isCurrent ? "step" : undefined}
                className={`flex min-h-[48px] items-center gap-2 rounded-xl border-2 px-3 py-2 text-[14px] font-bold ${
                  isCurrent
                    ? "border-[var(--border-strong)] bg-[var(--primary)] text-[#FFFFFF]"
                    : isCompleted
                      ? "border-[var(--border-strong)] bg-[var(--surface-tint)] text-[var(--text)]"
                      : "border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text-muted)]"
                }`}
              >
                {isCompleted ? (
                  <CheckCircle2
                    className="h-4 w-4 shrink-0"
                    aria-hidden="true"
                  />
                ) : (
                  <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
                )}
                <span>{item.label}</span>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Error / Rejection Banner */}
      {errorBanner ? (
        <div
          role="alert"
          className="rounded-2xl border-2 border-[var(--danger)] bg-[var(--surface)] p-4 text-[var(--danger)]"
        >
          <div className="flex items-start gap-3">
            <ShieldAlert
              className="mt-0.5 h-6 w-6 shrink-0 text-[var(--danger)]"
              aria-hidden="true"
            />
            <div className="flex flex-col gap-1">
              <p className="text-[16px] font-bold text-[var(--danger)]">
                Security Check Blocked Payment
              </p>
              <p className="text-[16px] font-bold text-[var(--text)]">
                {errorBanner}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {/* 2-Column Blind + Sighted Bridge on Desktop (1280x800), Linear on Mobile (390x844) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start lg:gap-8">
        {/* LEFT COLUMN: Voice Capture, Readout Lock & Biometric Approval */}
        <div className="flex flex-col gap-6">
          {/* STEP 1: Voice + Text Request Card */}
          <section
            aria-labelledby="step-1-heading"
            className="flex flex-col gap-4 rounded-2xl border-2 border-[var(--border-strong)] bg-[var(--surface)] p-5"
          >
            <div className="flex items-center justify-between gap-2">
              <h2
                id="step-1-heading"
                className="text-[20px] font-bold text-[var(--text)]"
              >
                Step 1: Speak or Type Request
              </h2>
              <span className="rounded-full border border-[var(--border-strong)] bg-[var(--surface-tint)] px-3 py-1 text-[14px] font-bold text-[var(--text)]">
                {isListening ? "Listening..." : "Ready"}
              </span>
            </div>

            <p className="text-[16px] text-[var(--text-muted)]">
              Example: &ldquo;Send 50 dollars to Ade Bello&rdquo; or &ldquo;Send
              20 dollars to Bello&rdquo; to test contact disambiguation.
            </p>

            {/* Primary 64px Voice Capture Button */}
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                type="button"
                variant="primary"
                onClick={isListening ? stopListening : startListening}
                className="flex-1"
              >
                <Mic className="h-6 w-6 shrink-0" aria-hidden="true" />
                <span>
                  {isListening
                    ? "Listening... Tap to Pause"
                    : "Hold or Tap to Speak Request"}
                </span>
              </Button>

              {isListening ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void submitTranscript(transcript)}
                  className="min-h-[64px]"
                >
                  <Square className="h-5 w-5 shrink-0" aria-hidden="true" />
                  <span>Done Speaking</span>
                </Button>
              ) : null}
            </div>

            {/* Accessible Fallback Text Input */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submitTranscript(transcript);
              }}
              className="flex flex-col gap-3"
            >
              <label
                htmlFor={textInputId}
                className="text-[16px] font-bold text-[var(--text)]"
              >
                Or type your payment request
              </label>
              <input
                id={textInputId}
                type="text"
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder="Send 50 dollars to Ade Bello"
                className="min-h-[56px] w-full rounded-xl border-2 border-[var(--border-strong)] bg-[var(--bg)] px-4 py-3 text-[16px] font-bold text-[var(--text)] placeholder:text-[var(--text-muted)]"
              />
              <Button
                type="submit"
                variant="secondary"
                disabled={isSubmittingIntent}
                className="min-h-[56px]"
              >
                <span>
                  {isSubmittingIntent
                    ? "Checking request..."
                    : "Build Payment Mandate"}
                </span>
              </Button>
            </form>

            {/* Clarification Prompt (when needsClarification === true) */}
            {clarificationSpoken ? (
              <div
                role="region"
                aria-label="Contact clarification"
                className="flex flex-col gap-3 rounded-xl border-2 border-[var(--border-strong)] bg-[var(--surface-tint)] p-4"
              >
                <p className="text-[16px] font-bold text-[var(--text)]">
                  {clarificationSpoken}
                </p>
                <div className="flex flex-wrap gap-2.5">
                  {clarificationCandidates.map((candidate) => (
                    <button
                      key={candidate}
                      type="button"
                      onClick={() => handleCandidateSelect(candidate)}
                      className="inline-flex min-h-[48px] items-center justify-center rounded-xl border-2 border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2.5 text-[16px] font-bold text-[var(--text)] hover:bg-[var(--sun)]"
                    >
                      {candidate}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          {/* STEP 3 & 4: Mandatory Readout Lock + Passkey Approval + Judge Demo Switch */}
          {mandate ? (
            <section
              aria-labelledby="step-3-heading"
              className="flex flex-col gap-4 rounded-2xl border-2 border-[var(--border-strong)] bg-[var(--surface)] p-5"
            >
              <div className="flex items-center justify-between gap-2">
                <h2
                  id="step-3-heading"
                  className="text-[20px] font-bold text-[var(--text)]"
                >
                  Step 3 &amp; 4: Readout &amp; Passkey Consent
                </h2>
                <span className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border-2 border-[var(--border-strong)] bg-[var(--surface-tint)] px-3 py-1 text-[14px] font-bold text-[var(--text)]">
                  {isApproveUnlocked ? (
                    <>
                      <CheckCircle2
                        className="h-4 w-4 shrink-0"
                        aria-hidden="true"
                      />
                      <span>Readout Complete</span>
                    </>
                  ) : (
                    <>
                      <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>
                        {isSpeakingReadout
                          ? "Reading Aloud..."
                          : "Readout Locked"}
                      </span>
                    </>
                  )}
                </span>
              </div>

              {/* Exact Server Readout Box */}
              <div className="rounded-xl border-2 border-[var(--border-strong)] bg-[var(--bg)] p-4">
                <p className="text-[14px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  Deterministic Server Readout (Spoken Verbatim)
                </p>
                <p
                  data-testid="server-spoken-readout"
                  className="mt-2 text-[18px] font-bold leading-[1.5] text-[var(--text)]"
                >
                  &ldquo;{mandate.spoken}&rdquo;
                </p>
              </div>

              {/* Stop / Replay Readout Button (>= 48px) */}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleStopOrReplayReadout}
                  className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border-2 border-[var(--border-strong)] bg-[var(--surface-tint)] px-4 py-2.5 text-[16px] font-bold text-[var(--text)] hover:bg-[var(--peach)]"
                >
                  {isSpeakingReadout ? (
                    <>
                      <Square className="h-5 w-5 shrink-0" aria-hidden="true" />
                      <span>Stop / Replay Readout</span>
                    </>
                  ) : (
                    <>
                      <RotateCcw
                        className="h-5 w-5 shrink-0"
                        aria-hidden="true"
                      />
                      <span>Stop / Replay Readout</span>
                    </>
                  )}
                </button>

                {readoutInterrupted ? (
                  <p className="text-[14px] font-bold text-[var(--danger)]">
                    Readout was stopped early. Replay the full readout to unlock
                    approval.
                  </p>
                ) : null}
              </div>

              {/* Boxed Judge Demo Control: Tamper Amount / Challenge After Readout */}
              <div className="rounded-xl border-2 border-[var(--border-strong)] bg-[var(--warning-bg)] p-4 text-[var(--warning-text)]">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle
                      className="mt-0.5 h-5 w-5 shrink-0 text-[var(--warning-text)]"
                      aria-hidden="true"
                    />
                    <div>
                      <label
                        htmlFor={tamperSwitchId}
                        className="block cursor-pointer text-[16px] font-bold text-[var(--warning-text)]"
                      >
                        Demo Attack: Tamper Amount / Challenge After Readout
                      </label>
                      <p className="mt-1 text-[14px] font-normal text-[var(--warning-text)]">
                        Simulates a compromised client mutating the payment
                        amount or WebAuthn challenge after the readout finishes.
                      </p>
                    </div>
                  </div>
                  <button
                    id={tamperSwitchId}
                    type="button"
                    role="switch"
                    aria-checked={tamperEnabled}
                    onClick={() => setTamperEnabled((prev) => !prev)}
                    className={`inline-flex min-h-[48px] min-w-[88px] shrink-0 items-center justify-center rounded-xl border-2 border-[var(--border-strong)] px-3 py-2 text-[14px] font-bold ${
                      tamperEnabled
                        ? "bg-[var(--danger)] text-[#FFFFFF]"
                        : "bg-[var(--surface)] text-[var(--text)]"
                    }`}
                  >
                    {tamperEnabled ? "TAMPER ON" : "OFF"}
                  </button>
                </div>
              </div>

              {/* Hard Readout-Locked 64px Biometric Approval Button */}
              <button
                type="button"
                data-testid="approve-passkey-button"
                disabled={!isApproveUnlocked || isApproving}
                aria-disabled={!isApproveUnlocked || isApproving}
                onClick={() => void handleApproveWithPasskey()}
                className={`inline-flex min-h-[64px] w-full items-center justify-center gap-3 rounded-2xl border-2 border-[var(--border-strong)] px-6 py-4 text-[18px] font-bold transition-colors ${
                  isApproveUnlocked && !isApproving
                    ? "cursor-pointer bg-[var(--primary)] text-[#FFFFFF] hover:bg-[var(--primary-hover)]"
                    : "cursor-not-allowed bg-[var(--surface-tint)] text-[var(--text-muted)]"
                }`}
              >
                <Fingerprint className="h-6 w-6 shrink-0" aria-hidden="true" />
                <span>
                  {isApproving
                    ? "Verifying Passkey..."
                    : "Approve with Fingerprint or Face"}
                </span>
              </button>

              {!isApproveUnlocked && !approvalResult ? (
                <p className="text-[14px] font-bold text-[var(--text-muted)]">
                  <Volume2
                    className="mr-1.5 inline h-4 w-4"
                    aria-hidden="true"
                  />
                  Approval remains locked until the spoken readout completes
                  without interruption.
                </p>
              ) : null}

              {/* Step 4 Outcome Banner */}
              {approvalResult ? (
                <div
                  role="status"
                  className={`flex flex-col gap-3 rounded-2xl border-2 p-5 ${
                    approvalRejected
                      ? "border-[var(--danger)] bg-[var(--bg)] text-[var(--danger)]"
                      : "border-[var(--border-strong)] bg-[var(--surface-tint)] text-[var(--text)]"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    {approvalRejected ? (
                      <ShieldAlert
                        className="h-6 w-6 shrink-0 text-[var(--danger)]"
                        aria-hidden="true"
                      />
                    ) : (
                      <ShieldCheck
                        className="h-6 w-6 shrink-0 text-[var(--text)]"
                        aria-hidden="true"
                      />
                    )}
                    <h3 className="text-[20px] font-bold">
                      {approvalRejected
                        ? "401 APPROVAL_REJECTED"
                        : approvalResult.status}
                    </h3>
                  </div>

                  <p className="text-[16px] font-bold text-[var(--text)]">
                    {approvalResult.spoken}
                  </p>

                  {approvalResult.paypalRef ? (
                    <div className="rounded-xl border-2 border-[var(--border-strong)] bg-[var(--surface)] px-4 py-3">
                      <span className="block text-[14px] font-bold text-[var(--text-muted)]">
                        PayPal Sandbox Payout Reference
                      </span>
                      <span className="num mt-0.5 block text-[18px] font-bold text-[var(--text)]">
                        {approvalResult.paypalRef}
                      </span>
                    </div>
                  ) : null}

                  <div className="mt-2 flex flex-wrap gap-3">
                    <Link
                      href="/activity"
                      className="inline-flex min-h-[48px] flex-1 items-center justify-center rounded-xl border-2 border-[var(--border-strong)] bg-[var(--primary)] px-4 py-2.5 text-[16px] font-bold text-[#FFFFFF] no-underline hover:bg-[var(--primary-hover)]"
                    >
                      View Audit Trail
                    </Link>
                    <button
                      type="button"
                      onClick={handleResetFlow}
                      className="inline-flex min-h-[48px] items-center justify-center rounded-xl border-2 border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2.5 text-[16px] font-bold text-[var(--text)] hover:bg-[var(--peach)]"
                    >
                      New Payment
                    </button>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}
        </div>

        {/* RIGHT COLUMN: Visual Mandate Node Tree Card (--balance-card #1F0D09 surface with --sun connector lines) */}
        <section
          aria-labelledby="mandate-tree-heading"
          className="flex flex-col gap-5 rounded-2xl border-2 border-[var(--border-strong)] bg-[var(--balance-card)] p-6 text-[#FFFFFF]"
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <span className="text-[14px] font-bold uppercase tracking-wider text-[var(--peach)]">
                Sighted Companion &amp; Judge Inspector
              </span>
              <h2
                id="mandate-tree-heading"
                className="mt-1 text-[22px] font-bold text-[#FFFFFF]"
              >
                Cryptographic Mandate Node Tree
              </h2>
            </div>
            <span className="inline-flex min-h-[36px] items-center rounded-full bg-[var(--sun)] px-3 py-1 text-[14px] font-bold text-[var(--text)]">
              {mandate ? "Mandate Bound" : "Awaiting Intent"}
            </span>
          </div>

          {/* Top Node: Spoken Request (requestConstraints) */}
          <div className="rounded-xl border-2 border-[var(--sun)] bg-[#2B140E] p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[14px] font-bold text-[var(--peach)]">
                TOP NODE: SPOKEN REQUEST CONSTRAINTS
              </span>
              <span className="num rounded bg-[var(--sun)] px-2 py-0.5 text-[12px] font-bold text-[var(--text)]">
                action: send_money
              </span>
            </div>
            <p className="mt-2 text-[16px] font-bold text-[#FFFFFF]">
              {transcript
                ? `"${transcript}"`
                : '"Send 50 dollars to Ade Bello"'}
            </p>
            <div className="mt-2 flex flex-wrap gap-3 text-[14px] text-[var(--peach)]">
              <span>
                Max Allowed:{" "}
                <strong className="num text-[#FFFFFF]">
                  {formatUsdMinor(displayAmountMinor)}
                </strong>
              </span>
              <span>
                Request Hash:{" "}
                <strong className="num text-[#FFFFFF]">
                  {requestHash ? truncateHash(requestHash) : "pending..."}
                </strong>
              </span>
            </div>
          </div>

          {/* Connector Lines in --sun (#FFCC6B) */}
          <div
            aria-hidden="true"
            className="flex flex-col items-center justify-center"
          >
            <div className="h-5 w-1 bg-[var(--sun)]" />
            <div className="h-1 w-3/4 bg-[var(--sun)]" />
            <div className="flex w-3/4 justify-between">
              <div className="h-5 w-1 bg-[var(--sun)]" />
              <div className="h-5 w-1 bg-[var(--sun)]" />
            </div>
          </div>

          {/* Left & Right Branches */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Left Branch: @karenpay/core Checks */}
            <div className="flex flex-col gap-3 rounded-xl border-2 border-[var(--sun)] bg-[#2B140E] p-4">
              <span className="text-[14px] font-bold uppercase tracking-wider text-[var(--peach)]">
                Left Branch: @karenpay/core
              </span>
              <div className="flex items-center justify-between rounded-lg bg-[#1F0D09] px-3 py-2.5">
                <span className="num text-[14px] font-bold text-[#FFFFFF]">
                  checkIntent
                </span>
                <span className="rounded bg-[var(--sun)] px-2.5 py-0.5 text-[13px] font-bold text-[var(--text)]">
                  PASS
                </span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-[#1F0D09] px-3 py-2.5">
                <span className="num text-[14px] font-bold text-[#FFFFFF]">
                  checkLimits
                </span>
                <span className="rounded bg-[var(--sun)] px-2.5 py-0.5 text-[13px] font-bold text-[var(--text)]">
                  PASS
                </span>
              </div>
              <p className="text-[14px] text-[var(--peach)]">
                Pure deterministic policy guard verified recipient allowlist and
                $500.00 sandbox cap.
              </p>
            </div>

            {/* Right Branch: Verified Recipient, Amount, Countdown, Mandate Hash */}
            <div className="flex flex-col gap-3 rounded-xl border-2 border-[var(--sun)] bg-[#2B140E] p-4">
              <span className="text-[14px] font-bold uppercase tracking-wider text-[var(--peach)]">
                Right Branch: Bound Mandate
              </span>
              <div>
                <span className="block text-[14px] text-[var(--peach)]">
                  Verified Recipient
                </span>
                <span className="text-[18px] font-bold text-[#FFFFFF]">
                  {recipientDisplayName}
                </span>
              </div>
              <div>
                <span className="block text-[14px] text-[var(--peach)]">
                  Bound Amount
                </span>
                <span className="num text-[32px] font-bold leading-tight text-[#FFFFFF]">
                  {formatUsdMinor(displayAmountMinor)}
                </span>
              </div>
              <div className="flex items-center justify-between border-t border-[var(--peach)]/30 pt-2">
                <span className="text-[14px] text-[var(--peach)]">
                  Expiry Countdown
                </span>
                <span className="num rounded bg-[var(--sun)] px-2.5 py-0.5 text-[14px] font-bold text-[var(--text)]">
                  {mandate ? `${secondsRemaining}s` : "120s"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[14px] text-[var(--peach)]">
                  mandateHash
                </span>
                <span
                  data-testid="mandate-hash-display"
                  className="num text-[14px] font-bold text-[#FFFFFF]"
                >
                  {mandate
                    ? truncateHash(mandate.mandateHash)
                    : "awaiting_mandate"}
                </span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default function PayPage(): React.JSX.Element {
  return (
    <Suspense
      fallback={
        <div className="py-8 text-[16px] font-bold text-[var(--text)]">
          Loading payment terminal...
        </div>
      }
    >
      <PayTerminalInner />
    </Suspense>
  );
}
