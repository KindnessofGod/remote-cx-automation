// ---------------------------------------------------------------------------
// llm.js  —  OpenAI adapter (the only place the app talks to an LLM)
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// The app only needs "give this text to a model, get JSON back." Centralising
// that here means every caller (all nine use cases' classifiers/parsers/
// narrative drafters, by now) shares one client, one model config, and one
// error shape.
//
// isLlmConfigured() lets callers check up front whether a real key is present
// and skip straight to their rule-based fallback — this is what keeps the test
// suite hermetic (no OPENAI_API_KEY in the test environment, so no network call
// is ever attempted there).
//
// USAGE TAGGING (closes docs/METRICS.md's "No cost model" gap). OpenAI returns
// prompt/completion token counts on every response, but askJson() used to
// discard them — `JSON.parse(content)` and nothing else, so nothing downstream
// could ever answer "what did this call cost." tagUsage()/extractUsage() fix
// that WITHOUT changing askJson()'s return shape: every existing caller reads
// the return value AS the parsed JSON object (`result.intent`, spreads it,
// JSON.stringifies it into an audit_log row) — a hidden, non-enumerable
// property rides along without any of that code changing. Object.keys(),
// for-in, JSON.stringify(), and object spread ({...obj}) all skip
// non-enumerable properties, so isValidClassification()-style shape checks
// and audit `details` payloads elsewhere in the app are provably unaffected
// (see test/llm.test.js). extractUsage() is the one sanctioned way back in.
// ---------------------------------------------------------------------------

import OpenAI from "openai";
import { config } from "./config.js";

let client = null;

// Some managed/sandboxed environments (this project's cloud dev container among
// them) route ALL outbound traffic through an HTTP CONNECT proxy named by
// HTTPS_PROXY, and refuse anything that goes direct. Node's global fetch honours
// that proxy when NODE_USE_ENV_PROXY=1, but the OpenAI SDK installs its own
// dispatcher and so bypasses it — the request goes direct and the proxy answers
// `403 Host not in allowlist: api.openai.com`, which reads exactly like an auth
// or allowlist problem and is neither. Delegating to globalThis.fetch puts the
// SDK back on the same path as every other caller. Guarded on HTTPS_PROXY so
// unproxied environments keep the SDK's own (faster, keep-alive) dispatcher, and
// network-free either way when no key is configured.
function getClient() {
  if (!config.openai.apiKey) return null;
  if (!client) {
    client = new OpenAI({
      apiKey: config.openai.apiKey,
      ...(process.env.HTTPS_PROXY ? { fetch: (url, init) => globalThis.fetch(url, init) } : {}),
    });
  }
  return client;
}

/** True iff a real OpenAI key is configured. */
export function isLlmConfigured() {
  // THE HERMETIC FLOOR. `npm test` must never reach OpenAI — CLAUDE.md §6
  // records that this burned real credit once, and the structural answer was
  // dependency injection. Injection is still the rule and every call site
  // still takes its own seam; this is the floor UNDER it, for the seam that
  // gets forgotten.
  //
  // It was forgotten. Five portal test files inject seven of the handler's ten
  // LLM seams, so `draftRelocationNarrative`, `draftTaxNarrative` and
  // `parseAdjustment` fell through to this function and reached the network
  // whenever OPENAI_API_KEY happened to be set — 348 connections across the
  // suite. Nothing failed, because each call 401s, retries three times and
  // lands on its own template fallback; the only symptom was the clock.
  //
  // A test that genuinely wants the configured path still injects
  // `isConfigured: () => true` explicitly, which this does not touch.
  // The floor now lives in config.js (see UNDER_TEST there), so this reads
  // false under test because the key itself is null — one gate, not two.
  return Boolean(config.openai.apiKey);
}

/** The one property key usage is ever stored/read under — a Symbol so it can
 * never collide with a real (even adversarial) field name an LLM echoes back. */
const USAGE_KEY = Symbol("llmUsage");

/**
 * Attach an OpenAI response's token usage to the already-parsed JSON object,
 * as a non-enumerable property. Pure and network-free — kept separate from
 * askJson() so it is unit-testable without a real OpenAI client (see
 * test/llm.test.js).
 * @param {object} parsed          the object askJson() is about to return
 * @param {object} response        the raw OpenAI chat-completion response
 * @returns {object} the same `parsed` object, for chaining
 */
export function tagUsage(parsed, response) {
  if (parsed && typeof parsed === "object" && response?.usage) {
    Object.defineProperty(parsed, USAGE_KEY, {
      value: {
        model: response.model ?? config.openai.model,
        promptTokens: response.usage.prompt_tokens ?? null,
        completionTokens: response.usage.completion_tokens ?? null,
        totalTokens: response.usage.total_tokens ?? null,
      },
      enumerable: false, // deliberate — see the file header
      configurable: true,
    });
  }
  return parsed;
}

/**
 * Read back the usage tagUsage() attached, or null when there is none — no
 * OpenAI call happened (the rule-based path), the object was constructed by
 * hand (a test fixture), or the response carried no usage block.
 * @param {object} result
 * @returns {{model:string, promptTokens:number|null, completionTokens:number|null, totalTokens:number|null}|null}
 */
export function extractUsage(result) {
  return result?.[USAGE_KEY] ?? null;
}

/**
 * Ask the LLM to return JSON for a prompt. Returns a parsed object, with its
 * token usage attached (see tagUsage() above — read it back via
 * extractUsage()).
 * Throws if no API key is configured, the request fails, or the response
 * isn't valid JSON — callers are expected to catch and fall back.
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @returns {Promise<object>}
 */
export async function askJson(systemPrompt, userPrompt) {
  const c = getClient();
  if (!c) {
    throw new Error("OPENAI_API_KEY not set — see .env.example");
  }

  const response = await c.chat.completions.create({
    model: config.openai.model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const content = response.choices[0]?.message?.content;
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`LLM did not return valid JSON: ${content}`);
  }
  return tagUsage(parsed, response);
}

/**
 * Ask the model to transcribe a DOCUMENT (a receipt image or PDF).
 *
 * Separate from askJson() because the message shape is different — the document
 * travels as a data URL in an image/file content part, not as prose — and
 * because keeping it separate means the receipt path can never accidentally be
 * pointed at a text-only prompt and silently return a hallucinated total.
 *
 * WHY A DATA URL AND NOT A FILE UPLOAD. Uploading creates a stored object on
 * OpenAI's side with a lifetime and an id somebody has to clean up, for a
 * document we need for exactly one call. Inlining sends the same bytes and
 * leaves nothing behind, which is the right default for a receipt belonging to
 * a real employee.
 *
 * A PDF is sent through the `file` content part; images go through `image_url`.
 * Both are the documented shapes for the chat completions API.
 *
 * @returns {Promise<string>} the model's raw text — the CALLER validates it.
 *   Deliberately not parsed here: receiptExtraction.js owns the schema, and a
 *   parse in two places is a schema in two places.
 */
export async function askAboutDocument({ systemPrompt, mimeType, fileName, dataBase64 }) {
  const c = getClient();
  if (!c) {
    throw new Error("OPENAI_API_KEY not set — see .env.example");
  }

  const dataUrl = `data:${mimeType};base64,${dataBase64}`;
  const documentPart =
    mimeType === "application/pdf"
      ? { type: "file", file: { filename: fileName || "receipt.pdf", file_data: dataUrl } }
      : { type: "image_url", image_url: { url: dataUrl } };

  const response = await c.chat.completions.create({
    model: config.openai.model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: "Transcribe this receipt as JSON, following the rules exactly." },
          documentPart,
        ],
      },
    ],
  });

  return response.choices[0]?.message?.content ?? "";
}
