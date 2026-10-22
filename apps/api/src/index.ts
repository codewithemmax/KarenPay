import { randomUUID } from "node:crypto";
import express, { Router, type Express, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { createApproveRouter, loadApproveConfig } from "./approve.js";
import { appendAuditEvent, createAuditRouter } from "./audit.js";
import { createAuthRouter, getAuthenticatedAccountId, loadAuthConfig, type AuthConfig } from "./auth.js";
import { createMandateRouter, loadMandateConfig } from "./mandates.js";
import { createIntentRouter, loadIntentConfig } from "./intents.js";

export { createApproveRouter, loadApproveConfig } from "./approve.js";
export { appendAuditEvent, createAuditRouter } from "./audit.js";
export { createAuthRouter, loadAuthConfig } from "./auth.js";
export { createMandateRouter, loadMandateConfig } from "./mandates.js";
export { createIntentRouter, loadIntentConfig, type GeminiIntentClient } from "./intents.js";
export {
  PayPalApiError,
  PayPalClient,
  type PayPalClientConfig,
  type PayPalPayout,
  type PayoutItem,
  type PayoutRequest,
} from "./paypal.js";

const contactCreateSchema = z.object({
  displayName: z.string().trim().min(1).max(100),
  paypalSandboxEmail: z.string().trim().email(),
}).strict();

type ContactRow = {
  id: string;
  display_name: string;
  paypal_sandbox_email: string;
};

/**
 * Enforces strict origin validation for browser requests and preflight checks.
 * Supports Option A (Next.js same-origin rewrite proxy) and local WEB_ORIGIN dev.
 */
export function createClientCorsMiddleware(webOrigin: string): RequestHandler {
  const allowedOrigin = new URL(webOrigin).origin;
  return (request: Request, response: Response, next: NextFunction) => {
    response.setHeader("Vary", "Origin");
    const requestOrigin = request.headers.origin;
    if (requestOrigin === allowedOrigin) {
      response.setHeader("Access-Control-Allow-Origin", allowedOrigin);
      response.setHeader("Access-Control-Allow-Credentials", "true");
      response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      response.setHeader("Access-Control-Allow-Headers", "Content-Type");
      if (request.method === "OPTIONS") {
        response.status(204).end();
        return;
      }
      next();
      return;
    }
    if (request.method === "OPTIONS" && requestOrigin) {
      response.status(403).json({
        code: "ORIGIN_NOT_ALLOWED",
        message: "This origin is not allowed.",
        spoken: "This origin is not allowed.",
      });
      return;
    }
    next();
  };
}

export function createContactsRouter(config: AuthConfig): Router {
  const router = Router();

  const requestContacts = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const response = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: config.supabaseServiceRoleKey,
        Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
        ...init.headers,
      },
    });
    if (!response.ok) throw new Error(`Supabase request failed with status ${response.status}`);
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  };

  router.get("/", async (request: Request, response: Response) => {
    const accountId = getAuthenticatedAccountId(request, config.sessionSecret);
    if (!accountId) {
      return response.status(401).json({
        code: "AUTH_REQUIRED",
        message: "Please sign in to view your contacts.",
        spoken: "Please sign in to view your contacts.",
      });
    }
    try {
      const rows = await requestContacts<ContactRow[]>(
        `contacts?select=id,display_name,paypal_sandbox_email&account_id=eq.${encodeURIComponent(accountId)}&order=created_at.asc`,
      );
      return response.json({
        contacts: rows.slice(0, 5).map((row) => ({
          id: row.id,
          displayName: row.display_name,
          paypalSandboxEmail: row.paypal_sandbox_email,
        })),
      });
    } catch {
      return response.status(500).json({
        code: "CONTACTS_FETCH_FAILED",
        message: "Your contacts could not be loaded.",
        spoken: "Your contacts could not be loaded.",
      });
    }
  });

  router.post("/", async (request: Request, response: Response) => {
    const accountId = getAuthenticatedAccountId(request, config.sessionSecret);
    if (!accountId) {
      return response.status(401).json({
        code: "AUTH_REQUIRED",
        message: "Please sign in before adding a contact.",
        spoken: "Please sign in before adding a contact.",
      });
    }
    try {
      const input = contactCreateSchema.parse(request.body);
      const existing = await requestContacts<ContactRow[]>(
        `contacts?select=id,display_name,paypal_sandbox_email&account_id=eq.${encodeURIComponent(accountId)}`,
      );
      if (existing.length >= 5) {
        return response.status(422).json({
          code: "CONTACT_LIMIT_REACHED",
          message: "You can save at most five contacts.",
          spoken: "You can save at most five contacts.",
        });
      }
      const contactId = randomUUID();
      await requestContacts("contacts", {
        method: "POST",
        body: JSON.stringify({
          id: contactId,
          account_id: accountId,
          display_name: input.displayName,
          paypal_sandbox_email: input.paypalSandboxEmail,
        }),
      });
      return response.status(201).json({
        contact: {
          id: contactId,
          displayName: input.displayName,
          paypalSandboxEmail: input.paypalSandboxEmail,
        },
        spoken: `Added ${input.displayName} to your contacts.`,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return response.status(400).json({
          code: "INVALID_CONTACT",
          message: "Please provide a valid contact name and sandbox email.",
          spoken: "Please provide a valid contact name and sandbox email.",
        });
      }
      return response.status(500).json({
        code: "CONTACT_CREATE_FAILED",
        message: "The contact could not be saved.",
        spoken: "The contact could not be saved.",
      });
    }
  });

  return router;
}

export function createKarenPayApi(): Express {
  const app = express();
  const authConfig = loadAuthConfig();
  app.use(createClientCorsMiddleware(authConfig.webOrigin));
  app.use(express.json({ limit: "32kb" }));
  app.get("/api/v1/health", (_request, response) => {
    response.json({ status: "ok", sandbox: true, spoken: "KarenPay sandbox API is ready." });
  });
  app.use("/api/v1/auth", createAuthRouter(authConfig));
  app.use("/api/v1/contacts", createContactsRouter(authConfig));
  app.use("/api/v1/audit", createAuditRouter(authConfig));
  app.use("/api/v1/mandates", createMandateRouter(loadMandateConfig()));
  app.use("/api/v1/intent", createIntentRouter(loadIntentConfig()));
  app.use("/api/v1/mandates", createApproveRouter(loadApproveConfig()));
  return app;
}
