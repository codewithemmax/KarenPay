# Spoken Language, Trust Language and Accessibility Contract

The normal file 3 in this methodology covers the visual design system. That is owned by the teammate and out of scope here. For the backend and Core, file 3 instead covers the words KarenPay may speak and return, because they travel through API responses and decide what the client can honestly say.

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
* Name the recipient in full, exactly as stored in the contact or spoken with the account number.
* When a recipient account number is used, read the account number digit by digit immediately after the recipient's name (for example, "to Ade Bello, account number zero, one, two, three, four, five, six, seven, eight, nine").
* Say the amount in words and then digit by digit.
* State the comparison with the request when constraints exist, for example "You asked for under one hundred dollars."
* End with one clear instruction for the passkey step.
* Same input always produces the same text, and the text is hashed inside the mandate.

## Claims the API and Speech Must Never Make or Imply
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
