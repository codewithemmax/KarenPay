import { z } from "zod";

const oauthResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  token_type: z.string().min(1),
});

const payoutResponseSchema = z.object({
  batch_header: z.object({
    payout_batch_id: z.string().min(1),
    batch_status: z.string().min(1),
  }),
});

const baseUrlSchema = z.string().url().refine(
  (value) => new URL(value).hostname === "api-m.sandbox.paypal.com",
  "PAYPAL_BASE_URL must be PayPal's sandbox host",
);

export interface PayPalClientConfig {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  fetcher?: typeof fetch;
}

export interface PayoutItem {
  recipientType?: "EMAIL" | "PHONE" | "PAYPAL_ID";
  recipient_type?: "EMAIL" | "PHONE" | "PAYPAL_ID";
  receiver: string;
  amount: { value: string; currency: string };
  note?: string;
  senderItemId?: string;
  sender_item_id?: string;
}

export interface PayoutRequest {
  mandateId: string;
  items: PayoutItem[];
  emailSubject?: string;
  emailMessage?: string;
}

export interface PayPalPayout {
  payoutBatchId: string;
  batchStatus: string;
}

export class PayPalApiError extends Error {
  constructor(
    public readonly operation: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(
      `PayPal ${operation} request failed with status ${status}${
        details ? `: ${typeof details === "string" ? details : JSON.stringify(details)}` : ""
      }`,
    );
    this.name = "PayPalApiError";
  }
}

export class PayPalClient {
  private readonly fetcher: typeof fetch;
  private accessToken: string | undefined;
  private tokenExpiresAt = 0;

  constructor(private readonly config: PayPalClientConfig) {
    baseUrlSchema.parse(config.baseUrl);
    if (!config.clientId || !config.clientSecret) throw new Error("PayPal client credentials are required");
    this.fetcher = config.fetcher ?? fetch;
  }

  async sendPayout(request: PayoutRequest): Promise<PayPalPayout> {
    console.log(`[PayPal] Creating payout batch for mandate ${request.mandateId} (${request.items.length} items)...`);
    const payload = {
      sender_batch_header: {
        sender_batch_id: request.mandateId,
        ...(request.emailSubject ? { email_subject: request.emailSubject } : {}),
        ...(request.emailMessage ? { email_message: request.emailMessage } : {}),
      },
      items: request.items.map((item) => {
        const formatted: Record<string, unknown> = {
          recipient_type: item.recipient_type ?? item.recipientType ?? "EMAIL",
          receiver: item.receiver,
          amount: item.amount,
        };
        if (item.note) {
          formatted.note = item.note;
        }
        const senderItemId = item.sender_item_id ?? item.senderItemId;
        if (senderItemId) {
          formatted.sender_item_id = senderItemId;
        }
        return formatted;
      }),
    };
    console.log(`[PayPal] Payout request payload:`, JSON.stringify(payload, null, 2));

    const response = await this.request("/v1/payments/payouts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const parsed = payoutResponseSchema.parse(await response.json());
    console.log(
      `[PayPal] Payout batch created successfully: id=${parsed.batch_header.payout_batch_id}, status=${parsed.batch_header.batch_status}`,
    );
    return { payoutBatchId: parsed.batch_header.payout_batch_id, batchStatus: parsed.batch_header.batch_status };
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const token = await this.getAccessToken();
    const response = await this.fetcher(`${this.config.baseUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...init.headers },
    });
    if (!response.ok) {
      let details: unknown;
      try {
        const text = await response.text();
        try {
          details = JSON.parse(text);
        } catch {
          details = text;
        }
      } catch {
        details = undefined;
      }
      console.error(`[PayPal API Error] ${init.method ?? "GET"} ${path} (${response.status}):`, details);
      throw new PayPalApiError(path, response.status, details);
    }
    return response;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) return this.accessToken;
    console.log(`[PayPal] Requesting OAuth access token from ${this.config.baseUrl}/v1/oauth2/token...`);
    const credentials = btoa(`${this.config.clientId}:${this.config.clientSecret}`);
    const response = await this.fetcher(`${this.config.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: "grant_type=client_credentials",
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.error(`[PayPal OAuth Error] /v1/oauth2/token (${response.status}):`, errText);
      throw new PayPalApiError("/v1/oauth2/token", response.status, errText);
    }
    const parsed = oauthResponseSchema.parse(await response.json());
    this.accessToken = parsed.access_token;
    this.tokenExpiresAt = Date.now() + Math.max(parsed.expires_in - 60, 1) * 1000;
    console.log(`[PayPal] OAuth access token acquired (expires in ${parsed.expires_in}s).`);
    return parsed.access_token;
  }
}
