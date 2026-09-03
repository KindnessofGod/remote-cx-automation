/* ---------------------------------------------------------------------------
 * country.js  —  the one place this bundle turns a country CODE into a NAME
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * The project owner, looking at the sidebar and the portal: "instead of using
 * country codes like PT you use the country's full name. You can use codes
 * inside the code, not on the UI."
 *
 * They are right, and it is not only a readability point. A code on screen asks
 * a specialist to be fluent in ISO 3166-1 while they are deciding whether
 * somebody may enter a jurisdiction: `PT` is Portugal and is also what a hurried
 * reader takes for "part-time", and every one of NL/NO/NE and CA/CH/CN is one
 * glance from another country.
 *
 * THE DIVISION THIS FILE IS THE BROWSER HALF OF (src/shared/countryNames.js):
 *   * codes decide   — gates, sets, audit rows, API payloads, anything POSTed
 *   * names are read — every string a human sees
 *
 * SO NOTHING HERE MAY BE COMPARED, STORED OR SENT. Every function below is
 * called at the point of rendering and its result goes straight into a
 * textContent. A name in a value that later reaches a gate is the alpha-3
 * defect one alphabet over, and this repository has already paid for that one:
 * an 80-day stay cleared a traveller because "Netherlands" reached a comparison
 * only two-letter codes can win.
 *
 * WHY `text()` IS NEVER APPLIED TO A VALUE GENERICALLY — the hazard, by name.
 * A bare two-letter token is not evidence that a value is a country. UC-04's
 * own evidence carries `{label: "Contract-signing authority", value: "no"}`,
 * and "no" is two letters and IS the code for Norway. A renderer that mapped
 * every short value would print "Contract-signing authority: Norway" on a
 * mobility approval screen. So a value is only ever passed through here when
 * the surface KNOWS the field holds a country: a typed field read by name
 * (a trip's destination, a dossier's route), or a `{label, value}` row whose
 * label is in COUNTRY_VALUED_LABELS below.
 *
 * WHY A NAME PASSES THROUGH UNTOUCHED. Some server strings are already names
 * ("Netherlands–Portugal double taxation convention"), and some are prose or
 * "not stated". Anything that is not exactly a two-letter token is returned
 * byte-for-byte as it arrived — never re-cased, never dropped. Double-wrapping
 * a name is the failure this rule exists to make impossible.
 *
 * WHY AN UNNAMEABLE CODE KEEPS ITS CODE. `XK` (Kosovo) is a user-assigned code
 * the ISO list does not carry a name for. The reader is better served by seeing
 * `XK` than a blank or the word "unknown", because the code is the thing they
 * can look up or quote. What must never happen is a name being invented for it.
 * ------------------------------------------------------------------------- */

(function () {
  "use strict";

  /* The map is GENERATED from src/shared/countryNames.js — see countryNames.js.
     Read defensively: if that asset ever failed to load, every call below
     degrades to printing the code, which is exactly today's behaviour and not a
     blank page. */
  var NAMES = window.CXCountryNames || {};

  /* Splits a string into tokens and the separators between them, keeping both,
     so a mapped phrase can be reassembled exactly as the server wrote it. The
     separators are the ones this repo's servers actually join countries with:
     an arrow (a route), an en/em dash (a treaty pair), a pipe (a pair KEY), a
     comma (a list) and a slash. */
  var SEPARATORS = /(\s*(?:->|→|–|—|\||\/|,)\s*)/;

  /** The canonical code, or null when the token is not a bare alpha-2 code. */
  function codeOf(value) {
    if (typeof value !== "string") return null;
    var token = value.trim();
    return /^[A-Za-z]{2}$/.test(token) ? token.toUpperCase() : null;
  }

  /** The country's name, or null when there is no name to give. */
  function name(value) {
    var code = codeOf(value);
    if (!code) return null;
    return NAMES[code] || null;
  }

  /**
   * What a country-valued field should PRINT.
   *
   * A bare code becomes its name; an unnameable code stays a code; anything
   * that is not a code — a name the server already sent, a sentence, "not
   * stated" — is returned exactly as it arrived; nothing at all becomes
   * `absent`.
   */
  function text(value, absent) {
    var fallback = absent === undefined ? "not stated" : absent;
    if (value === null || value === undefined) return fallback;
    var raw = String(value);
    if (!raw.trim()) return fallback;

    return raw
      .split(SEPARATORS)
      .map(function (part) {
        var code = codeOf(part);
        // A separator, a name, or prose: untouched, including its spacing.
        if (!code) return part;
        return NAMES[code] || code;
      })
      .join("");
  }

  /**
   * The name AND the code — "Portugal (PT)" — for the one kind of line where
   * both belong: a reference somebody may have to quote back to a consulate, a
   * treaty index or another system. NOT for prose, where the parenthesis is
   * noise, and not for a route read at a glance.
   *
   * A value that is not a single bare code falls through to `text()`, so a list
   * or a pair is still named rather than being refused.
   */
  function nameAndCode(value, absent) {
    var fallback = absent === undefined ? "not stated" : absent;
    if (value === null || value === undefined || String(value).trim() === "") return fallback;
    var code = codeOf(value);
    if (!code) return text(value, fallback);
    var named = NAMES[code];
    return named ? named + " (" + code + ")" : code;
  }

  /** A list of codes as one readable phrase: ["NL","PT"] -> "Netherlands, Portugal". */
  function join(values, absent, decorate) {
    var render = decorate === "withCode" ? nameAndCode : text;
    var list = (values || []).filter(function (v) {
      return v !== null && v !== undefined && String(v).trim() !== "";
    });
    if (!list.length) return absent === undefined ? "not stated" : absent;
    return list
      .map(function (v) {
        return render(v);
      })
      .join(", ");
  }

  /* =========================================================================
     WHICH `{label, value}` ROWS HOLD A COUNTRY
     =========================================================================
     main.js renders two generic row shapes — a dimension's `evidence` and a
     decision-fact bundle — where the label and the value both come from the
     server and this file has no way to tell a country from a status word. The
     answer is NOT a shape guess (see the "no"/Norway hazard in this file's
     header); it is this list, and it is short on purpose.
     Every label below is a string a src/uc0N/*.js actually emits, and
     test/zafCountryNames.test.js asserts each one still exists there — so a
     server-side rename shows up as a failing test rather than as a code
     quietly reappearing on the screen.

     A LABEL THAT IS NOT ON THIS LIST RENDERS ITS CODE, exactly as it does
     today. That is the safe direction: a missed row is a row that reads the way
     it always has, where a wrong guess would rename a value that is not a
     country at all. */
  var COUNTRY_VALUED_LABELS = {
    // src/uc04/decisionFacts.js — the treaty and presence dimensions
    /* "Country pair" WAS RENAMED "Nationality → destination" ON 2026-08-31,
       because it is keyed on the NATIONALITY while the trip line at the top of
       the page is keyed on the HOME COUNTRY — two different pairs under one
       label, identical on any case where the two happen to agree and silently
       different on any where they do not.

       THE RETIRED KEY IS NOT KEPT. The first version of this edit left it in
       "for stored payloads", and test/zafCountryNames.test.js failed it: this
       registry must hold only labels a server actually emits, because a stale
       entry is indistinguishable from a live one and hides the next rename. */
    "Nationality → destination": true,
    Destination: true,
    // src/uc09/decisionFacts.js — the jurisdiction heuristic's provenance
    "Countries on the list": true,
    "The employment's country": true,
    // src/uc03/policyEngine.js — the facts a routing decision was made from
    // BOTH PROVENANCE FORMS. src/uc03/policyEngine.js composes these as
    // `${noun} as stated` when the traveller typed the value into the form and
    // `${noun} as read` when the classifier took it out of their prose. Only
    // the second existed when this map was written. A row whose label is not
    // here renders its raw code, so missing the new one would have turned
    // "Germany" back into "DE" on exactly the requests where a human had been
    // most explicit about the answer.
    "Destination as read": true,
    "Destination as stated": true,
    "Home country on the record": true,
  };

  /** The value for a `{label, value}` row, named only where the label says country. */
  function row(label, value) {
    if (!COUNTRY_VALUED_LABELS[String(label)]) return value;
    return text(value, value);
  }

  window.CXCountry = {
    name: name,
    text: text,
    nameAndCode: nameAndCode,
    join: join,
    row: row,
    countryValuedLabels: COUNTRY_VALUED_LABELS,
  };
})();
