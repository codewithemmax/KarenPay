import { describe, expect, it } from "vitest";
import {
  buildReadout,
  checkIntent,
  checkLimits,
  type Contact,
  type IntentConstraints,
  type PaymentPolicy,
  type PaymentProposal,
} from "../../packages/core/src/index.js";

const contact: Contact = {
  id: "33333333-3333-4333-8333-333333333333",
  displayName: "Ade Bello",
  paypalSandboxEmail: "ade@example.com",
};

const proposal: PaymentProposal = {
  action: "send_money",
  payeeContactId: contact.id,
  amountMinor: 5000,
  currency: "USD",
};

const constraints: IntentConstraints = {
  action: "send_money",
  payeeContactId: contact.id,
  maximumAmountMinor: 10000,
  currency: "USD",
};

const policy: PaymentPolicy = {
  maximumAmountMinor: 10000,
  allowedCurrencies: ["USD"],
};

describe("Core readout", () => {
  it("uses only approved fields and always produces the same spoken text", () => {
    const first = buildReadout({ proposal, payeeDisplayName: contact.displayName, requestConstraints: constraints });
    const second = buildReadout({ proposal, payeeDisplayName: contact.displayName, requestConstraints: constraints });

    expect(first).toBe(second);
    expect(first).toBe("You asked to send fifty dollars to Ade Bello. That is five, zero dollars. You asked for under one hundred dollars. This is a sandbox test payment. To approve, use your fingerprint or face now.");
  });
});

describe("Core intent check", () => {
  it("accepts an exact proposal within the requested maximum", () => {
    expect(checkIntent(proposal, constraints)).toEqual({ accepted: true });
  });

  it("rejects recipient, amount, and currency mismatches", () => {
    expect(checkIntent({ ...proposal, payeeContactId: "44444444-4444-4444-8444-444444444444" }, constraints))
      .toEqual({ accepted: false, code: "RECIPIENT_MISMATCH" });
    expect(checkIntent({ ...proposal, amountMinor: 10001 }, constraints))
      .toEqual({ accepted: false, code: "AMOUNT_EXCEEDS_REQUEST" });
    expect(checkIntent({ ...proposal, currency: "EUR" }, constraints))
      .toEqual({ accepted: false, code: "CURRENCY_MISMATCH" });
  });
});

describe("Core payment limits", () => {
  it("requires a positive integer amount", () => {
    expect(checkLimits({ ...proposal, amountMinor: 0 } as PaymentProposal, policy, [contact]))
      .toEqual({ accepted: false, code: "INVALID_AMOUNT" });
  });

  it("enforces the maximum amount", () => {
    expect(checkLimits({ ...proposal, amountMinor: 10001 }, policy, [contact]))
      .toEqual({ accepted: false, code: "AMOUNT_EXCEEDS_POLICY" });
  });

  it("enforces the currency whitelist", () => {
    expect(checkLimits({ ...proposal, currency: "EUR" }, policy, [contact]))
      .toEqual({ accepted: false, code: "CURRENCY_NOT_ALLOWED" });
  });

  it("requires the recipient to be an owned contact", () => {
    expect(checkLimits({ ...proposal, payeeContactId: "44444444-4444-4444-8444-444444444444" }, policy, [contact]))
      .toEqual({ accepted: false, code: "RECIPIENT_NOT_FOUND" });
  });
});
