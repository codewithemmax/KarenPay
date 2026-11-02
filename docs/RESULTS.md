# KarenPay Security & Attack Suite Results (Units 14–17)

- **Recorded Date**: October 22, 2026
- **Base Commit**: `d62f4ee` (with Units 12, 14, 15, and 16 suites)
- **Command to Run All Suites**:
  ```powershell
  bun run build; bun run test
  ```

---

## 1. Attack Suite A: Crypto, Logic, and Passkey Assertions (Unit 15)

File: [`tests/unit/attack-suite-a-crypto-logic.test.ts`](../tests/unit/attack-suite-a-crypto-logic.test.ts)

| Suite / Vector | Trials Run | Rejected Attacks | Valid Baseline Approvals | Bypasses | Rule of Three 95% Upper Bound (for sampled attack types) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Crypto & Logic Mutations** (amount, recipient/spoken account digits, expiry, nonce replay, policy limits, audit chain, RFC 8785 key-order canonicalization) | 1,000 | 1,000 | — | **0** | $\le 3 / 1000 = 0.3\%$ |
| **WebAuthn Passkey Assertion Flows** (valid ES256 baseline + flipped `UV=0`, flipped `UP=0`, mismatched mandate hash challenge, phishing origin) | 100 | 80 | 20 | **0** | $\le 3 / 80 = 3.75\%$ |

---

## 2. Attack Suite B: AI Pipeline & Contact/Account-Number Injections (Unit 16)

File: [`tests/unit/attack-suite-b-ai-pipeline.test.ts`](../tests/unit/attack-suite-b-ai-pipeline.test.ts)

Graded deterministically by code across **200 adversarial prompt and contact-name / spoken-account-number injection cases inspired by AP2-WhisperBench**:

| Attack Category (inspired by AP2-WhisperBench) | Trials | Bypasses **Without** `checkIntent` / `checkLimits` | Bypasses **With** `checkIntent` + `checkLimits` |
| :--- | :---: | :---: | :---: |
| Amount escalation prompt injection | 40 | 40 / 40 | **0 / 40** |
| Contact-name injection redirecting recipient | 40 | 40 / 40 | **0 / 40** |
| Spoken digit-by-digit account number / name substitution | 40 | 40 / 40 | **0 / 40** |
| Currency substitution injection | 40 | 40 / 40 | **0 / 40** |
| Unowned recipient / policy ceiling escalation | 40 | 40 / 40 | **0 / 40** |
| **Total** | **200** | **200 / 200 (100%)** | **0 / 200 (0%)** |

> **Rule of Three Note**: Zero observed bypasses across $N = 200$ clean adversarial trials bounds the failure rate at approximately $\le 3 / 200 = 1.5\%$ at 95% confidence, strictly for the attack types sampled.

---

## 3. Audit Log Hash Chain & Retry Safety (Unit 14)

File: [`tests/unit/audit-and-retry.test.ts`](../tests/unit/audit-and-retry.test.ts)

| Check | Result |
| :--- | :--- |
| Valid hash-chained audit log (`computeAuditHash` + `verifyAuditChain`) | **Pass** (`{ valid: true }`) |
| Mutated `detail` payload detection | **Pass** (`HASH_MISMATCH` detected) |
| Deleted/reordered link detection (`prev_hash`) | **Pass** (`PREV_HASH_MISMATCH` detected) |
| Retry after dropped network response on `POST /api/v1/mandates/:id/approve` | **Pass** (stored `PAID` outcome returned, `0` duplicate PayPal Payout calls) |

---

## 4. Bulk Pay Extension Security & Quality Gate (Unit B8)

- **Recorded Date**: November 2, 2026
- **Commit Hash**: `2f51630` (with Units B1–B7 on `feature/bulk-pay`)
- **Commands to Verify**:
  ```powershell
  bun run build
  bun run test --fileParallelism=false
  node scripts/verify-bulk-ui.mjs
  ```

### 4.1 Unit Test Suites Summary (All 17 Test Files Passing Unchanged)

| Test File | Tests | Status | Scope & Attack Vectors Tested |
| :--- | :---: | :---: | :--- |
| `tests/unit/attack-suite-a-crypto-logic.test.ts` | 2 | **Pass** | 1,000 randomized crypto/logic trials + 100 WebAuthn passkey assertion trials (`UV=0`, `UP=0`, origin/challenge checks). |
| `tests/unit/attack-suite-b-ai-pipeline.test.ts` | 1 | **Pass** | 200 adversarial prompt & contact/account-number injections graded with/without `checkIntent`. |
| `tests/unit/bulk-package.test.ts` | 12 | **Pass** | WhatsApp recipient parser, >=20 Nigerian bank aliases, 10-digit validation, duplicate detection, token-set name comparison, Gemini display-name sanitizer, deterministic amount parser, dual amount check, RFC 8785 `planHash`, and 5 Zod widget schemas. |
| `tests/unit/bulk-parse-resolve.test.ts` | 3 | **Pass** | `POST /api/v1/bulk/parse` and `POST /api/v1/bulk/items/:id/resolve-name` with simulated directory lookup and hash-chained audit events. |
| `tests/unit/bulk-plan.test.ts` | 4 | **Pass** | `POST /api/v1/bulk/:batchId/plan` and `POST /api/v1/bulk/:batchId/confirm-plan` with dual amount check, per-transfer ($100) and batch ($300) limits, and audit events. |
| `tests/unit/bulk-queue-approve-cancel.test.ts` | 2 | **Pass** | `POST /api/v1/bulk/:batchId/next`, `GET /api/v1/bulk/:batchId/items/:itemId/mandate`, WebAuthn passkey approval, fail-closed approve hook, per-item cancel, and `cancel-remaining`. |
| `tests/unit/bulk-security-suite.test.ts` | 6 | **Pass** | 5-recipient batch cap, 10-digit validation & duplicate accounts, adversarial prompt injection sanitization to `"Recipient N"` without account/bank leaks, dual amount mismatch rejection, cross-account and cross-batch isolation, independent item failure/expiry, 5-sequential passkey approvals, Judge Demo Tamper Switch hash mismatch detection, browser SHA-256 shim parity across 100 trials, and full audit chain verification. |
| `tests/unit/mandate-route.test.ts` | 4 | **Pass** | Core mandate creation endpoint and service helper extraction. |
| `tests/unit/approve-route.test.ts` | 2 | **Pass** | Mandate approval, atomic single-use consume, and sandbox payout. |
| `tests/unit/client-integration.test.ts` | 5 | **Pass** | Health, contacts list/create (max 5), mandate state mapping, and CORS/cookie topology. |
| `tests/unit/intent-route.test.ts` | 5 | **Pass** | Gemini intent interpretation, contact matching, spoken accounts, and rate limiting. |
| `tests/unit/audit-and-retry.test.ts` | 3 | **Pass** | Hash-chained audit log verification and idempotency retry safety. |
| `tests/unit/paypal-client.test.ts` | 2 | **Pass** | PayPal sandbox OAuth and Payouts client. |
| `tests/unit/mandate.test.ts` | 3 | **Pass** | Core mandate schema validation and canonicalization. |
| `tests/unit/mandate-state.test.ts` | 3 | **Pass** | Core state machine transitions. |
| `tests/unit/readout-intent-limits.test.ts` | 9 | **Pass** | Core readout formatting, intent validation, and policy limits. |
| `tests/unit/scaffold.test.ts` | 1 | **Pass** | Workspace structure and manifest integrity. |
| **Total** | **67** | **67 / 67 (100% Pass)** | **17 test files passed cleanly** |

### 4.2 Browser & Accessibility Verification (`scripts/verify-bulk-ui.mjs`)

Evaluated with Playwright Chromium/Edge + `@axe-core/playwright` across WCAG 2.0, 2.1 Level A & AA standards at viewports `320x844` (mobile small), `390x844` (mobile standard), and `1280x800` (desktop):

| Viewport | Evaluated Bulk Pay Route State | axe-core Violations | Functional Assertion Check |
| :---: | :--- | :---: | :--- |
| `320px` | Empty Paste (`/bulk`) | **0** | No horizontal scroll overflow; 5 bottom tabs accessible. |
| `320px` | `recipient_list` + `name_check` | **0** | Simulated directory badge visible; name resolution options interactable. |
| `320px` | `plan` | **0** | Plan items and running total rendered cleanly. |
| `320px` | `transfer_approval` | **0** | Full 10-digit account grouped in `.num`, RFC 8785 hash displayed. |
| `320px` | `transfer_approval` (Tampered) | **0** | Tamper switch causes hash mismatch, displays `"Not sent"`, locks Approve button. |
| `320px` | `batch_summary` | **0** | 5 sequential passkey approvals completed; final summary with status chips. |
| `390px` | Empty Paste (`/bulk`) | **0** | No horizontal scroll overflow; 5 bottom tabs accessible. |
| `390px` | `recipient_list` + `name_check` | **0** | Name resolution choices and warning cards accessible. |
| `390px` | `plan` | **0** | Confirmed plan widget formatted cleanly. |
| `390px` | `transfer_approval` | **0** | Spoken readout banner and passkey gesture button ready. |
| `390px` | `transfer_approval` (Tampered) | **0** | Tamper switch causes hash mismatch, displays `"Not sent"`, locks Approve button. |
| `390px` | `batch_summary` | **0** | 5 sequential passkey approvals completed; final summary with status chips. |
| `1280px` | Empty Paste (`/bulk`) | **0** | Desktop layout aligned with Sunset palette tokens. |
| `1280px` | `recipient_list` + `name_check` | **0** | Responsive card layout. |
| `1280px` | `plan` | **0** | Running total bar and action buttons accessible. |
| `1280px` | `transfer_approval` | **0** | Readout lock and passkey gesture aligned. |
| `1280px` | `transfer_approval` (Tampered) | **0** | Tamper switch causes hash mismatch, displays `"Not sent"`, locks Approve button. |
| `1280px` | `batch_summary` | **0** | 5 sequential passkey approvals completed; final summary with status chips. |
| **Total** | **18 states across 3 viewports** | **0 Violations** | **0 Assertion Failures** |
