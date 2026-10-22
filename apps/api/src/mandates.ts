import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  buildMandate,
  buildReadout,
  checkIntent,
  checkLimits,
  describeMandateState,
  hashMandate,
  IntentConstraintsSchema,
  PaymentPolicySchema,
  PaymentProposalSchema,
  type Contact,
  type JsonValue,
  type MandateState,
  type PaymentPolicy,
} from "../../../packages/core/src/index.js";
import { appendAuditEvent } from "./audit.js";
import { getAuthenticatedAccountId, loadAuthConfig, type AuthConfig } from "./auth.js";

const mandateRequestSchema = z.object({
  proposal: PaymentProposalSchema,
  requestConstraints: IntentConstraintsSchema,
  requestHash: z.string().min(1).max(256),
}).strict();

type ContactRow = {
  id: string;
  display_name: string;
  paypal_sandbox_email: string;
};

type MandateStateRow = {
  id: string;
  state: MandateState;
  mandate_hash: string;
  spoken_text: string;
  paypal_ref: string | null;
};

export interface MandateConfig extends AuthConfig {
  mandateTtlSeconds: number;
  paymentPolicy: PaymentPolicy;
}

export function loadMandateConfig(environment: NodeJS.ProcessEnv = process.env): MandateConfig {
  const auth = loadAuthConfig(environment);
  const ttl = Number.parseInt(environment.MANDATE_TTL_SECONDS ?? "120", 10);
  if (!Number.isInteger(ttl) || ttl < 30 || ttl > 600) {
    throw new Error("MANDATE_TTL_SECONDS must be an integer between 30 and 600");
  }
  const maximumAmountMinor = Number.parseInt(environment.MAX_AMOUNT_MINOR ?? "", 10);
  const allowedCurrencies = (environment.ALLOWED_CURRENCIES ?? "")
    .split(",")
    .map((currency) => currency.trim())
    .filter(Boolean);
  return {
    ...auth,
    mandateTtlSeconds: ttl,
    paymentPolicy: PaymentPolicySchema.parse({ maximumAmountMinor, allowedCurrencies }),
  };
}

class SupabaseMandateStore {
  constructor(private readonly config: MandateConfig) {}

  async getOwnedContact(accountId: string, contactId: string): Promise<Contact | undefined> {
    const rows = await this.request<ContactRow[]>(
      `contacts?select=id,display_name,paypal_sandbox_email&id=eq.${encodeURIComponent(contactId)}&account_id=eq.${encodeURIComponent(accountId)}`,
    );
    const contact = rows[0];
    return contact ? {
      id: contact.id,
      displayName: contact.display_name,
      paypalSandboxEmail: contact.paypal_sandbox_email,
    } : undefined;
  }

  async getOwnedMandateState(accountId: string, mandateId: string): Promise<MandateStateRow | undefined> {
    const rows = await this.request<MandateStateRow[]>(
      `mandates?select=id,state,mandate_hash,spoken_text,paypal_ref&id=eq.${encodeURIComponent(mandateId)}&account_id=eq.${encodeURIComponent(accountId)}`,
    );
    return rows[0];
  }

  async createMandate(record: Record<string, unknown>): Promise<void> {
    await this.request("mandates", { method: "POST", body: JSON.stringify(record) });
  }

  async createAuditEvent(accountId: string, mandateId: string | null, eventType: string, detail: Record<string, JsonValue>): Promise<void> {
    await appendAuditEvent(this.config, accountId, mandateId, eventType, detail);
  }

  private async request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.config.supabaseUrl}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: this.config.supabaseServiceRoleKey,
        Authorization: `Bearer ${this.config.supabaseServiceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
        ...init.headers,
      },
    });
    if (!response.ok) throw new Error(`Supabase request failed with status ${response.status}`);
    const body = await response.text();
    return (body ? JSON.parse(body) : undefined) as T;
  }
}

export function createMandateRouter(config: MandateConfig): Router {
  const router = Router();
  const store = new SupabaseMandateStore(config);

  router.post("/", async (request, response) => {
    const accountId = getAuthenticatedAccountId(request, config.sessionSecret);
    if (!accountId) {
      return response.status(401).json({ code: "AUTH_REQUIRED", message: "Please sign in before creating a test payment." });
    }

    let mandateId: string | null = null;
    try {
      const input = mandateRequestSchema.parse(request.body);
      const intentResult = checkIntent(input.proposal, input.requestConstraints);
      if (!intentResult.accepted) {
        await store.createAuditEvent(accountId, null, "MANDATE_REJECTED", { code: intentResult.code });
        return response.status(422).json({ code: intentResult.code, message: "The payment details do not match your request." });
      }
      const contact = input.proposal.payeeContactId
        ? await store.getOwnedContact(accountId, input.proposal.payeeContactId)
        : undefined;
      const limitsResult = checkLimits(input.proposal, config.paymentPolicy, contact ? [contact] : []);
      if (!limitsResult.accepted) {
        await store.createAuditEvent(accountId, null, "MANDATE_REJECTED", { code: limitsResult.code });
        return response.status(422).json({ code: limitsResult.code, message: "This test payment is not allowed." });
      }

      const issuedAt = new Date();
      const expiresAt = new Date(issuedAt.getTime() + config.mandateTtlSeconds * 1000);
      mandateId = randomUUID();
      const payeeDisplayName = contact?.displayName ?? input.proposal.payeeName!;
      const spokenText = buildReadout({
        proposal: input.proposal,
        payeeDisplayName,
        requestConstraints: input.requestConstraints,
      });
      const mandate = buildMandate({
        id: mandateId,
        accountId,
        ...input.proposal,
        constraints: input.requestConstraints,
        requestHash: input.requestHash,
        nonce: randomUUID(),
        issuedAt: issuedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        spokenText,
      });
      const mandateHash = hashMandate(mandate);
      await store.createMandate({
        id: mandate.id,
        account_id: mandate.accountId,
        action: mandate.action,
        payee_contact_id: mandate.payeeContactId ?? null,
        ...(mandate.payeeName ? { payee_name: mandate.payeeName } : {}),
        ...(mandate.payeeAccountNumber ? { payee_account_number: mandate.payeeAccountNumber } : {}),
        amount_minor: mandate.amountMinor,
        currency: mandate.currency,
        constraints: mandate.constraints,
        request_hash: mandate.requestHash,
        nonce: mandate.nonce,
        issued_at: mandate.issuedAt,
        expires_at: mandate.expiresAt,
        spoken_text: mandate.spokenText,
        mandate_hash: mandateHash,
        state: "CREATED",
      });
      await store.createAuditEvent(accountId, mandateId, "MANDATE_CREATED", { mandateHash });

      const approvalOptions = await generateAuthenticationOptions({
        rpID: config.rpID,
        // SimpleWebAuthn serializes byte challenges to base64url. Passing the
        // decoded digest avoids treating its base64url text as new challenge bytes.
        challenge: new Uint8Array(Buffer.from(mandateHash, "base64url")),
        userVerification: "required",
      });
      return response.status(201).json({
        mandateId,
        mandateHash,
        spoken: spokenText,
        readoutRequired: true,
        approvalOptions,
      });
    } catch (error) {
      if (mandateId) {
        await store.createAuditEvent(accountId, mandateId, "MANDATE_CREATE_FAILED", {}).catch(() => undefined);
      } else {
        await store.createAuditEvent(accountId, null, "MANDATE_CREATE_FAILED", {}).catch(() => undefined);
      }
      if (error instanceof z.ZodError) {
        return response.status(400).json({ code: "INVALID_REQUEST", message: "The payment request is invalid." });
      }
      return response.status(500).json({ code: "MANDATE_CREATE_FAILED", message: "The test payment could not be prepared." });
    }
  });

  router.get("/:id", async (request, response) => {
    const accountId = getAuthenticatedAccountId(request, config.sessionSecret);
    if (!accountId) {
      return response.status(401).json({
        code: "AUTH_REQUIRED",
        message: "Please sign in before checking a test payment.",
        spoken: "Please sign in before checking a test payment.",
      });
    }
    try {
      const mandateId = z.string().uuid().parse(request.params.id);
      const mandate = await store.getOwnedMandateState(accountId, mandateId);
      if (!mandate) {
        return response.status(404).json({
          code: "MANDATE_NOT_FOUND",
          message: "This test payment was not found.",
          spoken: "This test payment was not found.",
        });
      }
      const status = describeMandateState(mandate.state);
      return response.json({
        mandateId: mandate.id,
        state: mandate.state,
        status,
        spoken: mandate.state === "CREATED" ? mandate.spoken_text : `${status}.`,
        readoutRequired: mandate.state === "CREATED",
        paypalRef: mandate.paypal_ref,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return response.status(400).json({
          code: "INVALID_REQUEST",
          message: "The payment identifier is invalid.",
          spoken: "The payment identifier is invalid.",
        });
      }
      return response.status(500).json({
        code: "MANDATE_FETCH_FAILED",
        message: "The test payment status could not be loaded.",
        spoken: "The test payment status could not be loaded.",
      });
    }
  });

  return router;
}
