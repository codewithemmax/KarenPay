# Architecture

Scope: this file documents the backend and Core. The teammate owns the web client and integrates against the endpoints below.

## Tech Stack
| Layer | Technology | Role |
| :--- | :--- | :--- |
| Core | TypeScript package, pure functions, no I/O | Mandate type, RFC 8785 canonicalization, hashing, readout template, intent check, limits, state machine. |
| API | Node.js 20+, Express, TypeScript | Routing, session handling, WebAuthn, Gemini intent, PayPal calls, audit log. |
| Database | Supabase (PostgreSQL) | Accounts, passkey credentials, contacts, mandates, audit events. Supabase Auth is not used. |
| Passkeys | SimpleWebAuthn (`@simplewebauthn/server` and `@simplewebauthn/browser`) | Registration, login and approval assertions. |
| AI | Gemini API with structured output | Transcript to proposed action only. |
| Payments | PayPal sandbox REST (Orders v2, Payouts) called with plain `fetch` | Money movement. No PayPal SDK on the server. |
| Web client | Next.js with the Web Speech API | Owned by the teammate. |
| Hosting | Render (API and web) | Environment variables set in the Render dashboard. |
| Tests | Vitest, fast-check, Playwright (Chromium virtual authenticator) | Logic, randomized attack trials, passkey flows. |

## Repository Layout
```
karenpay/
  packages/core/      KarenPay Core (the open-source product)
  apps/api/           Express API
  apps/web/           Next.js voice client (teammate)
  supabase/migrations/  additive SQL migrations
  tests/              attack suites and scenario files
  docs/               KARENPAY_API.md, THREAT_MODEL.md, RESULTS.md
  SECURITY.md  LICENSE (Apache-2.0)  README.md
```

## Data Model (Required)

**accounts**: id, display_name, created_at.

**passkey_credentials**: id, account_id, credential_id (unique), public_key, counter, transports, device_type, backed_up, created_at.

**contacts**: id, account_id, display_name, paypal_sandbox_email, created_at. Maximum 5 per account.

**mandates**: id, account_id, action (`send_money` or `pay_merchant`), payee_contact_id, amount_minor (positive integer), currency, constraints (jsonb), request_hash, nonce, issued_at, expires_at, spoken_text, mandate_hash, state, paypal_ref, created_at, updated_at.

**audit_events**: id, mandate_id (nullable), account_id, event_type, detail (jsonb), prev_hash, hash, created_at. The hash chains each row to the previous one.

## Mandate States
`CREATED` then `CONSUMED` then `PAID` or `FAILED`. Terminal side states: `REJECTED` and `EXPIRED`. CREATED to CONSUMED is one atomic update guarded by the current state and the database clock. A repeated approve call on a CONSUMED, PAID or FAILED mandate returns the stored result and never triggers a second payment.

## Required Endpoints
* `GET /api/v1/health`
* `POST /api/v1/auth/register/options` and `POST /api/v1/auth/register/verify`
* `POST /api/v1/auth/login/options` and `POST /api/v1/auth/login/verify`
* `POST /api/v1/auth/logout`
* `GET /api/v1/contacts` and `POST /api/v1/contacts` (maximum 5)
* `POST /api/v1/intent` (transcript in, proposed action out, no mandate yet)
* `POST /api/v1/mandates` (proposal in, checked mandate plus readout plus passkey options out)
* `POST /api/v1/mandates/:id/approve` (passkey assertion in, payment result out)
* `GET /api/v1/mandates/:id` (state)
* `GET /api/v1/audit` (the caller's own events)

## Auth and Access Model
* Passkey-only accounts. A login assertion creates a short-lived session in an httpOnly, secure, same-site cookie.
* Every mandate, contact and audit action validates ownership against the session account. Altering an ID to reach another account must be rejected.
* The approval assertion is separate from the login assertion. Its challenge is the mandate hash.

## AI Model
Gemini is called only by `POST /api/v1/intent`. It receives the transcript and the caller's contact names. It never receives secrets, PayPal data or account IDs. Its output is parsed with a strict zod schema and then passed through the intent check and limits. It can never approve, never choose a recipient outside the contact list, and never set the final amount.

## Invariants (Hard Rules)
1. Challenge equals base64url(SHA-256(RFC 8785 canonical mandate)).
2. The spoken text is a field inside the hashed mandate and is built by a template from the mandate's own numbers.
3. Approval requires user verification true, user presence true, matching origin and RP ID, and a valid signature. Log the device type and backup flags.
4. Expiry is 120 seconds, checked with the database clock.
5. Single use is enforced by the atomic state transition, never by application memory.
6. Amount is a positive integer in minor units, below the policy maximum. Currency is on the whitelist.
7. Recipient must be one of the caller's contacts.
8. PayPal calls use the mandate id as the idempotency key (`sender_batch_id` for Payouts, `PayPal-Request-Id` for Orders). Confirm exact behavior in PayPal's docs.
9. Credentials and secrets never reach the browser, Gemini, logs or Git.
10. Every outcome writes an audit event, including every rejection and its reason.
