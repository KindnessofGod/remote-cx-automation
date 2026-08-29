// ---------------------------------------------------------------------------
// stripBuildComments.js — remove developer comments from a static browser
// asset before it is served (rca-b7rr / R7-10).
// ---------------------------------------------------------------------------
// This repo's convention is to write dense WHY-comments directly into the
// HTML/JS files under `src/*/assets/` (see CLAUDE.md's "explain non-obvious
// logic in comments"). That is correct for a file a developer reads in the
// editor. It is wrong for a file served, unauthenticated, to a stranger on
// the public internet — the third-party door (src/thirdparty/) has no login,
// no key and no account gate by design (see its server.js header), and its
// comments were found naming round-6 defect ids (`D-25`, `D-26`, `D-29`) and
// internal source paths (`src/portal/assets/app.js`,
// `src/surfaceverify/surfaces/browser.js`) in plain view-source.
//
// The fix is applied at SERVE time, not by rewriting the source files: the
// comments stay exactly where they are for the next developer reading the
// code, and only the bytes sent over the wire are stripped.
// ---------------------------------------------------------------------------

/** Removes HTML comments (`<!-- ... -->`) from a string of HTML markup. */
export function stripHtmlComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, "");
}

/**
 * Removes `//` line comments and `/* ... *\/` block comments from JavaScript
 * source, without touching lookalike text inside string/template literals —
 * a naive regex breaks on something like `"http://example.com"`. Walks the
 * source once, tracking whether the cursor is inside a string/template
 * literal, a line comment, or a block comment.
 *
 * Not a general-purpose JS parser (it does not resolve the regex-literal vs.
 * division ambiguity around a bare `/`), so this is for stripping comments
 * from this repo's own small, controlled static assets — not for arbitrary
 * third-party JavaScript.
 */
export function stripJsComments(js) {
  let out = "";
  let i = 0;
  const n = js.length;
  let mode = "code"; // code | line-comment | block-comment | string
  let stringChar = "";

  while (i < n) {
    const c = js[i];
    const next = js[i + 1];

    if (mode === "code") {
      if (c === "/" && next === "/") {
        mode = "line-comment";
        i += 2;
        continue;
      }
      if (c === "/" && next === "*") {
        mode = "block-comment";
        i += 2;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        mode = "string";
        stringChar = c;
        out += c;
        i += 1;
        continue;
      }
      out += c;
      i += 1;
      continue;
    }

    if (mode === "line-comment") {
      if (c === "\n") {
        mode = "code";
        out += c;
      }
      i += 1;
      continue;
    }

    if (mode === "block-comment") {
      if (c === "*" && next === "/") {
        mode = "code";
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    // mode === "string"
    out += c;
    if (c === "\\") {
      out += next ?? "";
      i += 2;
      continue;
    }
    if (c === stringChar) {
      mode = "code";
    }
    i += 1;
  }

  return out;
}
