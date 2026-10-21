import { describe, expect, it } from "vitest";
import { transitionMandateState } from "../../packages/core/src/index.js";

const expiresAt = new Date("2026-10-21T10:02:00.000Z");

describe("mandate state transitions", () => {
  it("allows a live mandate to be consumed exactly once", () => {
    expect(transitionMandateState("CREATED", "CONSUME", expiresAt, new Date("2026-10-21T10:01:59.999Z")))
      .toEqual({ accepted: true, state: "CONSUMED" });
    expect(transitionMandateState("CONSUMED", "CONSUME", expiresAt, new Date("2026-10-21T10:01:59.999Z")))
      .toEqual({ accepted: false, state: "CONSUMED", code: "INVALID_TRANSITION" });
  });

  it("expires a CREATED mandate using the supplied database time", () => {
    expect(transitionMandateState("CREATED", "CONSUME", expiresAt, expiresAt))
      .toEqual({ accepted: true, state: "EXPIRED" });
  });

  it("allows only payment outcomes after consumption", () => {
    expect(transitionMandateState("CONSUMED", "PAYMENT_SUCCEEDED", expiresAt, expiresAt))
      .toEqual({ accepted: true, state: "PAID" });
    expect(transitionMandateState("CONSUMED", "PAYMENT_FAILED", expiresAt, expiresAt))
      .toEqual({ accepted: true, state: "FAILED" });
    expect(transitionMandateState("PAID", "PAYMENT_FAILED", expiresAt, expiresAt))
      .toEqual({ accepted: false, state: "PAID", code: "INVALID_TRANSITION" });
  });
});
