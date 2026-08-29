// ---------------------------------------------------------------------------
// zafSidebar.js  —  boot the real ZAF sidebar against a fake DOM
// ---------------------------------------------------------------------------
// WHY THIS IS A FIXTURE AND NOT A COPY IN EACH TEST FILE
// `npm test` never imports a browser asset, so anything the sidebar renders
// that no test reads can ship saying anything at all. The only defence is to
// run zaf-app/assets/main.js for real and assert on the words that came out —
// which needs a DOM, a fetch, and a ZAFClient. That harness was written once,
// in test/zafApprovalRole.test.js, and the second file that needed it would
// have copied it. Two copies of a harness drift exactly the way two copies of a
// gate do, and the drift is silent: each file keeps passing against its own
// copy while they stop testing the same thing.
//
// The fake DOM is deliberately minimal — appendChild/removeChild/textContent/
// className/setAttribute is the entire surface main.js and panels.js use, and
// test/zafApp.test.js pins that they never reach for innerHTML. A node here
// that grew a method the real DOM has would let a renderer start depending on
// something this harness cannot check.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import vm from "node:vm";

const MAIN = new URL("../../zaf-app/assets/main.js", import.meta.url);
const PANELS = new URL("../../zaf-app/assets/panels.js", import.meta.url);
// The country map and the one file that reads it, in the order iframe.html
// loads them. They come FIRST for the same reason they do in the browser: both
// panels.js and main.js name countries at render time, and a harness that left
// them out would render codes and prove the opposite of what it was asserting.
const COUNTRY_NAMES = new URL("../../zaf-app/assets/countryNames.js", import.meta.url);
const COUNTRY = new URL("../../zaf-app/assets/country.js", import.meta.url);

export function createNode(tagName) {
  return {
    tagName: String(tagName).toLowerCase(),
    className: "",
    textContent: "",
    childNodes: [],
    attributes: {},
    get firstChild() {
      return this.childNodes[0] || null;
    },
    appendChild(child) {
      this.childNodes.push(child);
      return child;
    },
    removeChild(child) {
      const i = this.childNodes.indexOf(child);
      if (i !== -1) this.childNodes.splice(i, 1);
      return child;
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
    addEventListener() {},
  };
}

export function textOf(node) {
  const own = node.textContent ? String(node.textContent) : "";
  const kids = node.childNodes.map(textOf).join(" ");
  return (own + " " + kids).replace(/\s+/g, " ").trim();
}

/**
 * The value rendered beside a <dt> label — i.e. what one row actually says.
 * Asserting on the whole page's text cannot tell a labelled row apart from the
 * same words inside a paragraph, which is the entire distinction here.
 */
export function rowValue(node, label) {
  for (let i = 0; i < node.childNodes.length; i += 1) {
    const child = node.childNodes[i];
    if (child.tagName === "dt" && String(child.textContent).trim() === label) {
      const value = node.childNodes[i + 1];
      return value ? String(value.textContent).trim() : null;
    }
    const found = rowValue(child, label);
    if (found !== null && found !== undefined) return found;
  }
  return null;
}

export function collect(node, predicate, found = []) {
  if (predicate(node)) found.push(node);
  node.childNodes.forEach((child) => collect(child, predicate, found));
  return found;
}

/** The one block the capacity assertions are about, wherever main.js put it. */
export function capacityBlock(root) {
  return collect(root, (n) => String(n.className).indexOf("r-capacity") === 0 && n.tagName === "div")[0] || null;
}

/**
 * Answer for ONE base URL and 404 everything else.
 *
 * main.js defaults `apiBaseUrl` to http://localhost:4020 when the setting is
 * blank, so UC-01's loader is ALWAYS in the race and it wins on precedence. A
 * responder that answered every URL therefore served a UC-04 body to UC-01's
 * loader, which built a view with no `case` at all — a failure that looks like
 * a rendering bug and is a test-harness bug.
 */
export function servedBy(base, body, status = 200) {
  return async (url) => (String(url).indexOf(base) === 0 ? { status, body } : { status: 404, body: { found: false } });
}

export async function renderSidebar({ settings, respond, ticketId }) {
  const root = createNode("div");
  const pendingFetches = new Set();
  const document = {
    getElementById: (id) => (id === "root" ? root : null),
    createElement: createNode,
    body: { scrollHeight: 800 },
  };

  const context = {
    window: {},
    document,
    console,
    setTimeout,
    clearTimeout,
    JSON,
    Promise,
    String,
    Number,
    Boolean,
    Object,
    Array,
    Date,
    Math,
    RegExp,
    encodeURIComponent,
    isNaN,
    parseInt,
    parseFloat,
    Error,
    fetch: (url, init) => {
      const pending = (async () => {
        const res = await respond(String(url), init || {});
        return { status: res.status, ok: res.status >= 200 && res.status < 300, json: async () => res.body };
      })();

      pendingFetches.add(pending);
      pending.then(
        () => pendingFetches.delete(pending),
        () => pendingFetches.delete(pending)
      );

      return pending;
    },
  };
  context.window.document = document;
  context.window.ZAFClient = {
    init: () => ({
      metadata: async () => ({ settings }),
      get: async () => ({
        "ticket.id": ticketId,
        "currentUser.email": "specialist@example.com",
        "currentUser.name": "A Specialist",
        "currentUser.id": 7,
      }),
      invoke: () => {},
    }),
  };
  vm.createContext(context);
  new vm.Script(readFileSync(COUNTRY_NAMES, "utf8"), { filename: "countryNames.js" }).runInContext(context);
  new vm.Script(readFileSync(COUNTRY, "utf8"), { filename: "country.js" }).runInContext(context);
  new vm.Script(readFileSync(PANELS, "utf8"), { filename: "panels.js" }).runInContext(context);
  new vm.Script(readFileSync(MAIN, "utf8"), { filename: "main.js" }).runInContext(context);
  // Wait for the mocked network work to become genuinely idle instead of
  // guessing that a fixed number of event-loop turns is long enough.
  //
  // Requiring several consecutive idle turns also gives the promise
  // continuations that consume the final response time to update the DOM.
  let idleTurns = 0;
  for (let i = 0; i < 1000 && idleTurns < 3; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    idleTurns = pendingFetches.size === 0 ? idleTurns + 1 : 0;
  }

  if (pendingFetches.size !== 0 || idleTurns < 3) {
    throw new Error(`ZAF sidebar did not become idle; ${pendingFetches.size} fetch(es) still pending`);
  }

  return { root, text: textOf(root), buttons: collect(root, (n) => n.tagName === "button") };
}

/** The request/response double every server test in this repo uses. */
export function callHandler(handler, { method, path, body = null }) {
  return new Promise((resolve, reject) => {
    const req = {
      method,
      url: path,
      headers: {},
      on(event, cb) {
        if (event === "data" && body) cb(Buffer.from(JSON.stringify(body)));
        if (event === "end") setImmediate(cb);
        return req;
      },
    };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) {
        this.headers[k.toLowerCase()] = v;
      },
      end(payload) {
        resolve({ status: this.statusCode, body: payload ? JSON.parse(payload) : null });
      },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}
