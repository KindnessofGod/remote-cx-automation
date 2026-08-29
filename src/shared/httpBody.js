// ---------------------------------------------------------------------------
// httpBody.js  —  The one JSON request-body reader every HTTP surface uses
// ---------------------------------------------------------------------------
// WHY THIS EXISTS (QA finding F-16, HIGH — availability)
// Eleven servers in this repo each carried a byte-identical private copy of
// readJsonBody(), and every one of them had the same defect: on exceeding the
// 64 KB cap they called reject(...) and then KEPT READING.
//
//     req.on("data", (chunk) => {
//       raw += chunk;
//       if (raw.length > 64_000) reject(new Error("Request body too large"));
//     });
//
// A promise can only settle once, so the rejection was delivered — and the
// stream was never paused, never destroyed, and `raw` kept growing with every
// subsequent chunk until V8's maximum string length was reached, at which
// point the string concatenation throws inside an EventEmitter callback with
// no handler and the PROCESS EXITS. One unauthenticated request killed both
// the review API and the UC-06 API outright; the ports went to ECONNREFUSED
// while the attacker's socket was still open.
//
// Rejecting a promise is not backpressure. The fix is to stop the flow of
// bytes at the cap:
//   1. drop the buffer, so nothing already read stays resident,
//   2. detach the listeners, so a late chunk can never re-enter this code,
//   3. DESTROY the request stream and its socket, so the kernel stops
//      accepting the rest of the body rather than the process buffering it.
//
// Centralising it also means the cap and its enforcement now have exactly one
// definition, testable without eleven near-identical tests — the same "one
// foundation component, one file" rule the rest of src/shared/ follows.
// ---------------------------------------------------------------------------

/** Cap on a request body, in bytes. A review note is a sentence, not a payload. */
export const MAX_BODY_BYTES = 64_000;

/**
 * Read and parse a JSON request body, refusing (and hanging up on) anything
 * over the cap.
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {object} [opts]
 * @param {number} [opts.limit]  byte cap; defaults to MAX_BODY_BYTES
 * @returns {Promise<object>}  the parsed body, or {} for an empty one
 * @throws {Error} with `.code` "body_too_large" (and `.status` 413) once the
 *   cap is exceeded, or "invalid_json" for a malformed body. Both are shaped
 *   so a caller can map them to a status without string-matching a message.
 */
export function readJsonBody(req, { limit = MAX_BODY_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let bytes = 0;
    let settled = false;

    // Guarded on `off` existing because several test suites drive handlers with
    // a minimal request DOUBLE that implements `on` and nothing else. Detaching
    // is a hardening step, not a correctness requirement (the `settled` flag
    // already makes a late chunk a no-op), so a double that cannot detach must
    // not turn into a thrown TypeError inside an event callback — which is the
    // same class of crash this whole helper exists to remove.
    const cleanup = () => {
      if (typeof req.off !== "function") return;
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
      req.off("aborted", onError);
    };

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };

    function onData(chunk) {
      bytes += chunk.length;
      if (bytes > limit) {
        // ---- THE FIX. Order matters: release the buffer and detach the
        // listeners BEFORE destroying, so nothing that is still queued in the
        // stream can append one more chunk on the way down.
        raw = "";
        const err = Object.assign(new Error("Request body too large"), {
          code: "body_too_large",
          status: 413,
        });
        finish(reject, err);
        destroyRequest(req);
        return;
      }
      raw += chunk;
    }

    function onEnd() {
      if (!raw.trim()) return finish(resolve, {});
      try {
        finish(resolve, JSON.parse(raw));
      } catch {
        finish(reject, Object.assign(new Error("Request body was not valid JSON"), {
          code: "invalid_json",
          status: 400,
        }));
      }
    }

    function onError(err) {
      finish(reject, err instanceof Error ? err : new Error("Request stream aborted"));
    }

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
    req.on("aborted", onError);
  });
}

/**
 * Hang up on a client that has already blown the cap. Guarded on every method
 * being a function because tests (and the mock request doubles the ucNN server
 * tests use) drive this with a plain EventEmitter that has no socket — the
 * point of the helper is that it never throws while refusing a request.
 * @param {any} req
 */
function destroyRequest(req) {
  try {
    if (typeof req.pause === "function") req.pause();
    if (req.socket && typeof req.socket.destroy === "function") req.socket.destroy();
    else if (typeof req.destroy === "function") req.destroy();
  } catch {
    // Destroying an already-destroyed socket must never become the thing that
    // takes the process down — that is the exact failure mode being fixed.
  }
}
