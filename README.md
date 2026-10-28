# KarenPay

> **A voice-first, screen-reader-native consent layer that stops an AI agent from moving money unless the account owner has heard the exact action read aloud and approved it with their fingerprint or face.**

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Runtime: Bun](https://img.shields.io/badge/Runtime-Bun-fbf0df.svg?logo=bun)](https://bun.sh)
[![TypeScript: Strict](https://img.shields.io/badge/TypeScript-Strict_5.9-3178c6.svg?logo=typescript)](https://www.typescriptlang.org/)
[![Auth: WebAuthn](https://img.shields.io/badge/Auth-WebAuthn_Passkeys-green.svg)](https://webauthn.guide/)
[![Target: PayPal Sandbox](https://img.shields.io/badge/Payment-PayPal_Sandbox-003087.svg?logo=paypal)](https://developer.paypal.com/)
[![A11y: WCAG 2.1/2.2 AAA](https://img.shields.io/badge/Accessibility-WCAG_2.1%2F2.2_AAA-success.svg)](https://www.w3.org/WAI/standards-guidelines/wcag/)

---

## Overview

Autonomous AI agents with tool-calling capabilities present a fundamental security challenge: **they hallucinate, they fall prey to prompt injections, and they cannot be trusted with unilateral wallet access.**

KarenPay addresses this authorization gap by providing an open-source consent layer. It moves no money and holds no deposits. Instead, it serves as cryptographic and perceptual middleware between an AI agent and payment rails (demonstrated using PayPal Payouts sandbox).

### The North Star
**Prove, with published empirical numbers, that an AI agent cannot move money without the owner's explicit biometric approval of the exact, spoken action.**

```
                                  KARENPAY CONSENT BOUNDARY
┌──────────────┐          ┌────────────────────────────────────────┐          ┌────────────────┐
│  AI Agent /  │ proposal │  1. Deterministic Intent & Limit Check │ payout   │  PayPal Rails  │
│  Gemini LLM  │─────────►│  2. RFC 8785 Canonical Mandate Hashing │─────────►│  (Sandbox)    │
└──────────────┘          │  3. Hard Spoken Readout Lock (TTS)     │          └────────────────┘
                          │  4. WebAuthn Biometric Assertion (UV)  │
                          └────────────────────────────────────────┘
                                              ▲
                                              │ biometric approval
                                     ┌─────────────────┐
                                     │  Account Owner  │
                                     │  (Voice + Face) │
                                     └─────────────────┘
```

---

## 10-Line Integration Example

Guard any AI agent payment action using `@karenpay/core`:

```typescript
import { buildMandate, checkIntent, checkLimits, hashMandate, buildReadout } from "@karenpay/core";

// 1. Guard against AI prompt injection, recipient drift, and limit escalations
const intent = checkIntent(proposal, constraints);
const limits = checkLimits(proposal, policy, contacts);
if (!intent.accepted || !limits.accepted) throw new Error("Payment proposal rejected");

// 2. Build deterministic spoken readout text and canonical mandate
const spokenText = buildReadout({ proposal, payeeDisplayName: "Ade Bello", requestConstraints: constraints });
const mandate = buildMandate({ id, accountId, ...proposal, constraints, requestHash, nonce, issuedAt, expiresAt, spokenText });

// 3. Generate tamper-evident SHA-256 challenge for passkey approval
const mandateHash = hashMandate(mandate); // Passkey assertion challenge
```

---

## Architecture & System Design

KarenPay is structured as a mono-repository with two primary tiers:
1. **KarenPay Core (`@karenpay/core`)**: Pure TypeScript library with **zero I/O**. It reads no clocks, touches no databases, makes no network calls, and stores no secrets. It owns RFC 8785 JSON canonicalization, mandate hashing, intent validation, policy enforcement, and audit hash chaining.
2. **Reference Implementation (`apps/api` & `apps/web`)**:
   - `apps/api`: Node.js Express service managing WebAuthn passkey registration/login, Gemini intent extraction, Supabase persistence, atomic single-use state transitions, and PayPal Sandbox Payouts.
   - `apps/web`: Next.js voice-first terminal with Atkinson Hyperlegible typography, WCAG AAA Sunset palette, a hard speech-synthesis readout lock, and live WebAuthn biometric confirmations.

### Runtime Architecture

```mermaid
flowchart LR
    person["Account owner<br/>voice + fingerprint/face"]

    subgraph render["KarenPay Infrastructure"]
        web["Next.js voice client<br/>Web Speech API<br/>SimpleWebAuthn browser"]
        api["Express API (Node.js)<br/>sessions · routes · controllers<br/>ownership · rate limits"]
        core["KarenPay Core<br/>pure TypeScript functions<br/>mandate · intent check · readout<br/>canonicalize · hash · limits · states"]
    end

    subgraph external["External services"]
        gemini["Gemini API<br/>structured intent proposal only"]
        paypal["PayPal Sandbox REST<br/>Payouts"]
        passkey["Browser / platform authenticator<br/>WebAuthn"]
    end

    subgraph data["Supabase PostgreSQL"]
        db[("accounts<br/>passkey_credentials<br/>contacts<br/>mandates<br/>audit_events")]
    end

    person -->|"spoken request"| web
    web <-->|"HTTPS JSON<br/>spoken + machine responses"| api
    web <-->|"registration/login/<br/>approval assertion"| passkey

    api --> core
    api -->|"transcript + contact names<br/>no secrets or account IDs"| gemini
    api <-->|"sessions, ownership,<br/>mandates, audit chain"| db
    api -->|"only after atomic consume<br/>mandate idempotency key"| paypal
    paypal -->|"payment result"| api

    classDef client fill:#FFE9D2,stroke:#312C51,color:#1F1B35
    classDef app fill:#FFF8F1,stroke:#FF9F31,color:#1F1B35
    classDef external fill:#FFE8B3,stroke:#5A2300,color:#1F1B35
    classDef data fill:#FFFFFF,stroke:#6B6590,color:#1F1B35
    class person,web client
    class api,core app
    class gemini,paypal,passkey external
    class db data
```

### Consent & Execution Sequence

```mermaid
sequenceDiagram
    actor Owner as Account owner
    participant Web as Next.js voice client
    participant API as Express API
    participant AI as Gemini
    participant Core as KarenPay Core
    participant DB as Supabase PostgreSQL
    participant Auth as Platform authenticator
    participant PayPal as PayPal Sandbox

    Owner->>Web: Speak request ("Send 50 dollars to Ade Bello")
    Web->>API: POST /api/v1/intent (transcript)
    API->>AI: Transcript + caller's contact names only
    AI-->>API: Structured proposal (payeeContactId, amountMinor, currency)
    API->>Core: Validate proposal against request constraints
    Core-->>API: Intent check passed
    API->>Core: Build readout, canonicalize (RFC 8785), SHA-256 hash
    Core-->>API: spoken text + mandate hash
    API->>DB: Store mandate as CREATED
    API-->>Web: Spoken text + mandate hash + approval options
    Note over Web,Owner: Hard Readout Lock active
    Web->>Owner: window.speechSynthesis reads exact action aloud
    Owner->>Web: Tap "Approve with fingerprint or face" (unlocked on utterance.onend)
    Web->>Auth: Request WebAuthn assertion (challenge = mandateHash)
    Auth-->>Web: Signed assertion (User Verification required)
    Web->>API: POST /api/v1/mandates/:id/approve (assertion)
    API->>Core: Verify challenge === mandateHash and signature
    API->>DB: Atomic CREATED -> CONSUMED transition (database clock)
    DB-->>API: Atomic update succeeded (single winner)
    API->>PayPal: Execute payout (mandate ID as idempotency key)
    PayPal-->>API: Payout batch ID
    API->>DB: Update mandate to PAID + write hash-chained audit event
    API-->>Web: Result: "Test payment sent."
    Web-->>Owner: Screen-reader and audio confirmation
```

### Mandate Lifecycle State Machine

```mermaid
stateDiagram-v2
    [*] --> CREATED: Proposal checked & stored
    CREATED --> CONSUMED: Valid passkey assertion + atomic consume
    CREATED --> REJECTED: Intent mismatch, policy limit, or tampered challenge
    CREATED --> EXPIRED: Database clock past TTL (120s)
    CONSUMED --> PAID: PayPal sandbox payout succeeded
    CONSUMED --> FAILED: PayPal sandbox payout failed
    PAID --> [*]
    FAILED --> [*]
    REJECTED --> [*]
    EXPIRED --> [*]

    note right of CREATED
        TTL: 120 seconds.
        Approve button remains physically
        and programmatically disabled
        until speech readout completes.
    end note
```

---

## Security Invariants

KarenPay enforces seven immutable security rules:

1. **AI Proposes Only**: Gemini never executes payments, has no database or PayPal access, and is never provided credentials, balances, or user IDs. If Gemini suggests an ambiguous contact (e.g., "Ade Bello" vs "Ada Bello"), KarenPay forces a clarification turn instead of choosing silently.
2. **Deterministic Spoken Readout**: Client-side speech synthesis is strictly forbidden from composing payment summaries. The client only speaks the exact `response.spoken` string produced by Core from the canonical mandate fields.
3. **Hard Readout Lock**: The "Approve with Fingerprint or Face" button is initialized with `disabled={true}` and `aria-disabled="true"`. It cannot be clicked until `window.speechSynthesis` fires `utterance.onend` cleanly for all sentence chunks without interruption or cancellation.
4. **RFC 8785 Canonical Mandate Hashing**: The WebAuthn authentication challenge is not a random nonce; it is the base64url-encoded SHA-256 hash of the canonicalized mandate (`mandateHash`). Any client-side alteration of amount, currency, or recipient invalidates the passkey assertion.
5. **Atomic Single-Use**: Mandate execution uses PostgreSQL atomic compare-and-swap (`CREATED` $\to$ `CONSUMED`). Race conditions, double-taps, and replay attacks return the stored outcome with zero additional payment calls.
6. **Hash-Chained Audit Log**: Every mandate creation, rejection, and payout records a SHA-256 hash-chained event (`computeAuditHash`, `verifyAuditChain`). Deletion or mutation of audit records is mathematically detectable.
7. **Sandbox Enforcement**: All operations strictly target the PayPal Sandbox environment. No real funds can ever be processed.

---

## Empirical Security & Attack Suite Results

KarenPay’s security guarantees are backed by published empirical suites:

### 1. Attack Suite A: Cryptographic & Logic Mutations (Unit 15)
File: [`tests/unit/attack-suite-a-crypto-logic.test.ts`](file:///C:/dev/KarenPay/tests/unit/attack-suite-a-crypto-logic.test.ts)

| Attack Vector | Trials | Attacks Rejected | Baseline Passes | Bypasses | Rule of Three 95% Bound |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Crypto & Logic Mutations** (amount tampering, recipient substitution, expiry overrun, nonce replay, policy limit bypass, audit chain breaks, RFC 8785 key-order permutation) | **1,000** | 1,000 | — | **0** | $\le 3 / 1000 = 0.30\%$ |
| **Passkey Assertion Flows** (valid ES256 baseline, flipped `UV=0`, flipped `UP=0`, wrong mandate hash challenge, phishing origin) | **100** | 80 | 20 | **0** | $\le 3 / 80 = 3.75\%$ |

### 2. Attack Suite B: Adversarial AI Prompt Injections (Unit 16)
File: [`tests/unit/attack-suite-b-ai-pipeline.test.ts`](file:///C:/dev/KarenPay/tests/unit/attack-suite-b-ai-pipeline.test.ts)

Evaluated across **200 adversarial prompt injection and contact-name / spoken-account-number injection trials inspired by AP2-WhisperBench**:

| Attack Category | Trials | Bypasses **Without** `checkIntent` | Bypasses **With** `checkIntent` |
| :--- | :---: | :---: | :---: |
| Amount escalation prompt injection | 40 | 40 / 40 (100%) | **0 / 40 (0%)** |
| Contact-name injection redirecting recipient | 40 | 40 / 40 (100%) | **0 / 40 (0%)** |
| Spoken digit-by-digit account number substitution | 40 | 40 / 40 (100%) | **0 / 40 (0%)** |
| Currency substitution injection | 40 | 40 / 40 (100%) | **0 / 40 (0%)** |
| Unowned recipient / policy ceiling escalation | 40 | 40 / 40 (100%) | **0 / 40 (0%)** |
| **Total** | **200** | **200 / 200 (100%)** | **0 / 200 (0.0%)** |

> **Statistical Note (Rule of Three)**: Across $N = 200$ clean adversarial trials, zero observed bypasses establishes an upper bound on the failure rate of approximately $\le 3 / 200 = 1.5\%$ at a 95% confidence interval for the sampled attack distributions.

---

## Threat Model

| Threat | Attacker Vector | KarenPay Defense |
| :--- | :--- | :--- |
| **Prompt Injection** | Malicious voice input instructs LLM to divert payment or maximize amount. | Core enforces `checkIntent` and `checkLimits` against original constraints; Gemini cannot alter constraints or select unowned recipients. |
| **Post-Readout Tampering** | Client malware alters payment recipient or amount after the user hears the audio readout. | Passkey challenge is `hashMandate(mandate)`. Mutated amount results in signature verification failure (`APPROVAL_REJECTED`). |
| **Replay / Re-entrancy** | Attacker replays signed passkey assertion to trigger a second transfer. | Database transitions mandate from `CREATED` $\to$ `CONSUMED` atomically; second attempt returns cached result with 0 PayPal calls. |
| **Phishing / Origin Spoofing** | Rogue web client attempts to collect passkey approval on untrusted domain. | WebAuthn binds signature to authenticated `rpID` and origin. Cross-origin assertions are rejected by `@simplewebauthn/server`. |
| **Bypassed Biometrics** | Compromised client sends assertion with User Verification flag set to 0. | `verifyAuthenticationResponse` enforces `requireUserVerification: true` and checks authenticator data flags. |
| **Silent Contact Substitution** | Ambiguous recipient name allows LLM to arbitrarily route funds to another contact. | `needsClarification` forces interactive voice or visual disambiguation before any mandate can be constructed. |

---

## Accessibility & WCAG 2.1/2.2 Compliance

KarenPay is designed from the ground up for blind and low-vision users:

- **Typography**: Uses **Atkinson Hyperlegible** (`--font-sans`) for body text to ensure maximum character distinction between ambiguous glyphs (`0`, `O`, `1`, `l`, `I`). Financial figures, account numbers, and timers use strict **tabular lining numerals** via `.num` (`tabular-nums lining-nums slashed-zero`) to prevent layout jitter.
- **Calibrated Sunset Palette**: Engineered for WCAG AAA contrast compliance:
  - Canvas Background: `#FFF8F1`
  - Cards & Surfaces: `#FFFFFF` / `#FFE9D2`
  - Primary Text: `#1F1B35` (16.6:1 AAA on white, 15.8:1 AAA on canvas)
  - Secondary Text / Icons: `#48426D` (9.2:1 AAA on white) / `#312C51` (13.1:1 AAA on white)
  - Primary Action Pill: `#FF9F31` with `#1F1B35` text (8.1:1 AAA contrast)
  - Focus Ring: `3px solid #1F1B35` with `2px` offset on light surfaces, `3px solid #FFFFFF` on dark surfaces.
- **Screen Reader Semantics**:
  - Top-level persistent live regions: `aria-live="assertive"` with `aria-atomic="true"` for critical state transitions and errors; `aria-live="polite"` for voice recognition transcripts.
  - Linear consent terminal: Only one primary interactive control active on screen at a time.
  - Large Touch Targets: All primary action buttons meet or exceed `64px` height (`min-h-[64px]`); all secondary controls meet or exceed `48px` by `48px`.

---

## Repository Structure

```
karenpay/
├── apps/
│   ├── api/                   # Express backend (Auth, Gemini, Mandates, PayPal)
│   │   ├── src/
│   │   │   ├── approve.ts     # WebAuthn verification & PayPal Payout execution
│   │   │   ├── audit.ts       # Hash-chained audit event storage
│   │   │   ├── auth.ts        # Passkey login & registration controllers
│   │   │   ├── intents.ts     # Gemini intent extraction & clarification
│   │   │   ├── mandates.ts    # Mandate creation & readout generation
│   │   │   └── paypal.ts      # PayPal Sandbox REST client
│   └── web/                   # Next.js App Router client
│       └── src/
│           ├── app/           # App routes: /, /register, /home, /contacts, /pay, /activity, /me
│           └── components/    # Accessible Button, BottomTabBar, LiveRegions
├── packages/
│   └── core/                  # Pure TypeScript security core (@karenpay/core)
│       └── src/index.ts       # Mandate schema, RFC 8785, SHA-256 hash, readout builder
├── docs/                      # Architectural specs, API documentation, attack results
├── supabase/
│   └── migrations/            # Additive PostgreSQL migrations (tables, RLS, consume_mandate RPC)
└── tests/
    └── unit/                  # Vitest suites (Attack Suite A, Attack Suite B, Audit & Retry)
```

---

## Getting Started

### Prerequisites
- [Bun](https://bun.sh/) (v1.2+)
- Node.js (v20+)
- A [PayPal Developer](https://developer.paypal.com/) Sandbox Account
- A [Google AI Studio](https://aistudio.google.com/) API Key for Gemini
- A [Supabase](https://supabase.com/) Project (PostgreSQL)

### 1. Installation

```powershell
git clone https://github.com/your-username/karenpay.git
cd karenpay
bun install
```

### 2. Environment Configuration

Copy `.env.example` to `.env` in the root directory:

```env
PAYPAL_CLIENT_ID=your_paypal_sandbox_client_id
PAYPAL_CLIENT_SECRET=your_paypal_sandbox_client_secret
PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
DATABASE_URL=postgresql://postgres:...@db.your-project.supabase.co:5432/postgres
RP_ID=localhost
RP_NAME=KarenPay
WEB_ORIGIN=http://localhost:3000
SESSION_SECRET=at-least-32-character-random-secret-key-here
MANDATE_TTL_SECONDS=120
MAX_AMOUNT_MINOR=50000
ALLOWED_CURRENCIES=USD
```

Apply database migrations via the Supabase SQL editor from [`supabase/migrations/`](file:///C:/dev/KarenPay/supabase/migrations/).

### 3. Verification & Typechecking

Always run the full build typecheck first:

```powershell
bun run build
```

Run all unit tests and attack suites:

```powershell
bun run test
```

### 4. Running the Development Servers

Start the API backend:
```powershell
bun run --cwd apps/api dev
```

In a separate terminal, start the Next.js web terminal:
```powershell
bun run --cwd apps/web dev
```

Open [http://localhost:3000](http://localhost:3000) to access the consent terminal.

---

## What KarenPay Must NOT Claim

To maintain documentation and security integrity, KarenPay explicitly does **not** claim:
- To be "bank-grade", "certified", or "compliant" with financial regulations.
- To be safe for real money transactions (it is strictly sandbox-only).
- To be immune to prompt injection (rather, prompt injections are caught and bounded deterministically by `@karenpay/core` validation).
- To be fully AP2-certified (it is *aligned* with AP2 for purchases and *inspired* by AP2 for peer transfers).

---

## Security Policy

Please review our [Security Policy](SECURITY.md) for vulnerability disclosure guidelines. Do not report security vulnerabilities through public GitHub issues.

---

## License

KarenPay is open-source software licensed under the [Apache-2.0 License](LICENSE).
