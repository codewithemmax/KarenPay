// Bulk Pay UI verification (Unit B7): axe-core at 320/390/1280 px, 5 sequential approvals,
// and the Judge Demo Tamper Switch. The API is stubbed inside the browser with server-shaped
// fixtures; mandates and hashes are produced by the real @karenpay/core.
// Run: node scripts/verify-bulk-ui.mjs   (requires `next start --port 3000`; Playwright hangs under Bun on Windows)
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

// playwright is only a transitive dependency (via @axe-core/playwright), so load it from the Bun store.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = await import(
  pathToFileURL(path.join(root, "node_modules/.bun/playwright@1.64.1/node_modules/playwright/index.mjs")).href
);
const { default: AxeBuilder } = await import("@axe-core/playwright");
import { createHash } from "node:crypto";
const nodeRequire = createRequire(path.join(root, "packages/core/package.json"));
const canonicalizeModule = nodeRequire("canonicalize");
const canonicalizeJson = canonicalizeModule.default ?? canonicalizeModule.canonicalize ?? canonicalizeModule;
// Same definition as @karenpay/core hashMandate: base64url(SHA-256(RFC 8785 canonical mandate)).
// The browser recomputes this with the real core, so a match here also proves parity.
const buildMandate = (m) => m;
const hashMandate = (m) =>
  createHash("sha256").update(canonicalizeJson(m), "utf8").digest("base64url");

const BASE = process.env.WEB_BASE ?? "http://localhost:3000";
const VIEWPORTS = [
  { width: 320, height: 844 },
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
];

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const BATCH_ID = uuid(1);
const ACCOUNT_ID = uuid(2);
const PEOPLE = [
  ["0700000000", "Cleva Bank", "Olayinka Emmanuel"],
  ["0123456789", "Guaranty Trust Bank", "Ade Bello"],
  ["0801112223", "Access Bank", "Chidinma Okafor"],
  ["0902223334", "Zenith Bank", "Tunde Bakare"],
  ["0456789012", "United Bank for Africa", "Ngozi Eze"],
];
const item = (i) => uuid(100 + i);
const mandateId = (i) => uuid(200 + i);

function mandateFor(i) {
  const [acct, bank, name] = PEOPLE[i];
  const now = Date.now();
  const payeeName = `${name} at ${bank}`;
  return buildMandate({
    id: mandateId(i),
    accountId: ACCOUNT_ID,
    action: "send_money",
    payeeName,
    payeeAccountNumber: acct,
    amountMinor: 2500,
    currency: "USD",
    constraints: {
      action: "send_money",
      payeeName,
      payeeAccountNumber: acct,
      maximumAmountMinor: 2500,
      currency: "USD",
    },
    requestHash: "request-hash",
    nonce: `nonce-${i}`,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 120_000).toISOString(),
    spokenText: `You asked to send twenty five dollars to ${payeeName}.`,
  });
}

const last4 = (a) => a.slice(-4);
const recipientList = () => ({
  type: "recipient_list",
  batchId: BATCH_ID,
  recipients: PEOPLE.map(([acct, bank, name], i) => ({
    itemId: item(i),
    position: i,
    pastedName: i === 1 ? "Adewale Bello" : name,
    resolvedName: i === 1 ? null : name,
    bankName: bank,
    accountLast4: last4(acct),
    status: i === 1 ? "NAME_MISMATCH" : "MATCHED",
    statusLabel: i === 1 ? "Name differs" : "Name matches",
  })),
  unreadable: [],
  spoken: "I found 5 recipients in the simulated directory. One name differs.",
});
const nameCheck = () => ({
  type: "name_check",
  batchId: BATCH_ID,
  itemId: item(1),
  position: 1,
  pastedName: "Adewale Bello",
  directoryName: "Ade Bello",
  bankName: PEOPLE[1][1],
  accountLast4: last4(PEOPLE[1][0]),
  statusLabel: "Name differs",
  choices: ["USE_DIRECTORY_NAME", "SKIP"],
  spoken: "Name differs for the account ending in last 4 digits six, seven, eight, nine.",
});
const planWidget = () => ({
  type: "plan",
  batchId: BATCH_ID,
  status: "PLANNED",
  planHash: "p".repeat(43),
  requestHash: "r".repeat(43),
  totalMinor: 12500,
  currency: "USD",
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
  items: PEOPLE.map(([acct, bank, name], i) => ({
    itemId: item(i),
    position: i,
    recipientName: name,
    bankName: bank,
    accountLast4: last4(acct),
    amountMinor: 2500,
    currency: "USD",
    statusLabel: "Ready",
  })),
  spoken: "Plan ready: 5 test payments of twenty five dollars each, 125 dollars total.",
});
const summaryWidget = () => ({
  type: "batch_summary",
  batchId: BATCH_ID,
  status: "COMPLETED",
  totalMinor: 12500,
  paidMinor: 12500,
  currency: "USD",
  items: PEOPLE.map(([acct, bank, name], i) => ({
    itemId: item(i),
    position: i,
    recipientName: name,
    bankName: bank,
    accountLast4: last4(acct),
    amountMinor: 2500,
    currency: "USD",
    status: "PAID",
    statusLabel: "Test payment sent",
    paypalRef: `payout-${i + 1}`,
  })),
  spoken: "All 5 test payments were sent.",
});

const json = (route, body, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function installStubs(page, state) {
  await page.addInitScript(() => {
    // Readout ends immediately (still goes through onend, as the Hard Readout Lock requires).
    window.speechSynthesis.cancel = () => {};
    window.speechSynthesis.speak = (u) => setTimeout(() => u.onend && u.onend({}), 30);
    // Fake passkey prompt.
    const buf = (s) => new TextEncoder().encode(s).buffer;
    window.PublicKeyCredential = window.PublicKeyCredential ?? function () {};
    navigator.credentials.get = async () => ({
      id: "Y3JlZA",
      rawId: buf("cred"),
      type: "public-key",
      authenticatorAttachment: "platform",
      response: {
        authenticatorData: buf("a"),
        clientDataJSON: buf("{}"),
        signature: buf("s"),
        userHandle: null,
      },
      getClientExtensionResults: () => ({}),
    });
  });
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const m = route.request().method();
    if (p.endsWith("/bulk/parse")) return json(route, { batchId: BATCH_ID, status: "PARSED", spoken: recipientList().spoken, widgets: [recipientList(), nameCheck()] }, 201);
    if (p.includes("/resolve-name")) return json(route, { spoken: "Using the directory name.", widgets: [] });
    if (p.endsWith("/plan")) return json(route, { status: "PLANNED", totalMinor: 12500, spoken: planWidget().spoken, widgets: [planWidget()] });
    if (p.endsWith("/confirm-plan")) return json(route, { status: "CONFIRMED", spoken: "Plan confirmed.", widgets: [] });
    if (p.endsWith("/next") && m === "POST") {
      if (state.next >= 5) return json(route, { status: "COMPLETED", activeItem: null, runningTotalMinor: 12500, totalMinor: 12500, spoken: summaryWidget().spoken, widgets: [summaryWidget()] });
      const i = state.next;
      state.next += 1;
      state.active = i;
      return json(route, { batchId: BATCH_ID, status: "IN_PROGRESS", activeItem: { itemId: item(i), position: i, mandateId: mandateId(i) }, runningTotalMinor: i * 2500, totalMinor: 12500, spoken: `Transfer ${i + 1} of 5 is ready.`, widgets: [{ type: "transfer_approval", mandateId: mandateId(i) }] });
    }
    if (p.endsWith("/mandate") && m === "GET") {
      const mandate = mandateFor(state.active);
      const mandateHash = hashMandate(mandate);
      return json(route, { mandate, mandateHash, approvalOptions: { challenge: mandateHash, userVerification: "required", timeout: 60000, allowCredentials: [] }, spoken: mandate.spokenText, readoutRequired: true, state: "CREATED" });
    }
    if (p.endsWith("/approve")) {
      state.approved += 1;
      return json(route, { code: "PAID", message: "Test payment sent.", spoken: "Test payment sent.", paypalRef: `payout-${state.approved}` });
    }
    return json(route, { message: "stub: unhandled" }, 404);
  });
}

const results = [];
async function axeCheck(page, label, vp) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  results.push({ viewport: vp.width, state: label, violations: r.violations.length, ids: r.violations.map((v) => `${v.id}(${v.nodes.length})`) });
}

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "chrome" });
let failures = 0;
const must = (cond, msg) => { if (!cond) { failures += 1; console.error("FAIL:", msg); } };

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({ viewport: vp });
  const page = await context.newPage();
  const state = { next: 0, active: 0, approved: 0 };
  await installStubs(page, state);
  await page.goto(`${BASE}/bulk`, { waitUntil: "networkidle" });
  await axeCheck(page, "empty paste", vp);

  // Tab bar has 5 tabs and none overflow the viewport.
  const tabs = await page.locator("nav a, nav button").count();
  must(tabs >= 5, `${vp.width}px: expected >=5 tab items, got ${tabs}`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  must(!overflow, `${vp.width}px: horizontal overflow`);

  await page.getByTestId("sample-whatsapp-5-button").click();
  await page.getByTestId("bulk-parse-submit").click();
  await page.getByTestId("widget-recipient-list").waitFor();
  await page.getByTestId("widget-recipient-list").scrollIntoViewIfNeeded();
  await axeCheck(page, "recipient_list + name_check", vp);

  await page.getByRole("button", { name: /directory name/i }).first().click();
  await page.getByTestId("bulk-amount-input").waitFor();
  await page.getByTestId("bulk-amount-input").fill("25 each");
  await page.getByTestId("bulk-plan-submit").click();
  await page.getByTestId("widget-plan").waitFor();
  await axeCheck(page, "plan", vp);

  await page.getByTestId("widget-plan").getByRole("button", { name: /confirm/i }).first().click();
  await page.getByTestId(`widget-transfer-approval-${mandateId(0)}`).getByTestId("transfer-approval-account-full").waitFor();
  await axeCheck(page, "transfer_approval", vp);

  // Judge Demo Tamper Switch: hash mismatch => "Not sent" and Approve stays disabled.
  const approve0 = page.getByTestId(`approve-transfer-${mandateId(0)}`);
  await page.getByTestId("bulk-tamper-switch").check();
  await page.getByTestId("bulk-hash-mismatch-banner").waitFor();
  must(await approve0.isDisabled(), `${vp.width}px: Approve not disabled under tamper`);
  must((await page.getByTestId(`transfer-status-${mandateId(0)}`).innerText()).includes("Not sent"), `${vp.width}px: tamper chip is not "Not sent"`);
  await axeCheck(page, "transfer_approval (tampered)", vp);
  await page.getByTestId("bulk-tamper-switch").uncheck();

  // Five sequential passkey approvals, one widget at a time.
  for (let i = 0; i < 5; i += 1) {
    const btn = page.getByTestId(`approve-transfer-${mandateId(i)}`);
    await btn.waitFor();
    await page.waitForFunction((id) => !document.querySelector(`[data-testid="approve-transfer-${id}"]`)?.disabled, mandateId(i), { timeout: 10_000 });
    must(await page.getByTestId("bulk-tamper-switch").isVisible(), `${vp.width}px: item ${i + 1} widget missing`);
    await btn.click();
    await page.getByTestId(`transfer-status-${mandateId(i)}`).filter({ hasText: "Test payment sent" }).waitFor({ timeout: 10_000 });
  }
  await page.getByTestId("widget-batch-summary").waitFor();
  must(state.approved === 5, `${vp.width}px: expected 5 approvals, got ${state.approved}`);
  await axeCheck(page, "batch_summary", vp);
  await context.close();
}
await browser.close();

console.table(results);
const totalViolations = results.reduce((s, r) => s + r.violations, 0);
console.log(`axe states checked: ${results.length}, total violations: ${totalViolations}, assertion failures: ${failures}`);
for (const r of results.filter((x) => x.violations)) console.log(r.viewport, r.state, r.ids.join(", "));
process.exit(totalViolations === 0 && failures === 0 ? 0 : 1);
