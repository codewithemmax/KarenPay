import { createHash } from "node:crypto";
import { z } from "zod";

export const MAX_BULK_RECIPIENTS = 5;

export const BulkAccountNumberSchema = z.string().regex(/^[0-9]{10}$/);

export interface NigerianBankEntry {
  canonicalName: string;
  shortAlias: string;
  aliases: readonly string[];
}

export const NIGERIAN_BANK_DIRECTORY: readonly NigerianBankEntry[] = [
  {
    canonicalName: "Cleva Bank",
    shortAlias: "Cleva",
    aliases: ["cleva", "cleva bank"],
  },
  {
    canonicalName: "Guaranty Trust Bank",
    shortAlias: "GTB",
    aliases: [
      "gtb",
      "gtbank",
      "gt bank",
      "guaranty trust",
      "guaranty trust bank",
      "gtco",
    ],
  },
  {
    canonicalName: "Access Bank",
    shortAlias: "Access",
    aliases: ["access", "access bank", "diamond bank", "access diamond"],
  },
  {
    canonicalName: "Zenith Bank",
    shortAlias: "Zenith",
    aliases: ["zenith", "zenith bank"],
  },
  {
    canonicalName: "United Bank for Africa",
    shortAlias: "UBA",
    aliases: ["uba", "u.b.a", "united bank for africa"],
  },
  {
    canonicalName: "First Bank of Nigeria",
    shortAlias: "FBN",
    aliases: ["first bank", "firstbank", "fbn", "first bank of nigeria"],
  },
  {
    canonicalName: "Kuda Bank",
    shortAlias: "Kuda",
    aliases: ["kuda", "kuda bank", "kuda mfb", "kuda microfinance bank"],
  },
  {
    canonicalName: "OPay",
    shortAlias: "OPay",
    aliases: ["opay", "o-pay", "opay digital", "paycom"],
  },
  {
    canonicalName: "Moniepoint",
    shortAlias: "Moniepoint",
    aliases: ["moniepoint", "moniepoint mfb", "teamapt"],
  },
  {
    canonicalName: "PalmPay",
    shortAlias: "PalmPay",
    aliases: ["palmpay", "palm pay"],
  },
  {
    canonicalName: "Fidelity Bank",
    shortAlias: "Fidelity",
    aliases: ["fidelity", "fidelity bank"],
  },
  {
    canonicalName: "Stanbic IBTC Bank",
    shortAlias: "Stanbic",
    aliases: ["stanbic", "stanbic ibtc", "stanbic ibtc bank", "ibtc"],
  },
  {
    canonicalName: "First City Monument Bank",
    shortAlias: "FCMB",
    aliases: ["fcmb", "first city monument bank"],
  },
  {
    canonicalName: "Union Bank of Nigeria",
    shortAlias: "Union",
    aliases: ["union", "union bank", "union bank of nigeria"],
  },
  {
    canonicalName: "Sterling Bank",
    shortAlias: "Sterling",
    aliases: ["sterling", "sterling bank"],
  },
  {
    canonicalName: "Wema Bank",
    shortAlias: "Wema",
    aliases: ["wema", "wema bank", "alat", "alat by wema"],
  },
  {
    canonicalName: "Polaris Bank",
    shortAlias: "Polaris",
    aliases: ["polaris", "polaris bank", "skye bank"],
  },
  {
    canonicalName: "Ecobank Nigeria",
    shortAlias: "Ecobank",
    aliases: ["ecobank", "eco bank", "ecobank nigeria"],
  },
  {
    canonicalName: "Keystone Bank",
    shortAlias: "Keystone",
    aliases: ["keystone", "keystone bank"],
  },
  {
    canonicalName: "Unity Bank",
    shortAlias: "Unity",
    aliases: ["unity", "unity bank"],
  },
  {
    canonicalName: "Providus Bank",
    shortAlias: "Providus",
    aliases: ["providus", "providus bank"],
  },
  {
    canonicalName: "Jaiz Bank",
    shortAlias: "Jaiz",
    aliases: ["jaiz", "jaiz bank"],
  },
  {
    canonicalName: "Carbon",
    shortAlias: "Carbon",
    aliases: ["carbon", "carbon mfb", "onefi"],
  },
  {
    canonicalName: "VFD Microfinance Bank",
    shortAlias: "VFD",
    aliases: ["vfd", "vbank", "vfd mfb", "vfd microfinance bank"],
  },
];

function normalizeText(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Matches a bank token or phrase against at least 20 Nigerian bank aliases.
 */
export function resolveBankName(raw: string): NigerianBankEntry | null {
  const normalized = normalizeText(raw);
  if (!normalized) return null;

  for (const entry of NIGERIAN_BANK_DIRECTORY) {
    if (normalizeText(entry.canonicalName) === normalized) {
      return entry;
    }
    for (const alias of entry.aliases) {
      if (normalizeText(alias) === normalized) {
        return entry;
      }
    }
  }
  return null;
}

/**
 * Composes `{directory account name} at {bank name}` for Mandate.payeeName,
 * falling back to the shortest bank alias if needed to fit within
 * PaymentProposalSchema's 100-character limit.
 */
export function composeMandatePayeeName(
  directoryAccountName: string,
  canonicalBankName: string,
): string {
  const cleanName = directoryAccountName.trim();
  const bankEntry = resolveBankName(canonicalBankName);
  const fullBank = bankEntry ? bankEntry.canonicalName : canonicalBankName.trim();
  const fullComposed = `${cleanName} at ${fullBank}`;
  if (fullComposed.length <= 100) {
    return fullComposed;
  }
  const shortBank = bankEntry ? bankEntry.shortAlias : fullBank;
  const shortComposed = `${cleanName} at ${shortBank}`;
  if (shortComposed.length <= 100) {
    return shortComposed;
  }
  throw new Error("COMPOSED_PAYEE_NAME_TOO_LONG");
}

/**
 * Masks a 10-digit account number to show only the last 4 digits (`••••1234`).
 */
export function maskAccountNumberLast4(accountNumber: string): string {
  const clean = accountNumber.trim();
  return `••••${clean.slice(-4)}`;
}

const DIGIT_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
] as const;

/**
 * Formats the spoken phrase for the last 4 digits of a 10-digit account number.
 */
export function speakLast4Digits(accountNumber: string): string {
  const last4 = accountNumber.trim().slice(-4);
  const spokenDigits = last4
    .split("")
    .map((ch) => DIGIT_WORDS[Number(ch)] ?? ch)
    .join(", ");
  return `account ending in last 4 digits ${spokenDigits}`;
}

/**
 * Formats a 10-digit account number into `070 000 1234` for `.num` display on the approval card.
 */
export function groupTenDigitAccountNumber(accountNumber: string): string {
  const clean = accountNumber.trim();
  if (!/^[0-9]{10}$/.test(clean)) return clean;
  return `${clean.slice(0, 3)} ${clean.slice(3, 6)} ${clean.slice(6, 10)}`;
}

export interface ParsedRecipientCandidate {
  accountNumber: string;
  bankName: string;
  pastedName: string;
  isDuplicate: boolean;
}

export interface UnreadableLine {
  rawText: string;
  reason: string;
}

export interface BulkParseResult {
  ok: boolean;
  errorCode?: "EMPTY_PASTE" | "TOO_MANY_RECIPIENTS";
  errorMessage?: string;
  recipients: ParsedRecipientCandidate[];
  unreadable: UnreadableLine[];
}

type ClassifiedToken =
  | { kind: "account_valid"; value: string }
  | { kind: "account_invalid"; raw: string }
  | { kind: "bank"; entry: NigerianBankEntry }
  | { kind: "name"; value: string };

function classifySegment(segment: string): ClassifiedToken | null {
  const trimmed = segment.replace(/^[,|\-–—\s]+|[,|\-–—\s]+$/g, "").trim();
  if (!trimmed) return null;

  // Check if the segment is purely digits (or digits with spaces/hyphens)
  const digitsOnly = trimmed.replace(/[\s-]/g, "");
  if (/^[0-9]+$/.test(digitsOnly)) {
    if (digitsOnly.length === 10) {
      return { kind: "account_valid", value: digitsOnly };
    }
    return { kind: "account_invalid", raw: trimmed };
  }

  // Check if the segment is a known Nigerian bank alias
  const bankEntry = resolveBankName(trimmed);
  if (bankEntry) {
    return { kind: "bank", entry: bankEntry };
  }

  return { kind: "name", value: trimmed };
}

function splitLineIntoSegments(line: string): string[] {
  // Split by pipe, comma, or spaced dash (` - `, ` – `, ` — `) while preserving hyphenated names like `Mary-Jane`
  return line
    .split(/\s*\|\s*|\s*,\s*|\s+[-–—]\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Pure deterministic parser for pasted WhatsApp / bank recipient lists.
 * Handles newline, comma, dash, and pipe separators, fields in any order,
 * and records split by blank lines or repeated 3-field patterns.
 */
export function parseBulkRecipients(rawText: string): BulkParseResult {
  const normalizedInput = rawText.replace(/\r\n/g, "\n").trim();
  if (!normalizedInput) {
    return {
      ok: false,
      errorCode: "EMPTY_PASTE",
      errorMessage: "Please paste at least one recipient with a 10-digit account number, bank name, and recipient name.",
      recipients: [],
      unreadable: [],
    };
  }

  const lines = normalizedInput.split("\n");
  const recipients: ParsedRecipientCandidate[] = [];
  const unreadable: UnreadableLine[] = [];

  let pendingAccount: string | null = null;
  let pendingInvalidAccount: string | null = null;
  let pendingBank: NigerianBankEntry | null = null;
  let pendingName: string | null = null;
  let pendingRawLines: string[] = [];

  const flushPending = () => {
    if (
      !pendingAccount &&
      !pendingInvalidAccount &&
      !pendingBank &&
      !pendingName &&
      pendingRawLines.length === 0
    ) {
      return;
    }

    const rawJoined = pendingRawLines.join(" / ");
    if (pendingInvalidAccount) {
      unreadable.push({
        rawText: rawJoined || pendingInvalidAccount,
        reason: "Account number must be 10 digits.",
      });
    } else if (pendingAccount && pendingBank && pendingName) {
      recipients.push({
        accountNumber: pendingAccount,
        bankName: pendingBank.canonicalName,
        pastedName: pendingName,
        isDuplicate: false,
      });
    } else {
      const missing: string[] = [];
      if (!pendingAccount) missing.push("10-digit account number");
      if (!pendingBank) missing.push("recognized bank name");
      if (!pendingName) missing.push("recipient name");
      unreadable.push({
        rawText: rawJoined,
        reason: `Could not read ${missing.join(", ")}.`,
      });
    }

    pendingAccount = null;
    pendingInvalidAccount = null;
    pendingBank = null;
    pendingName = null;
    pendingRawLines = [];
  };

  for (const rawLine of lines) {
    const trimmedLine = rawLine.trim();
    if (!trimmedLine) {
      flushPending();
      continue;
    }

    const segments = splitLineIntoSegments(trimmedLine);
    const classified = segments
      .map(classifySegment)
      .filter((item): item is ClassifiedToken => item !== null);

    if (classified.length === 0) {
      continue;
    }

    // If a single line has multiple segments (e.g., "Ade Bello - GTBank - 0123456789")
    if (classified.length >= 2) {
      // Flush any previous multi-line accumulator first if it already had conflicting parts
      const lineHasAccount = classified.some(
        (t) => t.kind === "account_valid" || t.kind === "account_invalid",
      );
      const lineHasBank = classified.some((t) => t.kind === "bank");
      const lineHasName = classified.some((t) => t.kind === "name");

      if (lineHasAccount && lineHasBank && lineHasName && classified.length === 3) {
        flushPending();
        pendingRawLines.push(trimmedLine);
        for (const token of classified) {
          if (token.kind === "account_valid") pendingAccount = token.value;
          else if (token.kind === "account_invalid")
            pendingInvalidAccount = token.raw;
          else if (token.kind === "bank") pendingBank = token.entry;
          else if (token.kind === "name") pendingName = token.value;
        }
        flushPending();
        continue;
      }
    }

    // Otherwise process token by token, flushing whenever a repeated field type starts a new record
    for (const token of classified) {
      const wouldRepeatField =
        ((token.kind === "account_valid" || token.kind === "account_invalid") &&
          (pendingAccount !== null || pendingInvalidAccount !== null)) ||
        (token.kind === "bank" && pendingBank !== null) ||
        (token.kind === "name" && pendingName !== null);

      if (wouldRepeatField) {
        flushPending();
      }

      if (!pendingRawLines.includes(trimmedLine)) {
        pendingRawLines.push(trimmedLine);
      }

      if (token.kind === "account_valid") {
        pendingAccount = token.value;
      } else if (token.kind === "account_invalid") {
        pendingInvalidAccount = token.raw;
      } else if (token.kind === "bank") {
        pendingBank = token.entry;
      } else if (token.kind === "name") {
        pendingName = token.value;
      }

      if (pendingAccount && pendingBank && pendingName) {
        flushPending();
      }
    }
  }

  flushPending();

  // Flag duplicates
  const seenAccounts = new Set<string>();
  for (const item of recipients) {
    const key = `${item.accountNumber}:${item.bankName.toLowerCase()}`;
    if (seenAccounts.has(key) || seenAccounts.has(item.accountNumber)) {
      item.isDuplicate = true;
    }
    seenAccounts.add(key);
    seenAccounts.add(item.accountNumber);
  }

  if (recipients.length > MAX_BULK_RECIPIENTS) {
    return {
      ok: false,
      errorCode: "TOO_MANY_RECIPIENTS",
      errorMessage: "You can include at most 5 recipients in one batch.",
      recipients: [],
      unreadable,
    };
  }

  return {
    ok: recipients.length > 0 && unreadable.length === 0,
    recipients,
    unreadable,
  };
}

/**
 * Normalizes a name into a sorted, deduplicated set of lowercase alphanumeric tokens.
 */
export function normalizeNameTokens(name: string): string[] {
  const tokens = name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  return Array.from(new Set(tokens)).sort();
}

export type NameComparisonResult =
  | { matched: true; label: "Name matches" }
  | { matched: false; label: "Name differs" };

/**
 * Rule 8: Compares pasted name with simulated directory name by normalizing case and punctuation
 * and comparing token sets. Exact token set match is "Name matches"; anything else is "Name differs".
 */
export function compareRecipientNames(
  pastedName: string,
  directoryName: string,
): NameComparisonResult {
  const a = normalizeNameTokens(pastedName);
  const b = normalizeNameTokens(directoryName);
  if (a.length > 0 && a.length === b.length && a.every((tok, idx) => tok === b[idx])) {
    return { matched: true, label: "Name matches" };
  }
  return { matched: false, label: "Name differs" };
}

const SAFE_GEMINI_NAME_REGEX = /^[A-Za-z\s\-'.]{1,60}$/;
const SUSPICIOUS_PROMPT_TOKENS = new Set([
  "ignore",
  "system",
  "assistant",
  "instruction",
  "instructions",
  "override",
  "send",
  "transfer",
  "pay",
  "dollar",
  "dollars",
  "thousand",
  "hundred",
  "each",
  "every",
  "all",
  "account",
  "prompt",
]);

/**
 * Decision 7: Send only display names that match letters, spaces, hyphens, apostrophes and periods,
 * at most 60 characters (and without prompt-instruction keywords). Otherwise send "Recipient N".
 */
export function sanitizeDisplayNameForGemini(
  name: string,
  oneBasedIndex: number,
): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed || trimmed.length > 60 || !SAFE_GEMINI_NAME_REGEX.test(trimmed)) {
    return `Recipient ${oneBasedIndex}`;
  }
  const lowerTokens = trimmed
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (
    lowerTokens.length === 0 ||
    lowerTokens.length > 5 ||
    lowerTokens.some((tok) => SUSPICIOUS_PROMPT_TOKENS.has(tok))
  ) {
    return `Recipient ${oneBasedIndex}`;
  }
  return trimmed;
}

const WORD_NUMBERS: Readonly<Record<string, number>> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

function parseSpokenWordAmountsMinor(text: string): number[] {
  const results: number[] = [];
  const cleaned = text
    .toLowerCase()
    .replace(/-/g, " ")
    .replace(/[^a-z\s]/g, " ");
  const words = cleaned.split(/\s+/).filter(Boolean);

  let i = 0;
  while (i < words.length) {
    const w = words[i];
    if (
      !(w in WORD_NUMBERS) &&
      w !== "hundred" &&
      w !== "thousand"
    ) {
      i += 1;
      continue;
    }

    let currentGroup = 0;
    let totalWhole = 0;
    let matchedAny = false;

    while (i < words.length) {
      const token = words[i];
      if (token === "and") {
        i += 1;
        continue;
      }
      if (token in WORD_NUMBERS) {
        currentGroup += WORD_NUMBERS[token];
        matchedAny = true;
        i += 1;
      } else if (token === "hundred") {
        currentGroup = (currentGroup === 0 ? 1 : currentGroup) * 100;
        matchedAny = true;
        i += 1;
      } else if (token === "thousand") {
        totalWhole += (currentGroup === 0 ? 1 : currentGroup) * 1000;
        currentGroup = 0;
        matchedAny = true;
        i += 1;
      } else {
        break;
      }
    }

    const wholeDollars = totalWhole + currentGroup;
    if (matchedAny && wholeDollars > 0) {
      results.push(wholeDollars * 100);
    }
  }

  return results;
}

/**
 * Rule 10: Deterministic amount parser on the user's instruction.
 * Extracts candidate amounts in minor units (e.g., `5k` -> 500000, `5,000` -> 500000,
 * `five thousand` -> 500000, `50 dollars` -> 5000, `25 each` -> 2500).
 */
export function parseInstructionAmountsMinor(instruction: string): number[] {
  const amounts = new Set<number>();

  // 1. Shorthand k (e.g. 5k, $2.5k)
  const kRegex = /\$?\b(\d+(?:\.\d{1,2})?)\s*k\b/gi;
  for (const match of instruction.matchAll(kRegex)) {
    const val = Number.parseFloat(match[1]);
    if (Number.isFinite(val) && val > 0) {
      amounts.add(Math.round(val * 1000 * 100));
    }
  }

  // 2. Numeric amounts with optional commas and decimals (excluding 10-digit account numbers)
  const withoutK = instruction.replace(kRegex, " ");
  const numRegex = /\$?\b(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\b/g;
  for (const match of withoutK.matchAll(numRegex)) {
    const rawWhole = match[1].replace(/,/g, "");
    if (rawWhole.length >= 10) continue; // Ignore account numbers
    const whole = Number.parseInt(rawWhole, 10);
    const frac = match[2] ? Number.parseInt(match[2].padEnd(2, "0"), 10) : 0;
    const minor = whole * 100 + frac;
    if (Number.isSafeInteger(minor) && minor > 0) {
      amounts.add(minor);
    }
  }

  // 3. Spoken English number words (e.g., "five thousand", "fifty dollars", "twenty-five each")
  for (const minor of parseSpokenWordAmountsMinor(instruction)) {
    if (Number.isSafeInteger(minor) && minor > 0) {
      amounts.add(minor);
    }
  }

  return Array.from(amounts);
}

export type DualAmountCheckResult =
  | { accepted: true }
  | { accepted: false; code: "AMOUNT_MISMATCH"; spoken: string };

/**
 * Rule 10: Verifies that every amount returned by Gemini matches an amount
 * found by the deterministic amount parser on the user's instruction.
 */
export function verifyDualAmountCheck(
  instruction: string,
  geminiAmountsMinor: readonly number[],
): DualAmountCheckResult {
  const parsedAmounts = parseInstructionAmountsMinor(instruction);
  if (parsedAmounts.length === 0 || geminiAmountsMinor.length === 0) {
    return {
      accepted: false,
      code: "AMOUNT_MISMATCH",
      spoken:
        "Please restate the amount clearly, for example 25 dollars each.",
    };
  }
  const allowedSet = new Set(parsedAmounts);
  for (const proposed of geminiAmountsMinor) {
    if (!Number.isSafeInteger(proposed) || proposed <= 0 || !allowedSet.has(proposed)) {
      return {
        accepted: false,
        code: "AMOUNT_MISMATCH",
        spoken:
          "The amount could not be confirmed from your instruction. Please restate the amount clearly.",
      };
    }
  }
  return { accepted: true };
}

function canonicalizeValue(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeValue(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((k) => record[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalizeValue(record[k])}`).join(",")}}`;
  }
  throw new Error("Unsupported value in bulk plan canonicalization");
}

/**
 * Computes RFC 8785 canonical SHA-256 base64url hash of a bulk payment plan.
 */
export function computePlanHash(plan: {
  batchId: string;
  accountId: string;
  currency: string;
  totalMinor: number;
  requestHash: string;
  items: ReadonlyArray<{
    itemId: string;
    position: number;
    accountNumber: string;
    bankName: string;
    resolvedName: string;
    amountMinor: number;
  }>;
}): string {
  const canonical = canonicalizeValue(plan);
  return createHash("sha256").update(canonical, "utf8").digest("base64url");
}

// ============================================================================
// Typed Server Widget Schemas (Rule 3 & Rule 4)
// ============================================================================

export const RecipientListItemSchema = z
  .object({
    itemId: z.string().uuid(),
    position: z.number().int().min(0).max(4),
    pastedName: z.string().min(1),
    resolvedName: z.string().nullable(),
    bankName: z.string().min(1),
    accountLast4: z.string().regex(/^[0-9]{4}$/),
    status: z.enum([
      "MATCHED",
      "NAME_MISMATCH",
      "NOT_FOUND",
      "DUPLICATE",
      "SKIPPED",
      "READY",
    ]),
    statusLabel: z.enum([
      "Name matches",
      "Name differs",
      "Not in simulated directory",
      "Duplicate account",
      "Skipped",
    ]),
  })
  .strict();

export const RecipientListWidgetSchema = z
  .object({
    type: z.literal("recipient_list"),
    batchId: z.string().uuid(),
    recipients: z.array(RecipientListItemSchema).max(5),
    unreadable: z.array(
      z
        .object({
          rawText: z.string(),
          reason: z.string(),
        })
        .strict(),
    ),
    spoken: z.string().min(1),
  })
  .strict();

export const NameCheckWidgetSchema = z
  .object({
    type: z.literal("name_check"),
    batchId: z.string().uuid(),
    itemId: z.string().uuid(),
    position: z.number().int().min(0).max(4),
    pastedName: z.string().min(1),
    directoryName: z.string().min(1),
    bankName: z.string().min(1),
    accountLast4: z.string().regex(/^[0-9]{4}$/),
    statusLabel: z.literal("Name differs"),
    choices: z.tuple([z.literal("USE_DIRECTORY_NAME"), z.literal("SKIP")]),
    spoken: z.string().min(1),
  })
  .strict();

export const PlanItemSchema = z
  .object({
    itemId: z.string().uuid(),
    position: z.number().int().min(0).max(4),
    recipientName: z.string().min(1),
    bankName: z.string().min(1),
    accountLast4: z.string().regex(/^[0-9]{4}$/),
    amountMinor: z.number().int().positive(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    statusLabel: z.string().min(1),
  })
  .strict();

export const PlanWidgetSchema = z
  .object({
    type: z.literal("plan"),
    batchId: z.string().uuid(),
    status: z.enum(["PLANNED", "CONFIRMED"]),
    planHash: z.string().min(1),
    requestHash: z.string().min(1),
    totalMinor: z.number().int().positive(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    expiresAt: z.string().datetime({ offset: true }),
    items: z.array(PlanItemSchema).min(1).max(5),
    spoken: z.string().min(1),
  })
  .strict();

/**
 * Rule 4: A transfer_approval widget carries only mandateId.
 */
export const TransferApprovalWidgetSchema = z
  .object({
    type: z.literal("transfer_approval"),
    mandateId: z.string().uuid(),
  })
  .strict();

export const BatchSummaryItemSchema = z
  .object({
    itemId: z.string().uuid(),
    position: z.number().int().min(0).max(4),
    recipientName: z.string().min(1),
    bankName: z.string().min(1),
    accountLast4: z.string().regex(/^[0-9]{4}$/),
    amountMinor: z.number().int().nonnegative(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    status: z.string().min(1),
    statusLabel: z.string().min(1),
    paypalRef: z.string().nullable(),
  })
  .strict();

export const BatchSummaryWidgetSchema = z
  .object({
    type: z.literal("batch_summary"),
    batchId: z.string().uuid(),
    status: z.string().min(1),
    totalMinor: z.number().int().nonnegative(),
    paidMinor: z.number().int().nonnegative(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    items: z.array(BatchSummaryItemSchema).max(5),
    spoken: z.string().min(1),
  })
  .strict();

export const BulkWidgetSchema = z.discriminatedUnion("type", [
  RecipientListWidgetSchema,
  NameCheckWidgetSchema,
  PlanWidgetSchema,
  TransferApprovalWidgetSchema,
  BatchSummaryWidgetSchema,
]);

export type RecipientListWidget = z.infer<typeof RecipientListWidgetSchema>;
export type NameCheckWidget = z.infer<typeof NameCheckWidgetSchema>;
export type PlanWidget = z.infer<typeof PlanWidgetSchema>;
export type TransferApprovalWidget = z.infer<
  typeof TransferApprovalWidgetSchema
>;
export type BatchSummaryWidget = z.infer<typeof BatchSummaryWidgetSchema>;
export type BulkWidget = z.infer<typeof BulkWidgetSchema>;
