export interface ContactItem {
  id: string;
  displayName: string;
  paypalSandboxEmail: string;
  maskedHint: string;
}

export interface ActivityPreviewRow {
  id: string;
  title: string;
  reference: string;
  dateLabel: string;
  amountFormatted: string;
  statusLabel:
    | "Waiting for your approval"
    | "Approved and sending"
    | "Test payment sent"
    | "Not sent"
    | "Rejected"
    | "Expired";
  isBlocked?: boolean;
  isDemoPlaceholder?: boolean;
}

export const DEMO_HOLDER_DEFAULT_NAME = "Ade Bello";

export const DEMO_BALANCE_MINOR = 245_000; // $2,450.00
export const DEMO_VOICE_LIMIT_USED_MINOR = 5_000; // $50.00
export const DEMO_VOICE_LIMIT_MAX_MINOR = 50_000; // $500.00

export const DEMO_CONTACTS: readonly ContactItem[] = [
  {
    id: "33333333-3333-4333-8333-333333333333",
    displayName: "Ade Bello",
    paypalSandboxEmail: "ade.bello@sandbox.karenpay.test",
    maskedHint: "Sandbox •••• 6789",
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    displayName: "Ada Bello",
    paypalSandboxEmail: "ada.bello@sandbox.karenpay.test",
    maskedHint: "Sandbox •••• 5432",
  },
  {
    id: "55555555-5555-4555-8555-555555555555",
    displayName: "Chidi Okonkwo",
    paypalSandboxEmail: "chidi.okonkwo@sandbox.karenpay.test",
    maskedHint: "Sandbox •••• 2011",
  },
  {
    id: "66666666-6666-4666-8666-666666666666",
    displayName: "Fatima Yusuf",
    paypalSandboxEmail: "fatima.yusuf@sandbox.karenpay.test",
    maskedHint: "Sandbox •••• 8100",
  },
  {
    id: "77777777-7777-4777-8777-777777777777",
    displayName: "Tunde Bakare",
    paypalSandboxEmail: "tunde.bakare@sandbox.karenpay.test",
    maskedHint: "Sandbox •••• 2736",
  },
] as const;

export const DEMO_ACTIVITY_ROWS: readonly ActivityPreviewRow[] = [
  {
    id: "demo-act-1",
    title: "Test payment to Ade Bello",
    reference: "Ref KP-2048 · Sandbox demo",
    dateLabel: "Today, 2:10 PM",
    amountFormatted: "-$50.00",
    statusLabel: "Test payment sent",
    isDemoPlaceholder: true,
  },
  {
    id: "demo-act-2",
    title: "Test payment to Chidi Okonkwo",
    reference: "Ref KP-2019 · Sandbox demo",
    dateLabel: "Yesterday, 9:42 AM",
    amountFormatted: "-$25.00",
    statusLabel: "Test payment sent",
    isDemoPlaceholder: true,
  },
  {
    id: "demo-act-3",
    title: "Test payment to Fatima Yusuf",
    reference: "Ref KP-1984 · Sandbox demo",
    dateLabel: "Oct 20, 6:15 PM",
    amountFormatted: "-$15.00",
    statusLabel: "Test payment sent",
    isDemoPlaceholder: true,
  },
] as const;

/**
 * Formats integer minor units into $2,450.00 (or -$50.00 for debits) without float math.
 */
export function formatMoneyMinor(
  amountMinor: number,
  options?: { debit?: boolean },
): string {
  const abs = Math.abs(Math.trunc(amountMinor));
  const whole = Math.trunc(abs / 100).toLocaleString("en-US");
  const cents = String(abs % 100).padStart(2, "0");
  const prefix = options?.debit ? "-$" : "$";
  return `${prefix}${whole}.${cents}`;
}

export function getInitials(fullName: string): string {
  const parts = fullName
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) {
    return "KP";
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function getFirstName(fullName: string): string {
  const parts = fullName
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return parts[0] ?? "Friend";
}

export function getTimeOfDayGreeting(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) {
    return "Good morning";
  }
  if (hour < 18) {
    return "Good afternoon";
  }
  return "Good evening";
}

const FALLBACK_HINTS = ["6789", "5432", "2011", "8100", "2736"] as const;

export function withMaskedHint(
  raw: { id: string; displayName: string; paypalSandboxEmail: string },
  index: number,
): ContactItem {
  const matchedDemo = DEMO_CONTACTS.find(
    (c) =>
      c.id === raw.id ||
      c.displayName.toLowerCase() === raw.displayName.toLowerCase(),
  );
  if (matchedDemo) {
    return {
      ...raw,
      maskedHint: matchedDemo.maskedHint,
    };
  }
  const suffix = FALLBACK_HINTS[index % FALLBACK_HINTS.length];
  return {
    ...raw,
    maskedHint: `Sandbox •••• ${suffix}`,
  };
}
