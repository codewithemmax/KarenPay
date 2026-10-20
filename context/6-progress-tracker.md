# Progress Tracker

Update this file after every meaningful implementation change.

## Current Phase
* Pre build. Product brief v1.0 is done. Nothing is built. Today is Day 4 (October 20, 2026).

## Current Goal
* Pass Gate 1: a PayPal sandbox Payouts send and an Orders payment from code, then scaffold the repo.

## Current State
* Product brief KarenPay v1.0 finalized. Test plan from the security research is adopted (see Architecture Decisions).
* No repository, accounts or keys confirmed yet.

## Completed
* (none yet)

## In Progress
* (not started)

## Next Up
* Unit 1: repo scaffold, Apache-2.0, SECURITY.md.
* Unit 2: PayPal sandbox client for Orders and Payouts.
* Start contacting screen-reader testers today.

## Open Questions
* Which currency does the demo use? PayPal may not list NGN as a supported currency. Default to USD and confirm against PayPal's supported currency list on Unit 2.
* Can an Orders payment be completed server side in the sandbox, or does the payer approval step have to run first? This decides whether pay_merchant is feasible. If it is not, pay_merchant is cut.
* Is Payouts available on the sandbox business account, and what do the app's Features settings require?
* Final hosted domain. Passkeys bind to the domain, so changing it later means re-registering. Decide by the end of Unit 4.
* Which demo phone and browser. Decide in Unit 4 and test only there.
* Exact Gemini model name for `GEMINI_MODEL`, and the exact package names for the RFC 8785 library and the Gemini SDK. Confirm on npm and in the docs.

## Architecture Decisions
* Library first: KarenPay Core is the product, the voice app is the reference client.
* Demo actions: send_money (Payouts) main, pay_merchant (Orders) secondary and cut first.
* Passkey-only accounts, no Supabase Auth. Supabase is used as Postgres only.
* Mandate follows the AP2 Cart Mandate shape and is validated against AP2's JSON schemas. Wording rule: aligned for purchases, inspired for transfers.
* RFC 8785 canonicalization. Challenge is the hash of the canonical mandate.
* Jev is cut. Elastic is a stretch task after Gate 6.
* License Apache-2.0. Budget $0. Hosting on Render.
* Test targets: 1,000+ randomized crypto and logic trials, 100 browser passkey runs, about 200 adversarial prompts graded by code with and without the intent check, 3+ screen-reader users. The Rule of Three bounds the failure rate at about 3 divided by the number of clean trials, only for the attack types sampled.

## Session Notes
* Submission target: November 11, 2026. Devpost deadline: November 12, 12:00 pm PST.
* Base setup commands:
  ```
  git clone https://github.com/<your-username>/karenpay.git
  cd karenpay
  git switch -c core/unit-01-scaffold
  npm install
  ```
* Daily control loop: pull dev, complete one narrow unit, test it, commit and push, update this file, then name the next unit.
