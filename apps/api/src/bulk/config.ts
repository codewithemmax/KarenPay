import { loadMandateConfig, type MandateConfig } from "../mandates.js";

export interface BulkConfig extends MandateConfig {
  maxBatchMinor: number;
  batchTtlSeconds: number;
}

/**
 * Loads configuration for Bulk Pay, reusing the existing MandateConfig
 * (which includes MAX_AMOUNT_MINOR, ALLOWED_CURRENCIES, and MANDATE_TTL_SECONDS)
 * and adding MAX_BATCH_MINOR (default 30000 minor units = $300.00) and
 * a 10-minute (600s) batch plan TTL.
 */
export function loadBulkConfig(
  environment: NodeJS.ProcessEnv = process.env,
): BulkConfig {
  const mandateConfig = loadMandateConfig({
    ...environment,
    MAX_AMOUNT_MINOR: environment.MAX_AMOUNT_MINOR?.trim() || "10000",
    ALLOWED_CURRENCIES: environment.ALLOWED_CURRENCIES?.trim() || "USD",
  });
  const rawMaxBatch = environment.MAX_BATCH_MINOR?.trim() || "30000";
  const maxBatchMinor = Number.parseInt(rawMaxBatch, 10);
  if (
    !Number.isSafeInteger(maxBatchMinor) ||
    maxBatchMinor <= 0 ||
    maxBatchMinor < mandateConfig.paymentPolicy.maximumAmountMinor
  ) {
    throw new Error(
      "MAX_BATCH_MINOR must be a positive integer greater than or equal to MAX_AMOUNT_MINOR",
    );
  }
  return {
    ...mandateConfig,
    maxBatchMinor,
    batchTtlSeconds: 600,
  };
}
