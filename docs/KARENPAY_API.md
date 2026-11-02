## PayPal sandbox client (Unit 2)

The API client uses PayPal's REST API at the sandbox host only:

- `POST /v1/oauth2/token` with HTTP Basic client authentication and
  `grant_type=client_credentials`.
- `POST /v1/payments/payouts` for `send_money`. The mandate ID is used as
  `sender_batch_id` for PayPal's payout idempotency behavior.

Responses are schema-validated with zod. Error messages expose only the
operation and HTTP status, never credentials or full PayPal response bodies.

### Sandbox feasibility

The implementation follows the official [REST
authentication](https://developer.paypal.com/api/rest/authentication/) and
[Payouts v1](https://developer.paypal.com/api/payments.payouts-batch/v1/)
references. Payouts uses the API's `sender_batch_id`.

A sandbox OAuth check was run against
`https://api-m.sandbox.paypal.com/v1/oauth2/token` on October 20, 2026. It
returned HTTP 200 and an access token, confirming that the configured app
credentials and base URL are valid. No live PayPal host was called.

The sandbox OAuth check and Payouts send are confirmed with the configured
sandbox business account. `send_money` is the only payment action in scope.

## Gemini intent endpoint (Unit 11)

- `POST /api/v1/intent`
  - **Authentication**: Requires a valid signed `kp_session` cookie (`401 AUTH_REQUIRED` otherwise).
  - **Rate limit**: 10 requests per minute per authenticated account (`429 RATE_LIMITED` when exceeded).
  - **Request body**:
    ```json
    {
      "transcript": "Send fifty dollars to Ade Bello"
    }
    ```
  - **Behavior**:
    - Loads at most 5 contacts belonging to the authenticated account from `contacts` (`422 NO_CONTACTS` if none exist and no spoken recipient account number is provided).
    - Sends only the spoken `transcript` and the indexed contact `display_name` values to Gemini structured output (`responseMimeType: "application/json"`, `responseSchema`). No account IDs, emails, PayPal data, or secrets are sent to Gemini.
    - Validates Gemini's response with a strict zod schema (`action: "send_money"`, `contactIndex`, `payeeName`, `payeeAccountNumber`, `amountMinor`, `currency`, `needsClarification`, `candidateIndexes`).
    - Supports speaking a recipient name and 6-to-20 digit account number digit-by-digit without requiring a saved contact; `POST /api/v1/mandates` hashes and reads back both the recipient name and the account number digit-by-digit, and `POST /api/v1/mandates/:id/approve` maps the account number deterministically to `acct-<digits>@sandbox.karenpay.test`.
  - **Responses**:
    - Unambiguous contact proposal (`200 OK`):
      ```json
      {
        "needsClarification": false,
        "proposal": {
          "action": "send_money",
          "payeeContactId": "33333333-3333-4333-8333-333333333333",
          "amountMinor": 5000,
          "currency": "USD"
        }
      }
      ```
    - Unambiguous spoken account-number proposal (`200 OK`):
      ```json
      {
        "needsClarification": false,
        "proposal": {
          "action": "send_money",
          "payeeName": "Ade Bello",
          "payeeAccountNumber": "0123456789",
          "amountMinor": 5000,
          "currency": "USD"
        }
      }
      ```
    - Ambiguous contact tie (`200 OK`):
      ```json
      {
        "needsClarification": true,
        "candidates": ["Ade Bello", "Ada Bello"],
        "spoken": "Which contact did you mean: Ade Bello or Ada Bello?"
      }
      ```
    - Incomplete or malformed intent (`422 Unprocessable Entity` with `INTENT_INCOMPLETE` or `INTENT_INVALID` and a spoken-safe `message`).
    - Upstream model failure (`502 Bad Gateway` with `INTENT_UNAVAILABLE` and a spoken-safe `message`).

## Mandate creation endpoint (Unit 8)

- `POST /api/v1/mandates`
  - **Authentication**: Requires a valid signed `kp_session` cookie (`401 AUTH_REQUIRED`).
  - **Request body (spoken account number):**
    ```json
    {
      "proposal": {
        "action": "send_money",
        "payeeName": "Ade Bello",
        "payeeAccountNumber": "0123456789",
        "amountMinor": 5000,
        "currency": "USD"
      },
      "requestConstraints": {
        "action": "send_money",
        "payeeName": "Ade Bello",
        "payeeAccountNumber": "0123456789",
        "maximumAmountMinor": 5000,
        "currency": "USD"
      },
      "requestHash": "request-hash"
    }
    ```
  - **Request body (saved contact):**
    ```json
    {
      "proposal": {
        "action": "send_money",
        "payeeContactId": "33333333-3333-4333-8333-333333333333",
        "amountMinor": 5000,
        "currency": "USD"
      },
      "requestConstraints": {
        "action": "send_money",
        "payeeContactId": "33333333-3333-4333-8333-333333333333",
        "maximumAmountMinor": 5000,
        "currency": "USD"
      },
      "requestHash": "request-hash"
    }
    ```
  - **Response (`201 Created`):**
    ```json
    {
      "mandateId": "11111111-1111-4111-8111-111111111111",
      "mandateHash": "<base64url-sha256-of-canonical-mandate>",
      "spoken": "You asked to send fifty dollars to Ade Bello, account number zero, one, two, three, four, five, six, seven, eight, nine. That is five, zero dollars. You asked for under fifty dollars. This is a sandbox test payment. To approve, use your fingerprint or face now.",
      "readoutRequired": true,
      "approvalOptions": {}
    }
    ```

## Client integration support (Unit 12)

- **Hosting & Cookie Topology (Option A — Same-Origin Proxy + Strict CORS)**:
  - Cookies (`kp_session` and `kp_auth_ceremony`) use `HttpOnly; Secure; SameSite=Strict; Path=/api/v1`.
  - Next.js (`apps/web`) rewrites `/api/v1/:path*` to the Express API (`API_INTERNAL_ORIGIN`), keeping cookies first-party on mobile browsers.
  - `createClientCorsMiddleware(webOrigin)` sets `Vary: Origin`, allows `Access-Control-Allow-Origin: WEB_ORIGIN` and `Access-Control-Allow-Credentials: true` for matching origins, and rejects untrusted `OPTIONS` preflight origins with `403 ORIGIN_NOT_ALLOWED`.
- `GET /api/v1/health`:
  - Returns `{ "status": "ok", "sandbox": true, "spoken": "KarenPay sandbox API is ready." }`.
- `GET /api/v1/contacts` and `POST /api/v1/contacts`:
  - Requires a valid signed `kp_session` cookie.
  - Lists or creates contacts owned by the authenticated account, enforcing a maximum of 5 contacts (`422 CONTACT_LIMIT_REACHED`).
- `GET /api/v1/mandates/:id`:
  - Requires a valid signed `kp_session` cookie and validates ownership against `account_id`.
  - Maps the mandate's `state` using `describeMandateState` to the exact Approved Status Vocabulary in `context/3-ui-context.md`:
    - `CREATED`: `"Waiting for your approval"` (`readoutRequired: true`)
    - `CONSUMED`: `"Approved and sending"`
    - `PAID`: `"Test payment sent"`
    - `FAILED`: `"Not sent"`
    - `REJECTED`: `"Rejected"`
    - `EXPIRED`: `"Expired"`

## Audit log and retry safety (Unit 14)

- `GET /api/v1/audit`
  - **Authentication**: Requires a valid signed `kp_session` cookie (`401 AUTH_REQUIRED`).
  - **Behavior**:
    - Fetches the caller's own rows from `audit_events` ordered by `created_at ASC, id ASC`.
    - Each row is hash-chained (`prev_hash` -> `hash`) using `computeAuditHash` over RFC 8785 canonical JSON of `{ accountId, mandateId, eventType, detail, prevHash }`.
    - Verifies the entire chain via `verifyAuditChain` and returns `chainValid: true | false` alongside `events` and a `spoken` summary.
- **Retry safety on `POST /api/v1/mandates/:id/approve`**:
  - Repeated approval calls on a `CONSUMED`, `PAID`, or `FAILED` mandate return the stored outcome immediately via `sendStoredOutcome` and never initiate a second PayPal sandbox payout.


## Bulk Pay (Units B1–B8)

### Additive Migration (`20261031000000_bulk_pay_schema_and_directory.sql`)
- **`public.batches`**:
  - Columns: `id` (`uuid`), `account_id` (`uuid` FK to `accounts`), `status` (`PARSED | PLANNED | CONFIRMED | IN_PROGRESS | COMPLETED | CANCELLED | EXPIRED`), `plan_hash` (`text`), `total_minor` (`bigint >= 0`), `currency` (`text`), `created_at` (`timestamptz`), `expires_at` (`timestamptz`, default `now() + interval '10 minutes'`).
- **`public.batch_items`**:
  - Columns: `id` (`uuid`), `batch_id` (`uuid` FK to `batches`), `position` (`integer`, `0..4`), `pasted_name` (`text`), `resolved_name` (`text`), `bank_name` (`text`), `account_number` (`text`, `^[0-9]{10}$`), `status` (`MATCHED | NAME_MISMATCH | NOT_FOUND | DUPLICATE | SKIPPED | READY | ACTIVE | CONSUMED | PAID | FAILED | REJECTED | CANCELLED | EXPIRED`), `amount_minor` (`bigint > 0`), `mandate_id` (`uuid` FK to `mandates`).
  - Trigger `enforce_batch_item_limit` enforces at most 5 items per batch.
- **`public.sandbox_directory`**:
  - Columns: `account_number` (`text`, `^[0-9]{10}$`), `bank_name` (`text`), `account_name` (`text`), `paypal_sandbox_email` (`text`), primary key `(account_number, bank_name)`.
  - Seeded with 12 simulated Nigerian bank records mapped to `@sandbox.karenpay.test` PayPal sandbox emails.
- **Limits Configuration (`apps/api/src/bulk/config.ts`)**:
  - Reuses `MAX_AMOUNT_MINOR` (sandbox default `10000` = `$100.00` per transfer) and adds `MAX_BATCH_MINOR` (sandbox default `30000` = `$300.00` per batch).

### Parse & Name Resolution Endpoints (Unit B3)
- `POST /api/v1/bulk/parse`
  - **Authentication**: Requires a valid signed `kp_session` cookie (`401 AUTH_REQUIRED`).
  - **Request body**: `{ "rawText": "0700000000\nCleva Bank,\nOlayinka Emmanuel" }`.
  - **Behavior**:
    - Deterministically parses up to 5 recipients (`422 TOO_MANY_RECIPIENTS` if > 5, `422 NO_VALID_RECIPIENTS` if none).
    - Checks each `(account_number, bank_name)` against `public.sandbox_directory` and runs token-set name comparison (`compareRecipientNames`).
    - Creates a `batches` row (`status = "PARSED"`, 10-minute TTL) and `batch_items` rows (`MATCHED`, `NAME_MISMATCH`, `NOT_FOUND`, `DUPLICATE`).
    - Appends hash-chained audit event `BULK_BATCH_PARSED` (or `BULK_PARSE_REJECTED`).
    - Returns `201 Created` with `{ batchId, status: "PARSED", spoken, widgets: [recipientListWidget, ...nameCheckWidgets] }`.
- `POST /api/v1/bulk/items/:id/resolve-name`
  - **Authentication & Ownership**: Requires a valid signed `kp_session` cookie and verifies that the item's batch belongs to the caller (`404 BATCH_ITEM_NOT_FOUND` otherwise).
  - **Request body**: `{ "decision": "USE_DIRECTORY_NAME" | "SKIP" }`.
  - **Behavior**:
    - Updates a `NAME_MISMATCH` item to `MATCHED` (with `resolved_name = directory.account_name`) or `SKIPPED`.
    - Appends hash-chained audit event `BULK_NAME_RESOLVED`.
    - Returns `200 OK` with `{ batchId, itemId, decision, status, resolvedName, spoken, widgets }`.

### Plan & Confirm-Plan Endpoints (Unit B4)
- `POST /api/v1/bulk/:batchId/plan`
  - **Authentication & Ownership**: Requires a valid signed `kp_session` cookie and verifies that `batchId` belongs to the caller (`404 BATCH_NOT_FOUND` otherwise).
  - **Request body**: `{ "instruction": "25 each" }`.
  - **Behavior**:
    - Rejects if any item in the batch still has `status = "NAME_MISMATCH"` (`409 UNRESOLVED_NAME_MISMATCH`).
    - Sanitizes display names via `sanitizeDisplayNameForGemini` (`<= 60` chars, letters/spaces/hyphens/apostrophes/periods, no prompt-injection keywords, or `"Recipient N"`) and sends **only** `{ instruction, recipients: [{ recipientId, displayName }] }` to the Gemini planner wrapper (`BulkGeminiPlannerClient`).
    - Enforces the **dual amount check** (`verifyDualAmountCheck`): every Gemini-proposed amount must equal an amount extracted by `parseInstructionAmountsMinor` (`422 CLARIFICATION_REQUIRED` with `BULK_PLAN_CLARIFICATION_REQUIRED` audit event if they differ).
    - Enforces both `MAX_AMOUNT_MINOR` (`$100.00` per transfer) and `MAX_BATCH_MINOR` (`$300.00` per batch) (`422 LIMIT_EXCEEDED` with `BULK_PLAN_REJECTED` audit event if exceeded).
    - Computes RFC 8785 `planHash` (`computePlanHash`) and SHA-256 `requestHash` over the normalized instruction, sets batch `status = "PLANNED"`, and returns a `plan` widget alongside server-composed `spoken` text.
- `POST /api/v1/bulk/:batchId/confirm-plan`
  - **Authentication & Ownership**: Requires a valid signed `kp_session` cookie and verifies that `batchId` belongs to the caller.
  - **Request body**: `{ "planHash": "<64-char sha256>" }`.
  - **Behavior**:
    - Recomputes `computePlanHash` from the persisted batch items and verifies that it matches both the stored `planHash` and the client's submitted `planHash` (`409 PLAN_HASH_MISMATCH` with `BULK_PLAN_REJECTED` audit event on mismatch).
    - Transitions matched items to `READY` and batch `status` to `CONFIRMED`, appends `BULK_PLAN_CONFIRMED`, and returns the confirmed `plan` widget.

### Queue Execution, Mandate Fetch, Fail-Closed Approve Hook & Cancellation (Unit B5)
- `POST /api/v1/bulk/:batchId/next`
  - **Authentication & Ownership**: Requires a valid signed `kp_session` cookie and verifies that `batchId` belongs to the caller.
  - **Behavior**:
    - Syncs any `ACTIVE` item's mandate status (marking expired `CREATED` mandates as `EXPIRED` and logging `BULK_ITEM_EXPIRED`).
    - If an item is still `ACTIVE` with a valid `CREATED` mandate, returns its `{ type: "transfer_approval", mandateId }` widget idempotently.
    - Otherwise selects the next `READY` item in `position` order, creates a mandate via `createAccountMandate` (`apps/api/src/mandates.ts`) with `payeeName = composeMandatePayeeName(item.resolved_name, item.bank_name)`, `payeeAccountNumber = item.account_number`, and `requestHash = sha256(instruction)` (120s TTL), updates the item to `ACTIVE`, logs `BULK_ITEM_ACTIVATED`, and returns `{ batchId, status: "IN_PROGRESS", activeItem, runningTotalMinor, totalMinor, currency, spoken, widgets: [{ type: "transfer_approval", mandateId }] }`.
    - When all items reach terminal states, updates the batch to `COMPLETED`, logs `BULK_BATCH_COMPLETED`, and returns a `batch_summary` widget.
- `GET /api/v1/bulk/:batchId/items/:itemId/mandate`
  - **Authentication & Ownership**: Requires a valid signed `kp_session` cookie and verifies that `batchId` belongs to the caller, `itemId` belongs to `batchId`, and the item has an active `CREATED` mandate.
  - **Response**: Returns `{ mandate (full MandateSchema object), mandateHash, approvalOptions (challenge === mandateHash), spoken, readoutRequired, state }` so the client can recompute `hashMandate(mandate) === mandateHash` before enabling approval.
- `POST /api/v1/bulk/:batchId/items/:id/cancel` and `POST /api/v1/bulk/:batchId/cancel-remaining`
  - Cancels pending items (`status = "CANCELLED"`, rejecting any underlying `CREATED` mandate, and appending one `BULK_ITEM_CANCELLED` audit event per cancelled item) while **never** touching any item that is `CONSUMED` or `PAID`.
- `GET /api/v1/bulk/:batchId`
  - Returns the current batch state, running total (`runningTotalMinor`), items (exposing only `accountLast4`), and active widget(s).
- **Fail-Closed Bulk Receiver Resolution Hook (`createApproveBulkHook` in `apps/api/src/bulk/store.ts`)**:
  - Wired into `createApproveRouter` (`apps/api/src/approve.ts`). Rejects 6-digit app PIN fallback on bulk mandates (`401 PIN_NOT_ALLOWED_FOR_BULK`).
  - On WebAuthn passkey approval of a bulk mandate, requires `batch_items.mandate_id === mandate.id`, `batch_items.account_number === mandate.payee_account_number`, `composeMandatePayeeName(item.resolved_name, item.bank_name) === mandate.payee_name`, matching amount/currency, and an existing `sandbox_directory` record. Any mismatch marks outcome `FAILED`, makes **no PayPal call**, and appends a `PAYMENT_FAILED` audit event. Non-bulk mandates remain byte-for-byte identical.
