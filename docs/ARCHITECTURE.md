# KarenPay Architecture

KarenPay is a consent layer, not a bank, wallet, or payment processor. The
web client gathers a spoken request, KarenPay Core turns the approved action
into a tamper-evident mandate, and the API authorizes exactly one PayPal
sandbox payment after passkey approval.

## Runtime architecture

```mermaid
flowchart LR
    person["Account owner<br/>voice + fingerprint/face"]

    subgraph render["Render"]
        web["Next.js voice client<br/>Web Speech API<br/>SimpleWebAuthn browser"]
        api["Node.js 20+ Express API<br/>sessions · routes · controllers<br/>ownership · rate limits"]
        core["KarenPay Core<br/>pure TypeScript functions<br/>mandate · intent check · readout<br/>canonicalize · hash · limits · states"]
    end

    subgraph external["External services"]
        gemini["Gemini API<br/>structured intent proposal only"]
        paypal["PayPal Sandbox REST<br/>Orders v2 · Payouts"]
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

    classDef client fill:#e8f1ff,stroke:#356ae6,color:#111
    classDef app fill:#eaf8ee,stroke:#2f855a,color:#111
    classDef external fill:#fff4df,stroke:#c77b00,color:#111
    classDef data fill:#f2eafa,stroke:#7b4ab3,color:#111
    class person,web client
    class api,core app
    class gemini,paypal,passkey external
    class db data
```

## Consent and payment sequence

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

    Owner->>Web: Speak request
    Web->>API: POST /api/v1/intent (transcript)
    API->>AI: Transcript + caller's contact names
    AI-->>API: Strict proposed action
    API->>Core: Validate proposal and intent constraints
    Core-->>API: Checked mandate fields
    API->>Core: Build readout, canonicalize, hash
    Core-->>API: spoken text + mandate hash
    API->>DB: Store mandate as CREATED
    API-->>Web: Readout + hash + passkey options<br/>readoutRequired = true
    Web->>Owner: Read exact action aloud
    Web->>Auth: Request approval with mandate hash challenge
    Auth-->>Web: Assertion with UV, UP, origin and RP checks
    Web->>API: POST /api/v1/mandates/:id/approve
    API->>Core: Verify assertion and mandate state
    API->>DB: Atomic CREATED -> CONSUMED update<br/>using database clock
    DB-->>API: Single winner
    API->>PayPal: Sandbox payment<br/>mandate ID as idempotency key
    PayPal-->>API: Payment result
    API->>DB: Store PAID/FAILED result + audit event
    API-->>Web: Spoken-safe status and result
    Web-->>Owner: Speak test payment outcome

    Note over Core,DB: Any mismatch, expiry, replay, or tamper attempt is rejected and audited.
```

## Mandate lifecycle

```mermaid
stateDiagram-v2
    [*] --> CREATED: checked proposal stored
    CREATED --> CONSUMED: valid approval + atomic consume
    CREATED --> REJECTED: intent, limit, ownership,<br/>signature, or integrity failure
    CREATED --> EXPIRED: database clock past expiry
    CONSUMED --> PAID: PayPal sandbox succeeds
    CONSUMED --> FAILED: PayPal sandbox fails
    PAID --> [*]
    FAILED --> [*]
    REJECTED --> [*]
    EXPIRED --> [*]

    note right of CREATED
        120-second lifetime
        Confirm is unavailable until
        speech readout completes.
    end note
```

## Security-critical boundaries

- **Core has no I/O.** It receives time and data as inputs; it does not read
  clocks, access the database, call networks, or read environment variables.
- **Gemini proposes only.** Its structured output is validated, constrained to
  the caller's contacts, and checked against the original request. Gemini
  cannot approve, choose an outside recipient, or set the final amount.
- **The readout is hashed.** Spoken text is generated from the mandate's own
  fields, placed inside the canonical mandate, and included in the SHA-256
  challenge.
- **Approval is separate from login.** The approval assertion must have user
  verification and presence, matching origin and RP ID, a valid signature,
  and a challenge equal to the stored mandate hash.
- **Single use is transactional.** Only a guarded database update can move a
  mandate from `CREATED` to `CONSUMED`; repeated approvals return the stored
  result and never initiate another payment.
- **All outcomes are auditable.** Rejections, expiry, payment results, and
  security-relevant approval details are recorded in the hash-chained audit
  log.
- **PayPal is sandbox-only.** KarenPay holds no money and the API never sends
  credentials or secrets to the browser, Gemini, logs, or Git.
