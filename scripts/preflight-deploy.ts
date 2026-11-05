/**
 * Runs before `npm run deploy` / `npm run cf:deploy` (npm `predeploy`).
 *
 * Four refusals, all decided in `src/lib/deploy-preflight.ts` where they are
 * unit-tested: the config must carry real resource ids, not the product
 * template's all-zero ones (RELEASE.md §7); the tree must be the branch — not behind
 * its upstream, not carrying uncommitted tracked changes — because `wrangler
 * deploy` uploads whatever is on disk and has reverted production twice; and
 * every migration production D1 has applied must be in this tree, or the new
 * Worker answers 503 on every database route; and every native landing page
 * production D1 lists must be in this tree's register, or the hourly reconcile
 * deletes it (overridable with ALLOW_NATIVE_LANDING_REMOVAL=1).
 *
 * It cannot cover a bare `npx wrangler deploy`: wrangler has no pre-deploy
 * hook, so RELEASE.md names `npm run deploy` as the deploy command. Anyone
 * reaching for wrangler directly is choosing to skip this. Refusing is the
 * whole job — it never deploys, and it holds no credentials.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import {
  checkDeployTarget,
  evaluateDeployPreflight,
  findProductOwnedEdits,
  findUnbundledMigrations,
  findUnregisteredNativeLandings,
  parseWranglerConfig,
} from "../src/lib/deploy-preflight.ts";
import { activeNativeLandingPages } from "../src/lib/native-landing-pages.ts";

function git(args: string[]): string {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

// The working tree's config, because that is the file wrangler itself reads —
// not `git show HEAD:…`, which would miss exactly the case where the checked-out
// config has drifted.
const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const target = parseWranglerConfig(config);
const targetResult = checkDeployTarget(target);
if (!targetResult.ok) {
  console.error("\npreflight: refusing to deploy.\n");
  for (const reason of targetResult.reasons) console.error(`  - ${reason}`);
  console.error(
    [
      "",
      "This config still carries the product template's ids (or none at all).",
      "One-click installs get real ids from the Deploy to Cloudflare button; a CLI",
      "install pastes the ids `wrangler d1 create` / `kv namespace create` print",
      "(INSTALLATION.md). If this IS an install: restore its wrangler.jsonc, then re-run.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

// The production ledger. A fresh database has no d1_migrations table yet, which
// is fine; any other failure (no network, no D1 permission) is reported, not
// guessed at.
const databaseName = String(target.d1Databases?.[0]?.database_name ?? "");
if (databaseName) {
  let ledger: string[] | null = null;
  try {
    const raw = execFileSync(
      "npx",
      ["wrangler", "d1", "execute", databaseName, "--remote", "--json", "--command", "SELECT name FROM d1_migrations ORDER BY id"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const parsed = JSON.parse(raw) as { results?: { name?: unknown }[] }[];
    ledger = (parsed[0]?.results ?? []).map((row) => String(row.name));
  } catch (error) {
    const detail = String((error as { stdout?: unknown }).stdout ?? "") + String((error as { stderr?: unknown }).stderr ?? "");
    if (/no such table: d1_migrations/.test(detail)) ledger = [];
    else console.warn("[preflight] could not read the production migration ledger; it was not compared.");
  }
  if (ledger) {
    const bundled = readdirSync(new URL("../src/db/migrations/", import.meta.url)).filter((file) => file.endsWith(".sql"));
    const missing = findUnbundledMigrations(ledger, bundled);
    if (missing.length) {
      console.error("\n[preflight] Refusing to deploy:\n");
      console.error(`  ✖ Production D1 (${databaseName}) has applied ${missing.length} migration(s) this tree does not have:`);
      for (const name of missing) console.error(`      ${name}`);
      console.error(
        "\n  The Worker would answer 503 on every database route. Bring those files into this\n" +
          "  checkout from wherever they were applied, commit them, then deploy.\n",
      );
      process.exit(1);
    }
    console.log(`[preflight] production D1 ledger: ${ledger.length} applied, all in this tree.`);
  }

  // Same database, same reasoning: a fresh store has no landing_pages yet.
  let live: string[] | null = null;
  try {
    const raw = execFileSync(
      "npx",
      ["wrangler", "d1", "execute", databaseName, "--remote", "--json", "--command", "SELECT slug FROM landing_pages WHERE source = 'native' ORDER BY slug"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const parsed = JSON.parse(raw) as { results?: { slug?: unknown }[] }[];
    live = (parsed[0]?.results ?? []).map((row) => String(row.slug));
  } catch (error) {
    const detail = String((error as { stdout?: unknown }).stdout ?? "") + String((error as { stderr?: unknown }).stderr ?? "");
    if (/no such (table|column)/.test(detail)) live = [];
    else console.warn("[preflight] could not read production native landing pages; they were not compared.");
  }
  if (live) {
    const unregistered = findUnregisteredNativeLandings(live, activeNativeLandingPages().map((entry) => entry.slug));
    if (unregistered.length && process.env.ALLOW_NATIVE_LANDING_REMOVAL !== "1") {
      console.error("\n[preflight] Refusing to deploy:\n");
      console.error(`  ✖ Production D1 (${databaseName}) lists ${unregistered.length} native landing page(s) this tree's register does not:`);
      for (const slug of unregistered) console.error(`      /${slug}`);
      console.error(
        "\n  Within the hour the reconcile would delete those rows and any product page they claim.\n" +
          "  Bring their route files and register entries (src/data/native-landing-pages.ts) into this\n" +
          "  checkout. If removing them is intended, set ALLOW_NATIVE_LANDING_REMOVAL=1.\n",
      );
      process.exit(1);
    }
    if (unregistered.length) console.warn(`[preflight] ALLOW_NATIVE_LANDING_REMOVAL=1: ${unregistered.length} native landing page(s) will be removed.`);
    else console.log(`[preflight] production native landing pages: ${live.length}, all registered.`);
  }
}

// Workers Builds (the Deploy button's pipeline) deploys the pushed commit.
const ci =
  process.env.WORKERS_CI === "1"
    ? { branch: process.env.WORKERS_CI_BRANCH ?? "", commit: process.env.WORKERS_CI_COMMIT_SHA ?? "" }
    : undefined;
const branch = ci ? "" : git(["rev-parse", "--abbrev-ref", "HEAD"]).replace(/^HEAD$/, "");
const upstream = branch ? git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]) : "";

// Without this the behind-count is whatever the last fetch happened to know —
// which is exactly the blind spot that let both reverted releases through.
if (upstream) {
  try {
    execFileSync("git", ["fetch", "--quiet", "origin"], { stdio: "ignore" });
  } catch {
    console.warn("[preflight] could not reach origin; comparing against the last known state.");
  }
}

const result = evaluateDeployPreflight({
  branch,
  upstream,
  behind: upstream ? Number(git(["rev-list", "--count", `HEAD..${upstream}`]) || "0") : 0,
  dirtyPaths: ci ? [] : git(["diff", "--name-only", "HEAD"]).split("\n").map((l) => l.trim()).filter(Boolean),
  workerName: String(target.name ?? "unknown"),
  overridden: process.env.ALLOW_STALE_DEPLOY === "1",
  ci,
});

for (const note of result.notes) console.log(`[preflight] ${note}`);
if (!target.placement) {
  console.warn('[preflight] wrangler.jsonc has no `placement`: a visitor routed to a far colo pays every D1 read across the ocean.');
  console.warn('  Add `"placement": { "region": "aws:ap-southeast-1" }` as the product template does (ADR-034).');
} else if ((target.placement as { mode?: unknown }).mode === 'smart') {
  console.warn('[preflight] wrangler.jsonc uses Smart Placement, which declined requests entering at LAX (ADR-034).');
  console.warn('  With D1 in APAC, pin it: `"placement": { "region": "aws:ap-southeast-1" }`.');
}

// An install that shares history with the product: what it has changed in the
// product's own files since the version it last merged. Warned, not refused.
const productBase = git(["merge-base", "HEAD", "product/main"]);
if (productBase) {
  const edits = findProductOwnedEdits(
    git(["diff", "--name-only", productBase, "HEAD"]).split("\n"),
    activeNativeLandingPages().map((entry) => entry.slug),
  );
  if (edits.length) {
    console.warn(`[preflight] ${edits.length} product-owned file(s) edited in this install since its last product merge:`);
    for (const path of edits.slice(0, 10)) console.warn(`      ${path}`);
    if (edits.length > 10) console.warn(`      … and ${edits.length - 10} more (git diff --stat ${productBase.slice(0, 7)} HEAD)`);
    console.warn("  The next `git merge product/main` conflicts wherever both sides moved; a fix every store needs belongs in adsbookcms.");
  }
}
if (!result.ok) {
  console.error("\n[preflight] Refusing to deploy:\n");
  for (const failure of result.failures) console.error(`  ✖ ${failure}\n`);
  console.error(
    "  `wrangler deploy` uploads the working tree, not the branch. Set ALLOW_STALE_DEPLOY=1 only if\n" +
      "  you have decided that this tree, exactly as it is, belongs in production.\n",
  );
  process.exit(1);
}
// Not "tree matches the branch": on the override path it demonstrably does not.
console.log("[preflight] proceeding to deploy.\n");
