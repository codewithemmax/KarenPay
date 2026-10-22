# Spoken Language, Trust Language, Design System and Accessibility Contract

Read this fully before writing UI code. It is the visual, spoken, and accessibility contract for KarenPay (`packages/core`, `apps/api`, and `apps/web`). Follow it exactly.

## Core Public Language
"KarenPay makes sure an AI cannot move money unless you have heard the exact action and approved it with your fingerprint or face."

## Approved Status Vocabulary
Use these terms, and only these, for mandate state in responses and speech:
* Waiting for your approval (CREATED)
* Approved and sending (CONSUMED)
* Test payment sent (PAID)
* Not sent (FAILED)
* Rejected (REJECTED)
* Expired (EXPIRED)

Every payment is a test payment. Say "test payment" and "sandbox". Never imply real money moved.

## Readout Template (Core owns this)
The readout is built from the mandate's fields only. Gemini's words never appear in it. Example for send_money:

"You asked to send fifty dollars to Ade Bello. That is five, zero dollars. This is a test payment. To approve, use your fingerprint or face now."

Rules:
* Name the recipient in full, exactly as stored in the contact.
* Say the amount in words and then digit by digit.
* State the comparison with the request when constraints exist, for example "You asked for under one hundred dollars."
* End with one clear instruction for the passkey step.
* Same input always produces the same text, and the text is hashed inside the mandate.

## Claims the API, Speech and UI Must Never Make or Imply
* "Secure", "safe", "verified", "bank-grade", "certified", "compliant", "protected by AI".
* That the recipient is verified or trusted.
* That a payment is guaranteed or real.
* Urgency or persuasion of any kind ("act now", "your account will close").

## Accessibility Contract for the API
* Every error returns a short spoken-safe message in `message` plus a machine code in `code`. No stack traces, no jargon.
* Responses that the client will read aloud include a `spoken` field so the client never composes safety-relevant speech itself.
* The client must disable confirm until the text-to-speech completion event fires. The API cannot enforce this, so `POST /mandates` returns `readoutRequired: true` and the approval flow is tested with an interrupted readout.
* Ties between contacts return `needsClarification: true` with the candidate names. The API never picks silently.
* Respond to `POST /intent` and `POST /mandates` fast. Target 3 seconds or less at the 95th percentile, because long silence feels like a crash to a blind user.

---

## Web Client Design System (`apps/web` — Prompt 0)

### Old Design to Replace
Open the four screenshots in `context/karenpay-ui-prompts/images` (`current-1-ledger.png`, `current-2-audit.png`, `current-3-signin.png`, `current-4-terminal.png`). That is the old design. The new UI must look clearly different from it: no outline on every element, no all-caps labels, no flat red rectangles, no jargon such as telemetry or state labels. Do not reuse its layout patterns.

### Product Feel
KarenPay is a modern mobile wallet for everyone, including blind and low-vision users. The look is a calm, friendly consumer fintech app with one warm sunset palette: soft rounded cards, a prominent balance, quick-action icons, a bottom tab bar. Original branding only. Do not copy any brand's logo or exact colours, and never write the words "Face ID". Never use brutalist boxes, thick 2px borders, all-caps headings or monospace body text.

### Stack
Next.js App Router, TypeScript, Tailwind CSS, `lucide-react` for icons, `Inter` via `next/font`, `@simplewebauthn/browser`. No other UI libraries.

### Layout
* Mobile first, 360 to 430px wide. On desktop, show a centered phone-width column (`max-width: 480px`) on the page background, so judges on laptops see a phone-like app.
* Fixed bottom tab bar with safe-area padding. Main content has bottom padding so nothing hides behind it.
* 8px spacing grid. Page side padding 20px.
* Reflow without horizontal scroll at 320px width and at 400 percent zoom.

### Colour Tokens — One Warm Sunset Palette (all contrast measured)
There is no green, teal, mint, or emerald token.
* `--bg` `#FFF8F1`
* `--surface` `#FFFFFF`
* `--surface-tint` `#FFE9D2`
* `--text` `#1F1B35` (16.6:1 on white, 15.8:1 on bg, 14.1:1 on tint)
* `--text-muted` `#48426D` (9.2:1 on white, 8.8:1 on bg, 7.8:1 on tint). Also use it for "Coming soon" labels.
* `--primary` `#FF9F31` (fill of primary buttons, ALWAYS with `--text` label at 8.1:1; never white text on orange)
* `--sun` `#FFCC6B` (highlights, progress fill, avatars with `--text` at 11.1:1)
* `--peach` `#F0C38E` (avatars with `--text` at 10.2:1, and caption text on the balance card at 8.0:1)
* `--coral` `#F1AA9B` (avatars and decoration only, with `--text` at 8.7:1; never as text colour)
* `--ink` `#312C51` (links, icons, and coloured text on light surfaces: 13.1:1 on white, 12.4:1 on bg, 11.1:1 on tint)
* `--balance-card` `#312C51` (white text 13.1:1, peach `#F0C38E` 8.0:1, sun `#FFCC6B` 8.8:1)
* `--danger` `#9F1239` (text on `--bg` at 7.6:1 or `--surface` white at 8.0:1 only; never on `--surface-tint` at 6.8:1)
* `--warning-bg` `#FFE8B3` with text `--warning-text` `#5A2300` (10.4:1)
* `--input-border` `#6B6590` (5.4:1 on white, 5.1:1 on bg, meets the 3:1 non-text rule)
* `--divider` `#EBDDD0` (decoration only, never the only way to see a boundary)

Rules:
* No text on any pair not listed here. No gradients behind text. Light theme only.
* Status chips are icon plus the approved status words, in `--ink` text on `--surface-tint`, never colour alone.
* The orange button edge is 1.95:1 against `--bg`, so its identity comes from its label, its 64px height, and its position. Do not add a border.
* Optional decorative sunset: flat solid shapes only (a `--sun` and `--primary` half-circle over `--ink` hills), `aria-hidden="true"`, no text on top, max 160px tall.

### Shape and Type
* Radius: cards 20px, inputs 14px, buttons and chips fully rounded (pill). Shadows soft: `0 1px 2px rgba(31,27,53,.06), 0 8px 24px rgba(31,27,53,.06)`.
* Inter. Body 16px minimum, captions 14px minimum, never smaller. Page title 28px bold, section title 20px semibold, balance 40px bold.
* All money, account numbers, references and timers use the class `.num`: `font-variant-numeric: tabular-nums slashed-zero; letter-spacing: 0.02em;`. Money columns are right aligned so the digits line up.
* Money format: `$2,450.00`. Show the minus sign for debits.

### Icons
Use `lucide-react`. Every icon that sits next to visible text is decorative: `aria-hidden="true"`. An icon-only button must have an `aria-label`. Never use an icon as the only way to tell status apart: always add text.

### Targets and Focus
* Primary call-to-action buttons: height at least 64px, full width, pill shape.
* Every other interactive element: at least 48px by 48px, with at least 8px between neighbours.
* Visible focus ring on everything: `3px solid #1F1B35` with `2px` offset on light surfaces, and `3px solid #FFFFFF` on `--balance-card`. Never remove outlines.
* Respect `prefers-reduced-motion`: no count-up animations, no sliding, no pulsing.

### Semantics
* Landmarks: `header`, `main`, `nav` with `aria-label`. One `h1` per screen. Headings in order.
* Real buttons for actions, real links for navigation, visible labels for every form field, errors linked with `aria-describedby`.
* The bottom tab bar is a `nav` with `aria-label="Main"`. The current tab has `aria-current="page"`.
* Features that are not built are shown but disabled: `aria-disabled="true"`, a visible "Coming soon" label, and removed from the tab order. Never hide visible controls with `aria-hidden`.
* Two live regions exist from the first render and stay mounted: a status banner with `aria-live="assertive"` and `aria-atomic="true"` for state changes and errors, and a transcript region with `aria-live="polite"` for the live voice transcript.

### Safety Rules (never break these)
1. The client never writes its own payment summary or any safety-relevant speech. It speaks and shows only the exact string in `response.spoken` from the KarenPay API.
2. The Approve button stays `disabled=true` and `aria-disabled="true"` until `window.speechSynthesis` fires `onend` for the whole readout without being cancelled, interrupted or erroring. If it is stopped or errors, it stays disabled until a full replay completes.
3. Use only these status words: `Waiting for your approval`, `Approved and sending`, `Test payment sent`, `Not sent`, `Rejected`, `Expired`. Every payment is a test payment in a sandbox. Never say or imply real money moved.
4. Never use the words `secure`, `safe`, `verified`, `bank-grade`, `certified` or `compliant` in the UI.
5. Secrets and tokens never appear in the client. The session is an `httpOnly` cookie.

### Data Rules
* Contacts, mandates and audit events come from the API. The balance, the daily limit and the placeholder activity rows are demo constants in one file (`demoData.ts`), clearly labelled "Sandbox demo" in the UI.
* The recipient is always a saved contact. There is no account number entry.
