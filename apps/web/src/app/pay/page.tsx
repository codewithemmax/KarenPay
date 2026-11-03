"use client";

import { startAuthentication } from "@simplewebauthn/browser";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Fingerprint,
  KeyRound,
  Lock,
  Mic,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Square,
  Volume2,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
import { useVoiceOnlyMode } from "../../components/VoiceModeToggle";
import { formatUsdMinor } from "../../lib/demoData";

type FlowStep = 1 | 2 | 3 | 4;

interface SavedContact {
  id: string;
  displayName: string;
  paypalSandboxEmail: string;
}

interface IntentProposal {
  action: "send_money";
  payeeContactId?: string;
  payeeName?: string;
  payeeAccountNumber?: string;
  amountMinor: number;
  currency: string;
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
  expiresAt?: string;
  approvalOptions: {
    challenge: string;
    rpId?: string;
    timeout?: number;
    userVerification?: "required" | "preferred" | "discouraged";
    allowCredentials?: { id: string; type: "public-key" }[];
  };
}

interface MandateApproveResponse {
  code: string;
  status?: string;
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialRecipient = searchParams.get("recipient") ?? "";
  const headingRef = useRef<HTMLHeadingElement>(null);
  const textInputId = useId();
  const tamperSwitchId = useId();
  const { announcePolite, announceAssertive } = useAnnounce();
  const [isVoiceOnlyMode, setVoiceOnlyMode] = useVoiceOnlyMode();

  const [contacts, setContacts] = useState<SavedContact[]>([]);
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
  const [approvalPin, setApprovalPin] = useState<string>("");
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
    void (async () => {
      try {
        const res = await fetch("/api/v1/contacts", {
          credentials: "include",
          cache: "no-store",
        });
        if (res.status === 401) {
          router.replace("/");
          return;
        }
        if (res.ok) {
          const data = (await res.json()) as { contacts?: SavedContact[] };
          if (Array.isArray(data.contacts)) {
            setContacts(data.contacts);
          }
        }
      } catch {
        // Ignore initial contact load failure
      }
    })();
  }, [router]);

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

      speechWatchdogRef.current = window.setTimeout(() => {
        if (!speechCancelledByUserRef.current) {
          finishCleanly();
        }
      }, 18000);
    },
    [announcePolite, clearSpeechTimers],
  );

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

    const fallbackExpiresMs = Date.now() + 120 * 1000;
    const expiresMs = mandate.expiresAt
      ? new Date(mandate.expiresAt).getTime()
      : fallbackExpiresMs;

    const updateTimer = () => {
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
      console.log(
        `[Single Pay UI] Submitting transcript to /api/v1/intent: "${cleanTranscript}"`,
      );

      try {
        const intentRes = await fetch("/api/v1/intent", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript: cleanTranscript }),
        });

        if (intentRes.status === 401) {
          console.warn("[Single Pay UI] Intent returned 401, redirecting to login");
          router.replace("/");
          return;
        }

        const intentData = (await intentRes.json()) as IntentResponse;

        if (!intentRes.ok) {
          console.error(
            `[Single Pay UI] Intent recognition failed (${intentRes.status}):`,
            intentData,
          );
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

        console.log(`[Single Pay UI] Intent recognized successfully:`, {
          needsClarification: intentData.needsClarification,
          proposal: intentData.proposal,
          candidatesCount: intentData.candidates?.length,
        });

        if (intentData.needsClarification) {
          const spokenPrompt =
            intentData.spoken ?? "Which contact did you mean?";
          setClarificationSpoken(spokenPrompt);
          setClarificationCandidates(intentData.candidates ?? []);
          setIsSubmittingIntent(false);
          speakServerText(spokenPrompt, {
            isMandatoryReadout: false,
            onCompleteCleanly: () => {
              startListening();
            },
          });
          return;
        }

        if (!intentData.proposal) {
          console.warn("[Single Pay UI] Intent missing proposal");
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

        const requestConstraints: Record<string, unknown> = {
          action: nextProposal.action,
          maximumAmountMinor: nextProposal.amountMinor,
          currency: nextProposal.currency,
        };
        if (nextProposal.payeeContactId) {
          requestConstraints.payeeContactId = nextProposal.payeeContactId;
        }
        if (nextProposal.payeeName) {
          requestConstraints.payeeName = nextProposal.payeeName;
        }
        if (nextProposal.payeeAccountNumber) {
          requestConstraints.payeeAccountNumber =
            nextProposal.payeeAccountNumber;
        }

        console.log(`[Single Pay UI] Requesting mandate creation from /api/v1/mandates...`, {
          proposal: nextProposal,
          requestHash: computedReqHash,
        });

        const mandateRes = await fetch("/api/v1/mandates", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            proposal: nextProposal,
            requestConstraints,
            requestHash: computedReqHash,
          }),
        });

        if (mandateRes.status === 401) {
          console.warn("[Single Pay UI] Mandate creation returned 401, redirecting to login");
          router.replace("/");
          return;
        }

        const mandateData = (await mandateRes.json()) as MandateCreatedResponse & {
          message?: string;
        };

        if (!mandateRes.ok) {
          console.error(
            `[Single Pay UI] Mandate creation rejected (${mandateRes.status}):`,
            mandateData,
          );
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

        console.log(`[Single Pay UI] Mandate created successfully:`, {
          mandateId: mandateData.mandateId,
          hash: mandateData.mandateHash,
          expiresAt: mandateData.expiresAt,
        });

        setMandate(mandateData);
        setStep(3);
        setIsSubmittingIntent(false);

        // Immediately speak server's exact response.spoken and enforce readout lock
        speakServerText(mandateData.spoken, { isMandatoryReadout: true });
      } catch (err) {
        console.error("[Single Pay UI] Network or processing error during transfer creation:", err);
        const netErr = "Unable to connect to the payment service.";
        setErrorBanner(netErr);
        announceAssertive(netErr);
        setIsSubmittingIntent(false);
      }
    },
    [
      announceAssertive,
      router,
      speakServerText,
      startListening,
      stopListening,
    ],
  );

  const handleCandidateSelect = useCallback(
    (candidateName: string) => {
      const amountMatch = transcript.match(/\$?\s*\d+(?:\.\d{1,2})?/);
      const amountPhrase = amountMatch
        ? `${amountMatch[0]} dollars`
        : "50 dollars";
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
    if (
      !mandate ||
      !readoutCompletedCleanly ||
      isSpeakingReadout ||
      isApproving
    ) {
      return;
    }

    setIsApproving(true);
    setErrorBanner(null);

    try {
      console.log(
        `[Single Pay UI] Starting WebAuthn passkey authentication for mandate ${mandate.mandateId}...`,
        {
          rpId: mandate.approvalOptions.rpId || window.location.hostname,
          challenge: mandate.approvalOptions.challenge,
          allowCredentialsCount:
            mandate.approvalOptions.allowCredentials?.length ?? 0,
        },
      );
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

      console.log(
        `[Single Pay UI] Passkey signature acquired (${credential.id}), sending approval...`,
      );

      const assertionBody: Record<string, unknown> = {
        ...credential,
      };

      // If the Judge Demo Tamper Switch is enabled, mutate the signed WebAuthn clientDataJSON
      // challenge after readout so the backend's cryptographic verification rejects it with 401.
      if (tamperEnabled && credential.response?.clientDataJSON) {
        console.warn(
          "[Single Pay UI] Tamper switch is ACTIVE: mutating clientDataJSON challenge",
        );
        const tamperedClientData = btoa(
          JSON.stringify({
            type: "webauthn.get",
            challenge: "tampered_challenge_after_readout",
            origin: window.location.origin,
          }),
        )
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/g, "");
        assertionBody.response = {
          ...credential.response,
          clientDataJSON: tamperedClientData,
        };
      }

      console.log(
        `[Single Pay UI] Submitting passkey approval to /api/v1/mandates/${mandate.mandateId}/approve...`,
      );
      const res = await fetch(`/api/v1/mandates/${mandate.mandateId}/approve`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(assertionBody),
      });

      const data = (await res.json()) as MandateApproveResponse;
      console.log(
        `[Single Pay UI] Approval response status=${res.status}:`,
        data,
      );
      setApprovalResult(data);
      setStep(4);

      if (!res.ok || data.code === "APPROVAL_REJECTED") {
        console.warn(
          `[Single Pay UI] Approval rejected/failed: code=${data.code}, message=${data.message}`,
        );
        setApprovalRejected(true);
        setErrorBanner(
          `401 ${data.code || "APPROVAL_REJECTED"}: ${data.spoken || data.message}`,
        );
        announceAssertive(data.spoken || data.message);
        speakServerText(data.spoken || data.message, {
          isMandatoryReadout: false,
        });
      } else {
        console.log(
          `[Single Pay UI] Approval succeeded (PAID): paypalRef=${data.paypalRef}`,
        );
        setApprovalRejected(false);
        announcePolite(data.spoken);
        speakServerText(data.spoken, { isMandatoryReadout: false });
      }
    } catch (err) {
      console.error(
        `[Single Pay UI] Passkey authentication or approval exception:`,
        err,
      );
      const errMsg =
        "Passkey verification was cancelled or failed. You can also approve with your 6-digit PIN below.";
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
    readoutCompletedCleanly,
    speakServerText,
    tamperEnabled,
  ]);

  const handleApproveWithPin = useCallback(async () => {
    if (
      !mandate ||
      !readoutCompletedCleanly ||
      isSpeakingReadout ||
      isApproving
    ) {
      return;
    }

    const cleanPin = approvalPin.trim();
    if (!/^\d{6}$/.test(cleanPin)) {
      const msg = "Please enter your 6-digit security PIN to approve.";
      setErrorBanner(msg);
      announceAssertive(msg);
      return;
    }

    setIsApproving(true);
    setErrorBanner(null);

    try {
      const challengeToSend = tamperEnabled
        ? "tampered_challenge_after_readout"
        : mandate.mandateHash;

      console.log(
        `[Single Pay UI] Submitting PIN fallback approval for mandate ${mandate.mandateId}...`,
        { tampered: tamperEnabled, challenge: challengeToSend },
      );

      const res = await fetch(`/api/v1/mandates/${mandate.mandateId}/approve`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fallbackMethod: "pin",
          pin: cleanPin,
          challenge: challengeToSend,
        }),
      });

      const data = (await res.json()) as MandateApproveResponse;
      console.log(
        `[Single Pay UI] PIN approval response status=${res.status}:`,
        data,
      );
      setApprovalResult(data);
      setStep(4);

      if (!res.ok || data.code === "APPROVAL_REJECTED") {
        console.warn(
          `[Single Pay UI] PIN approval rejected: code=${data.code}, message=${data.message}`,
        );
        setApprovalRejected(true);
        setErrorBanner(
          `401 ${data.code || "APPROVAL_REJECTED"}: ${data.spoken || data.message}`,
        );
        announceAssertive(data.spoken || data.message);
        speakServerText(data.spoken || data.message, {
          isMandatoryReadout: false,
        });
      } else {
        console.log(
          `[Single Pay UI] PIN approval succeeded: paypalRef=${data.paypalRef}`,
        );
        setApprovalRejected(false);
        announcePolite(data.spoken);
        speakServerText(data.spoken, { isMandatoryReadout: false });
      }
    } catch (err) {
      console.error(
        `[Single Pay UI] PIN approval exception:`,
        err,
      );
      const errMsg =
        "Could not verify your 6-digit PIN. No test payment was sent.";
      setErrorBanner(errMsg);
      announceAssertive(errMsg);
    } finally {
      setIsApproving(false);
    }
  }, [
    announceAssertive,
    announcePolite,
    approvalPin,
    isApproving,
    isSpeakingReadout,
    mandate,
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
    setApprovalPin("");
    setApprovalResult(null);
    setApprovalRejected(false);
    setErrorBanner(null);
    setClarificationSpoken(null);
    setClarificationCandidates([]);
    setReadoutCompletedCleanly(false);
    setReadoutInterrupted(false);
    setTamperEnabled(false);
  }, [stopActiveSpeech, stopListening]);

  const recipientContact = proposal?.payeeContactId
    ? contacts.find((c) => c.id === proposal.payeeContactId)
    : null;
  const recipientDisplayName =
    recipientContact?.displayName ??
    proposal?.payeeName ??
    (initialRecipient || "Not selected yet");
  const displayAmountMinor = proposal?.amountMinor ?? 0;
  const isApproveUnlocked =
    Boolean(mandate) &&
    readoutCompletedCleanly &&
    !isSpeakingReadout &&
    secondsRemaining > 0 &&
    !approvalResult;

  const steps: { id: FlowStep; label: string }[] = [
    { id: 1, label: "1. Understand" },
    { id: 2, label: "2. Review details" },
    { id: 3, label: "3. Read aloud" },
    { id: 4, label: "4. Confirm" },
  ];

  return (
    <div className={`flex flex-col gap-7 pb-8 pt-7 ${isVoiceOnlyMode ? "voice-only-payment" : ""}`}>
      {/* Top Bar */}
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/home"
          className="inline-flex min-h-[48px] items-center gap-2 rounded-full bg-[var(--surface-tint)] px-4 py-2 text-[16px] font-bold text-[var(--text)] no-underline hover:bg-[var(--peach)]"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          <span>Back to Home</span>
        </Link>
        <button
          type="button"
          onClick={() => setVoiceOnlyMode(!isVoiceOnlyMode)}
          className="inline-flex min-h-[36px] items-center rounded-full bg-[var(--surface-tint)] px-3.5 py-1 text-[14px] font-bold text-[var(--text)] hover:bg-[var(--peach)]"
        >
          {isVoiceOnlyMode ? "Exit voice-only mode" : "Voice-only mode"}
        </button>
      </div>

      <h1 ref={headingRef} tabIndex={-1} className="sr-only">
        Voice payment and consent
      </h1>

      {/* Top 4-Step Security Stepper */}
      <nav aria-label="Payment security steps" className={isVoiceOnlyMode ? "sr-only" : undefined}>
        <ol className="grid grid-cols-4 gap-2">
          {steps.map((item) => {
            const isCurrent = step === item.id;
            const isCompleted = step > item.id || Boolean(approvalResult);
            return (
              <li
                key={item.id}
                aria-current={isCurrent ? "step" : undefined}
                className="flex min-w-0 flex-col items-center gap-1.5 text-center text-[12px] font-bold text-[var(--text)] sm:text-[14px]"
              >
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-full ${
                    isCurrent
                      ? "bg-[var(--primary)] text-white"
                      : isCompleted
                        ? "bg-[var(--surface-tint)] text-[var(--text)]"
                        : "border border-[var(--divider)] bg-[var(--surface)] text-[var(--text)]"
                  }`}
                >
                  {isCompleted ? (
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <span>{item.id}</span>
                  )}
                </span>
                <span>{item.label.replace(/^\d+\.\s*/, "")}</span>
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
      <div className={isVoiceOnlyMode ? "block" : "grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start lg:gap-8"}>
        {/* LEFT COLUMN: Voice Capture, Readout Lock & Biometric Approval */}
        <div className={isVoiceOnlyMode ? "mx-auto flex max-w-[560px] flex-col gap-6" : "flex flex-col gap-6"}>
          {/* STEP 1: Voice + Text Request Card */}
          <section
            aria-labelledby="step-1-heading"
            className={`flex flex-col gap-5 rounded-card border border-[var(--divider)] bg-[var(--surface)] p-7 ${
              isVoiceOnlyMode ? "min-h-[420px] justify-center text-center" : ""
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <h2
                id="step-1-heading"
                className="sr-only"
              >
                Step 1: Speak or Type Request
              </h2>
              <span
                role="status"
                aria-live="polite"
                className="inline-flex min-h-[36px] items-center rounded-full border border-[var(--border-strong)] bg-[var(--surface-tint)] px-4 py-1 text-[15px] font-bold text-[var(--text)]"
              >
                {isListening ? "Listening…" : "Ready to listen"}
              </span>
            </div>

            <p className="sr-only">
              Speak a saved contact name (or recipient name and account number
              digits), the amount, and currency.
            </p>

            <div className="flex items-center justify-center gap-1.5" aria-hidden="true">
              {[10, 18, 28, 36, 28, 18, 10].map((height, index) => (
                <span
                  key={index}
                  className="w-1.5 rounded-full bg-[var(--surface-tint)]"
                  style={{ height }}
                />
              ))}
            </div>

            {/* Primary 64px Voice Capture Button */}
            <div className="flex flex-col gap-3">
              <Button
                type="button"
                variant="primary"
                onClick={isListening ? stopListening : startListening}
                className="min-h-[76px] px-5 text-[20px] shadow-none"
              >
                <Mic className="h-6 w-6 shrink-0" aria-hidden="true" />
                <span className="text-center leading-tight">
                  {isListening ? (
                    <>
                      <span className="block">Listening…</span>
                      <span className="mt-1 block text-[16px] font-semibold">
                        Tap to pause
                      </span>
                    </>
                  ) : (
                    "Hold or tap to speak"
                  )}
                </span>
              </Button>

              {isListening ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void submitTranscript(transcript)}
                  className="min-h-[56px] border border-[var(--divider)] bg-[var(--surface-tint)] px-5 text-[18px] shadow-none"
                >
                  <Square className="h-5 w-5 shrink-0" aria-hidden="true" />
                  <span>Finish speaking</span>
                </Button>
              ) : null}
            </div>

            {/* Accessible Fallback Text Input */}
            {!isVoiceOnlyMode ? <form
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
                placeholder="Send 50 dollars to your saved contact"
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
            </form> : null}

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
              className={`flex flex-col gap-4 rounded-2xl border-2 border-[var(--border-strong)] bg-[var(--surface)] p-5 ${
                isVoiceOnlyMode ? "text-center" : ""
              }`}
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
                <p className="flex items-center gap-2 text-[14px] font-bold text-[var(--text-muted)]">
                  <Volume2 className="h-4 w-4" aria-hidden="true" />
                  Reading payment details aloud
                </p>
                <p
                  data-testid="server-spoken-readout"
                  className="mt-3 rounded-input bg-[var(--surface-tint)] p-4 text-[18px] font-bold leading-[1.5] text-[var(--text)]"
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

              {/* Boxed demo control for the safety rejection flow */}
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
                        Demo safety check
                      </label>
                      <p className="mt-1 text-[14px] font-normal text-[var(--warning-text)]">
                        Shows that approval is rejected if the payment details
                        change after you hear the readout.
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
                    ? "Verifying..."
                    : "Approve with Fingerprint or Face"}
                </span>
              </button>

              {/* Hard Readout-Locked 6-Digit PIN Fallback Approval (for devices without biometrics) */}
              <div className="rounded-xl border-2 border-[var(--border-strong)] bg-[var(--bg)] p-4">
                <label
                  htmlFor="pay-approve-pin"
                  className="block text-[15px] font-bold text-[var(--text)]"
                >
                  No fingerprint or face sensor? Approve with your 6-digit PIN
                </label>
                <div className="mt-2.5 flex flex-col gap-2.5 sm:flex-row">
                  <input
                    id="pay-approve-pin"
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    disabled={!isApproveUnlocked || isApproving}
                    value={approvalPin}
                    onChange={(e) =>
                      setApprovalPin(
                        e.target.value.replace(/\D/g, "").slice(0, 6),
                      )
                    }
                    placeholder="6-digit PIN"
                    className="num min-h-[48px] flex-1 rounded-xl border-2 border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2.5 text-[18px] font-bold tracking-widest text-[var(--text)] placeholder:text-[var(--text-muted)] disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <button
                    type="button"
                    data-testid="approve-pin-button"
                    disabled={!isApproveUnlocked || isApproving}
                    aria-disabled={!isApproveUnlocked || isApproving}
                    onClick={() => void handleApproveWithPin()}
                    className={`inline-flex min-h-[48px] shrink-0 items-center justify-center gap-2 rounded-xl border-2 border-[var(--border-strong)] px-5 py-2.5 text-[16px] font-bold transition-colors ${
                      isApproveUnlocked && !isApproving
                        ? "cursor-pointer bg-[var(--surface-tint)] text-[var(--text)] hover:bg-[var(--peach)]"
                        : "cursor-not-allowed bg-[var(--surface-tint)] text-[var(--text-muted)] opacity-60"
                    }`}
                  >
                    <KeyRound className="h-5 w-5 shrink-0" aria-hidden="true" />
                    <span>Approve with PIN</span>
                  </button>
                </div>
              </div>

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
                        : (approvalResult.status ?? "Test payment sent")}
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
                      View activity
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

        {/* RIGHT COLUMN: Plain-English transfer summary for sighted companions */}
        <section
          aria-labelledby="transfer-summary-heading"
          className={`flex flex-col gap-5 rounded-2xl border-2 border-[var(--border-strong)] bg-[var(--balance-card)] p-6 text-[#FFFFFF] ${
            isVoiceOnlyMode ? "hidden" : ""
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <span className="text-[14px] font-bold uppercase tracking-wider text-[var(--peach)]">
                Transfer summary
              </span>
              <h2
                id="transfer-summary-heading"
                className="mt-1 text-[22px] font-bold text-[#FFFFFF]"
              >
                Check the details
              </h2>
            </div>
            <span className="inline-flex min-h-[36px] items-center rounded-full bg-[var(--sun)] px-3 py-1 text-[14px] font-bold text-[var(--text)]">
              {mandate ? "Ready to approve" : "Waiting for details"}
            </span>
          </div>

          <div className="rounded-xl border-2 border-[var(--sun)] bg-[#2B140E] p-4">
            <div className="flex items-center gap-2 text-[14px] font-bold text-[var(--peach)]">
              <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
              <span>Verified recipient</span>
            </div>
            <dl className="mt-4 flex flex-col gap-4">
              <div>
                <dt className="text-[13px] font-bold uppercase tracking-wider text-[var(--peach)]">
                  Recipient
                </dt>
                <dd className="mt-0.5 text-[20px] font-bold text-[#FFFFFF]">
                  {recipientDisplayName}
                </dd>
              </div>
              <div>
                <dt className="text-[13px] font-bold uppercase tracking-wider text-[var(--peach)]">
                  Account number
                </dt>
                <dd className="num mt-0.5 text-[16px] font-bold text-[#FFFFFF]">
                  {proposal?.payeeAccountNumber || "Saved contact account"}
                </dd>
              </div>
              <div>
                <dt className="text-[13px] font-bold uppercase tracking-wider text-[var(--peach)]">
                  Amount
                </dt>
                <dd className="num mt-0.5 text-[36px] font-bold leading-tight text-[#FFFFFF]">
                  {formatUsdMinor(displayAmountMinor)}
                </dd>
              </div>
            </dl>
          </div>

          <div className="flex flex-col gap-3 text-[15px] text-[var(--peach)]">
            <p className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-[var(--sun)]" aria-hidden="true" />
              <span>Matches what you said</span>
            </p>
            <p className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-[var(--sun)]" aria-hidden="true" />
              <span>Saved contact verified</span>
            </p>
            <p className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-[var(--sun)]" aria-hidden="true" />
              <span>Within your $500.00 daily voice limit</span>
            </p>
            <p className="mt-2 border-t border-[var(--peach)]/30 pt-3 text-[14px]">
              The transfer is a sandbox test payment. Nothing moves until you
              finish the spoken readout and approve it.
            </p>
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
