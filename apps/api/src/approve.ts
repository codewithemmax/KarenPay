import { verifyAuthenticationResponse, type AuthenticationResponseJSON, type WebAuthnCredential } from "@simplewebauthn/server";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { JsonValue } from "../../../packages/core/src/index.js";
import { appendAuditEvent } from "./audit.js";
import { getAuthenticatedAccountId, loadAuthConfig, type AuthConfig } from "./auth.js";
import { PayPalClient } from "./paypal.js";

const approvalResponseSchema = z.object({ id: z.string().min(1) }).passthrough();
const mandateIdSchema = z.string().uuid();

type MandateRow = {
  id: string;
  state: "CREATED" | "CONSUMED" | "PAID" | "FAILED" | "REJECTED" | "EXPIRED";
  mandate_hash: string;
  payee_contact_id: string | null;
  payee_name?: string | null;
  payee_account_number?: string | null;
  amount_minor: number;
  currency: string;
  paypal_ref: string | null;
  spoken_text: string;
};

type CredentialRow = {
  id: string;
  credential_id: string;
  public_key: string;
  counter: number;
  transports: string[];
};

type ContactRow = { paypal_sandbox_email: string };

export interface ApproveConfig extends AuthConfig {
  paypalClientId: string;
  paypalClientSecret: string;
  paypalBaseUrl: string;
}

export function loadApproveConfig(environment: NodeJS.ProcessEnv = process.env): ApproveConfig {
  const auth = loadAuthConfig(environment);
  const required = (name: string): string => {
    const value = environment[name]?.trim();
    if (!value) throw new Error(`${name} is required`);
    return value;
  };
  return {
    ...auth,
    paypalClientId: required("PAYPAL_CLIENT_ID"),
    paypalClientSecret: required("PAYPAL_CLIENT_SECRET"),
    paypalBaseUrl: required("PAYPAL_BASE_URL"),
  };
}

class SupabaseApprovalStore {
  constructor(private readonly config: ApproveConfig) {}

  async getMandate(accountId: string, mandateId: string): Promise<MandateRow | undefined> {
    const rows = await this.request<MandateRow[]>(
      `mandates?select=id,state,mandate_hash,payee_contact_id,payee_name,payee_account_number,amount_minor,currency,paypal_ref,spoken_text&id=eq.${encodeURIComponent(mandateId)}&account_id=eq.${encodeURIComponent(accountId)}`,
    );
    return rows[0];
  }

  async getCredential(accountId: string, credentialId: string): Promise<CredentialRow | undefined> {
    const rows = await this.request<CredentialRow[]>(
      `passkey_credentials?select=id,credential_id,public_key,counter,transports&credential_id=eq.${encodeURIComponent(credentialId)}&account_id=eq.${encodeURIComponent(accountId)}`,
    );
    return rows[0];
  }

  async getContactEmail(accountId: string, contactId: string): Promise<string | undefined> {
    const rows = await this.request<ContactRow[]>(
      `contacts?select=paypal_sandbox_email&id=eq.${encodeURIComponent(contactId)}&account_id=eq.${encodeURIComponent(accountId)}`,
    );
    return rows[0]?.paypal_sandbox_email;
  }

  async consumeMandate(accountId: string, mandateId: string): Promise<MandateRow | undefined> {
    const rows = await this.request<MandateRow[]>("rpc/consume_mandate", {
      method: "POST",
      body: JSON.stringify({ p_mandate_id: mandateId, p_account_id: accountId }),
    });
    return rows[0];
  }

  async updateCredential(id: string, counter: number): Promise<void> {
    await this.request(`passkey_credentials?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ counter }),
    });
  }

  async setPaymentOutcome(accountId: string, mandateId: string, state: "PAID" | "FAILED", paypalRef: string | null): Promise<void> {
    await this.request(`mandates?id=eq.${encodeURIComponent(mandateId)}&account_id=eq.${encodeURIComponent(accountId)}&state=eq.CONSUMED`, {
      method: "PATCH",
      body: JSON.stringify({ state, paypal_ref: paypalRef }),
    });
  }

  async audit(accountId: string, mandateId: string, eventType: string, detail: Record<string, JsonValue>): Promise<void> {
    await appendAuditEvent(this.config, accountId, mandateId, eventType, detail);
  }

  private async request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.config.supabaseUrl}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: this.config.supabaseServiceRoleKey,
        Authorization: `Bearer ${this.config.supabaseServiceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
        ...init.headers,
      },
    });
    if (!response.ok) throw new Error(`Supabase request failed with status ${response.status}`);
    const body = await response.text();
    return (body ? JSON.parse(body) : undefined) as T;
  }
}

export function createApproveRouter(config: ApproveConfig): Router {
  const router = Router();
  const store = new SupabaseApprovalStore(config);
  const paypal = new PayPalClient({
    clientId: config.paypalClientId,
    clientSecret: config.paypalClientSecret,
    baseUrl: config.paypalBaseUrl,
  });

  router.post("/:id/approve", async (request, response) => {
    const accountId = getAuthenticatedAccountId(request, config.sessionSecret);
    if (!accountId) return response.status(401).json({ code: "AUTH_REQUIRED", message: "Please sign in before approving a test payment." });

    let mandateId: string;
    try {
      mandateId = mandateIdSchema.parse(request.params.id);
      const responseCredential = approvalResponseSchema.parse(request.body);
      const mandate = await store.getMandate(accountId, mandateId);
      if (!mandate) return response.status(404).json({ code: "MANDATE_NOT_FOUND", message: "This test payment was not found." });
      if (mandate.state !== "CREATED") return sendStoredOutcome(response, mandate);

      const credential = await store.getCredential(accountId, responseCredential.id);
      if (!credential) {
        await store.audit(accountId, mandateId, "APPROVAL_REJECTED", { code: "UNKNOWN_CREDENTIAL" });
        return response.status(401).json({
          code: "APPROVAL_REJECTED",
          message: "The approval could not be verified.",
          spoken: "The approval could not be verified.",
        });
      }
      let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>> | undefined;
      try {
        verification = await verifyAuthenticationResponse({
          response: responseCredential as unknown as AuthenticationResponseJSON,
          expectedChallenge: mandate.mandate_hash,
          expectedOrigin: config.webOrigin,
          expectedRPID: config.rpID,
          requireUserVerification: true,
          credential: {
            id: credential.credential_id,
            publicKey: decodeBytea(credential.public_key),
            counter: credential.counter,
            transports: credential.transports,
          },
        });
      } catch {
        verification = undefined;
      }
      if (
        !verification ||
        !verification.verified ||
        !verification.authenticationInfo.userVerified ||
        !hasUserPresence(responseCredential)
      ) {
        await store.audit(accountId, mandateId, "APPROVAL_REJECTED", { code: "APPROVAL_REJECTED" });
        return response.status(401).json({
          code: "APPROVAL_REJECTED",
          message: "The approval could not be verified.",
          spoken: "The approval could not be verified.",
        });
      }
      await store.updateCredential(credential.id, verification.authenticationInfo.newCounter);
      const consumed = await store.consumeMandate(accountId, mandateId);
      if (!consumed) {
        const latest = await store.getMandate(accountId, mandateId);
        return latest ? sendStoredOutcome(response, latest) : response.status(404).json({ code: "MANDATE_NOT_FOUND", message: "This test payment was not found." });
      }

      const recipient = consumed.payee_contact_id
        ? await store.getContactEmail(accountId, consumed.payee_contact_id)
        : consumed.payee_account_number
          ? `acct-${consumed.payee_account_number}@sandbox.karenpay.test`
          : undefined;
      if (!recipient) throw new Error("Mandate recipient no longer exists");
      await store.audit(accountId, mandateId, "MANDATE_CONSUMED", {
        deviceType: verification.authenticationInfo.credentialDeviceType,
        backedUp: verification.authenticationInfo.credentialBackedUp,
      });
      try {
        const payout = await paypal.sendPayout({
          mandateId,
          items: [{
            recipientType: "EMAIL",
            receiver: recipient,
            amount: { value: formatPayoutAmount(consumed.amount_minor), currency: consumed.currency },
          }],
        });
        await store.setPaymentOutcome(accountId, mandateId, "PAID", payout.payoutBatchId);
        await store.audit(accountId, mandateId, "PAYMENT_SENT", { payoutBatchId: payout.payoutBatchId });
        return response.json({ code: "PAID", message: "Test payment sent.", spoken: "Test payment sent.", paypalRef: payout.payoutBatchId });
      } catch {
        await store.setPaymentOutcome(accountId, mandateId, "FAILED", null);
        await store.audit(accountId, mandateId, "PAYMENT_FAILED", {});
        return response.status(502).json({ code: "PAYMENT_FAILED", message: "Test payment not sent.", spoken: "Test payment not sent." });
      }
    } catch (error) {
      if (error instanceof z.ZodError) return response.status(400).json({ code: "INVALID_REQUEST", message: "The approval request is invalid." });
      return response.status(500).json({ code: "APPROVAL_FAILED", message: "The approval could not be completed." });
    }
  });

  return router;
}

function sendStoredOutcome(response: Response, mandate: MandateRow): Response {
  if (mandate.state === "PAID") return response.json({ code: "PAID", message: "Test payment sent.", spoken: "Test payment sent.", paypalRef: mandate.paypal_ref });
  if (mandate.state === "FAILED") return response.status(502).json({ code: "PAYMENT_FAILED", message: "Test payment not sent.", spoken: "Test payment not sent." });
  if (mandate.state === "CONSUMED") return response.status(202).json({ code: "PAYMENT_PENDING", message: "Test payment is being sent.", spoken: "Test payment is being sent." });
  if (mandate.state === "EXPIRED") return response.status(410).json({ code: "MANDATE_EXPIRED", message: "This approval has expired." });
  return response.status(409).json({ code: "MANDATE_NOT_APPROVABLE", message: "This test payment cannot be approved." });
}

function decodeBytea(value: string): WebAuthnCredential["publicKey"] {
  if (!value.startsWith("\\x")) throw new Error("Stored passkey public key is not PostgreSQL bytea hex");
  return new Uint8Array(Buffer.from(value.slice(2), "hex")) as WebAuthnCredential["publicKey"];
}

function formatPayoutAmount(amountMinor: number): string {
  return `${Math.floor(amountMinor / 100)}.${String(amountMinor % 100).padStart(2, "0")}`;
}

function hasUserPresence(credentialResponse: Record<string, unknown>): boolean {
  const response = credentialResponse.response as { authenticatorData?: unknown } | undefined;
  if (!response || typeof response.authenticatorData !== "string") {
    return false;
  }
  const authData = Buffer.from(response.authenticatorData, "base64url");
  if (authData.length < 33) {
    return false;
  }
  return (authData[32] & 0x01) === 0x01;
}
