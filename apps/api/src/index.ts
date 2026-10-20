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
  recipientType: "EMAIL" | "PHONE" | "PAYPAL_ID";
  receiver: string;
  amount: {
    value: string;
    currency: string;
  };
  note?: string;
  senderItemId?: string;
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
  public readonly status: number;
  public readonly operation: string;

  constructor(operation: string, status: number) {
    super(`PayPal ${operation} request failed with status ${status}`);
    this.name = "PayPalApiError";
    this.status = status;
    this.operation = operation;
  }
}

export class PayPalClient {
  private readonly fetcher: typeof fetch;
  private accessToken: string | undefined;
  private tokenExpiresAt = 0;

  constructor(private readonly config: PayPalClientConfig) {
    baseUrlSchema.parse(config.baseUrl);
    if (!config.clientId || !config.clientSecret) {
      throw new Error("PayPal client credentials are required");
    }
    this.fetcher = config.fetcher ?? fetch;
  }

  async sendPayout(request: PayoutRequest): Promise<PayPalPayout> {
    const response = await this.request("/v1/payments/payouts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender_batch_header: {
          sender_batch_id: request.mandateId,
          email_subject: request.emailSubject,
          email_message: request.emailMessage,
        },
        items: request.items,
      }),
    });
    const parsed = payoutResponseSchema.parse(await response.json());
    return {
      payoutBatchId: parsed.batch_header.payout_batch_id,
      batchStatus: parsed.batch_header.batch_status,
    };
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const response = await this.fetcher(`${this.config.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${await this.getAccessToken()}`,
        ...init.headers,
      },
    });
    if (!response.ok) {
      throw new PayPalApiError(path, response.status);
    }
    return response;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    const credentials = btoa(
      `${this.config.clientId}:${this.config.clientSecret}`,
    );
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
      throw new PayPalApiError("/v1/oauth2/token", response.status);
    }
    const parsed = oauthResponseSchema.parse(await response.json());
    this.accessToken = parsed.access_token;
    this.tokenExpiresAt = Date.now() + Math.max(parsed.expires_in - 60, 1) * 1000;
    return parsed.access_token;
  }
}
