// ---------------------------------------------------------------------------
// server.js  —  The live demo's HTTP API: the ONLY place in this repo that
// creates a real Zendesk ticket on purpose.
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// src/playground/ deliberately never touches a real Zendesk ticket — it calls
// handleVerificationTicket() directly in-process, which is the right tool for
// exploring the decision logic but proves nothing about the live pipeline.
// This is the opposite: it does nothing BUT create a real ticket (shaped
// exactly like the live trigger expects — same "uc01_test" tag, same Remote
// Employment ID custom field) and then read that same real ticket back so the
// page can show what the live n8n workflow actually did to it. It contains no
// decision logic of its own — the decision is made entirely by the live n8n
// workflow once the ticket lands in Zendesk, the same way it would for any
// other ticket that reaches that trigger.
// ---------------------------------------------------------------------------

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readJsonBody } from "../shared/httpBody.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_TAG = "uc01_test"; // must match the tag the live Zendesk trigger watches for

const ASSETS = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.js": { file: "app.js", type: "application/javascript; charset=utf-8" },
  "/style.css": { file: "style.css", type: "text/css; charset=utf-8" },
  // The shared design system (src/shared/ui/remote-ui.css), served from every
  // browser surface at the same path so the six of them stay one product
  // rather than six. `dir` overrides the default assets/ lookup below.
  "/remote-ui.css": {
    file: "remote-ui.css",
    dir: join(__dirname, "..", "shared", "ui"),
    type: "text/css; charset=utf-8",
  },
};

/**
 * @param {object} deps
 * @param {import("../zendesk/restClient.js").ZendeskClient} deps.zendesk
 * @param {string} deps.employmentIdFieldId  the Zendesk custom field id carrying the Remote employment id
 * @param {Array<{id:string,name:string,email:string}>} deps.employees  known real Sandbox employees to submit as
 */
export function createLiveDemoHandler({ zendesk, employmentIdFieldId, employees }) {
  return async function handle(req, res) {
    const url = new URL(req.url, "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);

    try {
      if (req.method === "GET" && ASSETS[url.pathname]) {
        const asset = ASSETS[url.pathname];
        const body = readFileSync(join(asset.dir ?? join(__dirname, "assets"), asset.file));
        res.statusCode = 200;
        res.setHeader("Content-Type", asset.type);
        return res.end(body);
      }

      // GET /api/employees — who the client can submit as
      if (req.method === "GET" && isPath(parts, ["api", "employees"])) {
        return send(res, 200, {
          employees: employees.map((e) => ({ id: e.id, name: e.name, email: e.email })),
        });
      }

      // POST /api/submit — "as the client, send this request" -> a REAL Zendesk ticket
      if (req.method === "POST" && isPath(parts, ["api", "submit"])) {
        const body = await readJsonBody(req);
        const employee = employees.find((e) => e.id === body.employmentId);
        if (!employee) return send(res, 400, { ok: false, code: "unknown_employee" });
        const text = typeof body.text === "string" && body.text.trim() ? body.text.trim() : "Please send me a standard employment verification letter.";

        // AUTHOR THE FIRST COMMENT AS THE CUSTOMER, NOT AS THIS API ACCOUNT.
        //
        // `requester: {name, email}` sets who the ticket is FOR, and that is
        // what UC-01's identity gate reads — it was already correct. But a
        // comment with no explicit `author_id` is attributed by Zendesk to the
        // authenticated caller, so on ticket #136 the customer's own sentence
        // appeared under the account owner's name, directly above an automated
        // reply under the same name. The conversation read as one person
        // talking to themselves.
        //
        // Resolved by id when Zendesk already knows the address; a first-time
        // requester it has never seen returns null and falls back to the
        // `requester` form, which still creates the user and still gates
        // correctly — one cosmetic attribution is not worth failing a demo
        // submission over.
        // NEVER let an attribution nicety fail a submission. If the lookup
        // throws — a token without `users:read`, a transient 5xx — fall back
        // to the `requester` form, which still creates the ticket, still sets
        // the requester UC-01's identity gate reads, and only loses the
        // cosmetic comment authorship. A demo that refuses to submit is worse
        // than one where a name reads wrong.
        let requesterId = null;
        try {
          requesterId = await zendesk.findUserIdByEmail(employee.email);
        } catch (err) {
          console.warn(`[livedemo] requester lookup failed, falling back to requester-by-email: ${err.message}`);
        }
        const ticket = await zendesk.createTicket({
          subject: "Employment verification letter request",
          comment: requesterId
            ? { body: text, public: true, author_id: requesterId }
            : { body: text, public: true },
          ...(requesterId
            ? { requester_id: requesterId }
            : { requester: { name: employee.name, email: employee.email } }),
          tags: [TEST_TAG],
          custom_fields: [{ id: Number(employmentIdFieldId), value: employee.id }],
        });
        return send(res, 200, { ok: true, ticketId: ticket.id, employee: { name: employee.name, email: employee.email } });
      }

      // GET /api/status/:ticketId — read the real ticket back, so the page can
      // show what the live workflow did without anyone opening Zendesk itself
      if (req.method === "GET" && isPath(parts, ["api", "status"]) && parts.length === 3) {
        const ticketId = parts[2];
        const ticket = await zendesk.getTicket(ticketId);
        if (!ticket) return send(res, 404, { ok: false, code: "not_found" });
        const comments = await zendesk.getTicketComments(ticketId);
        const publicReply = [...comments].reverse().find((c) => c.public && c.author_id !== ticket.requester_id);
        return send(res, 200, {
          ok: true,
          // Echoed back so the client's dialog and download link are built from
          // what the SERVER just answered about, not from a variable the page
          // has been carrying since submit.
          ticketId: String(ticketId),
          status: ticket.status,
          tags: ticket.tags ?? [],
          publicReplyHtml: publicReply?.html_body ?? null,
          // WHAT HAPPENED, IN ONE WORD, DECIDED HERE. The page used to render a
          // Zendesk status and a row of tags and leave the reader to work out
          // whether a person had said yes. Reported after an approval:
          // "I approved it in Zendesk, it is meant to show on this page".
          //
          // Derived server-side rather than in the browser for the reason every
          // other surface in this repo does it — the browser holds no copy of a
          // rule the server owns, because the copy is the thing that drifts.
          outcome: describeOutcome(ticket, publicReply),
        });
      }

      // GET /api/letter/:ticketId.pdf — the letter as a file a person can keep.
      //
      // THE SAME BYTES THE CUSTOMER RECEIVED, re-read from the real ticket on
      // every request rather than cached anywhere on this page: what is
      // downloaded is what was actually posted, not a local re-render that
      // could differ from it.
      if (req.method === "GET" && isPath(parts, ["api", "letter"]) && parts.length === 3) {
        const ticketId = String(parts[2]).replace(/\.pdf$/, "");
        const ticket = await zendesk.getTicket(ticketId);
        if (!ticket) return send(res, 404, { ok: false, code: "not_found" });
        const comments = await zendesk.getTicketComments(ticketId);
        const reply = [...comments].reverse().find((c) => c.public && c.author_id !== ticket.requester_id);
        if (!reply?.html_body) {
          return send(res, 404, { ok: false, code: "no_letter_yet", reason: "This ticket has no public reply to download." });
        }
        try {
          // Imported HERE, not at the top of the file. `src/pdf/render.js` has a
          // top-level `import { chromium } from "playwright"`, and this page must
          // still start and still demo on a machine with no browser installed —
          // the download degrades to the HTML fallback the client already has,
          // rather than the whole server refusing to boot.
          const { renderPdfFromHtml } = await import("../pdf/render.js");
          const pdf = await renderPdfFromHtml(letterHtmlFrom(reply.html_body));
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/pdf");
          res.setHeader("Content-Disposition", `attachment; filename="employment-verification-${ticketId}.pdf"`);
          return res.end(pdf);
        } catch (err) {
          console.error(`[livedemo] pdf render failed for ticket ${ticketId}: ${err.message}`);
          // 503, not 500: the letter exists and is fine, the renderer is not
          // available. The client says so and offers the HTML instead.
          return send(res, 503, { ok: false, code: "pdf_unavailable", reason: err.message });
        }
      }

      return send(res, 404, { ok: false, code: "no_such_route", path: url.pathname });
    } catch (err) {
      console.error(`[livedemo] ${req.method} ${url.pathname} failed: ${err.stack}`);
      return send(res, 500, { ok: false, code: "internal_error", reason: err.message });
    }
  };
}

/**
 * What the live pipeline actually did, as one labelled outcome.
 *
 * READ OFF THE REAL TICKET, never inferred from anything this page remembers.
 * Every input is a fact Zendesk holds: the status, the tags the workflow and
 * the review sidebar wrote, and whether a public reply exists.
 *
 * THE ORDER IS THE ARGUMENT. A declined ticket may also be solved, and a
 * specialist-approved one is solved exactly like an automatic one — so the
 * most specific evidence is tested first and the weakest last:
 *
 *   1. `verification_declined`  — a person said no. Nothing else can produce it.
 *   2. `uc01_auto_resolved`     — the automation resolved it with no human.
 *   3. solved + a public reply  — a person approved it. `uc01_human_review` is
 *      REMOVED when a decision is recorded (src/review/service.js), so its
 *      absence beside a reply is the signal, and it is why this comes after (2)
 *      rather than being confused with it.
 *   4. `uc01_human_review`      — still waiting on a person.
 *
 * `kind` is for the page's styling and `label`/`detail` are the words a reader
 * sees; nothing downstream branches on this, and it decides nothing.
 */
function describeOutcome(ticket, publicReply) {
  const tags = ticket.tags ?? [];
  const has = (tag) => tags.includes(tag);
  const solved = ticket.status === "solved" || ticket.status === "closed";
  const hasLetter = Boolean(publicReply?.html_body);

  if (has("verification_declined") || has("verification_denied")) {
    return {
      kind: "declined",
      label: "Declined by a specialist",
      detail: "A person reviewed this and decided not to issue the letter. The reason they gave is recorded in the audit log.",
      letterAvailable: false,
    };
  }
  if (has("uc01_auto_resolved")) {
    return {
      kind: "auto",
      label: "Resolved automatically",
      detail: "Every gate passed, so the letter was issued and the ticket closed without anyone looking at it.",
      letterAvailable: hasLetter,
    };
  }
  if (solved && hasLetter) {
    return {
      kind: "approved",
      label: "Approved by a specialist",
      detail: "A person reviewed this in Zendesk, authorised it, and the letter below was issued and sent.",
      letterAvailable: true,
    };
  }
  if (has("uc01_human_review")) {
    return {
      kind: "waiting",
      label: "Waiting on a specialist",
      detail: "The automation would not decide this one on its own. It is sitting in a person's queue.",
      letterAvailable: false,
    };
  }
  return {
    kind: "pending",
    label: "Processing",
    detail: "The live workflow has not finished with this ticket yet.",
    letterAvailable: hasLetter,
  };
}

/**
 * The letter, out of the Zendesk comment Zendesk wrapped it in.
 *
 * `comment.html_body` is not the document we posted. Zendesk strips `<html>`,
 * `<head>` and `<title>` and keeps their TEXT, then wraps what is left in
 * `<div class="zd-comment">` — so the letter's own title survives as a bare
 * text node and prints as a stray "Employment Verification Letter" line ABOVE
 * the letterhead. Harmless in a ticket thread; wrong on a PDF somebody emails
 * to their bank.
 *
 * Cut at the first styled `<div`, which is the letter's own outer element.
 *
 * GUARDED, AND FALLS BACK TO THE WHOLE THING. If the shape ever changes the
 * regex simply will not match, and if it matches but the result no longer
 * contains the letterhead marker then something unexpected was cut — either
 * way the ORIGINAL html is returned. A PDF with one stray line is a blemish; a
 * PDF missing the employer's name is a broken document, and this function must
 * not be able to produce the second while trying to prevent the first.
 */
function letterHtmlFrom(commentHtml) {
  if (typeof commentHtml !== "string") return commentHtml;
  const cut = commentHtml.replace(/^[\s\S]*?<div class="zd-comment"[^>]*>[\s\S]*?(?=<div style)/i, "");
  if (cut === commentHtml) return commentHtml;
  // "Employer of Record" is on every letter this endpoint can be asked for —
  // standard and customized alike — and is below the point we cut at.
  return cut.includes("Employer of Record") ? cut : commentHtml;
}

function isPath(parts, expected) {
  return expected.every((segment, i) => parts[i] === segment);
}


function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

/** Start the live demo on `port`. Returns the http.Server once listening. */
export function startLiveDemoServer(deps, port = 4040) {
  const server = createServer(createLiveDemoHandler(deps));
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
