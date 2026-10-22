import { createHash, createHmac, generateKeyPairSync, sign } from "node:crypto";
import express from "express";
import { describe, expect, it, vi } from "vitest";
import { createApproveRouter, type ApproveConfig } from "../../apps/api/src/approve.js";
import {
  buildMandate,
  buildReadout,
  canonicalize,
  checkIntent,
  checkLimits,
  computeAuditHash,
  hashMandate,
  transitionMandateState,
  verifyAuditChain,
  type Mandate,
} from "../../packages/core/src/index.js";

/** Deterministic Mulberry32 PRNG for reproducible randomized trials. */
function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Encodes a P-256 uncompressed public key (X, Y) as COSE_Key CBOR bytes in PostgreSQL bytea hex format. */
function encodeP256CosePublicKeyBytea(x: Uint8Array, y: Uint8Array): string {
  const cose = new Uint8Array([
    0xa5, // map(5)
    0x01, 0x02, // 1 (kty): 2 (EC2)
    0x03, 0x26, // 3 (alg): -7 (ES256)
    0x20, 0x01, // -1 (crv): 1 (P-256)
    0x21, 0x58, 0x20, ...x, // -2 (x): bstr(32)
    0x22, 0x58, 0x20, ...y, // -3 (y): bstr(32)
  ]);
  return `\\x${Buffer.from(cose).toString("hex")}`;
}

describe("Unit 15: Attack Suite A — Crypto, Logic, and Passkey Flows", () => {
  it("runs 1,000 randomized crypto and logic mutation trials with zero bypasses", () => {
    const rng = createRng(20261022);
    const totalTrials = 1_000;
    let rejectedMutations = 0;
    let bypasses = 0;

    const baseAccountId = "22222222-2222-4222-8222-222222222222";
    const baseContactId = "33333333-3333-4333-8333-333333333333";

    for (let trial = 0; trial < totalTrials; trial += 1) {
      const amountMinor = 100 + Math.floor(rng() * 9_900);
      const accountDigits = String(1_000_000_000 + Math.floor(rng() * 8_999_999_999));
      const useSpokenAccount = trial % 2 === 1;

      const proposal = useSpokenAccount
        ? {
            action: "send_money" as const,
            payeeName: `Recipient ${trial}`,
            payeeAccountNumber: accountDigits,
            amountMinor,
            currency: "USD",
          }
        : {
            action: "send_money" as const,
            payeeContactId: baseContactId,
            amountMinor,
            currency: "USD",
          };

      const constraints = useSpokenAccount
        ? {
            action: "send_money" as const,
            payeeName: `Recipient ${trial}`,
            payeeAccountNumber: accountDigits,
            maximumAmountMinor: amountMinor,
            currency: "USD",
          }
        : {
            action: "send_money" as const,
            payeeContactId: baseContactId,
            maximumAmountMinor: amountMinor,
            currency: "USD",
          };

      const spokenText = buildReadout({
        proposal,
        payeeDisplayName: `Recipient ${trial}`,
        requestConstraints: constraints,
      });

      const originalMandate: Mandate = buildMandate({
        id: "11111111-1111-4111-8111-111111111111",
        accountId: baseAccountId,
        ...proposal,
        constraints,
        requestHash: `req-${trial}`,
        nonce: `nonce-${trial}-${Math.floor(rng() * 1_000_000)}`,
        issuedAt: "2026-10-22T10:00:00.000Z",
        expiresAt: "2026-10-22T10:02:00.000Z",
        spokenText,
      });

      const originalHash = hashMandate(originalMandate);

      // Verify RFC 8785 canonicalization invariance under key reordering
      const reversedEntries = Object.entries(originalMandate).reverse();
      const reorderedMandate = Object.fromEntries(reversedEntries) as Mandate;
      if (canonicalize(reorderedMandate) !== canonicalize(originalMandate) || hashMandate(reorderedMandate) !== originalHash) {
        bypasses += 1;
      }

      const attackKind = trial % 6;
      if (attackKind === 0) {
        const tampered = { ...originalMandate, amountMinor: amountMinor + 1 + Math.floor(rng() * 5_000) };
        const tamperedHash = hashMandate(tampered);
        const intentResult = checkIntent(
          { ...proposal, amountMinor: tampered.amountMinor },
          constraints,
        );
        if (tamperedHash !== originalHash && !intentResult.accepted) {
          rejectedMutations += 1;
        } else {
          bypasses += 1;
        }
      } else if (attackKind === 1) {
        const flippedDigits = `${accountDigits.slice(0, -1)}${(Number(accountDigits.at(-1)) + 1) % 10}`;
        const tamperedProposal = useSpokenAccount
          ? { ...proposal, payeeAccountNumber: flippedDigits }
          : { ...proposal, payeeContactId: "44444444-4444-4444-8444-444444444444" };
        const tamperedMandate = { ...originalMandate, ...tamperedProposal };
        const intentResult = checkIntent(tamperedProposal, constraints);
        if (hashMandate(tamperedMandate) !== originalHash && !intentResult.accepted) {
          rejectedMutations += 1;
        } else {
          bypasses += 1;
        }
      } else if (attackKind === 2) {
        const expiresAt = new Date(originalMandate.expiresAt);
        const afterExpiry = new Date(expiresAt.getTime() + Math.floor(rng() * 60_000));
        const transition = transitionMandateState("CREATED", "CONSUME", expiresAt, afterExpiry);
        if (transition.accepted && transition.state === "EXPIRED") {
          rejectedMutations += 1;
        } else {
          bypasses += 1;
        }
      } else if (attackKind === 3) {
        const expiresAt = new Date(originalMandate.expiresAt);
        const beforeExpiry = new Date(expiresAt.getTime() - 1_000);
        const firstConsume = transitionMandateState("CREATED", "CONSUME", expiresAt, beforeExpiry);
        const replayConsume = transitionMandateState(firstConsume.state, "CONSUME", expiresAt, beforeExpiry);
        if (firstConsume.state === "CONSUMED" && !replayConsume.accepted && replayConsume.code === "INVALID_TRANSITION") {
          rejectedMutations += 1;
        } else {
          bypasses += 1;
        }
      } else if (attackKind === 4) {
        const limitResult = checkLimits(
          { ...proposal, amountMinor: 10_001, currency: trial % 4 === 0 ? "EUR" : "USD" },
          { maximumAmountMinor: 10_000, allowedCurrencies: ["USD"] },
          [{ id: baseContactId, displayName: "Ade Bello", paypalSandboxEmail: "ade@example.com" }],
        );
        if (!limitResult.accepted) {
          rejectedMutations += 1;
        } else {
          bypasses += 1;
        }
      } else {
        const event1 = {
          accountId: baseAccountId,
          mandateId: originalMandate.id,
          eventType: "MANDATE_CREATED",
          detail: { mandateHash: originalHash },
          prevHash: null,
        };
        const record1 = { ...event1, hash: computeAuditHash(event1) };
        const event2 = {
          accountId: baseAccountId,
          mandateId: originalMandate.id,
          eventType: "PAYMENT_SENT",
          detail: { amountMinor },
          prevHash: record1.hash,
        };
        const tamperedRecord2 = {
          ...event2,
          detail: { amountMinor: amountMinor + 100 },
          hash: computeAuditHash(event2),
        };
        const chainResult = verifyAuditChain([record1, tamperedRecord2]);
        if (!chainResult.valid) {
          rejectedMutations += 1;
        } else {
          bypasses += 1;
        }
      }
    }

    console.log(
      `[Attack Suite A — Crypto & Logic] Trials: ${totalTrials} | Rejected Attacks: ${rejectedMutations} | Bypasses: ${bypasses}`,
    );
    expect(bypasses).toBe(0);
    expect(rejectedMutations).toBe(totalTrials);
  });

  it("runs 100 WebAuthn passkey approval flows through POST /api/v1/mandates/:id/approve including flipped UV, flipped UP, wrong challenge, and phishing origin", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
    const cosePublicKeyHex = encodeP256CosePublicKeyBytea(
      Buffer.from(jwk.x, "base64url"),
      Buffer.from(jwk.y, "base64url"),
    );

    const secret = "a-long-test-session-secret-that-is-at-least-32-characters";
    const accountId = "22222222-2222-4222-8222-222222222222";
    const mandateId = "11111111-1111-4111-8111-111111111111";
    const rpID = "karenpay-web.onrender.com";
    const expectedOrigin = "https://karenpay-web.onrender.com";
    const credentialId = Buffer.from("demo-passkey-credential-1").toString("base64url");
    const rpIdHash = createHash("sha256").update(rpID, "utf8").digest();

    const config: ApproveConfig = {
      rpID,
      rpName: "KarenPay",
      webOrigin: expectedOrigin,
      sessionSecret: secret,
      supabaseUrl: "https://example.supabase.co",
      supabaseServiceRoleKey: "test-service-role-key",
      paypalClientId: "client-id",
      paypalClientSecret: "client-secret",
      paypalBaseUrl: "https://api-m.sandbox.paypal.com",
    };

    const encodedSession = Buffer.from(JSON.stringify({ accountId, expiresAt: Date.now() + 60_000 })).toString("base64url");
    const cookie = `kp_session=${encodedSession}.${createHmac("sha256", secret).update(encodedSession).digest("base64url")}`;

    let currentChallenge = "";
    const nativeFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://example.supabase.co") && url.includes("mandates?select=")) {
        return new Response(JSON.stringify([{
          id: mandateId,
          state: "CREATED",
          mandate_hash: currentChallenge,
          payee_contact_id: null,
          payee_name: "Ade Bello",
          payee_account_number: "0123456789",
          amount_minor: 5000,
          currency: "USD",
          paypal_ref: null,
          spoken_text: "You asked to send fifty dollars to Ade Bello.",
        }]));
      }
      if (url.startsWith("https://example.supabase.co") && url.includes("passkey_credentials?select=")) {
        return new Response(JSON.stringify([{
          id: "cred-row-1",
          credential_id: credentialId,
          public_key: cosePublicKeyHex,
          counter: 0,
          transports: ["internal"],
        }]));
      }
      if (url.startsWith("https://example.supabase.co") && url.includes("rpc/consume_mandate")) {
        return new Response(JSON.stringify([{
          id: mandateId,
          state: "CONSUMED",
          mandate_hash: currentChallenge,
          payee_contact_id: null,
          payee_name: "Ade Bello",
          payee_account_number: "0123456789",
          amount_minor: 5000,
          currency: "USD",
          paypal_ref: null,
          spoken_text: "You asked to send fifty dollars to Ade Bello.",
        }]));
      }
      if (url.startsWith("https://example.supabase.co")) {
        return new Response("[]", { status: 200 });
      }
      if (url.startsWith("https://api-m.sandbox.paypal.com/v1/oauth2/token")) {
        return new Response(JSON.stringify({ access_token: "sandbox-token", token_type: "Bearer", expires_in: 3600 }), { status: 200 });
      }
      if (url.startsWith("https://api-m.sandbox.paypal.com/v1/payments/payouts")) {
        return new Response(JSON.stringify({ batch_header: { payout_batch_id: "batch-ok", batch_status: "PENDING" } }), { status: 201 });
      }
      return nativeFetch(input, init);
    }) as typeof fetch;

    const app = express();
    app.use(express.json());
    app.use("/api/v1/mandates", createApproveRouter(config));
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const listener = app.listen(0, () => resolve(listener));
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No TCP address");
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const totalPasskeyRuns = 100;
      let validApprovals = 0;
      let rejectedTamperedAssertions = 0;
      let bypasses = 0;

      for (let i = 0; i < totalPasskeyRuns; i += 1) {
        currentChallenge = createHash("sha256").update(`mandate-${i}`, "utf8").digest("base64url");
        const mode = i % 5;
        const flags = mode === 1
          ? 0x01 // UP=1, UV=0 (user verification false)
          : mode === 2
            ? 0x04 // UP=0, UV=1 (user presence false)
            : 0x05; // UP=1, UV=1

        const signCount = Buffer.alloc(4);
        signCount.writeUInt32BE(i + 1, 0);
        const authenticatorData = Buffer.concat([rpIdHash, Buffer.from([flags]), signCount]);

        const clientDataJSON = Buffer.from(
          JSON.stringify({
            type: "webauthn.get",
            challenge: mode === 3 ? createHash("sha256").update(`wrong-${i}`, "utf8").digest("base64url") : currentChallenge,
            origin: mode === 4 ? "https://phishing.example.com" : expectedOrigin,
            crossOrigin: false,
          }),
          "utf8",
        );

        const clientDataHash = createHash("sha256").update(clientDataJSON).digest();
        const signedBytes = Buffer.concat([authenticatorData, clientDataHash]);
        const signatureDer = sign("sha256", signedBytes, privateKey);

        const response = await nativeFetch(`${baseUrl}/api/v1/mandates/${mandateId}/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cookie },
          body: JSON.stringify({
            id: credentialId,
            rawId: credentialId,
            type: "public-key",
            clientExtensionResults: {},
            response: {
              authenticatorData: authenticatorData.toString("base64url"),
              clientDataJSON: clientDataJSON.toString("base64url"),
              signature: signatureDer.toString("base64url"),
            },
          }),
        });

        if (mode === 0) {
          if (response.status === 200) {
            validApprovals += 1;
          } else {
            bypasses += 1;
          }
        } else if (response.status === 401) {
          rejectedTamperedAssertions += 1;
        } else {
          bypasses += 1;
        }
      }

      console.log(
        `[Attack Suite A — Passkey Assertions] Runs: ${totalPasskeyRuns} | Valid Approvals: ${validApprovals} | Rejected Tampered/Flag-Flipped: ${rejectedTamperedAssertions} | Bypasses: ${bypasses}`,
      );
      expect(bypasses).toBe(0);
      expect(validApprovals).toBe(20);
      expect(rejectedTamperedAssertions).toBe(80);
    } finally {
      globalThis.fetch = nativeFetch;
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  }, 20_000);
});
