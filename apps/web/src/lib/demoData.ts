export interface ContactItem {
  id: string;
  displayName: string;
  paypalSandboxEmail: string;
  maskedHint: string;
}

export interface ActivityPreviewRow {
  id: string;
  recipientName: string;
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
}

export const VOICE_POLICY_LIMIT_MAX_MINOR = 50_000; // $500.00 policy cap

const AVATAR_BG_CLASSES = ["bg-sun", "bg-peach", "bg-coral"] as const;

/**
 * Cycles avatar background across --sun, --peach, and --coral (all paired with --text).
 */
export function getAvatarBgClass(index: number): string {
  return AVATAR_BG_CLASSES[Math.abs(index) % AVATAR_BG_CLASSES.length];
}

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

export function formatUsdMinor(amountMinor: number): string {
  return formatMoneyMinor(amountMinor);
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
  return parts[0] ?? "Account";
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

export function withMaskedHint(raw: {
  id: string;
  displayName: string;
  paypalSandboxEmail: string;
}): ContactItem {
  const email = raw.paypalSandboxEmail.trim();
  const [localPart, domain] = email.split("@");
  const maskedLocal =
    localPart && localPart.length > 2
      ? `${localPart.slice(0, 2)}••••`
      : "••••";
  return {
    ...raw,
    maskedHint: domain ? `${maskedLocal}@${domain}` : email,
  };
}
