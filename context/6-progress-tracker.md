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
* Web UI Redesign (`web/ui-redesign` branch): Prompt 0 (`context/3-ui-context.md` design system and accessibility contract) and Prompt 1 (`/` welcome and passkey sign-in screen, `/register` create account screen, `LiveRegionsProvider`, `Button` component, and global colour/typography tokens) are implemented, verified with Playwright MCP and axe-core (0 violations), and old UI components removed. Awaiting `"continue"` before starting Prompt 2 (`/home` and `/contacts`).

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
