import express, { type Express } from "express";
import { createApproveRouter, loadApproveConfig } from "./approve.js";
import { createAuthRouter, loadAuthConfig } from "./auth.js";
import { createMandateRouter, loadMandateConfig } from "./mandates.js";
import { createIntentRouter, loadIntentConfig } from "./intents.js";

export { createApproveRouter, loadApproveConfig } from "./approve.js";
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

export function createKarenPayApi(): Express {
  const app = express();
  app.use(express.json({ limit: "32kb" }));
  app.use("/api/v1/auth", createAuthRouter(loadAuthConfig()));
  app.use("/api/v1/mandates", createMandateRouter(loadMandateConfig()));
  app.use("/api/v1/intent", createIntentRouter(loadIntentConfig()));
  app.use("/api/v1/mandates", createApproveRouter(loadApproveConfig()));
  return app;
}
