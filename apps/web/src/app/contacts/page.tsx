"use client";

import { ArrowLeft, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useCallback, useEffect, useState } from "react";
import { BottomTabBar } from "../../components/BottomTabBar";
import { Button } from "../../components/Button";
import {
  DEMO_CONTACTS,
  getAvatarBgClass,
  getInitials,
  withMaskedHint,
  type ContactItem,
} from "../../lib/demoData";

export default function ContactsPage() {
  const router = useRouter();
  const [contacts, setContacts] = useState<readonly ContactItem[]>(
    DEMO_CONTACTS,
  );
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadContacts = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/v1/contacts", {
        method: "GET",
        credentials: "include",
      });

      if (response.status === 401) {
        router.replace("/");
        return;
      }

      if (response.ok) {
        const body = (await response.json()) as {
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
          return;
        }
      }

      setContacts(DEMO_CONTACTS);
    } catch {
      setContacts(DEMO_CONTACTS);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void loadContacts();
  }, [loadContacts]);

  return (
    <div className="flex flex-1 flex-col pb-28">
      <header className="flex items-center gap-3 py-2">
        <Link
          href="/home"
          aria-label="Back to home"
          className="inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-full border border-divider bg-surface text-text shadow-card transition-colors hover:bg-surface-tint"
        >
          <ArrowLeft aria-hidden="true" className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-[28px] font-bold leading-tight text-text">
            Contacts
          </h1>
          <p className="text-sm text-text-muted">
            Saved recipients for sandbox voice payments (maximum 5)
          </p>
        </div>
      </header>

      <main className="mt-5 flex flex-1 flex-col gap-5">
        {errorMessage && (
          <section className="rounded-card bg-warning-bg p-5 text-warning-text shadow-card">
            <p className="text-base font-medium">{errorMessage}</p>
            <div className="mt-3">
              <Button variant="secondary" onClick={() => void loadContacts()}>
                Try again
              </Button>
            </div>
          </section>
        )}

        <section aria-label="Saved contacts">
          {loading ? (
            <div className="rounded-card border border-divider bg-surface p-5 shadow-card">
              <p className="text-base text-text-muted">Loading contacts…</p>
            </div>
          ) : contacts.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-card border border-divider bg-surface p-6 text-center shadow-card">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-tint text-text">
                <Users aria-hidden="true" className="h-6 w-6" />
              </div>
              <p className="text-base font-bold text-text">
                No contacts saved yet
              </p>
              <p className="text-sm text-text-muted">
                Saved contacts will appear here for voice test payments.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {contacts.slice(0, 5).map((contact, idx) => (
                <li
                  key={contact.id}
                  className="flex items-center justify-between gap-3 rounded-card border border-divider bg-surface p-4 shadow-card"
                >
                  <div className="flex min-w-0 items-center gap-3.5">
                    <span
                      aria-hidden="true"
                      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base font-bold text-text ${getAvatarBgClass(idx)}`}
                    >
                      {getInitials(contact.displayName)}
                    </span>
                    <div className="min-w-0">
                      <p className="text-base font-bold text-text">
                        {contact.displayName}
                      </p>
                      <p
                        data-testid="contact-masked-hint"
                        className="num text-sm text-text-muted"
                      >
                        {contact.maskedHint}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <button
          type="button"
          disabled
          aria-disabled="true"
          tabIndex={-1}
          className="inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-full bg-surface-tint px-5 py-3 text-base font-bold text-text"
        >
          <UserPlus aria-hidden="true" className="h-5 w-5" />
          <span>Add contact</span>
          <span className="text-sm font-normal text-text-muted">
            · Coming soon
          </span>
        </button>
      </main>

      <BottomTabBar activeTab="home" />
    </div>
  );
}
