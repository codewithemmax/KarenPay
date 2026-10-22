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
