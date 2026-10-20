import { describe, expect, it, vi } from "vitest";
import { PayPalApiError, PayPalClient } from "../../apps/api/src/index.js";

const config = {
  clientId: "client-id",
  clientSecret: "client-secret",
  baseUrl: "https://api-m.sandbox.paypal.com",
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("PayPal sandbox client", () => {
  it("gets an OAuth token and sends a payout with the mandate idempotency key", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({
        access_token: "token",
        expires_in: 3600,
        token_type: "Bearer",
      }))
      .mockResolvedValueOnce(response({
        batch_header: {
          payout_batch_id: "payout-1",
          batch_status: "PENDING",
        },
      }));
    const client = new PayPalClient({ ...config, fetcher });

    const result = await client.sendPayout({
      mandateId: "mandate-1",
      items: [{
        recipientType: "EMAIL",
        receiver: "sandbox@example.com",
        amount: { value: "5.00", currency: "USD" },
      }],
    });

    expect(result).toEqual({ payoutBatchId: "payout-1", batchStatus: "PENDING" });
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "https://api-m.sandbox.paypal.com/v1/payments/payouts",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token",
        }),
      }),
    );
    expect(JSON.parse(fetcher.mock.calls[1][1].body as string).sender_batch_header.sender_batch_id)
      .toBe("mandate-1");
  });

  it("rejects non-sandbox base URLs and non-success responses", async () => {
    expect(() => new PayPalClient({ ...config, baseUrl: "https://api.paypal.com" }))
      .toThrow("PAYPAL_BASE_URL must be PayPal's sandbox host");
    const fetcher = vi.fn().mockResolvedValue(response({}, 401));
    const client = new PayPalClient({ ...config, fetcher });

    await expect(client.sendPayout({
      mandateId: "mandate-3",
      items: [],
    })).rejects.toMatchObject({
      status: 401,
      operation: "/v1/oauth2/token",
    });
  });
});
