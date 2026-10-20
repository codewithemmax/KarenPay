# Implementation Units

Each unit is one atomic step: one PR-sized piece of work, testable and reviewable on its own. Build them in order. Do not start a unit until the previous one is done and verified against `5-ai-workflow-rules.md`. Dates are targets. Gates are the real stop signs: if a gate is not passed, fix it before moving on.

## Unit 1: Repo Scaffold (Oct 20)
* Scope: Create the repo `karenpay` with the layout in `2-architecture.md`, TypeScript strict config, npm workspaces, Vitest, `.gitignore`, `.env.example`, Apache-2.0 `LICENSE`, `SECURITY.md`, and an empty `docs/KARENPAY_API.md`.
* Done when: `npm run build` and `npm test` run (with one placeholder test) and nothing secret is tracked.
* Depends on: none.

## Unit 2: PayPal Sandbox Client (Oct 20 to 21) GATE 1
* Scope: In `apps/api`, a small client using `fetch` for the sandbox OAuth token, Payouts send (`send_money`) and Orders create plus capture (`pay_merchant`). Use the mandate id as the idempotency key. Settle the open questions on currency, Payouts availability and Orders approval.
* Done when: One Payouts send to a sandbox account succeeds from code and one Orders payment succeeds from code, or the Orders question is answered and recorded in `6-progress-tracker.md`.
* Depends on: Unit 1.

## Unit 3: Database Migrations (Oct 21)
* Scope: Additive migrations for `accounts`, `passkey_credentials`, `contacts`, `mandates` (with the state enum) and `audit_events`.
* Done when: Migrations apply cleanly to an empty Supabase project, with unique constraints on credential id and foreign keys enforced.
* Depends on: Unit 1.

## Unit 4: Passkey Registration and Login (Oct 22 to 23) GATE 2
* Scope: The four `/auth` endpoints with SimpleWebAuthn, session cookie, `RP_ID` and origin from the environment. Require user verification. Store device type and backup flags. Deploy a skeleton to Render over HTTPS.
* Done when: A passkey is registered and used to log in on the real demo phone, and the hosted domain is chosen and recorded.
* Depends on: Unit 3.

## Unit 5: Core Mandate, Canonicalization and Hash (Oct 24)
* Scope: In `packages/core`: the Mandate type and zod schema, RFC 8785 canonicalization, `hashMandate`, and tests including key-order and whitespace differences.
* Done when: Equal mandates always hash equally, any one-field change changes the hash, and the tests cover both.
* Depends on: Unit 1.

## Unit 6: Core Readout, Intent Check and Limits (Oct 24 to 25)
* Scope: `buildReadout` (words and digits, from fields only), `checkIntent` (compare the proposal with the extracted constraints), and the limits (positive integer, maximum, currency whitelist, contact membership).
* Done when: A named test exists for each rule in `3-ui-context.md` and each limit, and the same input always yields the same readout.
* Depends on: Unit 5.

## Unit 7: Core State Machine and Atomic Consume (Oct 25)
* Scope: State transition rules in Core and the guarded single-statement update in the API service. Expiry uses the database clock.
* Done when: Two concurrent consume attempts on one mandate produce exactly one winner, and an expired mandate is rejected.
* Depends on: Unit 3, Unit 5.

## Unit 8: Mandate Create Endpoint (Oct 25 to 26)
* Scope: `POST /api/v1/mandates` builds the mandate from a checked proposal, stores it as CREATED, returns the spoken readout, the mandate hash and the WebAuthn authentication options with the hash as challenge.
* Done when: Ownership is validated, a failed intent check returns a spoken-safe error, and every outcome is audit logged.
* Depends on: Unit 4, Unit 6, Unit 7.

## Unit 9: Approve Endpoint (Oct 26) GATE 3
* Scope: `POST /api/v1/mandates/:id/approve`. Verify the assertion (user verification, user presence, origin, RP ID, signature), confirm the challenge equals the stored mandate hash, consume atomically, call PayPal, store the result. Repeated calls return the stored result.
* Done when: A phone approval produces a sandbox payment, and tampered, replayed, expired and flag-flipped approvals are rejected in tests.
* Depends on: Unit 2, Unit 8.

## Unit 10: AP2 Schema Validation (Oct 26)
* Scope: Validate the `pay_merchant` mandate against AP2's published JSON schemas and record the mapping. Record that `send_money` is inspired by AP2, not validated.
* Done when: Validation passes or a list of mismatches is documented. The README wording follows the result.
* Depends on: Unit 5.

## Unit 11: Gemini Intent Endpoint (Oct 26 to 27)
* Scope: `POST /api/v1/intent`. Gemini structured output parsed with a strict zod schema. At most 5 contacts. Return `needsClarification` on ties. Rate limit it.
* Done when: 10 of 10 clean spoken-style requests produce the right proposal, and malformed Gemini output is rejected without a crash.
* Depends on: Unit 6.

## Unit 12: Client Integration Support (Oct 28 to 29) GATE 4
* Scope: CORS and cookie settings for the web client, the `spoken` and `readoutRequired` response fields, and spoken-safe error messages. Pair with the teammate on the voice loop and the passkey prompt.
* Done when: 5 voice-only sends in a row succeed on the demo phone, and confirm stays disabled until the readout ends.
* Depends on: Unit 9, Unit 11.

## Unit 13: pay_merchant Action (Oct 30)
* Scope: The second action through the same Core, using Orders. Skip this unit if Unit 2 showed it is not feasible.
* Done when: A merchant payment passes through the same mandate, hash, passkey and consume path.
* Depends on: Unit 9, Unit 10.

## Unit 14: Audit Log and Retry Safety (Oct 30 to 31)
* Scope: Hash-chained audit events, `GET /api/v1/audit`, and the retry-after-network-drop behavior (one payment only).
* Done when: A broken chain is detected by a verification script, and a retry after a dropped response pays once.
* Depends on: Unit 9.

## Unit 15: Attack Suite A, Crypto and Logic (Nov 1 to 2)
* Scope: Vitest and fast-check randomized trials (at least 1,000) over mutated amount, recipient, expiry, nonce, flags and canonicalization. Playwright with a virtual authenticator runs at least 100 passkey flows, including flipped user verification and user presence. One command runs everything and prints counts.
* Done when: The suite runs from a clean checkout and writes a results table.
* Depends on: Unit 9, Unit 14.

## Unit 16: Attack Suite B, AI Pipeline (Nov 3 to 4)
* Scope: About 200 adversarial prompts and contact-name injections, graded by code. Run with the intent check on and off and record both columns. Use only phrasing "inspired by" AP2-WhisperBench unless the dataset is actually run.
* Done when: A results table exists for both columns, with a deterministic grader.
* Depends on: Unit 11, Unit 6.

## Unit 17: Freeze and Full Run (Nov 5)
* Scope: Tag a commit, run every suite from a clean checkout, record the commit hash, date and counts in `docs/RESULTS.md`. Any failure means fix and restart the count.
* Done when: One clean recorded run exists for the tagged commit.
* Depends on: Unit 15, Unit 16.

## Unit 18: Human Testing (Nov 6 to 7)
* Scope: Manual voice tests (accents, number mix-ups, background audio, interrupted readout) and sessions with at least 3 screen-reader users. Write session notes.
* Done when: Notes are written, including what went wrong.
* Depends on: Unit 12.

## Unit 19: Fixes and Documentation (Nov 8)
* Scope: Fix only the top findings, then finalize `docs/KARENPAY_API.md`, `docs/THREAT_MODEL.md`, `SECURITY.md` and the README with a 10 line integration example and the corrected results wording.
* Done when: A reviewer can run the whole flow from the docs alone.
* Depends on: Unit 17, Unit 18.

## Unit 20: Deploy, Video and Submit (Nov 9 to 11)
* Scope: Final Render deploy, video under 3 minutes uploaded to YouTube, Devpost write-up, requirements check, submit on November 11.
* Done when: Submitted.
* Depends on: Unit 19.

## Stretch (only after Unit 17 is done early)
* Elastic: a voice-searchable view of the audit log on an Elastic General purpose project. Start the trial only then. Cut if there is any doubt.
