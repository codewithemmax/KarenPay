# Code Standards

## TypeScript Conventions
* Strict mode: `"strict": true`.
* Avoid `any`. Use `unknown` for genuinely dynamic shapes, then narrow.
* `interface` for object models, `type` for unions and aliases.
* Validate every external input (requests, Gemini output, PayPal responses) with zod before use.

## Core Package Rules (`packages/core`)
* Pure functions only. No database, no network, no clock reads (pass time in), no environment variables.
* Every security rule in `2-architecture.md` has its own named test in `packages/core`.
* Keep the public surface small: `buildMandate`, `canonicalize`, `hashMandate`, `buildReadout`, `checkIntent`, `verifyApproval`-style helpers, and the state transition types.

## Express (API) Structure
* Routes: define endpoint URLs, attach to controllers. No business logic.
* Controllers: request parsing, response formatting, error catching.
* Services: business logic and database queries. Isolated and testable.
* Middlewares: session validation, ownership checks, request sanitization, rate limiting on `/intent` and `/auth/*`.

## Data and Migration Rules
* SQL migrations live in `supabase/migrations`, additive only. Never modify a migration once applied.
* Build exactly the five tables in `2-architecture.md`.
* Use parameterized queries only. Never string-build SQL.
* Mandate state changes use a single guarded `UPDATE ... WHERE state = ... RETURNING` statement.

## Dependencies
* Keep the list short, pin exact versions, commit the lockfile, and review lockfile changes in every PR.
* Approved: express, zod, @simplewebauthn/server, @simplewebauthn/browser, a Postgres client or @supabase/supabase-js, an RFC 8785 library, the Google Gen AI SDK, vitest, fast-check, playwright.
* Confirm each package name and its maintainer on npm before installing. Do not add anything else without asking.

## Testing Standards
* Vitest for unit and API tests. fast-check for randomized attack trials. Playwright with the Chromium virtual authenticator for passkey flows.
* Grade attacks with code, never with an AI. An attack "succeeds" only if a deterministic check finds a payment created outside the request.
* Every suite prints counts: trials run, bypasses, and (for the AI suite) results with and without the intent check.
* Randomize inputs. Repeating one identical case 100 times proves nothing.
* If a failure appears, fix it and restart the count from zero. Never report a count that includes a fix made mid-run.
* Results are recorded with the commit hash and date in `docs/RESULTS.md`.

## Environment Variables (names only, values never in Git)
`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_BASE_URL` (sandbox host only), `GEMINI_API_KEY`, `GEMINI_MODEL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `RP_ID`, `RP_NAME`, `WEB_ORIGIN`, `SESSION_SECRET`, `MANDATE_TTL_SECONDS` (120), `MAX_AMOUNT_MINOR`, `ALLOWED_CURRENCIES`. Keep `.env.example` in the repo with names only.

## Git and Secrets
* Never commit `.env` files, keys, database URLs, tokens or archives.
* Before every push: `git diff --check`, `git status --short`, `npm run build`, `npm test`.
* Branches: `main` (stable), `dev` (integration), and short-lived `core/...`, `api/...`, `web/...` branches. Open a PR into `dev`. The other person reviews and merges.
* Document every request, response, manual test and migration command in `docs/KARENPAY_API.md`.
