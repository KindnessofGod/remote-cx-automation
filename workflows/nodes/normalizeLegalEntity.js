// ---------------------------------------------------------------------------
// normalizeLegalEntity.js — body of the "Normalize Legal Entity" n8n Code node
// ---------------------------------------------------------------------------
// Sits between the two upstream HTTP fetches this node depends on
// (`Fetch Legal Entity (Remote)`, `Fetch Countries (Remote)`) and `Render
// Letter`, on the auto_resolve branch only.
//
// WHY THIS NODE EXISTS — DEPLOY-BLOCKING, same finding as Render Letter's own
// throw (L-16, DRIFT-085/086). `Render Letter` needs `ctx.legalEntity`, and the
// deployed graph had no node that read /v1/legal-entities at all. Adding a bare
// HTTP fetch and wiring its response straight through is not enough, and is
// F-27 wearing different clothes:
//
//   GET /v1/companies/{id}/legal-entities returns `country_code` on the ISO
//   3166-1 ALPHA-3 axis ("USA", "CAN", "FRA", ... — confirmed against the live
//   Sandbox and Remote's own reference). Every other surface in src/ speaks
//   ALPHA-2, because RemoteClient#normalizeLegalEntity() (src/remote/
//   restClient.js) already converts for the Node execution path. No entity
//   this endpoint returns carries an address field, so Render Letter's
//   `legalEntity.address || legalEntity.country_code || ''` ALWAYS falls
//   through to country_code — wiring the raw response in would put "USA" in
//   front of a bank where the Node path prints "US".
//
// This node is that conversion, ported for the n8n path — mirroring
// RemoteClient's #normalizeLegalEntity + #countryIndex/#resolveAlpha2 exactly,
// because an n8n Code node has no imports and cannot share the class. It does
// NOT hardcode a 249-entry alpha3->alpha2 table (prime directive #4: do not
// invent a shape the API did not give us) — the mapping is read from the SAME
// `GET /v1/countries` registry the Node path reads, via the
// `Fetch Countries (Remote)` node upstream. An unrecognised or unreadable code
// fails CLOSED to null, never a guess — a missing value gets investigated, a
// wrong one gets acted on into a document going to a bank or an immigration
// officer.
//
// Both HTTP nodes hit https://gateway.remote-sandbox.com directly, so their
// output is Remote's raw envelope — `{data: {...}}` — never unwrapped the way
// RemoteClient#get() unwraps it. That unwrap is mirrored here rather than
// assumed away.
// ---------------------------------------------------------------------------

const ctx = $('Assign Routing').first().json;
const employment = ctx.employment ?? {};

const legalEntityBody = $('Fetch Legal Entity (Remote)').first().json;
const legalEntityData = legalEntityBody?.data ?? legalEntityBody ?? {};
const legalEntities = Array.isArray(legalEntityData?.legal_entities) ? legalEntityData.legal_entities : [];

const countriesBody = $('Fetch Countries (Remote)').first().json;
const countriesData = countriesBody?.data ?? countriesBody;
const countryRows = Array.isArray(countriesData) ? countriesData : (countriesData?.countries ?? []);

// Ported from RemoteClient#countryIndex(). Rows missing either code are
// skipped — a half-row cannot map, and a skip is the fail-closed direction.
const alpha3ToAlpha2 = new Map();
const namesByAlpha2 = new Map();
for (const row of countryRows) {
  const alpha2 = typeof row?.alpha_2_code === 'string' ? row.alpha_2_code.trim().toUpperCase() : null;
  const alpha3 = typeof row?.code === 'string' ? row.code.trim().toUpperCase() : null;
  if (alpha2 && /^[A-Z]{2}$/.test(alpha2) && alpha3 && /^[A-Z]{3}$/.test(alpha3)) {
    alpha3ToAlpha2.set(alpha3, alpha2);
    if (typeof row?.name === 'string') namesByAlpha2.set(alpha2, row.name);
  }
}

// Ported from RemoteClient#resolveAlpha2(). Already-alpha-2 passes through
// unconverted, so this is safe whether the entity row arrived on either axis.
function resolveAlpha2(countryCode) {
  if (typeof countryCode !== 'string') return null;
  const code = countryCode.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(code)) return code;
  if (!/^[A-Z]{3}$/.test(code)) return null; // not a country code at all
  return alpha3ToAlpha2.get(code) ?? null; // unknown country -> fail closed
}

// The entity this specific employment is engaged by — never the first row, and
// never "the company's default entity". A wrong match here names the wrong
// employer on a document going to a bank.
const match = legalEntities.find((e) => e.id === employment.legal_entity_id) ?? null;

let legalEntity = null;
if (match) {
  const original = typeof match.country_code === 'string' ? match.country_code.trim().toUpperCase() : null;
  const alpha2 = resolveAlpha2(match.country_code);
  legalEntity = Object.assign({}, match, {
    country_code: alpha2,
    country_code_alpha3: original && /^[A-Z]{3}$/.test(original) ? original : null,
    country_name: match.country_name ?? (alpha2 ? (namesByAlpha2.get(alpha2) ?? null) : null),
  });
}

// legalEntity stays null when no row matched — Render Letter already throws on
// a missing/nameless legal entity rather than guessing. That refusal is
// correct and this node must not paper over it.
return [{ json: Object.assign({}, ctx, { legalEntity }) }];
