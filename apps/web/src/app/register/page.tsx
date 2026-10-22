"use client";

import {
  browserSupportsWebAuthn,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
} from "@simplewebauthn/browser";
import { ArrowLeft, Fingerprint } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useEffect, useState, type FormEvent } from "react";
import { Button } from "../../components/Button";
import { useLiveRegions } from "../../components/LiveRegions";

export default function RegisterPage() {
  const router = useRouter();
  const { announceStatus, clearStatus } = useLiveRegions();
  const [displayName, setDisplayName] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [webAuthnSupported, setWebAuthnSupported] = useState<boolean>(true);

  useEffect(() => {
    setWebAuthnSupported(browserSupportsWebAuthn());
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = displayName.trim();
    if (!trimmedName) {
      const msg = "Please enter your name before creating a passkey.";
      setErrorMessage(msg);
      announceStatus(msg, "error");
      return;
    }

    if (!webAuthnSupported) {
      const msg =
        "This browser does not support passkeys. Please open KarenPay in a modern browser such as Safari or Chrome.";
      setErrorMessage(msg);
      announceStatus(msg, "error");
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    clearStatus();

    try {
      const optionsRes = await fetch("/api/v1/auth/register/options", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: trimmedName }),
      });

      const optionsBody = (await optionsRes.json()) as
        | PublicKeyCredentialCreationOptionsJSON
        | { message?: string; spoken?: string };

      if (!optionsRes.ok || !("challenge" in optionsBody)) {
        const msg =
          ("spoken" in optionsBody && optionsBody.spoken) ||
          ("message" in optionsBody && optionsBody.message) ||
          "Could not start passkey setup. Please try again.";
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

      announceStatus("Account created.", "neutral");
      router.push("/home");
    } catch {
      const msg =
        "Passkey setup was cancelled or could not be completed. Please try again.";
      setErrorMessage(msg);
      announceStatus(msg, "error");
    } finally {
      setLoading(false);
    }
  };

  const describedByIds = errorMessage
    ? "name-helper register-error"
    : "name-helper";

  return (
    <div className="flex flex-1 flex-col justify-between gap-6">
      <header className="flex items-center pt-2">
        <Link
          href="/"
          aria-label="Back"
          className="inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-full bg-surface text-text shadow-card transition-colors hover:bg-surface-tint"
        >
          <ArrowLeft aria-hidden="true" className="h-5 w-5" />
        </Link>
      </header>

      <main className="flex flex-1 flex-col justify-center">
        <section className="rounded-card bg-surface p-6 shadow-card">
          <h1 className="text-[28px] font-bold leading-tight text-text">
            Create your account
          </h1>

          {!webAuthnSupported && (
            <div
              role="note"
              className="mt-4 rounded-input bg-warning-bg p-4 text-sm font-medium text-warning-text"
            >
              This browser does not support passkeys. Please use a device and
              browser with fingerprint or face sign-in enabled.
            </div>
          )}

          <form
            onSubmit={(e) => void handleSubmit(e)}
            noValidate
            className="mt-6 flex flex-col gap-5"
          >
            <div>
              <label
                htmlFor="account-holder-name"
                className="block text-base font-medium text-text"
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
                className="mt-2 min-h-[48px] w-full rounded-input border border-input-border bg-surface px-4 py-3 text-base text-text placeholder:text-text-muted"
              />
              <p id="name-helper" className="mt-2 text-sm text-text-muted">
                You will use your fingerprint or face instead of a password.
              </p>

              {errorMessage && (
                <p
                  id="register-error"
                  className="mt-3 rounded-input bg-warning-bg p-3.5 text-sm font-medium text-warning-text"
                >
                  {errorMessage}
                </p>
              )}
            </div>

            <Button
              type="submit"
              variant="primary"
              loading={loading}
              disabled={!webAuthnSupported}
              icon={<Fingerprint aria-hidden="true" className="h-5 w-5" />}
            >
              Create passkey
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
