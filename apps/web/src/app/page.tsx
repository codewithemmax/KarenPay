"use client";

import {
  browserSupportsWebAuthn,
  startAuthentication,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import {
  Fingerprint,
  KeyRound,
  Mail,
  QrCode,
  ShieldCheck,
  Volume2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useEffect, useState, type FormEvent } from "react";
import { Button } from "../components/Button";
import { useLiveRegions } from "../components/LiveRegions";

type SignInMode = "passkey" | "qr" | "pin" | "email";

export default function WelcomeSignInPage() {
  const router = useRouter();
  const { announceStatus, clearStatus } = useLiveRegions();
  const [mode, setMode] = useState<SignInMode>("pin");
  const [displayName, setDisplayName] = useState<string>("");
  const [pin, setPin] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [otpCode, setOtpCode] = useState<string>("");
  const [otpSent, setOtpSent] = useState<boolean>(false);
  const [devOtpPreview, setDevOtpPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [webAuthnSupported, setWebAuthnSupported] = useState<boolean>(true);

  useEffect(() => {
    setWebAuthnSupported(browserSupportsWebAuthn());
    try {
      const savedName = window.localStorage.getItem("kp_holder_name");
      if (savedName) {
        setDisplayName(savedName);
      }
    } catch {
      // Ignore storage access failure
    }
  }, []);

  const handleModeSwitch = (nextMode: SignInMode) => {
    setMode(nextMode);
    setErrorMessage(null);
    setInfoMessage(null);
    clearStatus();
  };

  const handleWebAuthnSignIn = async (crossDevice: boolean) => {
    if (!webAuthnSupported) {
      const msg =
        "This browser does not support passkeys. Please use 6-Digit PIN or Email Code instead.";
      setErrorMessage(msg);
      announceStatus(msg, "error");
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    setInfoMessage(null);
    clearStatus();

    try {
      const optionsRes = await fetch("/api/v1/auth/login/options", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crossDevice }),
      });
      const optionsBody = (await optionsRes.json()) as
        | PublicKeyCredentialRequestOptionsJSON
        | { message?: string; spoken?: string };

      if (!optionsRes.ok || !("challenge" in optionsBody)) {
        const msg =
          ("spoken" in optionsBody && optionsBody.spoken) ||
          ("message" in optionsBody && optionsBody.message) ||
          "Could not start passkey sign-in. Please try 6-Digit PIN or Email Code.";
        setErrorMessage(msg);
        announceStatus(msg, "error");
        return;
      }

      const assertion = await startAuthentication({
        optionsJSON: optionsBody,
      });

      const verifyRes = await fetch("/api/v1/auth/login/verify", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(assertion),
      });
      const verifyBody = (await verifyRes.json()) as {
        verified?: boolean;
        message?: string;
        spoken?: string;
      };

      if (!verifyRes.ok || !verifyBody.verified) {
        const msg =
          verifyBody.spoken ??
          verifyBody.message ??
          "Passkey sign-in did not succeed. Please try again.";
        setErrorMessage(msg);
        announceStatus(msg, "error");
        return;
      }

      announceStatus("Signed in.", "neutral");
      router.push("/home");
    } catch {
      const msg =
        "Passkey sign-in was cancelled or unavailable on this device. You can use 6-Digit PIN or Email Code above.";
      setErrorMessage(msg);
      announceStatus(msg, "error");
    } finally {
      setLoading(false);
    }
  };

  const handlePinSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = displayName.trim();
    const trimmedPin = pin.trim();

    if (!trimmedName) {
      const msg = "Please enter the name on your account.";
      setErrorMessage(msg);
      announceStatus(msg, "error");
      return;
    }

    if (!/^\d{6}$/.test(trimmedPin)) {
      const msg = "Please enter your 6-digit numeric PIN.";
      setErrorMessage(msg);
      announceStatus(msg, "error");
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    setInfoMessage(null);
    clearStatus();

    try {
      const res = await fetch("/api/v1/auth/pin/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: trimmedName,
          pin: trimmedPin,
        }),
      });

      const body = (await res.json()) as {
        verified?: boolean;
        message?: string;
        spoken?: string;
      };

      if (!res.ok || !body.verified) {
        const msg =
          body.spoken ??
          body.message ??
          "Invalid name or 6-digit PIN. Please try again.";
        setErrorMessage(msg);
        announceStatus(msg, "error");
        return;
      }

      try {
        window.localStorage.setItem("kp_holder_name", trimmedName);
      } catch {
        // Ignore storage write failure
      }

      announceStatus("Signed in.", "neutral");
      router.push("/home");
    } catch {
      const msg = "Could not connect to sign in. Please try again.";
      setErrorMessage(msg);
      announceStatus(msg, "error");
    } finally {
      setLoading(false);
    }
  };

  const handleSendEmailOtp = async () => {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !trimmedEmail.includes("@")) {
      const msg = "Please enter a valid email address.";
      setErrorMessage(msg);
      announceStatus(msg, "error");
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    setInfoMessage(null);
    setDevOtpPreview(null);
    clearStatus();

    try {
      const res = await fetch("/api/v1/auth/email/send-otp", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmedEmail,
          displayName: displayName.trim() || undefined,
        }),
      });

      const body = (await res.json()) as {
        sent?: boolean;
        devOtpCode?: string;
        message?: string;
        spoken?: string;
      };

      if (!res.ok || !body.sent) {
        const msg =
          body.spoken ??
          body.message ??
          "Could not send verification email. Please try again.";
        setErrorMessage(msg);
        announceStatus(msg, "error");
        return;
      }

      setOtpSent(true);
      if (body.devOtpCode) {
        setDevOtpPreview(body.devOtpCode);
      }
      const msg =
        body.spoken ??
        "We sent a 6-digit verification code to your email address.";
      setInfoMessage(msg);
      announceStatus(msg, "neutral");
    } catch {
      const msg = "Could not connect to send email code. Please try again.";
      setErrorMessage(msg);
      announceStatus(msg, "error");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyEmailOtp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!otpSent) {
      await handleSendEmailOtp();
      return;
    }

    const trimmedEmail = email.trim().toLowerCase();
    const trimmedCode = otpCode.trim();
    if (!/^\d{6}$/.test(trimmedCode)) {
      const msg = "Please enter the 6-digit code sent to your email.";
      setErrorMessage(msg);
      announceStatus(msg, "error");
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    setInfoMessage(null);
    clearStatus();

    try {
      const res = await fetch("/api/v1/auth/email/verify-otp", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmedEmail,
          code: trimmedCode,
          displayName: displayName.trim() || undefined,
        }),
      });

      const body = (await res.json()) as {
        verified?: boolean;
        displayName?: string;
        message?: string;
        spoken?: string;
      };

      if (!res.ok || !body.verified) {
        const msg =
          body.spoken ??
          body.message ??
          "Invalid or expired 6-digit email code.";
        setErrorMessage(msg);
        announceStatus(msg, "error");
        return;
      }

      if (body.displayName) {
        try {
          window.localStorage.setItem("kp_holder_name", body.displayName);
        } catch {
          // Ignore storage write failure
        }
      }

      announceStatus("Signed in.", "neutral");
      router.push("/home");
    } catch {
      const msg = "Could not verify email code. Please try again.";
      setErrorMessage(msg);
      announceStatus(msg, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col justify-between gap-6">
      <header className="flex items-center gap-3 pt-2">
        <div
          aria-hidden="true"
          className="flex h-12 w-12 items-center justify-center rounded-input bg-ink text-peach"
        >
          <ShieldCheck aria-hidden="true" className="h-6 w-6" />
        </div>
        <span className="text-[20px] font-bold text-text">KarenPay</span>
      </header>

      <main className="flex flex-1 flex-col justify-center gap-6">
        <section className="rounded-card border border-divider bg-surface p-6 shadow-card">
          {/* Decorative flat solid sunset (max 160px tall, aria-hidden, no text on top) */}
          <div
            aria-hidden="true"
            className="mb-5 h-32 max-h-[160px] w-full overflow-hidden rounded-input bg-surface-tint"
          >
            <svg
              aria-hidden="true"
              focusable="false"
              viewBox="0 0 400 128"
              preserveAspectRatio="none"
              className="h-full w-full"
            >
              {/* Outer --sun half-circle */}
              <circle cx="200" cy="96" r="68" fill="#FFCC6B" />
              {/* Inner --primary half-circle */}
              <circle cx="200" cy="96" r="46" fill="#B82D14" />
              {/* Flat solid --ink hills */}
              <path
                d="M0 98 Q95 72 205 94 T400 84 L400 128 L0 128 Z"
                fill="#1F0D09"
              />
              <path
                d="M0 108 Q140 88 260 106 T400 98 L400 128 L0 128 Z"
                fill="#1F0D09"
              />
            </svg>
          </div>

          <h1 className="text-[28px] font-bold leading-tight text-text">
            Welcome back
          </h1>
          <p className="mt-2 text-base text-text-muted">
            Send money with your voice. Nothing moves until you approve it.
          </p>

          {/* 4-Method Sign-In Selector */}
          <div
            role="group"
            aria-label="Choose sign-in method"
            className="mt-5 grid grid-cols-2 gap-2.5"
          >
            <button
              type="button"
              onClick={() => handleModeSwitch("pin")}
              aria-pressed={mode === "pin"}
              className={`flex min-h-[48px] items-center justify-center gap-2 rounded-input border-2 px-3 py-2.5 text-sm font-bold transition-colors ${
                mode === "pin"
                  ? "border-primary bg-primary text-primary-on"
                  : "border-input-border bg-surface-tint text-text hover:bg-peach"
              }`}
            >
              <KeyRound aria-hidden="true" className="h-4 w-4 shrink-0" />
              <span>6-Digit PIN</span>
            </button>

            <button
              type="button"
              onClick={() => handleModeSwitch("email")}
              aria-pressed={mode === "email"}
              className={`flex min-h-[48px] items-center justify-center gap-2 rounded-input border-2 px-3 py-2.5 text-sm font-bold transition-colors ${
                mode === "email"
                  ? "border-primary bg-primary text-primary-on"
                  : "border-input-border bg-surface-tint text-text hover:bg-peach"
              }`}
            >
              <Mail aria-hidden="true" className="h-4 w-4 shrink-0" />
              <span>Email Code</span>
            </button>

            <button
              type="button"
              onClick={() => handleModeSwitch("passkey")}
              aria-pressed={mode === "passkey"}
              className={`flex min-h-[48px] items-center justify-center gap-2 rounded-input border-2 px-3 py-2.5 text-sm font-bold transition-colors ${
                mode === "passkey"
                  ? "border-primary bg-primary text-primary-on"
                  : "border-input-border bg-surface-tint text-text hover:bg-peach"
              }`}
            >
              <Fingerprint aria-hidden="true" className="h-4 w-4 shrink-0" />
              <span>Passkey</span>
            </button>

            <button
              type="button"
              onClick={() => handleModeSwitch("qr")}
              aria-pressed={mode === "qr"}
              className={`flex min-h-[48px] items-center justify-center gap-2 rounded-input border-2 px-3 py-2.5 text-sm font-bold transition-colors ${
                mode === "qr"
                  ? "border-primary bg-primary text-primary-on"
                  : "border-input-border bg-surface-tint text-text hover:bg-peach"
              }`}
            >
              <QrCode aria-hidden="true" className="h-4 w-4 shrink-0" />
              <span>Phone QR Code</span>
            </button>
          </div>

          {errorMessage && (
            <p
              id="signin-error"
              className="mt-4 rounded-input bg-warning-bg p-3.5 text-sm font-medium text-warning-text"
            >
              {errorMessage}
            </p>
          )}

          {infoMessage && (
            <p className="mt-4 rounded-input bg-surface-tint p-3.5 text-sm font-medium text-text">
              {infoMessage}
            </p>
          )}

          {devOtpPreview && (
            <div
              role="status"
              className="mt-4 rounded-input border-2 border-input-border bg-surface-tint p-3.5 text-sm font-bold text-text"
            >
              Local Dev Code (RESEND_API_KEY not set in .env):{" "}
              <span className="num text-base underline">{devOtpPreview}</span>
            </div>
          )}

          {mode === "pin" && (
            <form
              onSubmit={(e) => void handlePinSignIn(e)}
              noValidate
              className="mt-5 flex flex-col gap-4"
            >
              <div>
                <label
                  htmlFor="signin-pin-name"
                  className="block text-base font-bold text-text"
                >
                  Your name
                </label>
                <input
                  id="signin-pin-name"
                  type="text"
                  autoComplete="name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  disabled={loading}
                  placeholder="Ade Bello"
                  className="mt-2 min-h-[48px] w-full rounded-input border-2 border-input-border bg-surface px-4 py-3 text-base text-text placeholder:text-text-muted"
                />
              </div>

              <div>
                <label
                  htmlFor="signin-pin-code"
                  className="block text-base font-bold text-text"
                >
                  6-digit PIN
                </label>
                <input
                  id="signin-pin-code"
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  autoComplete="current-password"
                  value={pin}
                  onChange={(e) =>
                    setPin(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  disabled={loading}
                  placeholder="123456"
                  className="num mt-2 min-h-[48px] w-full rounded-input border-2 border-input-border bg-surface px-4 py-3 text-lg font-bold tracking-widest text-text placeholder:text-text-muted"
                />
              </div>

              <Button
                type="submit"
                variant="primary"
                loading={loading}
                icon={<KeyRound aria-hidden="true" className="h-5 w-5" />}
              >
                Sign in with 6-Digit PIN
              </Button>
            </form>
          )}

          {mode === "email" && (
            <form
              onSubmit={(e) => void handleVerifyEmailOtp(e)}
              noValidate
              className="mt-5 flex flex-col gap-4"
            >
              <div>
                <label
                  htmlFor="signin-email"
                  className="block text-base font-bold text-text"
                >
                  Email address
                </label>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <input
                    id="signin-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={loading}
                    placeholder="you@example.com"
                    className="min-h-[48px] flex-1 rounded-input border-2 border-input-border bg-surface px-4 py-3 text-base text-text placeholder:text-text-muted"
                  />
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void handleSendEmailOtp()}
                    className="inline-flex min-h-[48px] shrink-0 items-center justify-center rounded-input border-2 border-input-border bg-surface-tint px-4 py-2.5 text-sm font-bold text-text hover:bg-peach"
                  >
                    {otpSent ? "Resend Code" : "Send 6-Digit Code"}
                  </button>
                </div>
              </div>

              {otpSent && (
                <div>
                  <label
                    htmlFor="signin-email-otp"
                    className="block text-base font-bold text-text"
                  >
                    6-digit email verification code
                  </label>
                  <input
                    id="signin-email-otp"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    autoComplete="one-time-code"
                    value={otpCode}
                    onChange={(e) =>
                      setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    disabled={loading}
                    placeholder="654321"
                    className="num mt-2 min-h-[48px] w-full rounded-input border-2 border-input-border bg-surface px-4 py-3 text-lg font-bold tracking-widest text-text placeholder:text-text-muted"
                  />
                </div>
              )}

              <Button
                type="submit"
                variant="primary"
                loading={loading}
                icon={<Mail aria-hidden="true" className="h-5 w-5" />}
              >
                {otpSent
                  ? "Verify Email Code & Sign In"
                  : "Send 6-Digit Email Code"}
              </Button>
            </form>
          )}

          {(mode === "passkey" || mode === "qr") && (
            <div className="mt-5 flex flex-col gap-3">
              <Button
                variant="primary"
                loading={loading}
                aria-describedby={errorMessage ? "signin-error" : undefined}
                icon={
                  mode === "qr" ? (
                    <QrCode aria-hidden="true" className="h-5 w-5" />
                  ) : (
                    <Fingerprint aria-hidden="true" className="h-5 w-5" />
                  )
                }
                onClick={() => void handleWebAuthnSignIn(mode === "qr")}
              >
                {mode === "qr" ? "Scan QR with Phone" : "Sign in with passkey"}
              </Button>
            </div>
          )}

          <div className="mt-3">
            <Link
              href="/register"
              className="inline-flex min-h-[48px] w-full items-center justify-center rounded-full bg-surface-tint px-5 py-3 text-base font-bold text-text transition-colors hover:bg-peach"
            >
              Create an account
            </Link>
          </div>
        </section>

        <section
          aria-label="How KarenPay works"
          className="rounded-card border border-divider bg-surface p-5 shadow-card"
        >
          <ul className="flex flex-col gap-4">
            <li className="flex items-center gap-3.5">
              <div
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-tint text-text"
              >
                <Volume2 aria-hidden="true" className="h-5 w-5" />
              </div>
              <span className="text-base text-text">
                Hear every payment read aloud
              </span>
            </li>

            <li className="flex items-center gap-3.5">
              <div
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-tint text-text"
              >
                <Fingerprint aria-hidden="true" className="h-5 w-5" />
              </div>
              <span className="text-base text-text">
                Approve with passkey, phone QR code, or 6-digit PIN
              </span>
            </li>

            <li className="flex items-center gap-3.5">
              <div
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-tint text-text"
              >
                <ShieldCheck aria-hidden="true" className="h-5 w-5" />
              </div>
              <span className="text-base text-text">
                Nothing is sent without your approval
              </span>
            </li>
          </ul>
        </section>
      </main>

      <footer className="pb-2 text-center">
        <p className="text-sm text-text-muted">Sandbox demo. No real money.</p>
      </footer>
    </div>
  );
}
