"use client";

import {
  Fingerprint,
  LogOut,
  Volume2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import React, { useEffect, useRef, useState } from "react";
import { BottomTabBar } from "../../components/BottomTabBar";
import { useAnnounce } from "../../components/LiveRegions";
import { getInitials } from "../../lib/demoData";
import { VoiceModeToggle } from "../../components/VoiceModeToggle";

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
  const enrolledDate = activeCredential?.createdAt
    ? new Date(activeCredential.createdAt).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "2-digit",
      })
    : "Active session";

  return (
    <div className="flex flex-col gap-6 pb-24 pt-7">
      <div>
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-[28px] font-bold leading-[1.2] text-[var(--text)] outline-none"
        >
          Me &amp; Passkey Security
        </h1>
        <p className="mt-1 text-[16px] text-[var(--text-muted)]">
          Manage your account and approval method.
        </p>
      </div>

      {/* Account Holder Profile Card */}
      <section
        aria-label="Account profile"
        className="flex items-center gap-[18px] rounded-card border border-[var(--divider)] bg-[var(--surface)] p-6"
      >
        <div className="flex items-center gap-4">
          <div
            aria-hidden="true"
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-[var(--border-strong)] bg-[var(--sun)] text-[20px] font-bold text-[var(--text)]"
          >
            {getInitials(holderName)}
          </div>
          <div className="min-w-0">
            <h2 className="text-[20px] font-bold text-[var(--text)]">
              {holderName || "Signed-in Account"}
            </h2>
            <p className="num text-[14px] text-[var(--text-muted)]">
              Account:{" "}
              {profile?.accountId
                ? `${profile.accountId.slice(0, 8)}...${profile.accountId.slice(-4)}`
                : "Authenticated"}
            </p>
            <span className="mt-1 inline-flex min-h-[26px] items-center rounded-full bg-[var(--surface-tint)] px-3 py-1 text-[13px] font-bold text-[var(--text)]">
              Sandbox account
            </span>
          </div>
        </div>
      </section>

      {/* Active passkey card */}
      <section
        aria-labelledby="passkey-card-heading"
        className="flex flex-col gap-[18px] rounded-card border border-[var(--divider)] bg-[var(--surface)] p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <h2
              id="passkey-card-heading"
              className="text-[20px] font-bold text-[var(--text)]"
            >
              Your passkey
            </h2>
          </div>

          <span className="inline-flex min-h-[26px] items-center gap-1.5 rounded-full bg-[var(--sun)] px-3 py-1 text-[13px] font-bold text-[var(--text)]">
            <span>Active on this device</span>
          </span>
        </div>

        <dl className="flex flex-col gap-4 rounded-input bg-[var(--bg)] p-5">
          <div>
            <dt className="text-[13px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              Approval method
            </dt>
            <dd className="mt-0.5 text-[17px] font-bold text-[var(--text)]">
              Fingerprint, face, or device PIN
            </dd>
          </div>
          <div>
            <dt className="text-[13px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              Added on
            </dt>
            <dd className="num mt-0.5 text-[17px] font-bold text-[var(--text)]">
              {enrolledDate}
            </dd>
          </div>
        </dl>

        <p className="text-[15px] leading-relaxed text-[var(--text-muted)]">
          Your passkey keeps approval on your device. KarenPay never approves a
          transfer for you.
        </p>
      </section>

      {/* How KarenPay Works Summary */}
      <section aria-labelledby="how-it-works-heading" className="flex flex-col gap-3">
        <h2
          id="how-it-works-heading"
          className="text-[20px] font-bold text-[var(--text)]"
        >
          How KarenPay Protects You
        </h2>

        <div className="flex items-start gap-4 rounded-input border border-[var(--divider)] bg-[var(--surface)] p-5">
          <Volume2
            className="mt-0.5 h-10 w-10 shrink-0 rounded-full bg-[var(--surface-tint)] p-2.5 text-[var(--text)]"
            aria-hidden="true"
          />
          <div>
            <h3 className="text-[16px] font-bold text-[var(--text)]">
              Hear it before you approve
            </h3>
            <p className="text-[14px] text-[var(--text-muted)]">
              Approval stays locked until you hear the recipient and amount
              spoken aloud in both words and digits.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-4 rounded-input border border-[var(--divider)] bg-[var(--surface)] p-5">
          <Fingerprint
            className="mt-0.5 h-10 w-10 shrink-0 rounded-full bg-[var(--surface-tint)] p-2.5 text-[var(--text)]"
            aria-hidden="true"
          />
          <div>
            <h3 className="text-[16px] font-bold text-[var(--text)]">
              Approve it yourself
            </h3>
            <p className="text-[14px] text-[var(--text-muted)]">
              Each payment still needs your fingerprint, face, or device PIN.
              Your approval is never shared with anyone else.
            </p>
          </div>
        </div>
      </section>

      <section
        aria-labelledby="voice-mode-heading"
        className="flex flex-col gap-3 rounded-card border border-divider bg-surface p-5"
      >
        <div>
          <h2 id="voice-mode-heading" className="text-[20px] font-bold text-text">
            Voice-only mode
          </h2>
          <p className="mt-1 text-[15px] text-text-muted">
            Use a focused speak-and-listen payment screen. Your security checks
            stay the same.
          </p>
        </div>
        <VoiceModeToggle />
      </section>

      {/* Sign Out Button (>= 48px) */}
      <button
        type="button"
        onClick={() => void handleSignOut()}
        disabled={isSigningOut}
        className="inline-flex min-h-[56px] w-full items-center justify-center gap-2.5 rounded-full bg-[var(--surface-tint)] px-6 py-3.5 text-[17px] font-bold text-[var(--text)] hover:bg-[var(--peach)]"
      >
        <LogOut className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span>{isSigningOut ? "Signing out..." : "Sign out"}</span>
      </button>

      <BottomTabBar activeTab="me" />
    </div>
  );
}
