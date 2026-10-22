# Unit 12: Client Integration Support (Gate 4) — Teammate Discussion & Preparation Checklist

This checklist covers everything to align on with your teammate and gather before and during **Unit 12 (`Client Integration Support — GATE 4`)**, including support for both **saved contacts** and **spoken recipient name + digit-by-digit account numbers**.

---

## 1. Decisions to Discuss & Lock In with Your Teammate

### 1.1 Hosting Topology, Domain, and Cookie Strategy (Decided: Option A — Same-Origin Proxy + Strict CORS)
- **Same-origin proxy + strict `WEB_ORIGIN` CORS (Implemented):**
  - Cookies (`kp_session` and `kp_auth_ceremony`) in [`setSignedCookie`](file:///C:/dev/KarenPay/apps/api/src/auth.ts#L302-L312) use `sameSite: "strict"`, `secure: true`, `httpOnly: true`, and `path: "/api/v1"`.
  - **Option A (Selected):** Next.js (`apps/web`) proxies `/api/v1/*` rewrites to the Express API on Render (see [apps/web/README.md](file:///C:/dev/KarenPay/apps/web/README.md)), and [`createClientCorsMiddleware`](file:///C:/dev/KarenPay/apps/api/src/index.ts#L37-L64) enforces `WEB_ORIGIN` CORS with credentials and rejects untrusted preflight origins (`403 ORIGIN_NOT_ALLOWED`).
- **Final Hosted Domain & `RP_ID` ([6-progress-tracker.md](file:///C:/dev/KarenPay/context/6-progress-tracker.md#L40-L43)):**
  - Passkeys permanently bind to `RP_ID`. Lock in the final Render domain now so passkeys do not need to be re-registered later.

### 1.2 Demo Phone, OS, Browser, and Speech Recognition Pause Handling
- **Lock in the physical demo device:**
  - Choose the exact phone, OS version, browser, and screen reader (e.g., iPhone + Safari/VoiceOver, or Android + Chrome/TalkBack).
- **Digit-by-digit speech capture:**
  - When users speak an account number one digit at a time (e.g., *"Send 50 dollars to Ade Bello, account number zero, one, two, three, four, five, six, seven, eight, nine"*), they naturally pause between digits.
  - Agree on how `SpeechRecognition` is configured in `apps/web` (e.g., `interimResults: true` with a silence debounce or an explicit stop-listening trigger) so the browser does not cut off the transcript mid-account-number.

### 1.3 End-to-End Voice & Readout State Machine ([3-ui-context.md](file:///C:/dev/KarenPay/context/3-ui-context.md#L24-L42))
1. **Step 1 (`POST /api/v1/intent`):**
   - [`createIntentRouter`](file:///C:/dev/KarenPay/apps/api/src/intents.ts#L136-L198) returns one of two proposal shapes when `needsClarification` is `false`:
     - **Spoken account number (works even with 0 saved contacts):**
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
     - **Saved contact:**
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
   - If `needsClarification: true` (when a contact name is ambiguous and no account number digits were given), the client speaks `response.spoken` (`"Which contact did you mean: ...?"`) and listens again.
2. **Step 2 (`POST /api/v1/mandates`):**
   - Accepts either `{ payeeContactId }` or `{ payeeName, payeeAccountNumber }` in `proposal` and `requestConstraints` (validated by [`PaymentProposalSchema`](file:///C:/dev/KarenPay/packages/core/src/index.ts#L50-L60) and [`IntentConstraintsSchema`](file:///C:/dev/KarenPay/packages/core/src/index.ts#L64-L74)).
   - Returns `{ mandateId, mandateHash, spoken, readoutRequired: true, approvalOptions }`.
   - When `payeeAccountNumber` is used, `spoken` from [`buildReadout`](file:///C:/dev/KarenPay/packages/core/src/index.ts#L172-L190) reads back **both** the recipient name and the account number digit-by-digit (`"You asked to send fifty dollars to Ade Bello, account number zero, one, two, three, four, five, six, seven, eight, nine. That is five, zero dollars..."`).
3. **Step 3 (Readout Lock):**
   - Because the digit-by-digit account number + amount readout is longer, the client **must keep Confirm disabled** until the TTS `utterance.onend` event fires cleanly without interruption. If speech is interrupted or cancelled, Confirm remains disabled.
4. **Step 4 (`POST /api/v1/mandates/:id/approve`):**
   - Passes `approvalOptions` to `@simplewebauthn/browser`'s `startAuthentication({ optionsJSON: approvalOptions })`, sends the assertion to `/approve`, and speaks `response.spoken`.
   - For account-number mandates, [`createApproveRouter`](file:///C:/dev/KarenPay/apps/api/src/approve.ts#L176-L181) maps the payout receiver deterministically to `acct-<digits>@sandbox.karenpay.test`.

### 1.4 Consistent Spoken-Safe Error Contract ([3-ui-context.md](file:///C:/dev/KarenPay/context/3-ui-context.md#L38-L39))
- Standardize all error responses across [`auth.ts`](file:///C:/dev/KarenPay/apps/api/src/auth.ts#L370-L376), [`intents.ts`](file:///C:/dev/KarenPay/apps/api/src/intents.ts#L146-L195), [`mandates.ts`](file:///C:/dev/KarenPay/apps/api/src/mandates.ts#L113-L194), and [`approve.ts`](file:///C:/dev/KarenPay/apps/api/src/approve.ts#L137-L209) to return `{ code, message, spoken }` so the client never has to compose safety-relevant speech itself.

### 1.5 Contacts & Health/Status Endpoints ([2-architecture.md](file:///C:/dev/KarenPay/context/2-architecture.md#L46-L55))
- Decide with your teammate whether `apps/web` needs `GET /api/v1/health`, `GET /api/v1/contacts`, `POST /api/v1/contacts`, and `GET /api/v1/mandates/:id` wired in [`createKarenPayApi`](file:///C:/dev/KarenPay/apps/api/src/index.ts#L18-L26) for the demo UI, or if contacts will be pre-seeded in Supabase while live sends use spoken name + digit-by-digit account number and pre-seeded contacts.

---

## 2. What You Need to Gather Before Starting Unit 12

- [x] **Apply the Additive Migration in Supabase (Completed):**
  - Applied [20261022125000_mandate_spoken_account_number.sql](file:///C:/dev/KarenPay/supabase/migrations/20261022125000_mandate_spoken_account_number.sql) in the Supabase SQL Editor so the `mandates` table accepts `payee_name` and `payee_account_number` with a nullable `payee_contact_id`.
- [ ] **Hosted URLs & Environment Values:**
  - `WEB_ORIGIN` (the exact HTTPS URL where the teammate's Next.js app is deployed on Render, plus local dev origin if needed).
  - `RP_ID` (the domain matching `WEB_ORIGIN`).
- [ ] **Real Demo Device Details:**
  - Device model, OS version, browser version, and screen reader (VoiceOver or TalkBack) that will be used for Gate 2 (Unit 4) and Gate 4 (Unit 12).
- [ ] **Demo Script & Seeded Data for the 5 Consecutive Voice Sends (Gate 4):**
  - Agree on the 5 spoken utterances for the phone test:
    - Sends using **spoken recipient name + digit-by-digit account number** (e.g., *"Send 50 dollars to Ade Bello, account number zero one two three four five six seven eight nine"*).
    - Sends using **saved contacts** in Supabase (including `"Ade Bello"` and `"Ada Bello"` to verify tie clarification).
- [x] **Client Request Payload Agreement for `POST /api/v1/mandates` (Confirmed):**
  - When `POST /api/v1/intent` returns `{ payeeName, payeeAccountNumber, amountMinor, currency }`, the client passes `payeeName` and `payeeAccountNumber` (or `payeeContactId` for contact sends) in both `proposal` and `requestConstraints`, plus `requestHash`, when calling `POST /api/v1/mandates`:
    - **Spoken account-number send payload:**
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
        "requestHash": "<sha256-base64url-of-transcript>"
      }
      ```
    - **Saved-contact send payload:**
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
        "requestHash": "<sha256-base64url-of-transcript>"
      }
      ```
