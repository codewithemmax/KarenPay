# Progress Tracker

Update this file after every meaningful implementation change.

## Current Phase
* Build phase. Product brief v1.0 is done. Unit 10 is removed; Units 4, 7, 8, and 9 await their live acceptance checks; Units 5, 6, 10, and 11 are complete or not applicable (October 22, 2026).

## Current Goal
* Complete Unit 12 (Client Integration Support) and remaining live acceptance gates for Units 4, 7, 8, and 9.

## Current State
* Product brief KarenPay v1.0 finalized. Test plan from the security research is adopted (see Architecture Decisions).
* Unit 1 scaffold is complete: workspace manifests, strict TypeScript, Vitest,
  security policy, API documentation placeholder, and repository layout are
  present. Bun build and test checks pass.
* Unit 2 client is implemented and tested with sandbox-only URL enforcement,
  OAuth token caching, Payouts, `sender_batch_id` idempotency, and schema
  validation. `send_money` is the only payment action in scope.
* Unit 11 endpoint (`POST /api/v1/intent`) is implemented, tested, and documented in `docs/KARENPAY_API.md`: it retrieves at most five owned contacts, supports spoken recipient name + digit-by-digit account number (`payeeName` and `payeeAccountNumber`) with full digit-by-digit readout in `buildReadout`, sends only transcript and display names to Gemini structured output, strictly validates the reply, returns clarification for ambiguity, and rate-limits requests per account.
* Unit 12 backend client integration support is implemented and tested: Option A same-origin rewrite guidance (`apps/web/README.md`), strict `WEB_ORIGIN` CORS middleware (`createClientCorsMiddleware`), `SameSite=Strict` cookies, spoken-safe auth error responses, `GET /api/v1/health`, `GET/POST /api/v1/contacts` (max 5), and `GET /api/v1/mandates/:id` with `describeMandateState` vocabulary. Awaiting the 5-send phone test with the voice client (Gate 4).
* Units 14, 15, 16, and 17 are implemented and documented in `docs/RESULTS.md`: hash-chained audit events (`computeAuditHash`, `verifyAuditChain`, `GET /api/v1/audit`) and retry safety (Unit 14); Attack Suite A with 1,000 randomized crypto/logic trials and 100 WebAuthn passkey assertion runs (Unit 15); and Attack Suite B with 200 adversarial prompt and contact/account-number injection trials inspired by AP2-WhisperBench graded with and without `checkIntent` (Unit 16).
* Web UI Redesign (`web/ui-redesign` branch): Prompts 0, 1, 2, 3, 4, and 5 are complete and verified. Configured WCAG-calibrated Sunset Palette (`--bg: #FFF2E7`, `--surface: #FFFFFF`, `--surface-tint: #FDD9B5`, `--text: #1F0D09`, `--text-muted: #5C2418`, `--primary: #B82D14`, `--balance-card: #1F0D09`, `--sun: #FFCC6B`, `--peach: #F0C38E`, `--coral: #F1AA9B`, `--danger: #9F1239`, `--warning-bg: #FEF3C7`, `--focus-ring: #F9C74F`) with `Atkinson_Hyperlegible` (`--font-sans`) and `Inter` (`--font-num`) and `.num` (`tabular-nums lining-nums slashed-zero`). Implemented `/` (Welcome), `/register` (2-step Passkey Setup), `/home` (Balance card + Quick Actions), `/contacts` (Allowed Recipients), `/pay` (4-step Voice & Cryptographic Consent Terminal with Desktop 2-column Blind + Sighted Bridge, Mandate Node Tree, Mandatory Readout Lock, and Judge Demo Tamper Switch), `/activity` (Hash-Chained Audit Log + Slide-Up Bottom Sheet Inspector), and `/me` (Profile & Passkey Security). Verified with Playwright MCP + `axe-core` across all 28 route/state/viewport combinations (`390x844` and `1280x800`) with **0 violations**.
* Bulk Pay (`feature/bulk-pay` branch):
  * **Unit B0** complete: Read-only discovery and integration map accepted.
  * **Unit B1** complete: Added `supabase/migrations/20261031000000_bulk_pay_schema_and_directory.sql` (`batches`, `batch_items`, `sandbox_directory` with 12 seeded simulated records), set `MAX_AMOUNT_MINOR=10000` and `MAX_BATCH_MINOR=30000` in `.env.example`, and added `loadBulkConfig` in `apps/api/src/bulk/config.ts`.
  * **Unit B2** complete: Created `@karenpay/bulk` (`packages/bulk/src/index.ts`) with pure WhatsApp/bank recipient parser (newline, comma, dash, pipe separators, fields in any order, repeated pattern splitting), 24 Nigerian bank entries/aliases, 10-digit account validation, duplicate detection, 5-recipient batch cap, token-set name comparison (`"Name matches"` / `"Name differs"`), Gemini display-name sanitizer (`<= 60` chars or `"Recipient N"`), deterministic amount parser + dual amount check, RFC 8785 `computePlanHash`, and strict `zod` schemas for all 5 widget types (`recipient_list`, `name_check`, `plan`, `transfer_approval`, `batch_summary`), verified by `tests/unit/bulk-package.test.ts`.
  * **Unit B3** complete: Implemented `POST /api/v1/bulk/parse` and `POST /api/v1/bulk/items/:id/resolve-name` in `apps/api/src/bulk/router.ts` and `apps/api/src/bulk/store.ts`, mounted `/api/v1/bulk` in `createKarenPayApi` (`apps/api/src/index.ts`), documented in `docs/KARENPAY_API.md`, and verified with `tests/unit/bulk-parse-resolve.test.ts`.
  * **Unit B4** complete: Implemented `POST /api/v1/bulk/:batchId/plan` and `POST /api/v1/bulk/:batchId/confirm-plan` with `BulkGeminiPlannerClient` (`apps/api/src/bulk/planner.ts`), sanitized display names (`<= 60` chars or `"Recipient N"`, zero account numbers/bank names/hashes in Gemini payload), deterministic dual amount check (`verifyDualAmountCheck`), per-transfer (`MAX_AMOUNT_MINOR=10000`) and batch (`MAX_BATCH_MINOR=30000`) limit enforcement, RFC 8785 `planHash` verification, and hash-chained audit events (`BULK_PLAN_CREATED`, `BULK_PLAN_CONFIRMED`, `BULK_PLAN_REJECTED`, `BULK_PLAN_CLARIFICATION_REQUIRED`), verified by `tests/unit/bulk-plan.test.ts`.
  * **Unit B5** complete: Extracted `createAccountMandate` and `buildMandateApprovalOptions` in `apps/api/src/mandates.ts` (`47ef37c`), implemented `POST /api/v1/bulk/:batchId/next`, `GET /api/v1/bulk/:batchId/items/:itemId/mandate`, `POST /api/v1/bulk/:batchId/items/:id/cancel`, `POST /api/v1/bulk/:batchId/cancel-remaining`, and `GET /api/v1/bulk/:batchId` in `apps/api/src/bulk/router.ts`, added the fail-closed bulk receiver resolution and state-sync hook (`createApproveBulkHook` in `apps/api/src/bulk/store.ts` and `apps/api/src/approve.ts`), and verified with `tests/unit/bulk-queue-approve-cancel.test.ts`.
  * **Unit B6** complete: Added 5th `"Bulk pay"` tab in `apps/web/src/components/BottomTabBar.tsx`, added `/home` Bulk pay card (`apps/web/src/app/home/page.tsx`), rendered `BULK_*` audit event types with last-4-digit formatting in `/activity` (`apps/web/src/app/activity/page.tsx`), and implemented `/bulk` (`apps/web/src/app/bulk/page.tsx`) and fixed widget registry (`apps/web/src/components/bulk/BulkWidgetRegistry.tsx`) with `@karenpay/core` client-side `buildMandate` + `hashMandate` verification, Hard Readout Lock, Judge Demo Tamper Switch, per-item Cancel, and Cancel remaining.

## Completed
* Unit 1: repo scaffold, Apache-2.0, SECURITY.md.
* Unit 2: PayPal Sandbox OAuth and Payouts client.
* Unit 3: additive Supabase database migrations, applied through the Supabase SQL Editor.
* Unit 5: Core mandate validation, RFC 8785 canonicalization, and SHA-256 hash.
* Unit 6: deterministic readout, intent validation, and payment limits.
* Unit 10: not applicable; merchant payments are out of scope.
* Unit 11: Gemini intent endpoint (`POST /api/v1/intent`), strict schema validation, clarification handling, rate limiting, and API documentation.

## In Progress
* Unit 4: passkey registration and login.
* Unit 7: Core state machine and atomic consume.
* Unit 8: mandate create endpoint.
* Unit 9: mandate approval and sandbox payout.

## Next Up
* Unit 7: Core state machine and atomic consume.
* Start contacting screen-reader testers today.

## Open Questions
* Final hosted domain. Passkeys bind to the domain, so changing it later means re-registering. Decide by the end of Unit 4.
* Which demo phone and browser. Decide in Unit 4 and test only there.
* Exact Gemini model name for `GEMINI_MODEL`, and the exact package names for the RFC 8785 library and the Gemini SDK. Confirm on npm and in the docs.

## Architecture Decisions
* Library first: KarenPay Core is the product, the voice app is the reference client.
* Demo action: `send_money` through PayPal Payouts only. Merchant payments are out of scope.
* Passkey-only accounts, no Supabase Auth. Supabase is used as Postgres only.
* Mandate follows the AP2 Cart Mandate shape and is validated against AP2's JSON schemas. Wording rule: aligned for purchases, inspired for transfers.
* RFC 8785 canonicalization. Challenge is the hash of the canonical mandate.
* Jev is cut. Elastic is a stretch task after Gate 6.
* License Apache-2.0. Budget $0. Hosting on Render.
* Test targets: 1,000+ randomized crypto and logic trials, 100 browser passkey runs, about 200 adversarial prompts graded by code with and without the intent check, 3+ screen-reader users. The Rule of Three bounds the failure rate at about 3 divided by the number of clean trials, only for the attack types sampled.
* **Bulk Pay Architecture Decisions (Accepted in Unit B0)**:
  1. **Account number display & readout**: In `recipient_list`, `name_check`, `plan`, `batch_summary`, and `/activity`, show the last 4 digits and speak `"account ending in last 4 digits ..."`. In `transfer_approval`, the signed mandate holds the full 10-digit `payeeAccountNumber`, `buildReadout` in `@karenpay/core` speaks it digit-by-digit unchanged, and the card displays the full 10-digit number grouped in `.num` so the user approves the exact signed payload.
  2. **Bank binding**: For bulk mandates, set `payeeName` to `"{directory account name} at {bank name}"` in both the proposal and the constraints (within `PaymentProposalSchema`'s 100-char max, falling back to shortest bank alias if needed) so the bank is spoken, hashed, and checked by `checkIntent`. The UI card may split on the last `" at "` for layout only.
  3. **Mandate fetch for `transfer_approval`**: Leave `GET /api/v1/mandates/:id` untouched. Add `GET /api/v1/bulk/:batchId/items/:itemId/mandate` returning `{ mandate, mandateHash, approvalOptions, spoken, readoutRequired, state }` after checking session ownership, batch membership, and active mandate state.
  4. **Fail-closed approve hook**: For any mandate belonging to a batch item, require `batch_items.mandate_id === mandate.id`, `batch_items.account_number === mandate.payeeAccountNumber`, composed `"${resolved_name} at ${bank_name}" === mandate.payeeName`, and that the `sandbox_directory` record exists. Any mismatch marks outcome `FAILED`, makes no PayPal call, and records an audit event. Non-bulk mandates remain byte-for-byte identical to existing behavior.
  5. **Limits**: Leave `VOICE_POLICY_LIMIT_MAX_MINOR` in `apps/web/src/lib/demoData.ts` untouched; set `.env.example` defaults `MAX_AMOUNT_MINOR=10000` (`$100.00`) and `MAX_BATCH_MINOR=30000` (`$300.00`).
  6. **Gemini display-name sanitization**: Send only display names matching letters, spaces, hyphens, apostrophes, and periods (`<= 60` characters); otherwise send `"Recipient N"`.

## Pre-demo cleanup
* `"Verified Recipient"` on the Mandate Node Tree (`apps/web/src/app/pay/page.tsx`)
* `"Hardware / Platform Passkey Verified"` (`apps/web/src/app/me/page.tsx`)
* `"Verification Status: Hash Chain Verified"` (`apps/web/src/app/activity/page.tsx`)
* Description claiming a `"$500.00 sandbox cap"` (`apps/web/src/app/home/page.tsx` and `apps/web/src/app/pay/page.tsx`) versus the `MAX_AMOUNT_MINOR` default of `10000` (`$100.00`)

## Session Notes
* Submission target: November 11, 2026. Devpost deadline: November 12, 12:00 pm PST.
* Base setup commands:
  ```
  git clone https://github.com/<your-username>/karenpay.git
  cd karenpay
  git switch -c core/unit-01-scaffold
  bun install
  ```
* Daily control loop: pull dev, complete one narrow unit, test it, commit and push, update this file, then name the next unit.
