// ---------------------------------------------------------------------------
// approverEntitlement.js  —  Is this authenticated human ALLOWED to hold that role?
// ---------------------------------------------------------------------------
// WHY THIS EXISTS (docs/APPROVAL-ROUTING.md §1.3)
// src/shared/approverAuth.js closed half of prime directive #3 for approvals:
// WHO the approver is now comes from a verified signature instead of a header.
// The other half stayed open, and it is the half that decides what they may
// do. src/uc06/server.js and src/uc09/server.js both built their policy call as
//
//     { role: body.role, approver: identity.approver }
//        ^ the REQUEST BODY        ^ the verified ZAF token
//
// and src/review/zafAuth.js contains no role claim at all — there is nothing in
// the token to read one from. So the four-eyes controls held as built (
// Math.max(2, …) and isSameApprover() genuinely require two different PEOPLE)
// while nothing anywhere required either of them to be an ENTITLED person. Two
// support agents could clear a payroll amendment as customer_admin +
// payroll_specialist, and on UC-04 any identity that could reach the approve
// route issued a work authorization. UC-04 and UC-05 had no role concept at
// all: `approver` merely had to be a non-empty string.
//
// This module is the missing predicate, in ONE place for all four.
//
// ---------------------------------------------------------------------------
// THREE PROPERTIES IT IS BUILT AROUND, AND THE TESTS THAT PIN THEM
// ---------------------------------------------------------------------------
// 1. IT IS CONSULTED LAST. Each policy calls it AFTER every refusal it already
//    had — not found, wrong action, not actionable, role already filled, same
//    person in two slots. A gate that runs before those could refuse for the
//    wrong reason and hide the real one.
// 2. IT CAN ONLY EVER REFUSE. `check()` returns either a refusal object or
//    `null` ("I have nothing to say"). There is no return value that means
//    "approved", so no call site can be written that lets this module satisfy a
//    requirement, fill a slot, or lower a floor. That is a structural property,
//    not a convention: see test/approverEntitlement.test.js's grid, which
//    asserts it over every combination and is mutation-verified.
// 3. IT IS ADDITIVE. No existing gate, floor or isSameApprover() check is
//    touched or reordered by it.
//
// ---------------------------------------------------------------------------
// WHERE ENTITLEMENT COMES FROM, AND WHY IT IS A CONFIGURED ROSTER
// ---------------------------------------------------------------------------
// Three sources were weighed. The roster won on one decisive property: it is
// the only one of the three that can be non-empty on the day it ships, and an
// entitlement source with no entries is a gate that refuses everything while
// looking exactly like a gate that is working.
//
//   A configured roster (CHOSEN). `APPROVER_ROLES` maps an approver identity to
//     the roles they may fill. No network on the approval path, hermetic to
//     test, and it can be populated in one environment variable — so the
//     POSITIVE test ("an entitled specialist MUST still be able to approve")
//     is runnable at every layer, which is the whole difference between a
//     working gate and a dead one.
//
//   Zendesk group membership (REJECTED FOR NOW, and it is the right end state).
//     The entitlement already exists there as an operational fact:
//     src/shared/escalationRouting.js emits `queue_mobility_specialists`,
//     `queue_payroll_ops`, `queue_hr_ops` … and scripts/setup-zendesk-groups.mjs
//     creates the matching groups. It loses TODAY on evidence, not on design:
//     docs/APPROVAL-ROUTING.md §2 records that those groups DO NOT EXIST in the
//     account yet and that the OAuth client has no scope for GET /api/v2/groups.
//     A source that cannot return a single membership is the empty store this
//     module must not be. It also puts a network read on the approval path,
//     where both failure modes are bad — an unreachable Zendesk must not
//     entitle anyone, and must not wedge every approval either.
//     THE SEAM FOR IT IS ALREADY HERE: `createEntitlementChecker({ grants })`
//     takes an already-resolved grant map, and resolving it is the caller's
//     (async, cached, failure-handling) problem. A Zendesk-backed source
//     resolves memberships in the server/CLI layer and hands the resolved map
//     in; the policy call stays synchronous and pure. See RESOLVING FROM
//     ZENDESK LATER at the bottom of this file.
//
//   A Supabase table (REJECTED). Same semantics as the roster with more
//     operational cost: a table to provision, a migration to document, a read
//     on the approval path — and it would ship empty for exactly the same
//     reason the Zendesk source does. It buys nothing the env var does not,
//     until entitlement needs to be edited by people who cannot deploy.
//
// ---------------------------------------------------------------------------
// THE DEFAULT, AND WHY IT KEYS OFF THE SAME THING SIGNED IDENTITY DOES
// ---------------------------------------------------------------------------
// Commit 39a7e33 answered this exact dilemma for finding F-20 and the answer
// transfers unchanged. Fail closed everywhere and a fresh clone stops working,
// including every seeded demo; fail open and you have the defect again with
// more code in front of it. So enforcement keys off the SAME discriminator
// signedIdentityRequired() uses — a durable store attached, or (at the
// deployment layer) a publicly reachable URL:
//
//   durable store attached  ->  entitlement REQUIRED
//   seeded in-memory demo   ->  not enforced, so `npm run uc06-api` on a fresh
//                               clone still approves, and every documented curl
//                               in docs/WALKTHROUGH.md still works
//
// One rule, not two. A second, weaker rule for entitlement would be the first
// one to fall behind — and entitlement is meaningless without a verified
// identity anyway: a role attached to an unverified name is a claim about a
// claim.
//
// REQUIRED-BUT-UNCONFIGURED REFUSES, LOUDLY AND BY ITS OWN NAME. That is
// deliberately the same shape as a persistent deployment with no ZAF verifier
// provisioned (src/shared/approverAuth.js's "loud failure on purpose"): a
// refused approval is recoverable in a minute by whoever is deploying; an
// approval by someone with no entitlement is not recoverable at all. The code
// is `approver_entitlement_not_configured` and NOT `approver_not_entitled`,
// because those two are different afternoons of work — one is fixed by setting
// APPROVER_ROLES, the other by adding a person to it — and this repo has
// already paid for conflating "blocks everything" with "correctly cautious".
// ---------------------------------------------------------------------------

import { canonicalizeApprover, isSameApprover } from "../shared/approverIdentity.js";

/**
 * Every role slot this system will ever be asked about, per use case.
 *
 * UC-06's and UC-09's entries MUST match those policies' own `ROLES` sets, and
 * test/approverEntitlement.test.js asserts that rather than trusting it: a role
 * that exists in the policy and not here would be refused for being unknown,
 * which is a dead gate wearing a plausible reason.
 *
 * UC-04 and UC-05 have no role parameter — one slot, one approver — so the
 * role is NOMINAL: named here, supplied by the policy, never read off a
 * request. That is the point. "Is this person entitled to approve this use
 * case" is the same question whether or not the request happens to carry a
 * `role` field, and answering it only where a field exists would leave the two
 * single-approver use cases exactly as open as they are today.
 */
export const USE_CASE_ROLES = Object.freeze({
  // UC-01 SHARES `hr_ops` WITH UC-05 RATHER THAN A ROLE OF ITS OWN. UC-01 has
  // no role picker in the sidebar (qa/contracts/UC-01-acceptance.md §"Who
  // approves" — "Any HR Ops support specialist... the one use case with no
  // named specialist role") and its own escalation route
  // (src/shared/escalationRouting.js) names the same "HR Ops" group UC-05
  // does. A NEW token here would mean an operator who rostered HR Ops for
  // UC-05 finds UC-01 refusing those same people — the exact "gate that
  // refuses the right people" failure this module's header exists to avoid.
  // K10 (qa/HUMAN-DECISIONS-REQUIRED.md, 2026-08-23).
  "UC-01": Object.freeze(["hr_ops"]),
  // UC-03 IS 🟢 AND STILL HAS ONE ROLE, WHICH IS NOT A CONTRADICTION. Its
  // router auto-resolves informational travel questions with nobody involved.
  // The single thing it cannot finish alone is the FORMAL TRAVEL LETTER: a
  // document on the legal entity's letterhead, carrying base compensation,
  // written for a destination authority. `policyEngine.js`'s gate 11 stops
  // there for exactly one stated reason — "a letter is never sent until a
  // specialist has read it and signed it off". That specialist is Travel &
  // Mobility Support (src/shared/escalationRouting.js's UC-03 row, whose own
  // `source` cites the held letter as the reason the team owns this use case).
  // Nothing else UC-03 produces is signable, and the policy refuses the rest by
  // name rather than by omission.
  "UC-03": Object.freeze(["travel_support_specialist"]),
  "UC-04": Object.freeze(["mobility_specialist"]),
  "UC-05": Object.freeze(["hr_ops"]),
  "UC-06": Object.freeze(["customer_admin", "payroll_specialist"]),
  "UC-09": Object.freeze(["requester", "approver", "payment_releaser"]),
});

/** The nominal single-slot roles, named once so the policies import rather than restate them. */
export const UC01_ROLE = "hr_ops";
export const UC03_ROLE = "travel_support_specialist";
export const UC04_ROLE = "mobility_specialist";
export const UC05_ROLE = "hr_ops";

/** Refusal codes this module can produce. Nothing else in the repo uses them. */
export const NOT_ENTITLED = "approver_not_entitled";
export const NOT_CONFIGURED = "approver_entitlement_not_configured";

/**
 * `UC-06` + `payroll_specialist` -> `uc06:payroll_specialist`. One spelling,
 * everywhere. The hyphen is stripped rather than lowercased through, so an
 * operator writes `uc06:` (which is what every other id in this repo looks
 * like) instead of `uc-06:`.
 */
function qualify(useCase, role) {
  return `${String(useCase).toLowerCase().replace(/[^a-z0-9]/g, "")}:${role}`;
}

/** Every qualified grant this vocabulary contains, e.g. `uc09:payment_releaser`. */
function allQualifiedRoles() {
  const out = [];
  for (const [useCase, roles] of Object.entries(USE_CASE_ROLES)) {
    for (const role of roles) out.push(qualify(useCase, role));
  }
  return out;
}

/**
 * Per-use-case coverage: how many DISTINCT approvers on this roster hold at
 * least one role for each use case in USE_CASE_ROLES. Counts, not identities
 * — safe to put on a public, unauthenticated health endpoint (rca-pb8a).
 *
 * This is the field that would have shown the K10 fallout from OUTSIDE: a
 * roster that grants only `uc05:hr_ops` reads correctly as
 * `approverEntitlementSource: "APPROVER_ROLES"` (non-empty, parses fine) while
 * `{"UC-01": 0, ...}` in this map is the alarm that UC-01 specifically cannot
 * be approved by anyone, which nothing else on the deployment says.
 *
 * @param {Map<string, {display: string, grants: Set<string>}>} roster
 * @returns {Record<string, number>}
 */
function coverageFromRoster(roster) {
  const coverage = {};
  for (const useCase of Object.keys(USE_CASE_ROLES)) {
    const prefix = qualify(useCase, "");
    let count = 0;
    for (const entry of roster.values()) {
      for (const grant of entry.grants) {
        if (grant.startsWith(prefix)) {
          count++;
          break;
        }
      }
    }
    coverage[useCase] = count;
  }
  return coverage;
}

/** Coverage when there is no roster at all (unconfigured/unreadable/empty) — every use case reads 0. */
function zeroCoverage() {
  return Object.fromEntries(Object.keys(USE_CASE_ROLES).map((useCase) => [useCase, 0]));
}

/**
 * Expand ONE roster token into the qualified grants it means.
 *
 * `uc06:payroll_specialist` grants exactly that slot. A bare `payroll_specialist`
 * grants that role in every use case that defines it — which is one use case for
 * every role except none, today. Bare names are accepted because that is what an
 * operator writes first, and refusing them would push people toward a wildcard.
 *
 * THROWS on a token that matches nothing. A typo in a roster is the single most
 * likely way this control becomes a gate that refuses everybody, and a typo is
 * indistinguishable from an absence unless somebody objects to it. This objects
 * to it at build time, where it is one line of config to fix, rather than at
 * 3am on an approval.
 */
function expandToken(token) {
  const raw = String(token).trim().toLowerCase();
  if (!raw) return [];
  if (raw.includes(":")) {
    const matches = allQualifiedRoles().filter((q) => q === raw);
    if (!matches.length) throw new Error(`unknown approver role "${token}"`);
    return matches;
  }
  const matches = allQualifiedRoles().filter((q) => q.endsWith(`:${raw}`));
  if (!matches.length) throw new Error(`unknown approver role "${token}"`);
  return matches;
}

/**
 * Parse a roster into `Map<canonicalApprover, {display, grants:Set<string>}>`.
 *
 * Two shapes, because both get written by hand:
 *   JSON     {"sam@remote.com": ["mobility_specialist", "uc09:approver"]}
 *   compact  sam@remote.com=mobility_specialist,uc09:approver; jane@remote.com=hr_ops
 *
 * IDENTITIES ARE CANONICALISED WITH THE REPO'S OWN DEFINITION of "the same
 * human" (src/shared/approverIdentity.js — NFKC, whitespace, case, confusable
 * folding), not with ===. UC-06 and UC-09 already decide four-eyes with that
 * function; a roster that matched bytes instead would refuse "Sam Patel " while
 * the segregation-of-duties check considered it the same person as "sam patel",
 * i.e. two different answers to one question.
 *
 * @param {string|object|null|undefined} raw
 * @returns {Map<string, {display: string, grants: Set<string>}>}
 */
export function parseRoster(raw) {
  const roster = new Map();
  if (raw == null) return roster;

  /** @type {Array<[string, string[]]>} */
  let pairs = [];

  if (typeof raw === "object") {
    pairs = Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v : String(v).split(",")]);
  } else {
    const text = String(raw).trim();
    if (!text) return roster;
    if (text.startsWith("{")) {
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        throw new Error(`APPROVER_ROLES is not valid JSON: ${err.message}`);
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("APPROVER_ROLES JSON must be an object of {approver: [roles]}");
      }
      pairs = Object.entries(parsed).map(([k, v]) => [k, Array.isArray(v) ? v : String(v).split(",")]);
    } else {
      for (const entry of text.split(/[;\n]+/)) {
        const line = entry.trim();
        if (!line || line.startsWith("#")) continue;
        const eq = line.indexOf("=");
        if (eq === -1) throw new Error(`APPROVER_ROLES entry "${line}" has no "=" between approver and roles`);
        pairs.push([line.slice(0, eq), line.slice(eq + 1).split(",")]);
      }
    }
  }

  for (const [approverRaw, tokens] of pairs) {
    const display = String(approverRaw).trim();
    const key = canonicalizeApprover(display);
    if (!key) throw new Error("APPROVER_ROLES contains an entry with no approver identity");
    const grants = roster.get(key)?.grants ?? new Set();
    for (const token of tokens) {
      for (const qualified of expandToken(token)) grants.add(qualified);
    }
    if (!grants.size) throw new Error(`APPROVER_ROLES entry "${display}" grants no roles`);
    roster.set(key, { display, grants });
  }

  return roster;
}

/**
 * The refusal shape every approval policy in this repo already speaks:
 * `{allowed:false, code, reason, status}`. Never `allowed:true` — see property
 * 2 in this file's header.
 */
function refuse(code, reason) {
  return { allowed: false, code, reason, status: 403 };
}

/**
 * An entitlement checker over an already-resolved grant map.
 *
 * SYNCHRONOUS ON PURPOSE. The policies that call it are pure functions with no
 * I/O, and they must stay that way — making one of them async to look up a
 * membership would make every caller async and put a network round-trip inside
 * a decision that four other gates depend on completing. Resolution is the
 * caller's job (see this file's header on the Zendesk seam); this only decides.
 *
 * @param {object} args
 * @param {Map<string, {display: string, grants: Set<string>}>} args.grants
 * @param {string} [args.source]  where the grants came from, quoted in refusals
 * @returns {{check: Function, describe: Function}}
 */
export function createEntitlementChecker({ grants, source = "configured roster" }) {
  const roster = grants instanceof Map ? grants : parseRoster(grants);

  return {
    /**
     * @param {object} args
     * @param {string} args.useCase   "UC-04" | "UC-05" | "UC-06" | "UC-09"
     * @param {string} args.role      a role from USE_CASE_ROLES[useCase]
     * @param {string|null} args.approver  the VERIFIED identity, never a body claim
     * @returns {null|{allowed:false, code:string, reason:string, status:number}}
     *   `null` means "nothing to say" — it is NOT an approval, and no caller may
     *   treat it as one.
     */
    check({ useCase, role, approver }) {
      const known = USE_CASE_ROLES[useCase];
      if (!known || !known.includes(role)) {
        // Reached only by a wiring mistake in this repo, never by a request:
        // every call site passes a constant or a role its own policy already
        // validated. Refusing is the only safe answer — this module cannot know
        // what an unknown slot is worth — and it is still only ever a refusal.
        return refuse(
          NOT_ENTITLED,
          `No entitlement is defined for role "${role}" on ${useCase}, so it cannot be granted to anyone.`
        );
      }

      const canonical = canonicalizeApprover(approver);
      if (!canonical) {
        return refuse(NOT_ENTITLED, "No approver identity was supplied, so no entitlement could be checked.");
      }

      const wanted = qualify(useCase, role);
      let held = null;
      for (const [key, entry] of roster) {
        // isSameApprover() rather than a Map hit, for the same reason UC-06 and
        // UC-09 use it: two spellings of one human must resolve to one answer.
        if (key === canonical || isSameApprover(key, canonical)) {
          held = entry;
          break;
        }
      }

      if (held && held.grants.has(wanted)) return null;

      const holds = held ? [...held.grants].sort().join(", ") : "";
      // THE SENTENCE A ZENDESK AGENT READS UNDER THE BUTTON (2026-09-02). It
      // used to cite `docs/APPROVAL-ROUTING.md §1.3` and the env var name —
      // neither of which an agent can open or act on — said "Approving" after a
      // Decline, and never named the code they would quote when asking for
      // access, nor what would clear it. Verb-neutral, code named, remedy
      // stated; the doc citation lives in this file's header instead.
      return refuse(
        NOT_ENTITLED,
        `${String(approver).trim()} is not entitled to act as "${role}" on ${useCase} (approver_not_entitled). ` +
          (holds
            ? `This approver is on the roster but holds only: ${holds}. `
            : "This approver is not on the entitlement roster at all. ") +
          "Signing or declining requires the role, not just a signed-in identity. " +
          `What clears it: whoever administers this deployment adds "${useCase.toLowerCase().replace("-", "")}:${role}" ` +
          `for this person to the entitlement roster (${source}); nothing on this panel can grant it.`
      );
    },

    /**
     * For a startup banner or a health endpoint. Names, never secrets.
     * `coverage` is per-use-case counts (see coverageFromRoster()) — still
     * counts, not identities, so it stays safe on a public endpoint.
     */
    describe() {
      return {
        enforced: true,
        source,
        approvers: roster.size,
        grants: [...roster.values()].reduce((n, e) => n + e.grants.size, 0),
        coverage: coverageFromRoster(roster),
      };
    },
  };
}

/**
 * A checker for the required-but-unconfigured posture: refuses everything, by
 * its own name, with the fix in the sentence.
 *
 * This is the loud failure described in the header. It is a SEPARATE code from
 * `approver_not_entitled` precisely so that "nobody configured this" can never
 * be mistaken for "this person is not a payroll specialist".
 */
export function createUnconfiguredEntitlement({ detail = "" } = {}) {
  const reason =
    "This service requires role entitlement for approvals (a durable store is attached), but no " +
    "entitlement roster is configured, so no approver can be checked and every approval is refused. " +
    "Set APPROVER_ROLES — see docs/SETUP-CHECKLIST.md." +
    (detail ? ` ${detail}` : "");
  return {
    check() {
      return refuse(NOT_CONFIGURED, reason);
    },
    describe() {
      return {
        enforced: true,
        source: "unconfigured",
        approvers: 0,
        grants: 0,
        detail: detail || null,
        coverage: zeroCoverage(),
      };
    },
  };
}

/**
 * Is role entitlement enforced here?
 *
 * Deliberately the same shape, the same discriminator and the same
 * exact-string-"true" override discipline as signedIdentityRequired() in
 * src/shared/approverAuth.js — including that the STRICT override wins when
 * both are set, so contradictory configuration resolves toward the safer
 * reading. See this file's header for why they share a rule.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {object} [opts]
 * @param {boolean} [opts.persistent]  true when a real durable store is wired
 */
export function entitlementRequired(env = process.env, { persistent = true } = {}) {
  if (env.APPROVER_ROLES_REQUIRE === "true") return true;
  if (env.APPROVER_ROLES_ALLOW_ANY === "true") return false;
  return persistent;
}

/**
 * The one call a server, CLI or deployment makes: posture in, checker out.
 *
 * Returns `entitlement: null` when entitlement is not enforced here, which is
 * what every policy treats as "not consulted". A checker that existed but said
 * yes to everything would be the F-20 defect in a new costume — a mechanism
 * that runs, passes its tests, and protects nothing.
 *
 * A roster that fails to PARSE does not fall back to open. It becomes the
 * unconfigured refuser carrying the parse error, because a roster nobody can
 * read is not a roster.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {object} [opts]
 * @param {boolean} [opts.persistent]
 * @returns {{entitlement: {check:Function, describe:Function}|null, required: boolean, source: string, warning: string|null}}
 */
export function resolveEntitlement(env = process.env, { persistent = true } = {}) {
  const required = entitlementRequired(env, { persistent });
  const raw = (env.APPROVER_ROLES || "").trim();

  if (!required) {
    return {
      entitlement: null,
      required: false,
      source: raw ? "not enforced (roster configured but posture is the seeded demo)" : "not enforced (seeded demo posture)",
      warning: null,
    };
  }

  if (!raw) {
    return {
      entitlement: createUnconfiguredEntitlement(),
      required: true,
      source: "unconfigured",
      warning:
        "Role entitlement is required here but APPROVER_ROLES is unset — every approve/decline will be " +
        "refused with approver_entitlement_not_configured. See docs/SETUP-CHECKLIST.md.",
    };
  }

  let roster;
  try {
    roster = parseRoster(raw);
  } catch (err) {
    return {
      entitlement: createUnconfiguredEntitlement({ detail: `APPROVER_ROLES could not be read: ${err.message}` }),
      required: true,
      source: "unreadable",
      warning: `APPROVER_ROLES could not be parsed (${err.message}) — every approve/decline will be refused.`,
    };
  }

  if (!roster.size) {
    return {
      entitlement: createUnconfiguredEntitlement({ detail: "APPROVER_ROLES parsed to zero approvers." }),
      required: true,
      source: "empty",
      warning: "APPROVER_ROLES parsed to zero approvers — every approve/decline will be refused.",
    };
  }

  return {
    entitlement: createEntitlementChecker({ grants: roster, source: "APPROVER_ROLES" }),
    required: true,
    source: "APPROVER_ROLES",
    warning: null,
  };
}

// ---------------------------------------------------------------------------
// RESOLVING FROM ZENDESK LATER — what the drop-in looks like
// ---------------------------------------------------------------------------
// Nothing below is built; this is the shape the seam was left in, so that the
// next person does not have to re-derive it from the header.
//
//   1. At server/CLI start (NOT per request, and NOT inside the policy):
//        const memberships = await zendesk.listGroupMemberships();   // async, cached
//        const grants = new Map();                                    // group name -> role
//        …fill from src/shared/escalationRouting.js's queue tags…
//        entitlement = createEntitlementChecker({ grants, source: "Zendesk groups" });
//   2. Refresh on a timer, and on failure KEEP THE LAST GOOD MAP rather than
//      emptying it — an unreachable Zendesk must not silently entitle anyone
//      (empty map + enforced = everything refused) and must not wedge every
//      approval either. Holding the previous snapshot is the only option that
//      does neither, and it is only safe because the snapshot is a list of
//      grants, not a list of denials.
//   3. If there has never BEEN a good map, that is the unconfigured refuser
//      above, by its own name — not an empty checker, which would refuse with
//      "this person is not a payroll specialist" about a person who is.
// ---------------------------------------------------------------------------
