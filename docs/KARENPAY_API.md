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
