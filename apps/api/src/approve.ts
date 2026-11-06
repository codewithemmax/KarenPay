import {
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
  type WebAuthnCredential,
} from "@simplewebauthn/server";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { JsonValue } from "../../../packages/core/src/index.js";
import { appendAuditEvent } from "./audit.js";
import {
  getAuthenticatedAccountId,
  loadAuthConfig,
  verifyPinSecret,
  type AuthConfig,
} from "./auth.js";
import { PayPalClient } from "./paypal.js";

const approvalResponseSchema = z
  .object({ id: z.string().min(1) })
  .passthrough();

const pinApprovalSchema = z.object({
  fallbackMethod: z.literal("pin"),
  pin: z.string().regex(/^[0-9]{6}$/),
  challenge: z.string().min(1),
});

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
  device_type?: string | null;
};

type ContactRow = { paypal_sandbox_email: string };

export type ApproveReceiverResolutionResult =
  | { kind: "non_bulk" }
  | {
      kind: "bulk_resolved";
      receiverEmail: string;
      batchId: string;
      itemId: string;
    }
  | {
      kind: "bulk_failed";
      reason: string;
      batchId: string | null;
      itemId: string | null;
    };

export interface ApproveBulkHook {
  isBulkMandate?(
    accountId: string,
    mandate: {
      id: string;
      payee_contact_id: string | null;
      payee_name?: string | null;
      payee_account_number?: string | null;
    },
  ): Promise<boolean>;
  resolveMandateReceiver(
    accountId: string,
    mandate: {
      id: string;
      payee_contact_id: string | null;
      payee_name?: string | null;
      payee_account_number?: string | null;
      amount_minor: number;
      currency: string;
    },
  ): Promise<ApproveReceiverResolutionResult>;
  onBulkMandateConsumed?(
    accountId: string,
    batchId: string,
    itemId: string,
    mandateId: string,
  ): Promise<void>;
  onBulkMandateOutcome?(
    accountId: string,
    batchId: string,
    itemId: string,
    mandateId: string,
    outcome: "PAID" | "FAILED",
    paypalRef: string | null,
  ): Promise<void>;
}

export interface ApproveConfig extends AuthConfig {
  paypalClientId: string;
  paypalClientSecret: string;
  paypalBaseUrl: string;
  bulkHook?: ApproveBulkHook;
}

export function loadApproveConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ApproveConfig {
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

  async getMandate(
    accountId: string,
    mandateId: string,
  ): Promise<MandateRow | undefined> {
    const rows = await this.request<MandateRow[]>(
      `mandates?select=id,state,mandate_hash,payee_contact_id,payee_name,payee_account_number,amount_minor,currency,paypal_ref,spoken_text&id=eq.${encodeURIComponent(mandateId)}&account_id=eq.${encodeURIComponent(accountId)}`,
    );
    return rows[0];
  }

  async getCredential(
    accountId: string,
    credentialId: string,
  ): Promise<CredentialRow | undefined> {
    const rows = await this.request<CredentialRow[]>(
      `passkey_credentials?select=id,credential_id,public_key,counter,transports&credential_id=eq.${encodeURIComponent(credentialId)}&account_id=eq.${encodeURIComponent(accountId)}`,
    );
    return rows[0];
  }

  async getAccountCredentials(accountId: string): Promise<CredentialRow[]> {
    return this.request<CredentialRow[]>(
      `passkey_credentials?select=id,credential_id,public_key,counter,transports,device_type&account_id=eq.${encodeURIComponent(accountId)}`,
    );
  }

  async getContactEmail(
    accountId: string,
    contactId: string,
  ): Promise<string | undefined> {
    const rows = await this.request<ContactRow[]>(
      `contacts?select=paypal_sandbox_email&id=eq.${encodeURIComponent(contactId)}&account_id=eq.${encodeURIComponent(accountId)}`,
    );
    return rows[0]?.paypal_sandbox_email;
  }

  async consumeMandate(
    accountId: string,
    mandateId: string,
  ): Promise<MandateRow | undefined> {
    const rows = await this.request<MandateRow[]>("rpc/consume_mandate", {
      method: "POST",
      body: JSON.stringify({
        p_mandate_id: mandateId,
        p_account_id: accountId,
      }),
    });
    return rows[0];
  }

  async updateCredential(id: string, counter: number): Promise<void> {
    await this.request(`passkey_credentials?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ counter }),
    });
  }

  async setPaymentOutcome(
    accountId: string,
    mandateId: string,
    state: "PAID" | "FAILED",
    paypalRef: string | null,
  ): Promise<void> {
    await this.request(
      `mandates?id=eq.${encodeURIComponent(mandateId)}&account_id=eq.${encodeURIComponent(accountId)}&state=eq.CONSUMED`,
      {
        method: "PATCH",
        body: JSON.stringify({ state, paypal_ref: paypalRef }),
      },
    );
  }

  async audit(
    accountId: string,
    mandateId: string,
    eventType: string,
    detail: Record<string, JsonValue>,
  ): Promise<void> {
    await appendAuditEvent(
      this.config,
      accountId,
      mandateId,
      eventType,
      detail,
    );
  }

  private async request<T = unknown>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
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
    if (!response.ok)
      throw new Error(`Supabase request failed with status ${response.status}`);
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
    const accountId = getAuthenticatedAccountId(
      request,
      config.sessionSecret,
    );
    if (!accountId) {
      console.warn("[Approve] Request rejected: missing or invalid session cookie");
      return response.status(401).json({
        code: "AUTH_REQUIRED",
        message: "Please sign in before approving a test payment.",
      });
    }

    let mandateId: string;
    try {
      mandateId = mandateIdSchema.parse(request.params.id);
      console.log(`[Approve] Received approval request for mandate ${mandateId} (account ${accountId})`);

      // Check if this is a 6-digit PIN fallback approval (when device has no biometrics)
      const pinCheck = pinApprovalSchema.safeParse(request.body);
      if (pinCheck.success) {
        console.log(`[Approve] Processing PIN fallback approval for mandate ${mandateId}`);
        const { pin, challenge } = pinCheck.data;
        const mandate = await store.getMandate(accountId, mandateId);
        if (!mandate) {
          console.warn(`[Approve] Mandate ${mandateId} not found for account ${accountId}`);
          return response.status(404).json({
            code: "MANDATE_NOT_FOUND",
            message: "This test payment was not found.",
          });
        }
        if (mandate.state !== "CREATED") {
          console.log(`[Approve] Mandate ${mandateId} is already in state '${mandate.state}', returning stored outcome`);
          return sendStoredOutcome(response, mandate);
        }

        if (challenge !== mandate.mandate_hash) {
          console.warn(`[Approve] PIN challenge mismatch for mandate ${mandateId}: received ${challenge}, expected ${mandate.mandate_hash}`);
          await store.audit(accountId, mandateId, "APPROVAL_REJECTED", {
            code: "APPROVAL_REJECTED",
            reason: "CHALLENGE_MISMATCH",
          });
          return response.status(401).json({
            code: "APPROVAL_REJECTED",
            message: "The approval could not be verified.",
            spoken:
              "Rejected. The payment details did not match what was read aloud. No test payment was sent.",
          });
        }

        const allCreds = await store.getAccountCredentials(accountId);
        const pinCred = allCreds.find((c) => {
          try {
            return verifyPinSecret(pin, decodeBytea(c.public_key));
          } catch {
            return false;
          }
        });

        if (!pinCred) {
          console.warn(`[Approve] Incorrect PIN entered for account ${accountId}`);
          await store.audit(accountId, mandateId, "APPROVAL_REJECTED", {
            code: "APPROVAL_REJECTED",
            reason: "INVALID_PIN",
          });
          return response.status(401).json({
            code: "APPROVAL_REJECTED",
            message: "Incorrect 6-digit PIN. The approval could not be verified.",
            spoken: "Incorrect 6-digit PIN. The approval could not be verified.",
          });
        }

        await store.updateCredential(pinCred.id, pinCred.counter + 1);
        const consumed = await store.consumeMandate(accountId, mandateId);
        if (!consumed) {
          console.warn(`[Approve] consumeMandate failed for mandate ${mandateId} (concurrent consume or expired)`);
          const latest = await store.getMandate(accountId, mandateId);
          return latest
            ? sendStoredOutcome(response, latest)
            : response.status(404).json({
                code: "MANDATE_NOT_FOUND",
                message: "This test payment was not found.",
              });
        }

        const recipient = consumed.payee_contact_id
          ? await store.getContactEmail(accountId, consumed.payee_contact_id)
          : consumed.payee_account_number
            ? `acct-${consumed.payee_account_number}@sandbox.karenpay.test`
            : undefined;
        if (!recipient) {
          console.error(`[Approve] Recipient could not be resolved for consumed mandate ${mandateId}`);
          throw new Error("Mandate recipient no longer exists");
        }

        await store.audit(accountId, mandateId, "MANDATE_CONSUMED", {
          deviceType: "pin",
          backedUp: false,
        });

        try {
          console.log(`[Approve] Calling PayPal Payouts for PIN mandate ${mandateId} to ${recipient}...`);
          const payout = await paypal.sendPayout({
            mandateId,
            items: [
              {
                recipientType: "EMAIL",
                receiver: recipient,
                amount: {
                  value: formatPayoutAmount(consumed.amount_minor),
                  currency: consumed.currency,
                },
              },
            ],
          });
          console.log(`[Approve] PayPal payout succeeded for PIN mandate ${mandateId}: ref=${payout.payoutBatchId}`);
          await store.setPaymentOutcome(
            accountId,
            mandateId,
            "PAID",
            payout.payoutBatchId,
          );
          await store.audit(accountId, mandateId, "PAYMENT_SENT", {
            payoutBatchId: payout.payoutBatchId,
            amountMinor: consumed.amount_minor,
            currency: consumed.currency,
          });
          return response.json({
            code: "PAID",
            message: "Test payment sent.",
            spoken: "Test payment sent.",
            paypalRef: payout.payoutBatchId,
          });
        } catch (err) {
          console.error(`[Approve] PayPal sendPayout failed for PIN mandate ${mandateId}:`, err);
          await store.setPaymentOutcome(accountId, mandateId, "FAILED", null);
          await store.audit(accountId, mandateId, "PAYMENT_FAILED", {
            error: err instanceof Error ? err.message : String(err),
          });
          return response.status(502).json({
            code: "PAYMENT_FAILED",
            message: "Test payment not sent.",
            spoken: "Test payment not sent.",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Standard WebAuthn Passkey / Cross-Device QR approval
      const responseCredential = approvalResponseSchema.parse(request.body);
      console.log(`[Approve] Processing WebAuthn passkey assertion for mandate ${mandateId}, credentialId=${responseCredential.id}`);
      const mandate = await store.getMandate(accountId, mandateId);
      if (!mandate) {
        console.warn(`[Approve] Mandate ${mandateId} not found for account ${accountId}`);
        return response.status(404).json({
          code: "MANDATE_NOT_FOUND",
          message: "This test payment was not found.",
        });
      }
      if (mandate.state !== "CREATED") {
        console.log(`[Approve] Mandate ${mandateId} is already in state '${mandate.state}', returning stored outcome`);
        return sendStoredOutcome(response, mandate);
      }

      const credential = await store.getCredential(
        accountId,
        responseCredential.id,
      );
      if (!credential) {
        console.warn(`[Approve] Credential ${responseCredential.id} not registered for account ${accountId}`);
        await store.audit(accountId, mandateId, "APPROVAL_REJECTED", {
          code: "UNKNOWN_CREDENTIAL",
        });
        return response.status(401).json({
          code: "APPROVAL_REJECTED",
          message: "The approval could not be verified.",
          spoken: "The approval could not be verified.",
        });
      }
      let verification:
        | Awaited<ReturnType<typeof verifyAuthenticationResponse>>
        | undefined;
      try {
        console.log(`[Approve] Verifying WebAuthn authentication response against challenge ${mandate.mandate_hash}...`);
        verification = await verifyAuthenticationResponse({
          response:
            responseCredential as unknown as AuthenticationResponseJSON,
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
      } catch (err) {
        console.error(`[Approve] verifyAuthenticationResponse threw error for mandate ${mandateId}:`, err);
        verification = undefined;
      }
      if (
        !verification ||
        !verification.verified ||
        !verification.authenticationInfo.userVerified ||
        !hasUserPresence(responseCredential)
      ) {
        console.warn(`[Approve] WebAuthn verification check failed for mandate ${mandateId}:`, {
          verified: verification?.verified,
          userVerified: verification?.authenticationInfo?.userVerified,
          userPresence: hasUserPresence(responseCredential),
        });
        await store.audit(accountId, mandateId, "APPROVAL_REJECTED", {
          code: "APPROVAL_REJECTED",
        });
        return response.status(401).json({
          code: "APPROVAL_REJECTED",
          message: "The approval could not be verified.",
          spoken: "The approval could not be verified.",
        });
      }
      console.log(`[Approve] WebAuthn signature verified successfully. Updating counter to ${verification.authenticationInfo.newCounter}...`);
      await store.updateCredential(
        credential.id,
        verification.authenticationInfo.newCounter,
      );
      const consumed = await store.consumeMandate(accountId, mandateId);
      if (!consumed) {
        console.warn(`[Approve] consumeMandate failed for mandate ${mandateId} (concurrent consume or expired)`);
        const latest = await store.getMandate(accountId, mandateId);
        return latest
          ? sendStoredOutcome(response, latest)
          : response.status(404).json({
              code: "MANDATE_NOT_FOUND",
              message: "This test payment was not found.",
            });
      }
      console.log(`[Approve] Mandate ${mandateId} consumed atomically.`);

      const bulkResolution = config.bulkHook
        ? await config.bulkHook.resolveMandateReceiver(accountId, consumed)
        : { kind: "non_bulk" as const };

      if (bulkResolution.kind === "bulk_failed") {
        console.warn(`[Approve] Bulk receiver resolution failed for mandate ${mandateId}:`, bulkResolution.reason);
        await store.audit(accountId, mandateId, "MANDATE_CONSUMED", {
          deviceType: verification.authenticationInfo.credentialDeviceType,
          backedUp: verification.authenticationInfo.credentialBackedUp,
        });
        await store.setPaymentOutcome(accountId, mandateId, "FAILED", null);
        await store.audit(accountId, mandateId, "PAYMENT_FAILED", {
          reason: bulkResolution.reason,
          ...(bulkResolution.batchId ? { batchId: bulkResolution.batchId } : {}),
          ...(bulkResolution.itemId ? { itemId: bulkResolution.itemId } : {}),
        });
        return response.status(502).json({
          code: "PAYMENT_FAILED",
          message: "Test payment not sent.",
          spoken: "Test payment not sent.",
        });
      }

      const recipient =
        bulkResolution.kind === "bulk_resolved"
          ? bulkResolution.receiverEmail
          : consumed.payee_contact_id
            ? await store.getContactEmail(accountId, consumed.payee_contact_id)
            : consumed.payee_account_number
              ? `acct-${consumed.payee_account_number}@sandbox.karenpay.test`
              : undefined;
      if (!recipient) {
        console.error(`[Approve] Recipient could not be resolved for consumed mandate ${mandateId}`);
        throw new Error("Mandate recipient no longer exists");
      }
      console.log(`[Approve] Resolved payout recipient for mandate ${mandateId}: ${recipient}`);
      if (bulkResolution.kind === "bulk_resolved") {
        await config.bulkHook?.onBulkMandateConsumed?.(
          accountId,
          bulkResolution.batchId,
          bulkResolution.itemId,
          mandateId,
        );
      }
      await store.audit(accountId, mandateId, "MANDATE_CONSUMED", {
        deviceType: verification.authenticationInfo.credentialDeviceType,
        backedUp: verification.authenticationInfo.credentialBackedUp,
      });
      try {
        console.log(`[Approve] Calling PayPal sendPayout for mandate ${mandateId} to ${recipient} (amount: ${consumed.amount_minor})...`);
        const payout = await paypal.sendPayout({
          mandateId,
          items: [
            {
              recipientType: "EMAIL",
              receiver: recipient,
              amount: {
                value: formatPayoutAmount(consumed.amount_minor),
                currency: consumed.currency,
              },
            },
          ],
        });
        console.log(`[Approve] PayPal payout succeeded for mandate ${mandateId}: ref=${payout.payoutBatchId}, status=${payout.batchStatus}`);
        await store.setPaymentOutcome(
          accountId,
          mandateId,
          "PAID",
          payout.payoutBatchId,
        );
        if (bulkResolution.kind === "bulk_resolved") {
          await config.bulkHook?.onBulkMandateOutcome?.(
            accountId,
            bulkResolution.batchId,
            bulkResolution.itemId,
            mandateId,
            "PAID",
            payout.payoutBatchId,
          );
        }
        await store.audit(accountId, mandateId, "PAYMENT_SENT", {
          payoutBatchId: payout.payoutBatchId,
        });
        return response.json({
          code: "PAID",
          message: "Test payment sent.",
          spoken: "Test payment sent.",
          paypalRef: payout.payoutBatchId,
        });
      } catch (err) {
        console.error(`[Approve] PayPal sendPayout failed for mandate ${mandateId}:`, err);
        await store.setPaymentOutcome(accountId, mandateId, "FAILED", null);
        if (bulkResolution.kind === "bulk_resolved") {
          await config.bulkHook?.onBulkMandateOutcome?.(
            accountId,
            bulkResolution.batchId,
            bulkResolution.itemId,
            mandateId,
            "FAILED",
            null,
          );
        }
        await store.audit(accountId, mandateId, "PAYMENT_FAILED", {
          error: err instanceof Error ? err.message : String(err),
        });
        return response.status(502).json({
          code: "PAYMENT_FAILED",
          message: "Test payment not sent.",
          spoken: "Test payment not sent.",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } catch (error) {
      console.error(`[Approve] General approval error for request:`, error);
      if (error instanceof z.ZodError)
        return response.status(400).json({
          code: "INVALID_REQUEST",
          message: "The approval request is invalid.",
          details: error.flatten(),
        });
      return response.status(500).json({
        code: "APPROVAL_FAILED",
        message: "The approval could not be completed.",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}

function sendStoredOutcome(response: Response, mandate: MandateRow): Response {
  if (mandate.state === "PAID")
    return response.json({
      code: "PAID",
      message: "Test payment sent.",
      spoken: "Test payment sent.",
      paypalRef: mandate.paypal_ref,
    });
  if (mandate.state === "FAILED")
    return response.status(502).json({
      code: "PAYMENT_FAILED",
      message: "Test payment not sent.",
      spoken: "Test payment not sent.",
    });
  if (mandate.state === "CONSUMED")
    return response.status(202).json({
      code: "PAYMENT_PENDING",
      message: "Test payment is being sent.",
      spoken: "Test payment is being sent.",
    });
  if (mandate.state === "EXPIRED")
    return response.status(410).json({
      code: "MANDATE_EXPIRED",
      message: "This approval has expired.",
    });
  return response.status(409).json({
    code: "MANDATE_NOT_APPROVABLE",
    message: "This test payment cannot be approved.",
  });
}

function decodeBytea(value: string): WebAuthnCredential["publicKey"] {
  if (!value.startsWith("\\x"))
    throw new Error("Stored passkey public key is not PostgreSQL bytea hex");
  return new Uint8Array(
    Buffer.from(value.slice(2), "hex"),
  ) as WebAuthnCredential["publicKey"];
}

function formatPayoutAmount(amountMinor: number): string {
  return `${Math.floor(amountMinor / 100)}.${String(amountMinor % 100).padStart(2, "0")}`;
}

function hasUserPresence(
  credentialResponse: Record<string, unknown>,
): boolean {
  const response = credentialResponse.response as
    | { authenticatorData?: unknown }
    | undefined;
  if (!response || typeof response.authenticatorData !== "string") {
    return false;
  }
  const authData = Buffer.from(response.authenticatorData, "base64url");
  if (authData.length < 33) {
    return false;
  }
  return (authData[32] & 0x01) === 0x01;
}
