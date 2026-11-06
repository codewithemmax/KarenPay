import express from "express";
import { describe, expect, it, vi } from "vitest";
import { createPayPalWebhookRouter } from "../../apps/api/src/paypal-webhook.js";

describe("PayPal webhook", () => {
  it("verifies a payout event and updates the matching consumed mandate", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "token" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ verification_status: "SUCCESS" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: "mandate-1" }]), { status: 200 }));
    const app = express();
    app.use(express.json());
    app.use("/api/v1/paypal/webhook", createPayPalWebhookRouter({
      clientId: "client-id",
      clientSecret: "client-secret",
      baseUrl: "https://api-m.sandbox.paypal.com",
      webhookId: "webhook-1",
      supabaseUrl: "https://example.supabase.co",
      supabaseServiceRoleKey: "service-key",
      fetcher,
    }));
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const listener = app.listen(0, () => resolve(listener));
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Test server did not receive a TCP address");
      const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/paypal/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "PAYPAL-TRANSMISSION-ID": "transmission-1",
          "PAYPAL-TRANSMISSION-TIME": "2026-11-06T13:00:00Z",
          "PAYPAL-CERT-URL": "https://api-m.sandbox.paypal.com/cert",
          "PAYPAL-AUTH-ALGO": "SHA256withRSA",
          "PAYPAL-TRANSMISSION-SIG": "signature",
        },
        body: JSON.stringify({
          id: "event-1",
          event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
          resource: { payout_batch_id: "payout-1" },
        }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ received: true, matched: true });
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(JSON.parse(fetcher.mock.calls[1][1].body as string)).toMatchObject({
        webhook_id: "webhook-1",
        transmission_id: "transmission-1",
      });
      expect(JSON.parse(fetcher.mock.calls[2][1].body as string)).toEqual({ state: "PAID" });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
