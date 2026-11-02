"use client";

import { ArrowLeft, Send, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useCallback, useEffect, useId, useState } from "react";
import { BottomTabBar } from "../../components/BottomTabBar";
import { Button } from "../../components/Button";
import { useLiveRegions } from "../../components/LiveRegions";
import {
  getAvatarBgClass,
  getInitials,
  withMaskedHint,
  type ContactItem,
} from "../../lib/demoData";

export default function ContactsPage() {
  const router = useRouter();
  const { announceStatus, clearStatus } = useLiveRegions();
  const nameInputId = useId();
  const emailInputId = useId();

  const [contacts, setContacts] = useState<readonly ContactItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [showAddForm, setShowAddForm] = useState<boolean>(false);
  const [newDisplayName, setNewDisplayName] = useState<string>("");
  const [newSandboxEmail, setNewSandboxEmail] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const loadContacts = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/v1/contacts", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });

      if (response.status === 401) {
        router.replace("/");
        return;
      }

      const body = (await response.json()) as {
        contacts?: Array<{
          id: string;
          displayName: string;
          paypalSandboxEmail: string;
        }>;
        message?: string;
        spoken?: string;
      };

      if (!response.ok) {
        setErrorMessage(
          body.spoken ?? body.message ?? "Your contacts could not be loaded.",
        );
        setContacts([]);
        return;
      }

      if (Array.isArray(body.contacts)) {
        setContacts(
          body.contacts.slice(0, 5).map((item) => withMaskedHint(item)),
        );
      } else {
        setContacts([]);
      }
    } catch {
      setErrorMessage("Unable to connect to the server to load your contacts.");
      setContacts([]);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void loadContacts();
  }, [loadContacts]);

  const handleCreateContact = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const displayName = newDisplayName.trim();
    const paypalSandboxEmail = newSandboxEmail.trim();

    if (!displayName || !paypalSandboxEmail) {
      const msg = "Please enter both a contact name and PayPal Sandbox email.";
      setErrorMessage(msg);
      announceStatus(msg, "error");
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);
    clearStatus();

    try {
      const res = await fetch("/api/v1/contacts", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, paypalSandboxEmail }),
      });

      if (res.status === 401) {
        router.replace("/");
        return;
      }

      const body = (await res.json()) as {
        contact?: {
          id: string;
          displayName: string;
          paypalSandboxEmail: string;
        };
        spoken?: string;
        message?: string;
      };

      if (!res.ok || !body.contact) {
        const msg =
          body.spoken ?? body.message ?? "The contact could not be saved.";
        setErrorMessage(msg);
        announceStatus(msg, "error");
        return;
      }

      setNewDisplayName("");
      setNewSandboxEmail("");
      setShowAddForm(false);
      announceStatus(
        body.spoken ?? `Added ${body.contact.displayName} to your contacts.`,
        "neutral",
      );
      await loadContacts();
    } catch {
      const msg = "Unable to save contact. Please check your connection.";
      setErrorMessage(msg);
      announceStatus(msg, "error");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col pb-28">
      <header className="flex items-center justify-between gap-3 py-2">
        <div className="flex items-center gap-3">
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
              Saved recipients for voice payments ({contacts.length} of 5 used)
            </p>
          </div>
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
                Add up to 5 allowed recipients below to send voice payments.
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
                        className="num truncate text-sm text-text-muted"
                      >
                        {contact.maskedHint}
                      </p>
                    </div>
                  </div>

                  <Link
                    href={`/pay?contactId=${encodeURIComponent(contact.id)}&recipient=${encodeURIComponent(contact.displayName)}`}
                    aria-label={`Pay ${contact.displayName}`}
                    className="inline-flex min-h-[48px] shrink-0 items-center gap-1.5 rounded-full bg-surface-tint px-4 py-2 text-sm font-bold text-text no-underline hover:bg-peach"
                  >
                    <Send aria-hidden="true" className="h-4 w-4" />
                    <span>Pay</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {contacts.length < 5 && !showAddForm && (
          <Button
            type="button"
            variant="primary"
            icon={<UserPlus className="h-5 w-5" />}
            onClick={() => setShowAddForm(true)}
          >
            Add contact
          </Button>
        )}

        {showAddForm && (
          <form
            onSubmit={(e) => void handleCreateContact(e)}
            className="flex flex-col gap-4 rounded-card border border-divider bg-surface p-5 shadow-card"
          >
            <h2 className="text-lg font-bold text-text">New recipient</h2>

            <div>
              <label
                htmlFor={nameInputId}
                className="block text-sm font-bold text-text"
              >
                Full name
              </label>
              <input
                id={nameInputId}
                type="text"
                required
                value={newDisplayName}
                onChange={(e) => setNewDisplayName(e.target.value)}
                placeholder="e.g. Ade Bello"
                className="mt-1.5 min-h-[48px] w-full rounded-input border-2 border-input-border bg-bg px-4 py-2.5 text-base font-bold text-text"
              />
            </div>

            <div>
              <label
                htmlFor={emailInputId}
                className="block text-sm font-bold text-text"
              >
                PayPal Sandbox email
              </label>
              <input
                id={emailInputId}
                type="email"
                required
                value={newSandboxEmail}
                onChange={(e) => setNewSandboxEmail(e.target.value)}
                placeholder="recipient@sandbox.paypal.com"
                className="num mt-1.5 min-h-[48px] w-full rounded-input border-2 border-input-border bg-bg px-4 py-2.5 text-base font-bold text-text"
              />
            </div>

            <div className="flex flex-wrap gap-3">
              <Button
                type="submit"
                variant="primary"
                loading={isSaving}
                className="flex-1"
              >
                Save contact
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={isSaving}
                onClick={() => setShowAddForm(false)}
                className="flex-1"
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
      </main>

      <BottomTabBar activeTab="home" />
    </div>
  );
}
