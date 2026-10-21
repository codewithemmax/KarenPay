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
