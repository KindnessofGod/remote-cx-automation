#!/usr/bin/env node
/**
 * seed-uc02-demo-expenses.mjs — take stock of, and try to restock, the live
 * Sandbox expenses UC-02's demo consumes.
 *
 * ⚠ THIS TOUCHES THE REAL REMOTE SANDBOX. Every read below goes to
 * `REMOTE_BASE_URL` (default `https://gateway.remote-sandbox.com`) with the
 * token in `REMOTE_API_TOKEN`. Sandbox only — never a production token, never
 * real customer data (CLAUDE.md §3 directive 5). The default mode is READ-ONLY;
 * the only request that is not a GET lives behind `--provision`, and even that
 * one is written so a refusal leaves nothing behind (see §3).
 *
 * USAGE
 *   NODE_USE_ENV_PROXY=1 node scripts/seed-uc02-demo-expenses.mjs
 *   NODE_USE_ENV_PROXY=1 node scripts/seed-uc02-demo-expenses.mjs --llm
 *   NODE_USE_ENV_PROXY=1 node scripts/seed-uc02-demo-expenses.mjs --provision
 *   NODE_USE_ENV_PROXY=1 node scripts/seed-uc02-demo-expenses.mjs --provision \
 *     --employment 2f7f8210-91fc-47db-803c-77a1cc625781
 *
 * `NODE_USE_ENV_PROXY=1` is required in this container: Node's global fetch
 * ignores HTTPS_PROXY, and without it every call fails with a 403 that reads
 * like an allowlist problem even though the host is allowlisted (CLAUDE.md §6).
 *
 * ---------------------------------------------------------------------------
 * §1 — WHY A RESTOCK SCRIPT EXISTS AT ALL
 * ---------------------------------------------------------------------------
 * UC-02 is the 🟢 tier, and its `auto_approve` branch is the only place in this
 * project where the green tier can be shown actually resolving something. That
 * branch fires a REAL `PATCH /v1/expenses/:id` (`status: "approved"`), so
 * demonstrating it CONSUMES the expense it approves: gate 5 refuses the same
 * record ever after with `expense_not_pending`, correctly. The demo asset is
 * therefore consumable, and something has to be able to put it back.
 *
 * ---------------------------------------------------------------------------
 * §2 — WHAT THE DEMO NEEDS, AND WHY IT IS NARROWER THAN "A PENDING EXPENSE"
 * ---------------------------------------------------------------------------
 * Three independent conditions have to line up before `auto_approve` is even
 * reachable, and only the first is obvious:
 *
 *   1. `status: "pending"`            — gate 5 (`APPROVABLE_EXPENSE_STATUSES`).
 *   2. `converted_currency` == USD    — `POLICY_CAP_CURRENCY` is "USD" and gate
 *                                       12 refuses to compare a cap against a
 *                                       different currency. Every EUR/CAD/SGD/
 *                                       GBP expense stops at
 *                                       `policy_cap_currency_mismatch`.
 *   3. a category IN the cap corpus,  — `POLICY_CAPS` covers 8 of the ~32-36
 *      with the amount UNDER its cap    selectable categories the live account
 *                                       returns. Everything else is
 *                                       `policy_cap_unknown` (the deliberate
 *                                       F-12 fail-closed contract), and an
 *                                       over-cap amount is `over_policy_cap`.
 *
 * So "how many pending USD expenses are there" is the WRONG inventory question,
 * and answering it is how a supply shortage stays invisible. This script asks
 * the right one instead: it runs each live candidate through the REAL
 * classifier and the REAL gates and reports which DEMO BEAT each one serves.
 * Nothing here re-implements a rule — `classifyExpense`, `evaluate`,
 * `getPolicyCap` and `isCategoryFileable` are imported from `src/uc02/`, so if
 * a cap or a gate changes, this inventory changes with it.
 *
 * Note which beats are CONSUMING: only `auto_approve` writes. A run that ends
 * `over_policy_cap` or `policy_cap_unknown` leaves the expense pending, so
 * those two beats are re-demonstrable indefinitely on the same record. That
 * asymmetry is why the auto-approve supply is the only one that ever runs out.
 *
 * ---------------------------------------------------------------------------
 * §3 — WHY `--provision` ASKS FOR `status: "pending"` AND ACCEPTS NO SUBSTITUTE
 * ---------------------------------------------------------------------------
 * Verified against Remote's own OpenAPI (`developer.remote.com/reference/
 * post_v1_expenses.md`, `post_v1_employee_expenses.md`) and then live, because
 * this repo has been burned reading a doc TITLE as a path (UC-06's
 * `/v1/company-payroll-runs`, which never existed):
 *
 *   POST /v1/expenses           security: CustomerAPIToken / OAuth2AuthorizationCode
 *                               summary:  "Creates an **approved** expense"
 *   POST /v1/employee/expenses  security: OAuth2Assertion  (an EMPLOYEE session)
 *
 * The company token this service holds can call only the first, and the first
 * creates approved expenses. Probed live 2026-08-19, same token, same shell:
 *
 *   POST  /v1/expenses            {…}                    -> 201, status "approved"
 *   POST  /v1/expenses            {…, status:"pending"}  -> 422 {"status":["only approved expenses can be created"]}
 *   PATCH /v1/expenses/:id        {status:"pending"}     -> 422 parameter_value_invalid
 *   PUT   /v1/expenses/:id        {status:"pending"}     -> 422 parameter_value_invalid
 *   POST  /v1/employee/expenses   {…}                    -> 403 "Forbidden, invalid role for this endpoint"
 *   DELETE /v1/expenses/:id                              -> 404 (no delete route)
 *
 * That is the same shape as the expense-CATEGORIES lesson already written up in
 * `docs/verification/uc02-expense-endpoints.md`: the `/v1/employee/` half of a
 * resource is gated by `OAuth2Assertion`, which an unattended system actor
 * structurally cannot hold. No credential change fixes it.
 *
 * Hence the deliberate design of `--provision`: it sends `status: "pending"` —
 * the ONLY shape the demo can use — and treats anything else as a refusal.
 *   • If Remote ever permits it, the request succeeds and the restock works.
 *   • Today it 422s, which creates NOTHING. So a failed restock leaves no junk
 *     in a Sandbox that has no DELETE route to clean it up with.
 * Omitting `status` would "succeed" every run while producing an approved
 * record the demo cannot use and nobody can remove — a restock script that
 * quietly makes the problem worse.
 *
 * ---------------------------------------------------------------------------
 * §4 — IF THE SUPPLY IS GONE
 * ---------------------------------------------------------------------------
 * Pending expenses in this Sandbox come from Remote's own seed data and from
 * employees submitting through Remote's product. Neither is reachable from
 * here. When this script reports zero auto-approve candidates, the options are:
 * a human submitting an expense in the Sandbox UI as the employee, a Sandbox
 * reseed, or demonstrating the beat on the mock (`npm run portal` /
 * `npm run uc02-api`, whose fixtures include an auto-approve case and whose
 * `<id>~fresh-<token>` minting makes it repeatable). Report the shortage;
 * never paper over it by widening `POLICY_CAPS`, which would mean inventing
 * policy on the path to a real reimbursement write.
 */

import "dotenv/config";   // the repo keeps credentials in .env; without this this
                          // script fails with a credentials-shaped error on a
                          // machine that HAS them — see verify-deployed-nodes.mjs
import { classifyExpense, classifyExpenseRuleBased } from "../src/uc02/expenseClassifier.js";
import { evaluate } from "../src/uc02/policyEngine.js";
import { getPolicyCap, POLICY_CAP_CURRENCY } from "../src/uc02/policyCaps.js";
import { isCategoryFileable } from "../src/uc02/expenseCategories.js";

const BASE = process.env.REMOTE_BASE_URL || "https://gateway.remote-sandbox.com";
const TOKEN = process.env.REMOTE_API_TOKEN;

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag) => {
  const i = argv.indexOf(flag);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
};

const USE_LLM = has("--llm");
const PROVISION = has("--provision");
const EMPLOYMENT_OVERRIDE = valueOf("--employment");

if (!TOKEN) {
  console.error("REMOTE_API_TOKEN is not set — this script only talks to the real Sandbox.");
  process.exit(1);
}

const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: "application/json",
  "Content-Type": "application/json",
};

/** One request. Returns {status, body} — a non-2xx body is itself the finding. */
async function call(method, pathAndQuery, payload) {
  const res = await fetch(`${BASE}${pathAndQuery}`, {
    method,
    headers: HEADERS,
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, ok: res.ok, body };
}

/** Every expense, following `total_pages` rather than assuming one page. */
async function listAllExpenses() {
  const rows = [];
  let page = 1;
  for (;;) {
    const { status, body } = await call("GET", `/v1/expenses?page=${page}&page_size=100`);
    if (status !== 200) throw new Error(`GET /v1/expenses failed: ${status} ${JSON.stringify(body).slice(0, 200)}`);
    rows.push(...(body?.data?.expenses ?? []));
    const totalPages = body?.data?.total_pages ?? 1;
    if (page >= totalPages) return rows;
    page += 1;
  }
}

/** Selectable + parent category rows for one employment, memoised per run. */
const categoryCache = new Map();
async function categoriesFor(employmentId) {
  if (categoryCache.has(employmentId)) return categoryCache.get(employmentId);
  const { status, body } = await call("GET", `/v1/expenses/categories?employment_id=${employmentId}`);
  // A 404/422 here is a fact about THIS employment, not a reason to stop: the
  // survey still reports the row, with an empty list, and the category gate
  // will say `category_unverified` — which is the honest answer.
  const list = status === 200 && Array.isArray(body?.data) ? body.data : [];
  categoryCache.set(employmentId, list);
  return list;
}

const money = (cents) => `$${(cents / 100).toFixed(2)}`;

/**
 * The demo beat one live expense currently serves — decided by the REAL gates,
 * not by re-reading the cap table here.
 *
 * Identity is deliberately passed as verified and the employment as active: the
 * question is "which POLICY outcome does this record produce", and a demo
 * always drives it with the matching session. Gates 0-4 are about the caller,
 * not about the supply.
 */
async function beatFor(expense) {
  const categoryList = await categoriesFor(expense.employment_id);
  const classification = USE_LLM
    ? await classifyExpense({ expense, categoryList })
    : classifyExpenseRuleBased({ expense, categoryList });
  const result = evaluate({
    identityVerified: true,
    employmentActive: true,
    expense,
    expenseOwned: true,
    duplicate: false,
    categoryValid: isCategoryFileable(categoryList, classification.categoryId),
    classification,
    policyCap: getPolicyCap(classification.categoryId),
  });
  return { classification, result, cap: getPolicyCap(classification.categoryId) };
}

/**
 * The three beats a UC-02 demo wants, and what each one needs from the supply.
 * `consuming` is the property that makes the auto-approve row special.
 */
const BEATS = [
  { reason: "all_gates_passed", label: "auto_approve   (the 🟢 success)", consuming: true },
  { reason: "over_policy_cap", label: "over_policy_cap (a sourced cap refuses)", consuming: false },
  { reason: "policy_cap_unknown", label: "policy_cap_unknown (F-12 fails closed)", consuming: false },
];

/** An active employment whose billing currency is the cap corpus's currency. */
async function pickUsEmployment(expenses) {
  if (EMPLOYMENT_OVERRIDE) return EMPLOYMENT_OVERRIDE;
  // Derived from the expense corpus rather than from `country`, because what
  // gate 12 actually needs is the COMPANY BILLING currency, and the only
  // first-party evidence of that is an existing expense's `converted_currency`.
  const byEmployment = new Map();
  for (const e of expenses) {
    if (e?.converted_currency?.code === POLICY_CAP_CURRENCY && e.employment_id) {
      byEmployment.set(e.employment_id, (byEmployment.get(e.employment_id) ?? 0) + 1);
    }
  }
  const [best] = [...byEmployment.entries()].sort((a, b) => b[1] - a[1]);
  return best ? best[0] : null;
}

/**
 * The three records `--provision` would create. Titles are chosen to classify
 * into the intended category, amounts to sit on the intended side of its cap.
 * `expense_category_slug` is resolved live (never hard-coded — slugs are
 * per-account uuids) and also lands on the record as `expense_category.title`,
 * which the classifier reads as a labelled hint.
 */
const PROVISION_SPECS = [
  {
    beat: "auto_approve",
    code: "work_meals_and_entertainment.internal_meals_and_entertainment",
    title: "Team lunch with the engineering team",
    amount: 32754, // $327.54 — under the $500.00 internal-meals cap
  },
  {
    beat: "over_policy_cap",
    code: "work_meals_and_entertainment.internal_meals_and_entertainment",
    title: "Team offsite dinner for the whole department",
    amount: 78412, // $784.12 — over the same $500.00 cap
  },
  {
    beat: "policy_cap_unknown",
    code: "relocation_and_mobility.relocation_and_mobility",
    title: "Relocation shipping for household goods",
    amount: 41900, // any amount: the corpus defines no cap for this category
  },
];

/** Yesterday, ISO — `expense_date` "must be in the past" per the OpenAPI. */
function yesterdayIso() {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

async function provision(employmentId) {
  console.log(`\n── PROVISION ── creating pending ${POLICY_CAP_CURRENCY} expenses on ${employmentId}`);
  const categoryList = await categoriesFor(employmentId);
  const created = [];
  for (const spec of PROVISION_SPECS) {
    const category = categoryList.find((c) => c.code === spec.code && c.is_selectable === true);
    if (!category) {
      console.log(`  ✗ ${spec.beat}: category ${spec.code} is not selectable for this employment — skipped`);
      continue;
    }
    const payload = {
      employment_id: employmentId,
      title: spec.title,
      amount: spec.amount,
      currency: POLICY_CAP_CURRENCY,
      tax_amount: 0,
      expense_date: yesterdayIso(),
      expense_category_slug: category.slug,
      // Gate 8 wants a receipt row carrying id/name/type/inserted_at. The
      // content is a placeholder text file: the demo needs the ROW to exist,
      // and a fabricated image would be pretending to evidence a spend.
      receipt: {
        name: `uc02-demo-${spec.beat}.txt`,
        content: Buffer.from(`UC-02 demo receipt — ${spec.title} — ${money(spec.amount)} USD`).toString("base64"),
      },
      // §3: the demo can only use a PENDING expense, so that is what we ask
      // for. A refusal here creates nothing, which is the point.
      status: "pending",
    };
    const { status, ok, body } = await call("POST", "/v1/expenses", payload);
    const expense = body?.data?.expense ?? null;
    if (ok && expense?.status === "pending") {
      console.log(`  ✓ ${spec.beat}: ${expense.id} ${money(expense.amount)} ${expense.currency?.code} (pending)`);
      created.push(expense);
      continue;
    }
    if (ok) {
      // Should be unreachable while `status:"pending"` is sent, and is kept
      // because a silent status downgrade is exactly the failure this script
      // must never hide.
      console.log(`  ! ${spec.beat}: created ${expense?.id} but status is "${expense?.status}", NOT pending — unusable for the demo`);
      continue;
    }
    console.log(`  ✗ ${spec.beat}: refused ${status} ${JSON.stringify(body).slice(0, 200)}`);
  }
  if (created.length === 0) {
    console.log(
      "\n  Nothing was created, and nothing was left behind.\n" +
        "  A company API token cannot create a pending expense: POST /v1/expenses\n" +
        "  creates APPROVED expenses, and POST /v1/employee/expenses needs an\n" +
        "  employee session (OAuth2Assertion) this service structurally cannot hold.\n" +
        "  See §3/§4 in this file's header for the verified probes and the options."
    );
  }
  return created;
}

async function main() {
  console.log(`UC-02 demo-expense stock — ${BASE}`);
  console.log(`Cap corpus currency: ${POLICY_CAP_CURRENCY} · classifier: ${USE_LLM ? "LLM (real)" : "rule-based"}`);

  const expenses = await listAllExpenses();
  const byStatus = new Map();
  for (const e of expenses) {
    const key = `${e.status}/${e.currency?.code ?? "?"}`;
    byStatus.set(key, (byStatus.get(key) ?? 0) + 1);
  }
  console.log(`\n── INVENTORY ── ${expenses.length} expenses`);
  for (const [key, n] of [...byStatus.entries()].sort()) console.log(`  ${String(n).padStart(4)}  ${key}`);

  const employmentId = await pickUsEmployment(expenses);
  if (PROVISION) {
    if (!employmentId) {
      console.log(`\nNo employment bills in ${POLICY_CAP_CURRENCY} — cannot provision. Pass --employment <id>.`);
    } else {
      await provision(employmentId);
    }
  }

  // Re-listed AFTER provisioning so the report describes the Sandbox as it now
  // stands, not as it stood before the writes.
  const finalExpenses = PROVISION ? await listAllExpenses() : expenses;
  const candidates = finalExpenses.filter(
    (e) => e.status === "pending" && e.converted_currency?.code === POLICY_CAP_CURRENCY
  );

  console.log(
    `\n── CANDIDATES ── ${candidates.length} pending expense(s) billed in ${POLICY_CAP_CURRENCY}` +
      ` (the only ones gate 12 will compare against a cap)`
  );

  const beats = new Map(BEATS.map((b) => [b.reason, []]));
  const other = [];
  for (const expense of candidates) {
    const { classification, result, cap } = await beatFor(expense);
    const row = {
      id: expense.id,
      title: expense.title,
      amount: expense.converted_amount,
      categoryId: classification.categoryId,
      source: classification.source,
      cap,
      decision: result.decision,
      reason: result.reason,
    };
    (beats.has(result.reason) ? beats.get(result.reason) : other).push(row);
  }

  for (const beat of BEATS) {
    const rows = beats.get(beat.reason);
    const note = beat.consuming
      ? "CONSUMED by each demo run — a successful approval spends the record"
      : "re-runnable on the same record — this beat writes nothing";
    console.log(`\n  ${rows.length === 0 ? "✗" : "✓"} ${beat.label}: ${rows.length} available  (${note})`);
    for (const r of rows) {
      console.log(
        `      ${r.id}  ${money(r.amount).padStart(10)}  ${JSON.stringify(r.title)}` +
          `\n        -> ${r.categoryId ?? "no category"} [${r.source}] cap=${r.cap === null ? "none" : money(r.cap)}`
      );
    }
  }
  if (other.length > 0) {
    console.log(`\n  · other outcomes: ${other.length}`);
    for (const r of other) console.log(`      ${r.id}  ${r.decision}/${r.reason}  ${JSON.stringify(r.title)}`);
  }

  const autoApprove = beats.get("all_gates_passed").length;
  console.log(
    `\n── VERDICT ── the 🟢 auto_approve beat has ${autoApprove} live candidate(s).` +
      (autoApprove === 0
        ? "\n  The live green-tier success path CANNOT currently be demonstrated." +
          "\n  See §4 in this file's header for what actually restocks it."
        : `\n  Each demonstration spends one; ${autoApprove} run(s) remain before this is exhausted.`)
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
