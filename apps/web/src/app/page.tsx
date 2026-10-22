"use client";

import {
  browserSupportsWebAuthn,
  startAuthentication,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { Fingerprint, ShieldCheck, Volume2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";
import { Button } from "../components/Button";
import { useLiveRegions } from "../components/LiveRegions";

export default function WelcomeSignInPage() {
  const router = useRouter();
  const { announceStatus, clearStatus } = useLiveRegions();
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [webAuthnSupported, setWebAuthnSupported] = useState<boolean>(true);

  useEffect(() => {
    setWebAuthnSupported(browserSupportsWebAuthn());
  }, []);

  const handleSignIn = async () => {
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
      const optionsRes = await fetch("/api/v1/auth/login/options", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const optionsBody = (await optionsRes.json()) as
        | PublicKeyCredentialRequestOptionsJSON
        | { message?: string; spoken?: string };

      if (!optionsRes.ok || !("challenge" in optionsBody)) {
        const msg =
          ("spoken" in optionsBody && optionsBody.spoken) ||
          ("message" in optionsBody && optionsBody.message) ||
          "Could not start passkey sign-in. Please try again.";
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
        "Passkey sign-in was cancelled or could not be completed. Please try again.";
      setErrorMessage(msg);
      announceStatus(msg, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col justify-between gap-6">
      <header className="flex items-center gap-3 pt-2">
        <div className="flex h-12 w-12 items-center justify-center rounded-input bg-surface-tint text-primary-strong">
          <ShieldCheck aria-hidden="true" className="h-6 w-6" />
        </div>
        <span className="text-[20px] font-semibold text-text">KarenPay</span>
      </header>

      <main className="flex flex-1 flex-col justify-center gap-6">
        <section className="rounded-card bg-surface p-6 shadow-card">
          <h1 className="text-[28px] font-bold leading-tight text-text">
            Welcome back
          </h1>
          <p className="mt-2 text-base text-text-muted">
            Send money with your voice. Nothing moves until you approve it.
          </p>

          {!webAuthnSupported && (
            <div
              role="note"
              className="mt-4 rounded-input bg-warning-bg p-4 text-sm font-medium text-warning-text"
            >
              This browser does not support passkeys. Please use a device and
              browser with fingerprint or face sign-in enabled.
            </div>
          )}

          {errorMessage && (
            <p
              id="signin-error"
              className="mt-4 rounded-input bg-warning-bg p-3.5 text-sm font-medium text-warning-text"
            >
              {errorMessage}
            </p>
          )}

          <div className="mt-6 flex flex-col gap-3">
            <Button
              variant="primary"
              loading={loading}
              disabled={!webAuthnSupported}
              aria-describedby={errorMessage ? "signin-error" : undefined}
              icon={<Fingerprint aria-hidden="true" className="h-5 w-5" />}
              onClick={() => void handleSignIn()}
            >
              Sign in with passkey
            </Button>

            <Link
              href="/register"
              className="inline-flex min-h-[48px] w-full items-center justify-center rounded-full bg-surface-tint px-5 py-3 text-base font-semibold text-text transition-colors hover:bg-divider"
            >
              Create an account
            </Link>
          </div>
        </section>

        <section
          aria-label="How KarenPay works"
          className="rounded-card bg-surface p-5 shadow-card"
        >
          <ul className="flex flex-col gap-4">
            <li className="flex items-center gap-3.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-tint text-primary-strong">
                <Volume2 aria-hidden="true" className="h-5 w-5" />
              </div>
              <span className="text-base text-text">
                Hear every payment read aloud
              </span>
            </li>

            <li className="flex items-center gap-3.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-tint text-primary-strong">
                <Fingerprint aria-hidden="true" className="h-5 w-5" />
              </div>
              <span className="text-base text-text">
                Approve with your fingerprint or face
              </span>
            </li>

            <li className="flex items-center gap-3.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-tint text-primary-strong">
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
