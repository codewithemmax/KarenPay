# Progress Tracker

Update this file after every meaningful implementation change.

## Current Phase
* Build phase. Product brief v1.0 is done. Unit 4 is in progress; Units 5 and 6 are complete (October 21, 2026).

## Current Goal
* Pass Gate 2: register and log in with a passkey on the real demo phone over HTTPS.

## Current State
* Product brief KarenPay v1.0 finalized. Test plan from the security research is adopted (see Architecture Decisions).
* Unit 1 scaffold is complete: workspace manifests, strict TypeScript, Vitest,
  security policy, API documentation placeholder, and repository layout are
  present. Bun build and test checks pass.
* Unit 2 client is implemented and tested with sandbox-only URL enforcement,
  OAuth token caching, Payouts, `sender_batch_id` idempotency, and schema
  validation. `send_money` is the only payment action in scope.

## Completed
* Unit 1: repo scaffold, Apache-2.0, SECURITY.md.
* Unit 2: PayPal Sandbox OAuth and Payouts client.
* Unit 3: additive Supabase database migrations, applied through the Supabase SQL Editor.
* Unit 5: Core mandate validation, RFC 8785 canonicalization, and SHA-256 hash.
* Unit 6: deterministic readout, intent validation, and payment limits.

## In Progress
* Unit 4: passkey registration and login.

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
  npm install
  ```
* Daily control loop: pull dev, complete one narrow unit, test it, commit and push, update this file, then name the next unit.
