import { describe, expect, it } from "vitest";
import { buildMandate, canonicalize, hashMandate, type Mandate } from "../../packages/core/src/index.js";

const mandate: Mandate = {
  id: "11111111-1111-4111-8111-111111111111",
  accountId: "22222222-2222-4222-8222-222222222222",
  action: "send_money",
  payeeContactId: "33333333-3333-4333-8333-333333333333",
  amountMinor: 5000,
  currency: "USD",
  constraints: { maximumAmountMinor: 10000, permitted: true },
  requestHash: "request-hash",
  nonce: "nonce-1",
  issuedAt: "2026-10-21T10:00:00.000Z",
  expiresAt: "2026-10-21T10:02:00.000Z",
  spokenText: "Send 50 dollars to Ade.",
};

describe("mandate canonicalization and hashing", () => {
  it("makes equivalent key ordering and JSON whitespace hash identically", () => {
    const reordered = buildMandate(JSON.parse(`{
      "spokenText": "Send 50 dollars to Ade.",
      "expiresAt": "2026-10-21T10:02:00.000Z",
      "issuedAt": "2026-10-21T10:00:00.000Z",
      "nonce": "nonce-1",
      "requestHash": "request-hash",
      "constraints": { "permitted": true, "maximumAmountMinor": 10000 },
      "currency": "USD",
      "amountMinor": 5000,
      "payeeContactId": "33333333-3333-4333-8333-333333333333",
      "action": "send_money",
      "accountId": "22222222-2222-4222-8222-222222222222",
      "id": "11111111-1111-4111-8111-111111111111"
    }`));

    expect(canonicalize(reordered)).toBe(canonicalize(mandate));
    expect(hashMandate(reordered)).toBe(hashMandate(mandate));
  });

  it("changes the hash when a consented field changes", () => {
    expect(hashMandate({ ...mandate, amountMinor: 5001 })).not.toBe(hashMandate(mandate));
    const accountMandate = buildMandate({
      ...mandate,
      payeeContactId: undefined,
      payeeName: "Ade Bello",
      payeeAccountNumber: "0123456789",
    });
    const tamperedDigitMandate = buildMandate({
      ...mandate,
      payeeContactId: undefined,
      payeeName: "Ade Bello",
      payeeAccountNumber: "0123456780",
    });
    expect(hashMandate(accountMandate)).not.toBe(hashMandate(tamperedDigitMandate));
  });

  it("rejects malformed or expired mandates before hashing", () => {
    expect(() => buildMandate({ ...mandate, action: "pay_merchant" })).toThrow();
    expect(() => buildMandate({ ...mandate, expiresAt: mandate.issuedAt })).toThrow();
  });
});
