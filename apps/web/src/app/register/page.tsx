"use client";

import {
  browserSupportsWebAuthn,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
} from "@simplewebauthn/browser";
import {
  ArrowLeft,
  Check,
  Fingerprint,
  Info,
  KeyRound,
  Mail,
  QrCode,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "../../components/Button";
import { useLiveRegions } from "../../components/LiveRegions";

type RegisterMethod = "passkey" | "qr" | "pin" | "email";

export default function RegisterPage() {
  const router = useRouter();
  const { announceStatus, clearStatus } = useLiveRegions();
  const [method, setMethod] = useState<RegisterMethod>("pin");
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
  const [isSuccess, setIsSuccess] = useState<boolean>(false);
  const successHeadingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    const supported = browserSupportsWebAuthn();
    setWebAuthnSupported(supported);
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("step") === "success") {
        setIsSuccess(true);
      }
    } catch {
      // Ignore URL parsing errors
    }
  }, []);

  useEffect(() => {
    if (isSuccess) {
      announceStatus("Account created", "neutral");
      successHeadingRef.current?.focus();
    }
  }, [isSuccess, announceStatus]);

  const handleMethodChange = (nextMethod: RegisterMethod) => {
    setMethod(nextMethod);
    setErrorMessage(null);
    setInfoMessage(null);
    clearStatus();
  };

  const handleSendEmailOtp = async () => {
    const trimmedName = displayName.trim();
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedName) {
      const msg = "Please enter your name before requesting an email code.";
      setErrorMessage(msg);
      announceStatus(msg, "error");
      return;
    }

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
          displayName: trimmedName,
        }),
      });

      const body = (await res.json()) as {
        sent?: boolean;
        delivery?: string;
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
      const msg = "Could not connect to send the email code. Please try again.";
      setErrorMessage(msg);
      announceStatus(msg, "error");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = displayName.trim();
    if (!trimmedName) {
      const msg = "Please enter your name before creating your account.";
      setErrorMessage(msg);
      announceStatus(msg, "error");
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    setInfoMessage(null);
    clearStatus();

    try {
      if (method === "pin") {
        const trimmedPin = pin.trim();
        if (!/^\d{6}$/.test(trimmedPin)) {
          const msg = "Please enter a 6-digit numeric PIN.";
          setErrorMessage(msg);
          announceStatus(msg, "error");
          setLoading(false);
          return;
        }

        const res = await fetch("/api/v1/auth/pin/register", {
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
            "Could not create your 6-digit PIN. Please try again.";
          setErrorMessage(msg);
          announceStatus(msg, "error");
          return;
        }

        try {
          window.localStorage.setItem("kp_holder_name", trimmedName);
        } catch {
          // Ignore storage write failure
        }

        setIsSuccess(true);
        return;
      }

      if (method === "email") {
        const trimmedEmail = email.trim().toLowerCase();
        const trimmedOtp = otpCode.trim();
        const trimmedPin = pin.trim();

        if (!otpSent) {
          await handleSendEmailOtp();
          return;
        }

        if (!/^\d{6}$/.test(trimmedOtp)) {
          const msg = "Please enter the 6-digit code sent to your email.";
          setErrorMessage(msg);
          announceStatus(msg, "error");
          setLoading(false);
          return;
        }

        if (trimmedPin && !/^\d{6}$/.test(trimmedPin)) {
          const msg =
            "If you add a payment approval PIN, it must be 6 digits.";
          setErrorMessage(msg);
          announceStatus(msg, "error");
          setLoading(false);
          return;
        }

        const verifyRes = await fetch("/api/v1/auth/email/verify-otp", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: trimmedEmail,
            code: trimmedOtp,
            displayName: trimmedName,
            pin: trimmedPin || undefined,
          }),
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
            "Email verification failed. Please check the 6-digit code.";
          setErrorMessage(msg);
          announceStatus(msg, "error");
          return;
        }

        try {
          window.localStorage.setItem("kp_holder_name", trimmedName);
        } catch {
          // Ignore storage write failure
        }

        setIsSuccess(true);
        return;
      }

      // Passkey or Cross-Device Phone QR Code
      if (!webAuthnSupported) {
        const msg =
          "This browser does not support passkeys. Please choose 6-Digit PIN or Email Code above.";
        setErrorMessage(msg);
        announceStatus(msg, "error");
        return;
      }

      const optionsRes = await fetch("/api/v1/auth/register/options", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: trimmedName,
          crossDevice: method === "qr",
        }),
      });

      const optionsBody = (await optionsRes.json()) as
        | PublicKeyCredentialCreationOptionsJSON
        | { message?: string; spoken?: string };

      if (!optionsRes.ok || !("challenge" in optionsBody)) {
        const msg =
          ("spoken" in optionsBody && optionsBody.spoken) ||
          ("message" in optionsBody && optionsBody.message) ||
          "Could not start passkey setup. Please try 6-Digit PIN or Email Code.";
        setErrorMessage(msg);
        announceStatus(msg, "error");
        return;
      }

      const registrationResponse = await startRegistration({
        optionsJSON: optionsBody,
      });

      const verifyRes = await fetch("/api/v1/auth/register/verify", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(registrationResponse),
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
          "Passkey creation could not be completed. Please try again.";
        setErrorMessage(msg);
        announceStatus(msg, "error");
        return;
      }

      try {
        window.localStorage.setItem("kp_holder_name", trimmedName);
      } catch {
        // Ignore storage write failure
      }

      setIsSuccess(true);
    } catch {
      const msg =
        "Passkey setup was cancelled or unavailable on this device. You can switch to 6-Digit PIN or Email Code above.";
      setErrorMessage(msg);
      announceStatus(msg, "error");
    } finally {
      setLoading(false);
    }
  };

  const describedByIds = errorMessage
    ? "name-helper register-error"
    : "name-helper";

  if (isSuccess) {
    return (
      <div className="flex flex-1 flex-col justify-between gap-6">
        <header aria-label="Account setup" className="pt-2" />

        <main className="flex flex-1 flex-col items-center justify-center">
          <section className="flex w-full flex-col items-center rounded-card border border-divider bg-surface p-8 text-center shadow-card">
            <div
              aria-hidden="true"
              className="flex h-20 w-20 items-center justify-center rounded-full bg-ink text-peach"
            >
              <Check aria-hidden="true" className="h-10 w-10 stroke-[2.75]" />
            </div>

            <h1
              ref={successHeadingRef}
              tabIndex={-1}
              className="mt-6 text-[28px] font-bold leading-tight text-text"
            >
              Your account is ready
            </h1>

            <p className="mt-3 text-base text-text-muted">
              You can now sign in and approve payments with your chosen security
              method.
            </p>

            <div className="mt-8 w-full">
              <Button variant="primary" onClick={() => router.push("/home")}>
                Continue
              </Button>
            </div>
          </section>
        </main>

        <footer className="pb-2 text-center">
          <p className="text-sm text-text-muted">Sandbox demo. No real money.</p>
        </footer>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col justify-between gap-6">
      <header className="flex items-center pt-2">
        <Link
          href="/"
          aria-label="Back"
          className="inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-full border border-divider bg-surface text-text shadow-card transition-colors hover:bg-surface-tint"
        >
          <ArrowLeft aria-hidden="true" className="h-5 w-5" />
        </Link>
      </header>

      <main className="flex flex-1 flex-col justify-center">
        <section className="rounded-card border border-divider bg-surface p-6 shadow-card">
          <h1 className="text-[28px] font-bold leading-tight text-text">
            Create your account
          </h1>
          <p className="mt-2 text-base text-text-muted">
            No fingerprint or face sensor? Choose a 6-digit PIN, Email Code, or
            Phone QR Code below.
          </p>

          {/* 4-Option Security Method Selector */}
          <div
            role="group"
            aria-label="Choose how to secure your account"
            className="mt-5 grid grid-cols-2 gap-2.5"
          >
            <button
              type="button"
              onClick={() => handleMethodChange("pin")}
              aria-pressed={method === "pin"}
              className={`flex min-h-[48px] items-center justify-center gap-2 rounded-input border-2 px-3 py-2.5 text-sm font-bold transition-colors ${
                method === "pin"
                  ? "border-primary bg-primary text-primary-on"
                  : "border-input-border bg-surface-tint text-text hover:bg-peach"
              }`}
            >
              <KeyRound aria-hidden="true" className="h-4 w-4 shrink-0" />
              <span>6-Digit PIN</span>
            </button>

            <button
              type="button"
              onClick={() => handleMethodChange("email")}
              aria-pressed={method === "email"}
              className={`flex min-h-[48px] items-center justify-center gap-2 rounded-input border-2 px-3 py-2.5 text-sm font-bold transition-colors ${
                method === "email"
                  ? "border-primary bg-primary text-primary-on"
                  : "border-input-border bg-surface-tint text-text hover:bg-peach"
              }`}
            >
              <Mail aria-hidden="true" className="h-4 w-4 shrink-0" />
              <span>Email Code</span>
            </button>

            <button
              type="button"
              onClick={() => handleMethodChange("passkey")}
              aria-pressed={method === "passkey"}
              className={`flex min-h-[48px] items-center justify-center gap-2 rounded-input border-2 px-3 py-2.5 text-sm font-bold transition-colors ${
                method === "passkey"
                  ? "border-primary bg-primary text-primary-on"
                  : "border-input-border bg-surface-tint text-text hover:bg-peach"
              }`}
            >
              <Fingerprint aria-hidden="true" className="h-4 w-4 shrink-0" />
              <span>Passkey</span>
            </button>

            <button
              type="button"
              onClick={() => handleMethodChange("qr")}
              aria-pressed={method === "qr"}
              className={`flex min-h-[48px] items-center justify-center gap-2 rounded-input border-2 px-3 py-2.5 text-sm font-bold transition-colors ${
                method === "qr"
                  ? "border-primary bg-primary text-primary-on"
                  : "border-input-border bg-surface-tint text-text hover:bg-peach"
              }`}
            >
              <QrCode aria-hidden="true" className="h-4 w-4 shrink-0" />
              <span>Phone QR Code</span>
            </button>
          </div>

          <form
            onSubmit={(e) => void handleSubmit(e)}
            noValidate
            className="mt-6 flex flex-col gap-5"
          >
            <div>
              <label
                htmlFor="account-holder-name"
                className="block text-base font-bold text-text"
              >
                Your name
              </label>
              <input
                id="account-holder-name"
                name="displayName"
                type="text"
                autoComplete="name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                disabled={loading}
                aria-invalid={errorMessage ? "true" : "false"}
                aria-describedby={describedByIds}
                placeholder="Ade Bello"
                className="mt-2 min-h-[48px] w-full rounded-input border-2 border-input-border bg-surface px-4 py-3 text-base text-text placeholder:text-text-muted"
              />
              <p id="name-helper" className="mt-2 text-sm text-text-muted">
                {method === "pin" &&
                  "Create a 6-digit PIN to sign in and approve payments without fingerprint or face hardware."}
                {method === "email" &&
                  "We will send a 6-digit verification code via Resend to your email."}
                {method === "passkey" &&
                  "You will use your device passkey (fingerprint, face, or screen lock) instead of a password."}
                {method === "qr" &&
                  "Scan a QR code with your phone or tablet camera to create your passkey."}
              </p>
            </div>

            {method === "pin" && (
              <div>
                <label
                  htmlFor="account-pin"
                  className="block text-base font-bold text-text"
                >
                  Choose a 6-digit security PIN
                </label>
                <input
                  id="account-pin"
                  name="pin"
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  autoComplete="new-password"
                  value={pin}
                  onChange={(e) =>
                    setPin(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  disabled={loading}
                  placeholder="123456"
                  className="num mt-2 min-h-[48px] w-full rounded-input border-2 border-input-border bg-surface px-4 py-3 text-lg font-bold tracking-widest text-text placeholder:text-text-muted"
                />
                <p className="mt-2 text-sm text-text-muted">
                  You will also use this 6-digit PIN to approve voice payments
                  after the readout finishes.
                </p>
              </div>
            )}

            {method === "email" && (
              <div className="flex flex-col gap-4">
                <div>
                  <label
                    htmlFor="account-email"
                    className="block text-base font-bold text-text"
                  >
                    Email address
                  </label>
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <input
                      id="account-email"
                      name="email"
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
                  <>
                    <div>
                      <label
                        htmlFor="account-otp"
                        className="block text-base font-bold text-text"
                      >
                        6-digit email verification code
                      </label>
                      <input
                        id="account-otp"
                        name="otpCode"
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        autoComplete="one-time-code"
                        value={otpCode}
                        onChange={(e) =>
                          setOtpCode(
                            e.target.value.replace(/\D/g, "").slice(0, 6),
                          )
                        }
                        disabled={loading}
                        placeholder="654321"
                        className="num mt-2 min-h-[48px] w-full rounded-input border-2 border-input-border bg-surface px-4 py-3 text-lg font-bold tracking-widest text-text placeholder:text-text-muted"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="email-optional-pin"
                        className="block text-base font-bold text-text"
                      >
                        Set a 6-digit PIN for approving payments (Recommended)
                      </label>
                      <input
                        id="email-optional-pin"
                        name="emailPin"
                        type="password"
                        inputMode="numeric"
                        maxLength={6}
                        value={pin}
                        onChange={(e) =>
                          setPin(e.target.value.replace(/\D/g, "").slice(0, 6))
                        }
                        disabled={loading}
                        placeholder="123456"
                        className="num mt-2 min-h-[48px] w-full rounded-input border-2 border-input-border bg-surface px-4 py-3 text-lg font-bold tracking-widest text-text placeholder:text-text-muted"
                      />
                    </div>
                  </>
                )}
              </div>
            )}

            {devOtpPreview && (
              <div
                role="status"
                className="rounded-input border-2 border-input-border bg-surface-tint p-3.5 text-sm font-bold text-text"
              >
                Local Dev Code (RESEND_API_KEY not set in .env):{" "}
                <span className="num text-base underline">{devOtpPreview}</span>
              </div>
            )}

            {infoMessage && (
              <p className="rounded-input bg-surface-tint p-3.5 text-sm font-medium text-text">
                {infoMessage}
              </p>
            )}

            {errorMessage && (
              <p
                id="register-error"
                className="rounded-input bg-warning-bg p-3.5 text-sm font-medium text-warning-text"
              >
                {errorMessage}
              </p>
            )}

            <div className="flex items-start gap-3 rounded-input bg-warning-bg p-4 text-sm text-warning-text">
              <Info
                aria-hidden="true"
                className="mt-0.5 h-5 w-5 shrink-0 text-warning-text"
              />
              <p>
                <strong className="font-bold">Important:</strong> Keep your
                passkey or 6-digit PIN private. Anyone with access to it could
                approve test payments.
              </p>
            </div>

            <Button
              type="submit"
              variant="primary"
              loading={loading}
              icon={
                method === "pin" ? (
                  <KeyRound aria-hidden="true" className="h-5 w-5" />
                ) : method === "email" ? (
                  <Mail aria-hidden="true" className="h-5 w-5" />
                ) : method === "qr" ? (
                  <QrCode aria-hidden="true" className="h-5 w-5" />
                ) : (
                  <Fingerprint aria-hidden="true" className="h-5 w-5" />
                )
              }
            >
              {method === "pin" && "Create account with 6-Digit PIN"}
              {method === "email" &&
                (otpSent
                  ? "Verify Email Code & Create Account"
                  : "Send 6-Digit Email Code")}
              {method === "passkey" && "Create passkey"}
              {method === "qr" && "Scan QR with Phone"}
            </Button>
          </form>
        </section>
      </main>

      <footer className="pb-2 text-center">
        <p className="text-sm text-text-muted">Sandbox demo. No real money.</p>
      </footer>
    </div>
  );
}
