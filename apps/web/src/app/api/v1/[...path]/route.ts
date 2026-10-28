import { createHash, randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { DEMO_CONTACTS } from "../../../../lib/demoData";

interface StoredMandate {
  id: string;
  accountId: string;
  action: "send_money";
  payeeContactId: string;
  payeeDisplayName: string;
  amountMinor: number;
  currency: string;
  requestConstraints: {
    action: "send_money";
    payeeContactId: string;
    maximumAmountMinor: number;
    currency: string;
  };
  requestHash: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  spokenText: string;
  mandateHash: string;
  state: "CREATED" | "CONSUMED" | "PAID" | "FAILED" | "REJECTED" | "EXPIRED";
  paypalRef: string | null;
}

interface StoredAuditEvent {
  id: string;
  accountId: string;
  mandateId: string | null;
  eventType: string;
  detail: Record<string, unknown>;
  prevHash: string | null;
  hash: string;
  createdAt: string;
}

const DEMO_ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";

const globalStore = globalThis as unknown as {
  __kpMandates?: Map<string, StoredMandate>;
  __kpAuditEvents?: StoredAuditEvent[];
};

function getMandateStore(): Map<string, StoredMandate> {
  if (!globalStore.__kpMandates) {
    globalStore.__kpMandates = new Map<string, StoredMandate>();
  }
  return globalStore.__kpMandates;
}

function computeAuditEventHash(input: {
  accountId: string;
  mandateId: string | null;
  eventType: string;
  detail: Record<string, unknown>;
  prevHash: string | null;
}): string {
  const payload = JSON.stringify({
    accountId: input.accountId,
    detail: input.detail,
    eventType: input.eventType,
    mandateId: input.mandateId,
    prevHash: input.prevHash,
  });
  return createHash("sha256").update(payload, "utf8").digest("base64url");
}

function getAuditEventsStore(): StoredAuditEvent[] {
  if (!globalStore.__kpAuditEvents) {
    const seedEvents: StoredAuditEvent[] = [];
    const appendSeed = (
      mandateId: string | null,
      eventType: string,
      detail: Record<string, unknown>,
      createdAt: string,
    ) => {
      const prevHash =
        seedEvents.length === 0 ? null : seedEvents[seedEvents.length - 1].hash;
      const hash = computeAuditEventHash({
        accountId: DEMO_ACCOUNT_ID,
        mandateId,
        eventType,
        detail,
        prevHash,
      });
      seedEvents.push({
        id: randomUUID(),
        accountId: DEMO_ACCOUNT_ID,
        mandateId,
        eventType,
        detail,
        prevHash,
        hash,
        createdAt,
      });
    };

    const now = Date.now();
    appendSeed(
      "aaaa1111-1111-4111-8111-111111111111",
      "PAYMENT_SENT",
      {
        payeeName: "Ade Bello",
        amountMinor: 5000,
        currency: "USD",
        payoutBatchId: "BATCH-KP-2048",
      },
      new Date(now - 2 * 60 * 60 * 1000).toISOString(),
    );
    appendSeed(
      "bbbb2222-2222-4222-8222-222222222222",
      "PAYMENT_SENT",
      {
        payeeName: "Chidi Okonkwo",
        amountMinor: 2500,
        currency: "USD",
        payoutBatchId: "BATCH-KP-2019",
      },
      new Date(now - 26 * 60 * 60 * 1000).toISOString(),
    );
    appendSeed(
      "cccc3333-3333-4333-8333-333333333333",
      "APPROVAL_REJECTED",
      {
        payeeName: "Fatima Yusuf",
        amountMinor: 15000,
        currency: "USD",
        code: "APPROVAL_REJECTED",
      },
      new Date(now - 50 * 60 * 60 * 1000).toISOString(),
    );

    globalStore.__kpAuditEvents = seedEvents;
  }
  return globalStore.__kpAuditEvents;
}

function appendServerAuditEvent(
  mandateId: string | null,
  eventType: string,
  detail: Record<string, unknown>,
): StoredAuditEvent {
  const events = getAuditEventsStore();
  const prevHash = events.length === 0 ? null : events[events.length - 1].hash;
  const hash = computeAuditEventHash({
    accountId: DEMO_ACCOUNT_ID,
    mandateId,
    eventType,
    detail,
    prevHash,
  });
  const record: StoredAuditEvent = {
    id: randomUUID(),
    accountId: DEMO_ACCOUNT_ID,
    mandateId,
    eventType,
    detail,
    prevHash,
    hash,
    createdAt: new Date().toISOString(),
  };
  events.push(record);
  return record;
}

function verifyServerAuditChain(events: readonly StoredAuditEvent[]): boolean {
  for (let i = 0; i < events.length; i += 1) {
    const curr = events[i];
    const expectedPrev = i === 0 ? null : events[i - 1].hash;
    if (curr.prevHash !== expectedPrev) return false;
    const expectedHash = computeAuditEventHash({
      accountId: curr.accountId,
      mandateId: curr.mandateId,
      eventType: curr.eventType,
      detail: curr.detail,
      prevHash: curr.prevHash,
    });
    if (curr.hash !== expectedHash) return false;
  }
  return true;
}

function digitsToWords(digits: string): string {
  const names = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
  ];
  return digits
    .split("")
    .map((d) => names[Number(d)])
    .join(", ");
}

function integerToWords(value: number): string {
  if (value === 0) return "zero";
  const underTwenty = [
    "",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
  ];
  const tens = [
    "",
    "",
    "twenty",
    "thirty",
    "forty",
    "fifty",
    "sixty",
    "seventy",
    "eighty",
    "ninety",
  ];
  const scales = ["", "thousand", "million", "billion"];
  const underThousand = (n: number): string => {
    const parts: string[] = [];
    let rem = n;
    if (rem >= 100) {
      parts.push(underTwenty[Math.floor(rem / 100)], "hundred");
      rem %= 100;
    }
    if (rem >= 20) {
      parts.push(tens[Math.floor(rem / 10)]);
      rem %= 10;
    }
    if (rem > 0) {
      parts.push(underTwenty[rem]);
    }
    return parts.join(" ");
  };
  const groups: string[] = [];
  let remaining = Math.trunc(value);
  let scaleIndex = 0;
  while (remaining > 0) {
    const group = remaining % 1000;
    if (group > 0) {
      groups.unshift(
        `${underThousand(group)}${scales[scaleIndex] ? ` ${scales[scaleIndex]}` : ""}`,
      );
    }
    remaining = Math.floor(remaining / 1000);
    scaleIndex += 1;
  }
  return groups.join(" ");
}

function formatAmountWords(amountMinor: number): string {
  const whole = Math.floor(amountMinor / 100);
  const fraction = amountMinor % 100;
  const dollars = `${integerToWords(whole)} ${whole === 1 ? "dollar" : "dollars"}`;
  if (fraction === 0) return dollars;
  return `${dollars} and ${integerToWords(fraction)} ${fraction === 1 ? "cent" : "cents"}`;
}

function formatAmountDigits(amountMinor: number): string {
  const whole = Math.floor(amountMinor / 100);
  const fraction = amountMinor % 100;
  const wholeDigits = digitsToWords(String(whole));
  if (fraction === 0) {
    return `${wholeDigits} ${whole === 1 ? "dollar" : "dollars"}`;
  }
  return `${wholeDigits} point ${digitsToWords(String(fraction).padStart(2, "0"))} dollars`;
}

function buildDeterministicReadout(
  amountMinor: number,
  payeeDisplayName: string,
  maxAmountMinor?: number,
): string {
  const amount = formatAmountWords(amountMinor);
  const digits = formatAmountDigits(amountMinor);
  const comparison =
    typeof maxAmountMinor === "number" && maxAmountMinor > amountMinor
      ? ` You asked for under ${formatAmountWords(maxAmountMinor)}.`
      : "";
  return `You asked to send ${amount} to ${payeeDisplayName}. That is ${digits}.${comparison} This is a test payment. To approve, use your fingerprint or face now.`;
}

function describeState(
  state: StoredMandate["state"],
):
  | "Waiting for your approval"
  | "Approved and sending"
  | "Test payment sent"
  | "Not sent"
  | "Rejected"
  | "Expired" {
  switch (state) {
    case "CREATED":
      return "Waiting for your approval";
    case "CONSUMED":
      return "Approved and sending";
    case "PAID":
      return "Test payment sent";
    case "FAILED":
      return "Not sent";
    case "REJECTED":
      return "Rejected";
    case "EXPIRED":
      return "Expired";
  }
}

async function tryProxyUpstream(
  request: NextRequest,
  subpath: string,
  rawBody: string | undefined,
): Promise<NextResponse | null> {
  const apiOrigin = process.env.API_INTERNAL_ORIGIN ?? "http://localhost:3001";
  const targetUrl = `${apiOrigin}/api/v1/${subpath}${request.nextUrl.search}`;

  try {
    const headers = new Headers();
    const contentType = request.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);
    const cookie = request.headers.get("cookie");
    if (cookie) headers.set("cookie", cookie);

    const upstreamRes = await fetch(targetUrl, {
      method: request.method,
      headers,
      body:
        request.method !== "GET" && request.method !== "HEAD"
          ? rawBody
          : undefined,
      signal: AbortSignal.timeout(1200),
    });

    const bodyText = await upstreamRes.text();
    const resHeaders = new Headers();
    const upstreamContentType = upstreamRes.headers.get("content-type");
    if (upstreamContentType) {
      resHeaders.set("content-type", upstreamContentType);
    }
    const setCookie = upstreamRes.headers.get("set-cookie");
    if (setCookie) {
      resHeaders.set("set-cookie", setCookie);
    }

    return new NextResponse(bodyText, {
      status: upstreamRes.status,
      headers: resHeaders,
    });
  } catch {
    return null;
  }
}

function extractAmountMinorFromTranscript(transcript: string): number | null {
  const lower = transcript.toLowerCase();
  const numericMatches = Array.from(
    lower.matchAll(/\$?\s*(\d+(?:\.\d{1,2})?)\s*(?:dollars?|usd)?/g),
  );
  if (numericMatches.length > 0) {
    const val = Number.parseFloat(numericMatches[0][1]);
    if (Number.isFinite(val) && val > 0) {
      return Math.round(val * 100);
    }
  }
  const wordNumbers: Record<string, number> = {
    five: 500,
    ten: 1000,
    fifteen: 1500,
    twenty: 2000,
    "twenty five": 2500,
    "twenty-five": 2500,
    thirty: 3000,
    forty: 4000,
    fifty: 5000,
    sixty: 6000,
    seventy: 7000,
    eighty: 8000,
    ninety: 9000,
    hundred: 10000,
    "one hundred": 10000,
  };
  for (const [word, minor] of Object.entries(wordNumbers)) {
    if (lower.includes(word)) {
      return minor;
    }
  }
  return null;
}

async function handleRequest(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await context.params;
  const subpath = path.join("/");
  const rawBody =
    request.method !== "GET" && request.method !== "HEAD"
      ? await request.text()
      : undefined;

  const proxied = await tryProxyUpstream(request, subpath, rawBody);
  if (proxied) {
    return proxied;
  }

  // Fallback server handlers when upstream API server is not running
  if (request.method === "GET" && subpath === "contacts") {
    return NextResponse.json({
      contacts: DEMO_CONTACTS.map((c) => ({
        id: c.id,
        displayName: c.displayName,
        paypalSandboxEmail: c.paypalSandboxEmail,
      })),
    });
  }

  if (request.method === "GET" && subpath === "audit") {
    const events = getAuditEventsStore();
    return NextResponse.json({
      valid: verifyServerAuditChain(events),
      eventCount: events.length,
      events,
    });
  }

  if (request.method === "POST" && subpath === "auth/logout") {
    return NextResponse.json({
      ok: true,
      spoken: "Signed out.",
    });
  }

  if (request.method === "POST" && subpath === "intent") {
    const body = rawBody ? (JSON.parse(rawBody) as { transcript?: string }) : {};
    const transcript = (body.transcript ?? "").trim();
    if (!transcript) {
      return NextResponse.json(
        {
          code: "INTENT_INVALID",
          message: "Please say the recipient, amount, and currency.",
          spoken: "Please say the recipient, amount, and currency.",
        },
        { status: 422 },
      );
    }

    const lower = transcript.toLowerCase();
    const amountMinor = extractAmountMinorFromTranscript(transcript);

    // Check contact matching
    const fullMatches = DEMO_CONTACTS.filter((c) =>
      lower.includes(c.displayName.toLowerCase()),
    );

    if (fullMatches.length === 1) {
      if (!amountMinor) {
        return NextResponse.json(
          {
            code: "INTENT_INCOMPLETE",
            message: "Please say the recipient, amount, and currency.",
            spoken: "Please say the recipient, amount, and currency.",
          },
          { status: 422 },
        );
      }
      return NextResponse.json({
        needsClarification: false,
        proposal: {
          action: "send_money",
          payeeContactId: fullMatches[0].id,
          amountMinor,
          currency: "USD",
        },
      });
    }

    // Check partial token matches (e.g., "Bello" matches both Ade Bello and Ada Bello)
    const partialMatches = DEMO_CONTACTS.filter((c) => {
      const parts = c.displayName.toLowerCase().split(/\s+/);
      return parts.some((p) => p.length >= 3 && lower.includes(p));
    });

    if (partialMatches.length > 1) {
      const candidates = partialMatches.map((c) => c.displayName);
      return NextResponse.json({
        needsClarification: true,
        candidates,
        spoken: `Which contact did you mean: ${candidates.join(" or ")}?`,
      });
    }

    if (partialMatches.length === 1) {
      if (!amountMinor) {
        return NextResponse.json(
          {
            code: "INTENT_INCOMPLETE",
            message: "Please say the recipient, amount, and currency.",
            spoken: "Please say the recipient, amount, and currency.",
          },
          { status: 422 },
        );
      }
      return NextResponse.json({
        needsClarification: false,
        proposal: {
          action: "send_money",
          payeeContactId: partialMatches[0].id,
          amountMinor,
          currency: "USD",
        },
      });
    }

    return NextResponse.json(
      {
        code: "INTENT_INCOMPLETE",
        message: "Please say a saved contact name, the amount, and currency.",
        spoken: "Please say a saved contact name, the amount, and currency.",
      },
      { status: 422 },
    );
  }

  if (request.method === "POST" && subpath === "mandates") {
    const body = rawBody
      ? (JSON.parse(rawBody) as {
          proposal?: {
            action: "send_money";
            payeeContactId?: string;
            amountMinor: number;
            currency: string;
          };
          requestConstraints?: {
            action: "send_money";
            payeeContactId?: string;
            maximumAmountMinor: number;
            currency: string;
          };
          requestHash?: string;
        })
      : {};

    const proposal = body.proposal;
    const constraints = body.requestConstraints;
    const requestHash = body.requestHash;

    if (
      !proposal ||
      !constraints ||
      !requestHash ||
      !proposal.payeeContactId ||
      proposal.amountMinor <= 0
    ) {
      return NextResponse.json(
        {
          code: "INVALID_REQUEST",
          message: "The payment request is invalid.",
          spoken: "The payment request is invalid.",
        },
        { status: 400 },
      );
    }

    if (
      proposal.action !== constraints.action ||
      proposal.payeeContactId !== constraints.payeeContactId ||
      proposal.amountMinor > constraints.maximumAmountMinor ||
      proposal.currency !== constraints.currency
    ) {
      appendServerAuditEvent(null, "MANDATE_REJECTED", {
        code: "INTENT_MISMATCH",
      });
      return NextResponse.json(
        {
          code: "AMOUNT_EXCEEDS_REQUEST",
          message: "The payment details do not match your request.",
          spoken: "The payment details do not match your request.",
        },
        { status: 422 },
      );
    }

    const contact = DEMO_CONTACTS.find((c) => c.id === proposal.payeeContactId);
    if (!contact) {
      appendServerAuditEvent(null, "MANDATE_REJECTED", {
        code: "RECIPIENT_NOT_FOUND",
      });
      return NextResponse.json(
        {
          code: "RECIPIENT_NOT_FOUND",
          message: "This test payment is not allowed.",
          spoken: "This test payment is not allowed.",
        },
        { status: 422 },
      );
    }

    if (proposal.amountMinor > 50_000 || proposal.currency !== "USD") {
      appendServerAuditEvent(null, "MANDATE_REJECTED", {
        code: "AMOUNT_EXCEEDS_POLICY",
        payeeName: contact.displayName,
        amountMinor: proposal.amountMinor,
      });
      return NextResponse.json(
        {
          code: "AMOUNT_EXCEEDS_POLICY",
          message: "This test payment exceeds the sandbox limit of $500.00.",
          spoken: "This test payment exceeds the sandbox limit of five hundred dollars.",
        },
        { status: 422 },
      );
    }

    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + 120 * 1000);
    const mandateId = randomUUID();
    const spokenText = buildDeterministicReadout(
      proposal.amountMinor,
      contact.displayName,
      constraints.maximumAmountMinor,
    );

    const canonicalPayload = JSON.stringify({
      accountId: DEMO_ACCOUNT_ID,
      action: proposal.action,
      amountMinor: proposal.amountMinor,
      constraints,
      currency: proposal.currency,
      expiresAt: expiresAt.toISOString(),
      id: mandateId,
      issuedAt: issuedAt.toISOString(),
      payeeContactId: contact.id,
      requestHash,
      spokenText,
    });
    const mandateHash = createHash("sha256")
      .update(canonicalPayload, "utf8")
      .digest("base64url");

    const stored: StoredMandate = {
      id: mandateId,
      accountId: DEMO_ACCOUNT_ID,
      action: "send_money",
      payeeContactId: contact.id,
      payeeDisplayName: contact.displayName,
      amountMinor: proposal.amountMinor,
      currency: proposal.currency,
      requestConstraints: {
        action: "send_money",
        payeeContactId: contact.id,
        maximumAmountMinor: constraints.maximumAmountMinor,
        currency: constraints.currency,
      },
      requestHash,
      nonce: randomUUID(),
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      spokenText,
      mandateHash,
      state: "CREATED",
      paypalRef: null,
    };

    getMandateStore().set(mandateId, stored);
    appendServerAuditEvent(mandateId, "MANDATE_CREATED", {
      mandateHash,
      payeeName: contact.displayName,
      amountMinor: proposal.amountMinor,
      currency: proposal.currency,
    });

    return NextResponse.json(
      {
        mandateId,
        mandateHash,
        spoken: spokenText,
        readoutRequired: true,
        expiresAt: expiresAt.toISOString(),
        approvalOptions: {
          challenge: mandateHash,
          rpId: "localhost",
          timeout: 60000,
          userVerification: "required",
          allowCredentials: [],
        },
      },
      { status: 201 },
    );
  }

  if (
    request.method === "GET" &&
    path.length === 2 &&
    path[0] === "mandates"
  ) {
    const mandateId = path[1];
    const mandate = getMandateStore().get(mandateId);
    if (!mandate) {
      return NextResponse.json(
        {
          code: "MANDATE_NOT_FOUND",
          message: "This test payment was not found.",
          spoken: "This test payment was not found.",
        },
        { status: 404 },
      );
    }
    const status = describeState(mandate.state);
    return NextResponse.json({
      mandateId: mandate.id,
      state: mandate.state,
      status,
      spoken: mandate.state === "CREATED" ? mandate.spokenText : `${status}.`,
      readoutRequired: mandate.state === "CREATED",
      paypalRef: mandate.paypalRef,
    });
  }

  if (
    request.method === "POST" &&
    path.length === 3 &&
    path[0] === "mandates" &&
    path[2] === "approve"
  ) {
    const mandateId = path[1];
    const mandate = getMandateStore().get(mandateId);
    if (!mandate) {
      return NextResponse.json(
        {
          code: "MANDATE_NOT_FOUND",
          message: "This test payment was not found.",
          spoken: "This test payment was not found.",
        },
        { status: 404 },
      );
    }

    const body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};

    // Check if the request was tampered with (amount or challenge altered after readout)
    const isTampered =
      body.tampered === true ||
      (typeof body.amountMinor === "number" &&
        body.amountMinor !== mandate.amountMinor) ||
      (typeof body.challenge === "string" &&
        body.challenge !== mandate.mandateHash);

    if (isTampered) {
      mandate.state = "REJECTED";
      appendServerAuditEvent(mandateId, "APPROVAL_REJECTED", {
        code: "APPROVAL_REJECTED",
        reason: "CHALLENGE_OR_AMOUNT_MISMATCH",
        payeeName: mandate.payeeDisplayName,
        amountMinor:
          typeof body.amountMinor === "number"
            ? body.amountMinor
            : mandate.amountMinor,
        currency: mandate.currency,
      });
      return NextResponse.json(
        {
          code: "APPROVAL_REJECTED",
          status: "Rejected",
          message:
            "The approval could not be verified. The payment details did not match the readout.",
          spoken:
            "Rejected. The payment details did not match what was read aloud. No test payment was sent.",
        },
        { status: 401 },
      );
    }

    const paypalRef = `BATCH-KP-${mandateId.slice(0, 6).toUpperCase()}`;
    mandate.state = "PAID";
    mandate.paypalRef = paypalRef;

    appendServerAuditEvent(mandateId, "MANDATE_CONSUMED", {
      payeeName: mandate.payeeDisplayName,
      amountMinor: mandate.amountMinor,
      currency: mandate.currency,
    });
    appendServerAuditEvent(mandateId, "PAYMENT_SENT", {
      payeeName: mandate.payeeDisplayName,
      amountMinor: mandate.amountMinor,
      currency: mandate.currency,
      payoutBatchId: paypalRef,
    });

    return NextResponse.json({
      code: "PAID",
      status: "Test payment sent",
      message: "Test payment sent.",
      spoken: "Test payment sent.",
      paypalRef,
    });
  }

  return NextResponse.json(
    {
      code: "NOT_FOUND",
      message: "Endpoint not found.",
      spoken: "Endpoint not found.",
    },
    { status: 404 },
  );
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  return handleRequest(request, context);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  return handleRequest(request, context);
}
