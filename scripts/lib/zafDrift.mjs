// ---------------------------------------------------------------------------
// zafDrift.mjs — is the installed ZAF app this tree, or just this version
// number?
// ---------------------------------------------------------------------------
// WHY THIS EXISTS (rca-xsbt)
//
// scripts/deploy-zaf-app.mjs's --check used to compare ONLY version strings:
//
//     const drift = String(before.version) !== String(manifest.version);
//
// rca-iih7's commit fd15c65 changed zaf-app/assets/main.js by 61 lines — two
// fixes on the SPECIALIST'S SCREEN, the surface §16 is graded against — and
// did not bump zaf-app/manifest.json. Both installed and manifest read
// v1.10.2, so drift === false. `npm run verify-zaf` reported "in sync" for
// nine hours while the account served the pre-fix bundle. A forgotten version
// bump is the ONE way the installed app and this tree can diverge that a
// version-string compare is structurally blind to — it is precisely the case
// the check exists to catch, and precisely the case it missed.
//
// assessZafDrift() below adds the check that closes it: even when the
// version strings agree, a commit under zaf-app/ (excluding zaf-app/tmp/,
// which is build output) newer than the installed app's own updated_at means
// content shipped without a version bump. Commit time, not mtime — a git
// checkout rewrites mtimes and would produce false DRIFTED reports on a
// freshly cloned tree that has never been touched.
//
// Split into its own pure module (no network, no git, no fs) so the
// comparison is hermetically testable — test/deployZafAppDrift.test.js drives
// it directly. The CLI script (deploy-zaf-app.mjs) is the only thing that
// talks to git or the Zendesk API; this file only ever compares values it is
// handed.
// ---------------------------------------------------------------------------

/**
 * @param {object} input
 * @param {string} input.manifestVersion    version in this tree's zaf-app/manifest.json
 * @param {string} input.installedVersion   version the account reports installed
 * @param {string|Date|null|undefined} input.installedUpdatedAt  the installed app's updated_at
 * @param {string|Date|null|undefined} input.treeNewestCommitAt  newest commit time under zaf-app/ (excluding tmp/), or null if it could not be read
 * @returns {{status: "in_sync"|"drifted"|"unknown", reason: string}}
 */
export function assessZafDrift({ manifestVersion, installedVersion, installedUpdatedAt, treeNewestCommitAt }) {
  const versionDrift = String(manifestVersion) !== String(installedVersion);

  const installedAt = toDate(installedUpdatedAt);
  const treeAt = toDate(treeNewestCommitAt);

  // A missing/unparseable timestamp on EITHER side means the content check
  // cannot run. Reporting "in sync" here — because the version strings alone
  // happened to match — would be exactly the blind spot this module exists to
  // close, so an unreadable timestamp is "unknown", never "in_sync".
  if (!installedAt || !treeAt) {
    return {
      status: "unknown",
      reason: versionDrift
        ? "version strings differ, and the content timestamps could not be read to confirm it either way"
        : "version strings match, but the content timestamps could not be read — reporting 'in sync' on that basis alone is the exact blind spot this check exists to close",
    };
  }

  if (versionDrift) {
    return {
      status: "drifted",
      reason: `version strings differ (repo v${manifestVersion}, installed v${installedVersion})`,
    };
  }

  if (treeAt > installedAt) {
    return {
      status: "drifted",
      reason: `version strings match (v${manifestVersion}) but zaf-app/ has a commit at ${treeAt.toISOString()}, `
        + `newer than the install (${installedAt.toISOString()}) — a content change landed without a version bump`,
    };
  }

  return {
    status: "in_sync",
    reason: `v${manifestVersion} installed at ${installedAt.toISOString()}; no zaf-app/ commit since`,
  };
}

function toDate(value) {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
