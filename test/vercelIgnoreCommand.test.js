// ---------------------------------------------------------------------------
// vercelIgnoreCommand.test.js — the build-skip check, run rather than read
// ---------------------------------------------------------------------------
// PRODUCTION STOPPED DEPLOYING ON 2026-08-28 and the push that broke it looked
// perfect: branch correct, commit pushed, Vercel deployment created. The build
// log had one line that mattered:
//
//   Running "git diff --quiet "${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}" HEAD -- ..."
//   fatal: bad object 8069763b8acd2eaa55ea9f84d3878436e96b36b0
//
// Vercel builds from a SHALLOW clone. `VERCEL_GIT_PREVIOUS_SHA` is the last
// deployed commit, and once HEAD moves far enough ahead that object is no
// longer in the clone — so `git diff` exits 128 instead of 0 or 1, and Vercel
// treats a crashed ignoreCommand as a FAILED BUILD. It had worked for months
// only because the previous sha kept landing inside the shallow window.
//
// The direction of the guard is the whole point. Exit 0 means SKIP THE BUILD.
// So anything unexpected — unknown sha, no sha, a repo with no parent commit —
// must exit NON-ZERO and build. A guard that failed the other way would skip
// deploys silently, which is the failure this project already paid for once
// (CLAUDE.md §6: a docs-only commit reports "Canceled" and no redeploy can
// ever change it).
//
// This runs the real command out of vercel.json against real git repositories,
// because the previous version of this check was a comment and comments do not
// exit 128.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";

const IGNORE_COMMAND = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"))
  .ignoreCommand;

/** Run the real ignoreCommand in `cwd`, return its exit code. */
function runIgnore(cwd, env = {}) {
  try {
    execFileSync("sh", ["-c", IGNORE_COMMAND], { cwd, env: { ...process.env, ...env }, stdio: "pipe" });
    return 0;
  } catch (err) {
    return typeof err.status === "number" ? err.status : 1;
  }
}

/** A throwaway git repo with two commits, the second touching `src/`. */
function repoWithTwoCommits() {
  const dir = mkdtempSync(join(tmpdir(), "cx-ignore-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "t@t.test");
  git("config", "user.name", "t");
  writeFileSync(join(dir, "README.md"), "one\n");
  git("add", "-A");
  git("commit", "-qm", "one");
  const first = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString().trim();
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "a.js"), "export const a = 1;\n");
  git("add", "-A");
  git("commit", "-qm", "two");
  return { dir, first };
}

test("an out-of-depth previous sha BUILDS rather than crashing the deployment", () => {
  // The exact reported failure. Before the fix this exited 128 and Vercel
  // reported "Deployment has failed" with nothing wrong in the code.
  const { dir } = repoWithTwoCommits();
  try {
    const code = runIgnore(dir, {
      VERCEL_GIT_PREVIOUS_SHA: "8069763b8acd2eaa55ea9f84d3878436e96b36b0",
    });
    assert.notEqual(code, 128, "the ignoreCommand still crashes on a sha the shallow clone lacks");
    assert.notEqual(code, 0, "an unknown previous sha SKIPPED the build — it must build instead");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a known previous sha with changes under a watched path builds", () => {
  const { dir, first } = repoWithTwoCommits();
  try {
    assert.notEqual(runIgnore(dir, { VERCEL_GIT_PREVIOUS_SHA: first }), 0, "a real src/ change was skipped");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unchanged tree still SKIPS — the guard must not build everything forever", () => {
  // The negative control. If this returned non-zero the fix would have
  // silently disabled build-skipping altogether, which is a cost regression
  // rather than an outage and would go unnoticed for far longer.
  const { dir } = repoWithTwoCommits();
  try {
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString().trim();
    assert.equal(runIgnore(dir, { VERCEL_GIT_PREVIOUS_SHA: head }), 0, "an identical tree no longer skips the build");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the watched-path list still names every input the deployed function is built from", () => {
  // If a path is dropped here, a change to it deploys nothing and the symptom
  // is "my fix isn't live" with a green build — the same shape of confusion
  // the shallow-clone bug produced.
  for (const p of ["api", "deploy", "src", "package.json", "package-lock.json", "vercel.json"]) {
    assert.ok(IGNORE_COMMAND.includes(p), `vercel.json no longer watches ${p}`);
  }
});
