// ---------------------------------------------------------------------------
// prepareClassificationPrompt.js — UC-02's "Prepare Classification Prompt" node
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS AT ALL
// It did not, until 2026-08-17. This node body lived ONLY inside the live n8n
// graph, which is precisely the state CLAUDE.md §6 forbids ("n8n Code node
// bodies must be real .js files, never template literals in the builder") —
// nothing in the repo could be diffed against it, `npm run verify-deployed` had
// no file to compare, and no test ever compiled it. It carried the same
// wrong-shape bug as the gates node and nobody could see it.
//
// WHAT IT DOES
// Builds the OpenAI chat body for the classification call. It is a PROMPT
// BUILDER and nothing else: it makes no decision, and the model's answer is
// re-validated from scratch in `Expense Gates` before it can mean anything
// (prime directive #1). Kept as its own node so the HTTP node stays a plain
// request with no logic in its parameters.
//
// THE SHAPE BUG THIS FIXES
// It used to send `categoryList.map(c => ({id: c.id, name: c.name}))`. A real
// Remote category row has neither field, so every entry serialized as
// `{"id":null,"name":null}` — the model was handed a list of empty objects and
// asked to pick one from it, then whatever it invented was compared against
// `c.id` (also undefined) and rejected. Silent on both ends.
//
// Mirrors src/uc02/expenseClassifier.js's SYSTEM_PROMPT and its
// selectable-only offering. Only categories an employee could actually file
// against are shown: a model never offered a parent heading cannot propose one.
// ---------------------------------------------------------------------------

const ticket = $('Normalize Expense Submission').first().json;
const expenseRaw = $('Fetch Expense (Remote)').first().json;
const expense = expenseRaw?.data?.expense ?? expenseRaw?.data ?? expenseRaw?.expense ?? null;
const categoriesRaw = $('Fetch Expense Categories (Remote)').first().json;

// The real envelope of GET /v1/expenses/categories is `{data: [...]}` — a flat
// array. The `data.categories` arm is a tripwire for a stale fixture serving
// the invented wrapper, not a second supported shape. Same reasoning, and same
// order, as expenseGates.js.
const categoryList = Array.isArray(categoriesRaw?.data)
  ? categoriesRaw.data
  : Array.isArray(categoriesRaw)
    ? categoriesRaw
    : (categoriesRaw?.data?.categories ?? categoriesRaw?.categories ?? []);

// src/uc02/expenseCategories.js's isSelectableCategory(), verbatim. Strict
// equality on both flags — an absent flag fails closed.
const offered = (Array.isArray(categoryList) ? categoryList : []).filter(
  (row) =>
    row &&
    typeof row === 'object' &&
    typeof row.code === 'string' &&
    row.code !== '' &&
    row.status === 'active' &&
    row.is_selectable === true
);

const systemPrompt = [
  'You classify an employee expense for an Employer-of-Record platform.',
  "You are given the expense's title, its notes, the category name recorded on the record, and the employee's selectable expense category list (code + title + description).",
  'Return ONLY a JSON object: {"categoryId": <a category CODE from the list, or null>, "reason": string, "confidence": number between 0 and 1}.',
  'Rules:',
  '- Pick the category that best fits the expense. For example, a meal whose purpose is entertaining a client or prospect is external meals and entertainment, not an internal team meal.',
  '- Use the exact "code" string from the list. Never invent a code, and never return a category that is not in the list.',
  '- Return null for categoryId when no listed category fits.',
  '- "confidence" is your certainty in the classification; below 0.85 the expense goes to a human reviewer.',
  '- You are CLASSIFYING only. Never produce, repeat or decide any money amount, total, or reimbursement eligibility.',
].join('\n');

const userContent = JSON.stringify({
  // The REAL text fields of a Remote expense. `description` is not one of them
  // — sending it meant the model received `"description": null` on every expense.
  // `recordedCategory` is the record's own (deprecated, disjoint-namespace)
  // category NAME, passed as a labelled hint the model may weigh, never as a
  // code it may return.
  title: expense?.title ?? null,
  notes: expense?.notes ?? null,
  recordedCategory: expense?.expense_category?.title ?? null,
  categories: offered.map((c) => ({ code: c.code, title: c.title, description: c.description })),
});

return [
  {
    json: {
      ...ticket,
      openaiBody: {
        model: 'gpt-4o-mini',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
      },
    },
  },
];
