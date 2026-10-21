import canonicalizeJson from "canonicalize";
import { createHash } from "node:crypto";
import { z } from "zod";

export type JsonValue = boolean | null | number | string | JsonValue[] | { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(), z.number().finite(), z.boolean(), z.null(), z.array(JsonValueSchema), z.record(JsonValueSchema),
]));

/** Immutable consented payment data. Mutable execution state is not hashed. */
export const MandateSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  action: z.literal("send_money"),
  payeeContactId: z.string().uuid(),
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: z.string().regex(/^[A-Z]{3}$/),
  constraints: z.record(JsonValueSchema),
  requestHash: z.string().min(1),
  nonce: z.string().min(1),
  issuedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  spokenText: z.string().min(1),
}).strict().refine(
  (mandate) => Date.parse(mandate.expiresAt) > Date.parse(mandate.issuedAt),
  { message: "expiresAt must be after issuedAt", path: ["expiresAt"] },
);

export type Mandate = z.infer<typeof MandateSchema>;

export function buildMandate(input: unknown): Mandate {
  return MandateSchema.parse(input);
}

/** Returns the RFC 8785 JSON Canonicalization Scheme representation. */
export function canonicalize(mandate: Mandate): string {
  const canonical = canonicalizeJson(mandate);
  if (canonical === undefined) {
    throw new Error("Mandate cannot be represented as canonical JSON");
  }
  return canonical;
}

/** Returns base64url(SHA-256(RFC 8785 canonical mandate)). */
export function hashMandate(mandate: Mandate): string {
  return createHash("sha256").update(canonicalize(mandate), "utf8").digest("base64url");
}

export const PaymentProposalSchema = z.object({
  action: z.literal("send_money"),
  payeeContactId: z.string().uuid(),
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: z.string().regex(/^[A-Z]{3}$/),
}).strict();

export type PaymentProposal = z.infer<typeof PaymentProposalSchema>;

export const IntentConstraintsSchema = z.object({
  action: z.literal("send_money"),
  payeeContactId: z.string().uuid(),
  maximumAmountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: z.string().regex(/^[A-Z]{3}$/),
}).strict();

export type IntentConstraints = z.infer<typeof IntentConstraintsSchema>;

export type IntentCheckResult =
  | { accepted: true }
  | { accepted: false; code: "ACTION_MISMATCH" | "RECIPIENT_MISMATCH" | "AMOUNT_EXCEEDS_REQUEST" | "CURRENCY_MISMATCH" };

/** Compares an AI proposal with the constraints extracted from the request. */
export function checkIntent(proposal: PaymentProposal, constraints: IntentConstraints): IntentCheckResult {
  if (proposal.action !== constraints.action) {
    return { accepted: false, code: "ACTION_MISMATCH" };
  }
  if (proposal.payeeContactId !== constraints.payeeContactId) {
    return { accepted: false, code: "RECIPIENT_MISMATCH" };
  }
  if (proposal.amountMinor > constraints.maximumAmountMinor) {
    return { accepted: false, code: "AMOUNT_EXCEEDS_REQUEST" };
  }
  if (proposal.currency !== constraints.currency) {
    return { accepted: false, code: "CURRENCY_MISMATCH" };
  }
  return { accepted: true };
}

export const ContactSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string().trim().min(1).max(100),
  paypalSandboxEmail: z.string().email(),
}).strict();

export type Contact = z.infer<typeof ContactSchema>;

export const PaymentPolicySchema = z.object({
  maximumAmountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  allowedCurrencies: z.array(z.string().regex(/^[A-Z]{3}$/)).min(1),
}).strict();

export type PaymentPolicy = z.infer<typeof PaymentPolicySchema>;

export type LimitCheckResult =
  | { accepted: true }
  | { accepted: false; code: "INVALID_AMOUNT" | "AMOUNT_EXCEEDS_POLICY" | "CURRENCY_NOT_ALLOWED" | "RECIPIENT_NOT_FOUND" };

/** Enforces policy limits after a proposal has passed the intent check. */
export function checkLimits(
  proposal: PaymentProposal,
  policy: PaymentPolicy,
  contacts: readonly Contact[],
): LimitCheckResult {
  if (!Number.isSafeInteger(proposal.amountMinor) || proposal.amountMinor <= 0) {
    return { accepted: false, code: "INVALID_AMOUNT" };
  }
  if (proposal.amountMinor > policy.maximumAmountMinor) {
    return { accepted: false, code: "AMOUNT_EXCEEDS_POLICY" };
  }
  if (!policy.allowedCurrencies.includes(proposal.currency)) {
    return { accepted: false, code: "CURRENCY_NOT_ALLOWED" };
  }
  if (!contacts.some((contact) => contact.id === proposal.payeeContactId)) {
    return { accepted: false, code: "RECIPIENT_NOT_FOUND" };
  }
  return { accepted: true };
}

export interface ReadoutInput {
  proposal: PaymentProposal;
  payeeDisplayName: string;
  requestConstraints?: IntentConstraints;
}

/** Builds the exact, deterministic text that must be read before approval. */
export function buildReadout(input: ReadoutInput): string {
  const name = input.payeeDisplayName.trim();
  if (!name) {
    throw new Error("payeeDisplayName is required");
  }
  const amount = formatAmount(input.proposal.amountMinor, input.proposal.currency);
  const digits = formatDigits(input.proposal.amountMinor, input.proposal.currency);
  const comparison = input.requestConstraints
    ? ` You asked for under ${formatAmount(input.requestConstraints.maximumAmountMinor, input.requestConstraints.currency)}.`
    : "";
  return `You asked to send ${amount} to ${name}. That is ${digits}.${comparison} This is a sandbox test payment. To approve, use your fingerprint or face now.`;
}

function formatAmount(amountMinor: number, currency: string): string {
  if (currency !== "USD") {
    return `${amountMinor} minor units of ${currency}`;
  }
  const whole = Math.floor(amountMinor / 100);
  const fraction = amountMinor % 100;
  const dollars = `${integerToWords(whole)} ${whole === 1 ? "dollar" : "dollars"}`;
  if (fraction === 0) {
    return dollars;
  }
  return `${dollars} and ${integerToWords(fraction)} ${fraction === 1 ? "cent" : "cents"}`;
}

function formatDigits(amountMinor: number, currency: string): string {
  if (currency !== "USD") {
    return `${digitsToWords(String(amountMinor))} minor units of ${currency}`;
  }
  const whole = Math.floor(amountMinor / 100);
  const fraction = amountMinor % 100;
  const wholeDigits = digitsToWords(String(whole));
  if (fraction === 0) {
    return `${wholeDigits} ${whole === 1 ? "dollar" : "dollars"}`;
  }
  return `${wholeDigits} point ${digitsToWords(String(fraction).padStart(2, "0"))} dollars`;
}

function digitsToWords(digits: string): string {
  const names = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
  return digits.split("").map((digit) => names[Number(digit)]).join(", ");
}

function integerToWords(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0 || value > 999_999_999_999) {
    throw new Error("Amount is outside the supported readout range");
  }
  if (value === 0) {
    return "zero";
  }
  const underTwenty = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  const scales = ["", "thousand", "million", "billion"];
  const underThousand = (number: number): string => {
    const parts: string[] = [];
    if (number >= 100) {
      parts.push(underTwenty[Math.floor(number / 100)], "hundred");
      number %= 100;
    }
    if (number >= 20) {
      parts.push(tens[Math.floor(number / 10)]);
      number %= 10;
    }
    if (number > 0) {
      parts.push(underTwenty[number]);
    }
    return parts.join(" ");
  };
  const groups: string[] = [];
  let remaining = value;
  let scaleIndex = 0;
  while (remaining > 0) {
    const group = remaining % 1000;
    if (group > 0) {
      groups.unshift(`${underThousand(group)}${scales[scaleIndex] ? ` ${scales[scaleIndex]}` : ""}`);
    }
    remaining = Math.floor(remaining / 1000);
    scaleIndex += 1;
  }
  return groups.join(" ");
}

export const MandateStateSchema = z.enum([
  "CREATED",
  "CONSUMED",
  "PAID",
  "FAILED",
  "REJECTED",
  "EXPIRED",
]);

export type MandateState = z.infer<typeof MandateStateSchema>;

export type MandateEvent = "CONSUME" | "REJECT" | "PAYMENT_SUCCEEDED" | "PAYMENT_FAILED";

export type StateTransitionResult =
  | { accepted: true; state: MandateState }
  | { accepted: false; state: MandateState; code: "INVALID_TRANSITION" };

/**
 * Calculates state transitions without reading a clock or mutating storage.
 * The database repeats the CREATED-to-CONSUMED guard atomically before payment.
 */
export function transitionMandateState(
  state: MandateState,
  event: MandateEvent,
  expiresAt: Date,
  now: Date,
): StateTransitionResult {
  if (event === "CONSUME" && state === "CREATED") {
    return now >= expiresAt
      ? { accepted: true, state: "EXPIRED" }
      : { accepted: true, state: "CONSUMED" };
  }
  if (event === "REJECT" && state === "CREATED") {
    return { accepted: true, state: "REJECTED" };
  }
  if (event === "PAYMENT_SUCCEEDED" && state === "CONSUMED") {
    return { accepted: true, state: "PAID" };
  }
  if (event === "PAYMENT_FAILED" && state === "CONSUMED") {
    return { accepted: true, state: "FAILED" };
  }
  return { accepted: false, state, code: "INVALID_TRANSITION" };
}
