# Project Overview

KarenPay is an open-source consent layer that stops an AI agent from moving money unless the account owner has heard the exact action read aloud and approved it with their fingerprint or face. It is shown through a voice-first app for blind and low-vision users that sends money through PayPal's sandbox.

North star: prove, with published numbers, that an AI cannot move money without the owner's approval of this exact action.

KarenPay moves no money and holds none. PayPal's sandbox does the money movement. This is security infrastructure, not a bank, a wallet or a shopping app.

## Two Parts in One Repo
* KarenPay Core: the open-source module and the real product. Builds the mandate, canonicalizes and hashes it, produces the spoken readout, checks the request against what the person asked, verifies the passkey signature, and allows exactly one payment.
* KarenPay app: the reference voice client for blind and low-vision users. It proves Core works end to end and is what judges see in the demo.

## Core User Flow
1. Speak: the person says a request, for example "send 50 dollars to Ade".
2. Understand: Gemini turns the transcript into a proposed action, amount and recipient chosen from at most 5 contacts. If two contacts match, the app asks which one.
3. Build and check: code builds the mandate and checks it against what the person asked. A mismatch is rejected before anything is read aloud.
4. Read aloud: a fixed template reads the recipient in full, the amount in words and digits, and the comparison with the request. Confirm stays disabled until the readout finishes.
5. Confirm: the passkey prompt asks for fingerprint or face. The challenge is the hash of the mandate.
6. Verify and pay once: the server checks everything, consumes the mandate, then PayPal's sandbox sends the payment. Every outcome is audit logged.
7. Tamper test (shown in the demo): the amount is changed after the readout, the person confirms, and the server rejects the payment.

## Demo Actions
* `send_money`: PayPal Payouts to a sandbox account. The main demo.

## What KarenPay Must NOT Claim
* Bank-grade, certified, compliant with any regulation, unhackable, or safe for real money.
* Immune to prompt injection.
* That blind users prefer it, until they tell us so.
* AP2 compatible, until our mandate passes AP2's JSON schema validation. Until then: "aligned with AP2 for purchases, inspired by AP2 for transfers".

## Team and Ownership
* Emmanuel: KarenPay Core, the API, PayPal integration, Gemini intent, security tests.
* Teammate: voice and accessible UI, screen-reader tester recruitment and sessions, pitch deck, demo video. Integrates against the endpoints in `2-architecture.md`.

## Scope (Release Gate, submit November 11, 2026)
* send_money works by voice end to end in the PayPal sandbox with fingerprint or face confirmation.
* Tamper, replay and expiry attacks are rejected, with published results.
* Test suites run with one command and report counts, with and without the intent check.
* At least 3 screen-reader users have tested it, with notes published.
* Public repo, Apache-2.0 license, README with a 10 line integration example, threat model, security policy.
* Hosted demo on Render, YouTube video under 3 minutes, Devpost submission.
* No secrets, archives or generated folders committed.

## Out of Scope
* Shopping catalog or product search, balances, ledger, KYC, bank features.
* Real money, live PayPal credentials, delegated spending when the person is absent.
* Merchant checkout and Orders payments.
* Siri or Android voice shortcuts. The demo is a web app.
* Jev. Cut to protect the deadline.

## Success Criteria
Every gate in `7-units.md` is passed, the frozen commit's test results are published in the README, and the submission is in on November 11.
