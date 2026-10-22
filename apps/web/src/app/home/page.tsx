"use client";

import {
  ArrowUpRight,
  Bell,
  Eye,
  EyeOff,
  History,
  Mic,
  ShieldAlert,
  ShieldCheck,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useCallback, useEffect, useState } from "react";
import { BottomTabBar } from "../../components/BottomTabBar";
import { Button } from "../../components/Button";
import { useLiveRegions } from "../../components/LiveRegions";
import {
  DEMO_ACTIVITY_ROWS,
  DEMO_BALANCE_MINOR,
  DEMO_CONTACTS,
  DEMO_HOLDER_DEFAULT_NAME,
  DEMO_VOICE_LIMIT_MAX_MINOR,
  DEMO_VOICE_LIMIT_USED_MINOR,
  formatMoneyMinor,
  getFirstName,
  getInitials,
  getTimeOfDayGreeting,
  withMaskedHint,
  type ActivityPreviewRow,
  type ContactItem,
} from "../../lib/demoData";

const HIDE_BALANCE_STORAGE_KEY = "kp_hide_balance";
const HOLDER_NAME_STORAGE_KEY = "kp_holder_name";

interface AuditEventApiRow {
  id: string;
  mandateId: string | null;
  eventType: string;
  detail: Record<string, unknown> | null;
  hash: string;
  createdAt: string;
}

function mapAuditEventToPreviewRow(event: AuditEventApiRow): ActivityPreviewRow {
  const isRejected =
    event.eventType.includes("REJECTED") || event.eventType.includes("FAILED");
  const detailAmount =
    event.detail && typeof event.detail.amountMinor === "number"
      ? event.detail.amountMinor
      : 5000;
  const shortRef = event.hash ? event.hash.slice(0, 8) : event.id.slice(0, 8);
  const dateObj = new Date(event.createdAt);
  const dateLabel = Number.isNaN(dateObj.getTime())
    ? "Recent"
    : dateObj.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      });

  if (isRejected) {
    return {
      id: event.id,
      title: "Blocked attempt",
      reference: `Ref ${shortRef}`,
      dateLabel,
      amountFormatted: "$0.00",
      statusLabel: event.eventType.includes("REJECTED")
        ? "Rejected"
        : "Not sent",
      isBlocked: true,
    };
  }

  return {
    id: event.id,
    title:
      event.eventType === "PAYMENT_SENT"
        ? "Test payment sent"
        : "Test payment prepared",
    reference: `Ref ${shortRef}`,
    dateLabel,
    amountFormatted: formatMoneyMinor(detailAmount, { debit: true }),
    statusLabel:
      event.eventType === "PAYMENT_SENT"
        ? "Test payment sent"
        : "Waiting for your approval",
    isBlocked: false,
  };
}

export default function HomePage() {
  const router = useRouter();
  const { announceStatus } = useLiveRegions();

  const [holderName, setHolderName] = useState<string>(
    DEMO_HOLDER_DEFAULT_NAME,
  );
  const [greeting, setGreeting] = useState<string>("Good afternoon");
  const [balanceHidden, setBalanceHidden] = useState<boolean>(false);
  const [contacts, setContacts] = useState<readonly ContactItem[]>(
    DEMO_CONTACTS,
  );
  const [activityRows, setActivityRows] =
    useState<readonly ActivityPreviewRow[]>(DEMO_ACTIVITY_ROWS);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadHomeData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const contactsRes = await fetch("/api/v1/contacts", {
        method: "GET",
        credentials: "include",
      });

      if (contactsRes.status === 401) {
        router.replace("/");
        return;
      }

      if (contactsRes.ok) {
        const body = (await contactsRes.json()) as {
          contacts?: Array<{
            id: string;
            displayName: string;
            paypalSandboxEmail: string;
          }>;
        };
        if (Array.isArray(body.contacts)) {
          setContacts(
            body.contacts.slice(0, 5).map((item, idx) =>
              withMaskedHint(item, idx),
            ),
          );
        }
      } else {
        // Standalone preview fallback when upstream backend is not running
        setContacts(DEMO_CONTACTS);
      }

      const auditRes = await fetch("/api/v1/audit", {
        method: "GET",
        credentials: "include",
      });
      if (auditRes.status === 401) {
        router.replace("/");
        return;
      }
      if (auditRes.ok) {
        const auditBody = (await auditRes.json()) as {
          events?: AuditEventApiRow[];
        };
        if (Array.isArray(auditBody.events) && auditBody.events.length > 0) {
          const latestThree = [...auditBody.events]
            .reverse()
            .slice(0, 3)
            .map(mapAuditEventToPreviewRow);
          setActivityRows(latestThree);
        } else {
          setActivityRows(DEMO_ACTIVITY_ROWS);
        }
      } else {
        setActivityRows(DEMO_ACTIVITY_ROWS);
      }
    } catch {
      // Keep demo fallback when running standalone UI server
      setContacts(DEMO_CONTACTS);
      setActivityRows(DEMO_ACTIVITY_ROWS);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    setGreeting(getTimeOfDayGreeting(new Date()));
    try {
      const savedHide = window.localStorage.getItem(HIDE_BALANCE_STORAGE_KEY);
      if (savedHide === "true") {
        setBalanceHidden(true);
      }
      const savedHolder = window.localStorage.getItem(HOLDER_NAME_STORAGE_KEY);
      if (savedHolder && savedHolder.trim().length > 0) {
        setHolderName(savedHolder.trim());
      }
    } catch {
      // Ignore storage access errors
    }
    void loadHomeData();
  }, [loadHomeData]);

  const handleToggleBalance = () => {
    setBalanceHidden((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(HIDE_BALANCE_STORAGE_KEY, String(next));
      } catch {
        // Ignore storage write errors
      }
      announceStatus(next ? "Balance hidden." : "Balance shown.", "neutral");
      return next;
    });
  };

  const firstName = getFirstName(holderName);
  const holderInitials = getInitials(holderName);
  const formattedBalance = formatMoneyMinor(DEMO_BALANCE_MINOR);
  const formattedUsed = formatMoneyMinor(DEMO_VOICE_LIMIT_USED_MINOR);
  const formattedMax = formatMoneyMinor(DEMO_VOICE_LIMIT_MAX_MINOR);
  const usedDollars = Math.trunc(DEMO_VOICE_LIMIT_USED_MINOR / 100);
  const maxDollars = Math.trunc(DEMO_VOICE_LIMIT_MAX_MINOR / 100);
  const progressPercent = Math.min(
    100,
    Math.round((usedDollars / Math.max(1, maxDollars)) * 100),
  );
  const exampleContactName = contacts[0]?.displayName ?? "Ade Bello";

  return (
    <div className="flex flex-1 flex-col pb-28">
      {/* 1. Header row */}
      <header className="flex items-center justify-between gap-3 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <div
            aria-hidden="true"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-surface-tint text-base font-bold text-text"
          >
            {holderInitials}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-base font-semibold text-text">
                {greeting}, {firstName}
              </h1>
              <span className="rounded-full bg-surface-tint px-2.5 py-0.5 text-sm font-medium text-text">
                Sandbox
              </span>
            </div>
          </div>
        </div>

        <button
          type="button"
          aria-label="Notifications"
          onClick={() =>
            announceStatus("No new notifications in this sandbox demo.")
          }
          className="inline-flex min-h-[48px] min-w-[48px] shrink-0 items-center justify-center rounded-full bg-surface text-text shadow-card transition-colors hover:bg-surface-tint"
        >
          <Bell aria-hidden="true" className="h-5 w-5" />
        </button>
      </header>

      <main className="mt-4 flex flex-col gap-6">
        {loadError && (
          <section className="rounded-card bg-warning-bg p-5 text-warning-text shadow-card">
            <p className="text-base font-medium">{loadError}</p>
            <div className="mt-3">
              <Button
                variant="secondary"
                onClick={() => void loadHomeData()}
              >
                Try again
              </Button>
            </div>
          </section>
        )}

        {/* 2. Balance card */}
        <section
          aria-label="Account balance"
          className="on-dark rounded-card bg-balance-card p-6 text-white shadow-card"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-base font-medium text-[#A7F3D0]">
              Available balance
            </span>
            <button
              type="button"
              aria-pressed={balanceHidden}
              aria-label={balanceHidden ? "Show balance" : "Hide balance"}
              onClick={handleToggleBalance}
              className="inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-full text-white transition-colors hover:bg-white/10"
            >
              {balanceHidden ? (
                <Eye aria-hidden="true" className="h-5 w-5" />
              ) : (
                <EyeOff aria-hidden="true" className="h-5 w-5" />
              )}
            </button>
          </div>

          <div className="mt-1">
            {balanceHidden ? (
              <p className="num text-[40px] font-bold leading-tight text-white">
                <span aria-hidden="true">••••••</span>
                <span className="sr-only">Balance hidden</span>
              </p>
            ) : (
              <p
                data-testid="home-balance-amount"
                className="num text-[40px] font-bold leading-tight text-white"
              >
                {formattedBalance}
              </p>
            )}
            <p className="mt-1 text-sm text-[#A7F3D0]">
              Sandbox demo balance. No real money.
            </p>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled
              aria-disabled="true"
              tabIndex={-1}
              className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-1.5 rounded-full border border-[#A7F3D0]/40 px-4 py-2.5 text-sm font-semibold text-[#A7F3D0]"
            >
              <span>Add money</span>
              <span className="text-sm font-normal">· Coming soon</span>
            </button>

            <Link
              href="/activity"
              className="inline-flex min-h-[48px] flex-1 items-center justify-center rounded-full bg-surface px-4 py-2.5 text-center text-sm font-semibold text-text transition-colors hover:bg-surface-tint"
            >
              Transaction history
            </Link>
          </div>

          <div className="mt-5">
            <div className="flex items-center justify-between gap-2 text-sm text-[#A7F3D0]">
              <span id="voice-limit-label" className="num">
                Voice limit today {formattedUsed} of {formattedMax}
              </span>
              <span className="rounded-full border border-white/40 px-2.5 py-0.5 text-sm font-medium text-white">
                Demo
              </span>
            </div>
            <div
              role="progressbar"
              aria-labelledby="voice-limit-label"
              aria-valuenow={usedDollars}
              aria-valuemin={0}
              aria-valuemax={maxDollars}
              className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-white/20"
            >
              <div
                className="h-full rounded-full bg-[#A7F3D0]"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        </section>

        {/* 3. Quick actions */}
        <section aria-labelledby="quick-actions-heading">
          <h2 id="quick-actions-heading" className="sr-only">
            Quick actions
          </h2>
          <div className="grid grid-cols-4 gap-3">
            <Link
              href="/pay"
              className="flex min-h-[64px] min-w-[48px] flex-col items-center justify-center gap-2 rounded-card bg-surface p-3 text-center shadow-card transition-colors hover:bg-surface-tint"
            >
              <span
                aria-hidden="true"
                className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white"
              >
                <Mic aria-hidden="true" className="h-6 w-6" />
              </span>
              <span className="text-sm font-semibold text-text">Voice pay</span>
            </Link>

            <Link
              href="/contacts"
              className="flex min-h-[64px] min-w-[48px] flex-col items-center justify-center gap-2 rounded-card bg-surface p-3 text-center shadow-card transition-colors hover:bg-surface-tint"
            >
              <span
                aria-hidden="true"
                className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-tint text-primary-strong"
              >
                <Users aria-hidden="true" className="h-6 w-6" />
              </span>
              <span className="text-sm font-medium text-text">Contacts</span>
            </Link>

            <Link
              href="/activity"
              className="flex min-h-[64px] min-w-[48px] flex-col items-center justify-center gap-2 rounded-card bg-surface p-3 text-center shadow-card transition-colors hover:bg-surface-tint"
            >
              <span
                aria-hidden="true"
                className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-tint text-primary-strong"
              >
                <History aria-hidden="true" className="h-6 w-6" />
              </span>
              <span className="text-sm font-medium text-text">Activity</span>
            </Link>

            <Link
              href="/me"
              className="flex min-h-[64px] min-w-[48px] flex-col items-center justify-center gap-2 rounded-card bg-surface p-3 text-center shadow-card transition-colors hover:bg-surface-tint"
            >
              <span
                aria-hidden="true"
                className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-tint text-primary-strong"
              >
                <ShieldCheck aria-hidden="true" className="h-6 w-6" />
              </span>
              <span className="text-sm font-medium text-text">Security</span>
            </Link>
          </div>
        </section>

        {/* 4. Recent recipients */}
        <section aria-labelledby="recent-recipients-heading">
          <div className="flex items-center justify-between gap-2">
            <h2
              id="recent-recipients-heading"
              className="text-[20px] font-semibold text-text"
            >
              Recent recipients
            </h2>
          </div>

          {contacts.length === 0 ? (
            <p className="mt-3 rounded-card bg-surface p-4 text-sm text-text-muted shadow-card">
              No saved contacts yet.
            </p>
          ) : (
            <div className="mt-3 flex items-center gap-3 overflow-x-auto pb-1">
              {contacts.map((contact) => (
                <Link
                  key={contact.id}
                  href="/contacts"
                  className="flex min-h-[64px] min-w-[68px] shrink-0 flex-col items-center justify-center gap-1.5 rounded-input bg-surface px-3 py-2.5 text-center shadow-card transition-colors hover:bg-surface-tint"
                >
                  <span
                    aria-hidden="true"
                    className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-tint text-sm font-bold text-text"
                  >
                    {getInitials(contact.displayName)}
                  </span>
                  <span className="text-sm font-medium text-text">
                    {getFirstName(contact.displayName)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* 5. Recent activity */}
        <section aria-labelledby="recent-activity-heading">
          <div className="flex items-center justify-between gap-2">
            <h2
              id="recent-activity-heading"
              className="text-[20px] font-semibold text-text"
            >
              Recent activity
            </h2>
            <Link
              href="/activity"
              className="inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-full px-3 text-sm font-semibold text-primary-strong transition-colors hover:bg-surface-tint"
            >
              See all
            </Link>
          </div>

          <div className="mt-2 rounded-card bg-surface p-5 shadow-card">
            {loading ? (
              <p className="text-base text-text-muted">
                Loading recent activity…
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-divider">
                {activityRows.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between gap-3 py-3.5 first:pt-0 last:pb-0"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        aria-hidden="true"
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                          item.isBlocked
                            ? "bg-warning-bg text-warning-text"
                            : "bg-surface-tint text-primary-strong"
                        }`}
                      >
                        {item.isBlocked ? (
                          <ShieldAlert aria-hidden="true" className="h-5 w-5" />
                        ) : (
                          <ArrowUpRight
                            aria-hidden="true"
                            className="h-5 w-5"
                          />
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-base font-medium text-text">
                          {item.title}
                        </p>
                        <p className="num truncate text-sm text-text-muted">
                          {item.reference} · {item.dateLabel}
                        </p>
                      </div>
                    </div>

                    <div className="shrink-0 text-right">
                      <p
                        data-testid="home-activity-amount"
                        className="num text-base font-semibold text-text"
                      >
                        {item.amountFormatted}
                      </p>
                      <p className="text-sm text-text-muted">
                        {item.statusLabel}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* 6. Tip card */}
        <section
          aria-label="Voice payment tip"
          className="flex items-center gap-3.5 rounded-card bg-surface-tint p-4"
        >
          <span
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface text-primary-strong"
          >
            <Mic aria-hidden="true" className="h-5 w-5" />
          </span>
          <p className="text-base font-medium text-text">
            Try it. Say: Send 50 dollars to {exampleContactName}.
          </p>
        </section>
      </main>

      {/* 7. Bottom tab bar */}
      <BottomTabBar activeTab="home" />
    </div>
  );
}
