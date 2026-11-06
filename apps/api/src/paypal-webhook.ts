import { z } from "zod";
import type { Request, Router } from "express";
import { Router as ExpressRouter } from "express";

const webhookEventSchema = z.object({
  id: z.string().min(1).optional(),
  event_type: z.string().min(1),
  resource: z.record(z.unknown()),
});

const verificationSchema = z.object({
  verification_status: z.enum(["SUCCESS", "FAILURE"]),
});

export interface PayPalWebhookConfig {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  webhookId: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  fetcher?: typeof fetch;
}

function requiredHeader(request: Request, name: string): string {
  const value = request.header(name);
  if (!value) throw new Error(`Missing PayPal webhook header: ${name}`);
  return value;
}

function payoutBatchId(resource: Record<string, unknown>): string | undefined {
  const value = resource.payout_batch_id ?? resource.batch_id;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

async function updateMandate(
  config: PayPalWebhookConfig,
  payoutBatchIdValue: string,
  state: "PAID" | "FAILED",
): Promise<boolean> {
  const response = await (config.fetcher ?? fetch)(
    `${config.supabaseUrl}/rest/v1/mandates?paypal_ref=eq.${encodeURIComponent(payoutBatchIdValue)}&state=eq.CONSUMED`,
    {
      method: "PATCH",
      headers: {
        apikey: config.supabaseServiceRoleKey,
        Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({ state }),
    },
  );
  if (!response.ok) {
    throw new Error(`Supabase webhook update failed with status ${response.status}`);
  }
  const rows = (await response.json()) as unknown;
  if (Array.isArray(rows) && rows.length > 0) return true;

  const existingResponse = await (config.fetcher ?? fetch)(
    `${config.supabaseUrl}/rest/v1/mandates?select=id&paypal_ref=eq.${encodeURIComponent(payoutBatchIdValue)}`,
    {
      headers: {
        apikey: config.supabaseServiceRoleKey,
        Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
      },
    },
  );
  if (!existingResponse.ok) {
    throw new Error(`Supabase webhook lookup failed with status ${existingResponse.status}`);
  }
  const existingRows = (await existingResponse.json()) as unknown;
  return Array.isArray(existingRows) && existingRows.length > 0;
}

export function createPayPalWebhookRouter(config: PayPalWebhookConfig): Router {
  const router = ExpressRouter();
  const fetcher = config.fetcher ?? fetch;

  router.post("/", async (request, response) => {
    try {
      if (!config.webhookId) {
        return response.status(503).json({ code: "PAYPAL_WEBHOOK_NOT_CONFIGURED" });
      }
      const event = webhookEventSchema.parse(request.body);
      const transmissionId = requiredHeader(request, "paypal-transmission-id");
      const transmissionTime = requiredHeader(request, "paypal-transmission-time");
      const certUrl = requiredHeader(request, "paypal-cert-url");
      const authAlgo = requiredHeader(request, "paypal-auth-algo");
      const transmissionSig = requiredHeader(request, "paypal-transmission-sig");

      const tokenResponse = await fetcher(`${config.baseUrl}/v1/oauth2/token`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: "grant_type=client_credentials",
      });
      if (!tokenResponse.ok) {
        return response.status(502).json({ code: "PAYPAL_AUTH_FAILED" });
      }
      const tokenBody = (await tokenResponse.json()) as { access_token?: string };
      if (!tokenBody.access_token) {
        return response.status(502).json({ code: "PAYPAL_AUTH_FAILED" });
      }

      const verificationResponse = await fetcher(
        `${config.baseUrl}/v1/notifications/verify-webhook-signature`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${tokenBody.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            auth_algo: authAlgo,
            cert_url: certUrl,
            transmission_id: transmissionId,
            transmission_sig: transmissionSig,
            transmission_time: transmissionTime,
            webhook_id: config.webhookId,
            webhook_event: request.body,
          }),
        },
      );
      if (!verificationResponse.ok) {
        return response.status(502).json({ code: "PAYPAL_WEBHOOK_VERIFY_FAILED" });
      }
      const verification = verificationSchema.parse(await verificationResponse.json());
      if (verification.verification_status !== "SUCCESS") {
        return response.status(400).json({ code: "INVALID_PAYPAL_WEBHOOK" });
      }

      const successEvents = new Set(["PAYMENT.PAYOUTS-ITEM.SUCCEEDED"]);
      const failedEvents = new Set([
        "PAYMENT.PAYOUTS-ITEM.FAILED",
        "PAYMENT.PAYOUTS-ITEM.BLOCKED",
        "PAYMENT.PAYOUTS-ITEM.DENIED",
        "PAYMENT.PAYOUTS-ITEM.RETURNED",
      ]);
      if (!successEvents.has(event.event_type) && !failedEvents.has(event.event_type)) {
        return response.status(200).json({ received: true, ignored: true });
      }

      const batchId = payoutBatchId(event.resource);
      if (!batchId) {
        return response.status(200).json({ received: true, matched: false });
      }
      const updated = await updateMandate(
        config,
        batchId,
        successEvents.has(event.event_type) ? "PAID" : "FAILED",
      );
      return response.status(200).json({ received: true, matched: updated });
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof Error && error.message.startsWith("Missing PayPal")) {
        return response.status(400).json({ code: "INVALID_PAYPAL_WEBHOOK" });
      }
      console.error("[PayPal Webhook] Processing failed:", error);
      return response.status(500).json({ code: "PAYPAL_WEBHOOK_FAILED" });
    }
  });

  return router;
}
