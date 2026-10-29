"use client";

import {
  Fingerprint,
  KeyRound,
  LogOut,
  ShieldCheck,
  Volume2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import React, { useEffect, useRef, useState } from "react";
import { BottomTabBar } from "../../components/BottomTabBar";
import { useAnnounce } from "../../components/LiveRegions";
import { getInitials } from "../../lib/demoData";

const HOLDER_NAME_STORAGE_KEY = "kp_holder_name";
const PASSKEY_ID_STORAGE_KEY = "kp_passkey_id_hint";

interface PasskeyProfileCredential {
  id: string;
  credentialId: string;
  deviceType: string;
  backedUp: boolean;
  createdAt: string;
}

interface AccountProfileResponse {
  accountId: string;
  displayName: string;
  createdAt: string;
  rpID: string;
  credentials: PasskeyProfileCredential[];
}

export default function MePage(): React.JSX.Element {
  const router = useRouter();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { announcePolite } = useAnnounce();

  const [profile, setProfile] = useState<AccountProfileResponse | null>(null);
  const [holderName, setHolderName] = useState<string>("");
  const [isSigningOut, setIsSigningOut] = useState<boolean>(false);

  useEffect(() => {
    headingRef.current?.focus();
    try {
      const savedName = window.localStorage.getItem(HOLDER_NAME_STORAGE_KEY);
      if (savedName && savedName.trim()) {
        setHolderName(savedName.trim());
      }
    } catch {
      // ignore storage errors
    }

    void (async () => {
      try {
        const res = await fetch("/api/v1/auth/me", {
          credentials: "include",
          cache: "no-store",
        });
        if (res.status === 401) {
          router.replace("/");
          return;
        }
        if (res.ok) {
          const data = (await res.json()) as AccountProfileResponse;
          setProfile(data);
          setHolderName(data.displayName);
        }
      } catch {
        // ignore network error
      }
    })();
  }, [router]);

  const handleSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      await fetch("/api/v1/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // ignore network failure on logout
    }
    try {
      window.localStorage.removeItem(HOLDER_NAME_STORAGE_KEY);
      window.localStorage.removeItem(PASSKEY_ID_STORAGE_KEY);
    } catch {
      // ignore
    }
    announcePolite("Signed out.");
    router.push("/");
  };

  const activeCredential = profile?.credentials?.[0];
  const formattedCredId = activeCredential?.credentialId
    ? activeCredential.credentialId.length > 20
      ? `${activeCredential.credentialId.slice(0, 10)}...${activeCredential.credentialId.slice(-6)}`
      : activeCredential.credentialId
    : "Enrolled passkey";
  const enrolledDate = activeCredential?.createdAt
    ? new Date(activeCredential.createdAt).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "2-digit",
      })
    : "Active session";

  return (
    <div className="flex flex-col gap-6 pb-24">
      <div>
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-[28px] font-bold leading-[1.2] text-[var(--text)] outline-none"
        >
          Me &amp; Passkey Security
        </h1>
        <p className="mt-1 text-[16px] text-[var(--text-muted)]">
          Manage your sandbox account, active WebAuthn passkey, and session.
        </p>
      </div>

      {/* Account Holder Profile Card */}
      <section
        aria-label="Account profile"
        className="flex items-center justify-between gap-4 rounded-2xl border-2 border-[var(--border-strong)] bg-[var(--surface)] p-5"
      >
        <div className="flex items-center gap-4">
          <div
            aria-hidden="true"
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-[var(--border-strong)] bg-[var(--sun)] text-[20px] font-bold text-[var(--text)]"
          >
            {getInitials(holderName)}
          </div>
          <div>
            <h2 className="text-[20px] font-bold text-[var(--text)]">
              {holderName || "Signed-in Account"}
            </h2>
            <p className="num text-[14px] text-[var(--text-muted)]">
              Account ID:{" "}
              {profile?.accountId
                ? `${profile.accountId.slice(0, 8)}...${profile.accountId.slice(-4)}`
                : "Authenticated"}
            </p>
          </div>
        </div>

        <span className="inline-flex min-h-[36px] shrink-0 items-center rounded-full border-2 border-[var(--border-strong)] bg-[var(--surface-tint)] px-3.5 py-1 text-[14px] font-bold text-[var(--text)]">
          Sandbox account
        </span>
      </section>

      {/* Active WebAuthn Passkey Card */}
      <section
        aria-labelledby="passkey-card-heading"
        className="flex flex-col gap-4 rounded-2xl border-2 border-[var(--border-strong)] bg-[var(--surface)] p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <KeyRound
              className="h-6 w-6 shrink-0 text-[var(--text)]"
              aria-hidden="true"
            />
            <h2
              id="passkey-card-heading"
              className="text-[20px] font-bold text-[var(--text)]"
            >
              Active WebAuthn Passkey
            </h2>
          </div>

          <span className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border-2 border-[var(--border-strong)] bg-[var(--sun)] px-3 py-1 text-[13px] font-bold text-[var(--text)]">
            <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Hardware / Platform Passkey Verified</span>
          </span>
        </div>

        <dl className="grid grid-cols-1 gap-3 rounded-xl border-2 border-[var(--border-strong)] bg-[var(--bg)] p-4 sm:grid-cols-2">
          <div>
            <dt className="text-[13px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              Credential ID
            </dt>
            <dd className="num mt-0.5 text-[16px] font-bold text-[var(--text)]">
              {formattedCredId}
            </dd>
          </div>
          <div>
            <dt className="text-[13px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              Enrolled Date &amp; RP
            </dt>
            <dd className="num mt-0.5 text-[16px] font-bold text-[var(--text)]">
              {enrolledDate}
              {profile?.rpID ? ` · RP ${profile.rpID}` : ""}
            </dd>
          </div>
        </dl>

        <p className="text-[15px] leading-relaxed text-[var(--text-muted)]">
          Your passkey signs the exact <span className="num">mandateHash</span>{" "}
          using your device fingerprint or face. The private key never leaves
          your device.
        </p>
      </section>

      {/* How KarenPay Works Summary */}
      <section
        aria-labelledby="how-it-works-heading"
        className="flex flex-col gap-3 rounded-2xl border-2 border-[var(--border-strong)] bg-[var(--surface)] p-5"
      >
        <h2
          id="how-it-works-heading"
          className="text-[20px] font-bold text-[var(--text)]"
        >
          How KarenPay Protects You
        </h2>

        <div className="flex items-start gap-3 rounded-xl border border-[var(--divider)] bg-[var(--bg)] p-3.5">
          <Volume2
            className="mt-0.5 h-5 w-5 shrink-0 text-[var(--text)]"
            aria-hidden="true"
          />
          <div>
            <h3 className="text-[16px] font-bold text-[var(--text)]">
              Mandatory Spoken Readout Lock
            </h3>
            <p className="text-[14px] text-[var(--text-muted)]">
              Approval stays physically locked until the server readout finishes
              speaking the recipient and amount in both words and digits.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-xl border border-[var(--divider)] bg-[var(--bg)] p-3.5">
          <Fingerprint
            className="mt-0.5 h-5 w-5 shrink-0 text-[var(--text)]"
            aria-hidden="true"
          />
          <div>
            <h3 className="text-[16px] font-bold text-[var(--text)]">
              Challenge-Bound Biometric Consent
            </h3>
            <p className="text-[14px] text-[var(--text-muted)]">
              Every payment approval requires a WebAuthn signature where{" "}
              <span className="num font-bold">challenge === mandateHash</span>.
            </p>
          </div>
        </div>
      </section>

      {/* Sign Out Button (>= 48px) */}
      <button
        type="button"
        onClick={() => void handleSignOut()}
        disabled={isSigningOut}
        className="inline-flex min-h-[56px] w-full items-center justify-center gap-2.5 rounded-2xl border-2 border-[var(--border-strong)] bg-[var(--surface-tint)] px-6 py-3.5 text-[17px] font-bold text-[var(--text)] hover:bg-[var(--peach)]"
      >
        <LogOut className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span>{isSigningOut ? "Signing out..." : "Sign out"}</span>
      </button>

      <BottomTabBar activeTab="me" />
    </div>
  );
}
