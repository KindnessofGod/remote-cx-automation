#!/usr/bin/env node
/**
 * make-demo-receipt.mjs — render the SYNTHETIC receipt UC-02's [E-1] demo uses.
 *
 * WHY THIS IS A SCRIPT AND NOT A FILE SOMEBODY DROPPED IN
 *
 * Prime directive #5: no real customer data. The acceptance contract says the
 * same thing in more detail for this specific artifact — "a photographed
 * third-party receipt carries a real vendor, a real card fragment and a real
 * person's purchase". So the demo receipt must be synthetic, and the safest way
 * to guarantee that is to GENERATE it from values in this file, where anyone can
 * read exactly what is on it and see that no part of it came from a real
 * transaction.
 *
 * Everything below is invented. "Café Verrocchio" is not a business; the card
 * fragment is literal `0000`; the VAT number is a documented example value.
 *
 * The receipt is deliberately ORDINARY-LOOKING — a till roll with a service
 * charge and a VAT line — because a receipt that is trivially machine-readable
 * proves nothing about reading real ones. It is rendered to PDF through the same
 * Playwright path `src/pdf/` already uses, so no new dependency arrives for it.
 *
 * USAGE
 *   node scripts/make-demo-receipt.mjs                 # the matching receipt
 *   node scripts/make-demo-receipt.mjs --variant wrong-total
 *   node scripts/make-demo-receipt.mjs --variant wrong-date
 *
 * The variants exist so the demo can show gate 8b REFUSING as well as passing.
 * A gate that has only ever been seen agreeing has not been seen working.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderPdfFromHtml } from "../src/pdf/render.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, "..", "qa", "fixtures", "receipts");

/**
 * The one place the demo's numbers live. `total` is in MINOR UNITS, matching
 * the ×100 discipline every money value in this system uses — so the fixture
 * cannot drift from the claim it is supposed to match by a rounding accident.
 */
const BASE = {
  merchant: "Café Verrocchio",
  addressLines: ["12 Innisfree Lane", "Springfield, IL 62704"],
  taxLabel: "Sales tax",
  vat: "TAX ID 00-0000000",
  date: "2026-08-12",
  time: "13:42",
  items: [
    { qty: 3, name: "Set lunch", each: 1450 },
    { qty: 3, name: "Sparkling water", each: 320 },
    { qty: 1, name: "Espresso", each: 280 },
  ],
  servicePct: 12.5,
  vatPct: 9,
  card: "VISA ····0000",
};

const VARIANTS = {
  matching: {},
  // Same receipt, a total that contradicts the claim — the headline refusal.
  "wrong-total": { items: [{ qty: 1, name: "Espresso", each: 280 }], servicePct: 0 },
  // Right money, wrong day.
  "wrong-date": { date: "2026-06-30" },
  // ---------------------------------------------------------------------
  // A SECOND MATCHING RECEIPT, for the ZENDESK path rather than the portal.
  //
  // The portal can demonstrate gate 8b passing because the portal chooses
  // its own claim. The Zendesk path cannot: the ticket names a REAL Remote
  // expense, and gate 5 (`expense_not_pending`) means only a PENDING one is
  // ever reached — so the receipt has to be built to fit an expense that
  // already exists rather than the other way round.
  //
  // Tuned to the Sandbox's `Standing Desk` claim: USD 60036 minor units,
  // 2026-04-29, employment 9ac2c03c (David W Jones, USA, active). Those are
  // the only three facts receiptContradictions() compares — currency, total
  // and date. The merchant is NOT compared and is invented freely, which is
  // the same reason the expense record has no merchant field to compare it
  // against.
  //
  // IT WILL STOP MATCHING WHEN THE SANDBOX IS RESEEDED, and that is expected
  // rather than a defect: it degrades into another contradiction fixture,
  // which is a legitimate thing for it to be. Re-tune it by listing pending
  // expenses and copying the amount and date of one of them. The total is
  // still COMPUTED from the line item rather than asserted, so this variant
  // cannot claim a figure its own arithmetic does not produce.
  // ---------------------------------------------------------------------
  "matching-tech": {
    merchant: "Northgate Office Interiors",
    addressLines: ["48 Merchant Row", "Springfield, IL 62704"],
    date: "2026-04-29",
    time: "10:18",
    items: [{ qty: 1, name: "Sit-stand desk, electric, 160cm", each: 60036 }],
    servicePct: 0,
    vatPct: 0,
  },
};

function computeTotals(r) {
  const net = r.items.reduce((sum, i) => sum + i.qty * i.each, 0);
  const service = Math.round((net * r.servicePct) / 100);
  const vat = Math.round(((net + service) * r.vatPct) / 100);
  return { net, service, vat, total: net + service + vat };
}

// USD, because the policy-cap corpus is denominated in USD
// (POLICY_CAP_CURRENCY). A GBP receipt could never reach the cap gate — it
// would stop earlier at `policy_cap_currency_mismatch` — so a demo built on
// one can only ever show a refusal.
const money = (minor) => `$${(minor / 100).toFixed(2)}`;

function receiptHtml(r, totals) {
  const rows = r.items
    .map(
      (i) =>
        `<tr><td>${i.qty} ×</td><td>${i.name}</td><td class="r">${money(i.qty * i.each)}</td></tr>`
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: 80mm 200mm; margin: 6mm 5mm; }
    body { font-family: "DejaVu Sans Mono", "Courier New", monospace; font-size: 11px; color:#111; }
    h1 { font-size: 15px; text-align:center; margin:0 0 2px; letter-spacing:1px; }
    .c { text-align:center; } .r { text-align:right; }
    .muted { color:#555; font-size:10px; }
    table { width:100%; border-collapse:collapse; margin:8px 0; }
    td { padding:1px 0; vertical-align:top; }
    .rule { border-top:1px dashed #999; margin:6px 0; }
    .total td { font-weight:bold; font-size:13px; padding-top:4px; }
    .synthetic { margin-top:10px; font-size:8px; color:#777; text-align:center; line-height:1.4; }
  </style></head><body>
    <h1>${r.merchant}</h1>
    <div class="c muted">${r.addressLines.join("<br>")}</div>
    <div class="c muted">${r.vat}</div>
    <div class="rule"></div>
    <div>${r.date} &nbsp; ${r.time}</div>
    <table>${rows}</table>
    <div class="rule"></div>
    <table>
      <tr><td>Subtotal</td><td class="r">${money(totals.net)}</td></tr>
      ${totals.service ? `<tr><td>Service ${r.servicePct}%</td><td class="r">${money(totals.service)}</td></tr>` : ""}
      <tr><td>${r.taxLabel} ${r.vatPct}%</td><td class="r">${money(totals.vat)}</td></tr>
      <tr class="total"><td>TOTAL</td><td class="r">${money(totals.total)}</td></tr>
    </table>
    <div class="rule"></div>
    <div class="c muted">${r.card}</div>
    <div class="c muted">Thank you — please retain for your records</div>
    <div class="synthetic">SYNTHETIC DOCUMENT — generated by
      scripts/make-demo-receipt.mjs for testing.<br>
      No such business, transaction or cardholder exists.</div>
  </body></html>`;
}

const variant = (() => {
  const i = process.argv.indexOf("--variant");
  return i === -1 ? "matching" : process.argv[i + 1];
})();

if (!(variant in VARIANTS)) {
  console.error(`Unknown variant ${JSON.stringify(variant)}. Known: ${Object.keys(VARIANTS).join(", ")}`);
  process.exit(2);
}

/**
 * Re-tune a receipt to a claim that exists TODAY.
 *
 * WHY THIS IS A FLAG AND NOT ANOTHER VARIANT. The Zendesk path can only
 * demonstrate the receipt gate against a claim that is genuinely PENDING in
 * the Sandbox (gate 5 stops an already-decided one before gate 8b is reached),
 * and the Sandbox is periodically reseeded — so every hard-coded fixture that
 * matched a real expense eventually stops matching one. Adding a variant per
 * expense would mean a growing list of files that were each true on one day.
 *
 * `--total` is in MINOR UNITS, like everything else that touches money here,
 * and it becomes the price of a SINGLE LINE ITEM with no service charge and no
 * tax. So the printed total is still COMPUTED by the same arithmetic as every
 * other variant rather than asserted — a receipt that claimed a figure its own
 * lines did not add up to would be a worse fixture than no fixture.
 *
 *   node scripts/make-demo-receipt.mjs --total 25805 --date 2026-05-15 \
 *     --merchant "Lakeside Conference Center" --item "Design conference, 1 seat"
 */
function flag(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
}

const totalOverride = flag("total");
const tuned = {};
if (totalOverride !== null) {
  const minor = Number(totalOverride);
  if (!Number.isInteger(minor) || minor <= 0) {
    console.error(`--total must be a positive whole number of MINOR units (got ${JSON.stringify(totalOverride)})`);
    process.exit(2);
  }
  tuned.items = [{ qty: 1, name: flag("item") ?? "Item", each: minor }];
  tuned.servicePct = 0;
  tuned.vatPct = 0;
}
if (flag("date")) tuned.date = flag("date");
if (flag("merchant")) tuned.merchant = flag("merchant");
if (flag("merchant")) tuned.addressLines = ["1 Commerce Street", "Springfield, IL 62704"];

const receipt = { ...BASE, ...VARIANTS[variant], ...tuned };
const totals = computeTotals(receipt);
const pdf = await renderPdfFromHtml(receiptHtml(receipt, totals));

mkdirSync(OUT_DIR, { recursive: true });
// A tuned receipt gets its own name so it can never be mistaken for one of the
// committed variants, whose numbers are fixed and documented.
const slug = flag("out") ?? (Object.keys(tuned).length ? `tuned-${receipt.date}-${totals.total}` : variant);
const file = path.join(OUT_DIR, `demo-receipt-${slug}.pdf`);
writeFileSync(file, pdf);

console.log(`  ${slug}: ${file}`);
console.log(`  merchant ${receipt.merchant} · date ${receipt.date} · TOTAL ${money(totals.total)} (${totals.total} minor units, USD)`);
console.log("  Every value above is invented — see this script's header.");
