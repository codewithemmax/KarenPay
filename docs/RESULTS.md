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
