# Deploying the website + release infrastructure (Supabase + Vercel)

**Read this first — the situation changed.** The live website (website repo
PR #3, "Replace gated download with macOS-only note and copyable curl
command") no longer uses the Supabase email-code gate. Distribution is now:

- **GitHub Releases** (`github.com/jamiejefferson/IDEalize/releases/latest`)
  as the download channel, cut with `scripts/release.sh` on `main`.
- **`install.sh`** as the one-line installer (`curl … | bash`), which also
  sends one anonymous version ping.

So this runbook is now mostly a reference. What is still worth doing:

1. **Security headers for the live site** (small, worth doing) — section 1.
2. **Decide the fate of the retired Supabase gate** (leave deployed but
   unused, or tear down) — section 2.
3. **Only if you revive the gate:** the hardening deploy — section 3.

**Repo layout gotcha:** `website/` is its OWN git repository
(`jamiejefferson/website`), and the local checkout is currently **9 commits
behind its origin/main** — the live site is AHEAD of this working copy (new
critters, video background, Buy Me a Coffee widget, gate removal). The local
uncommitted edits here (index.html tweaks, `vercel.json`) were made against
the OLD gated page. Merge `origin/main` in the website repo BEFORE deploying
anything; several index.html tweaks (defer, reduced-motion, rAF pause) will
need re-applying to the new page by hand.

---

## 1. Security headers for the live site (do this)

`website/vercel.json` (uncommitted locally) sets CSP, X-Frame-Options,
nosniff, Referrer-Policy and Permissions-Policy on all routes. It has been
written for the CURRENT live page: `esm.sh` (the ogl gallery import) and
`cdnjs.buymeacoffee.com` (the coffee widget) are allowlisted; the Supabase
origin was dropped since the page no longer calls it.

Deploy:

```bash
cd website
git merge origin/main        # reconcile first; resolve any conflicts
# re-apply the small JS fixes to the new index.html if wanted (see below)
vercel --prod                # or push and let Vercel deploy
curl -sI https://<your-site>/ | grep -iE 'content-security-policy|x-frame-options|x-content-type-options|referrer-policy|permissions-policy'
```

All five headers should be present. Then load the site and check the gallery,
the critters and the coffee widget all still render; if anything is blocked,
the browser console names the blocked origin — allowlist it in `vercel.json`
and redeploy.

Small JS fixes made on the old page that are worth re-applying to the new one
(it uses the same gallery stack): `defer` on the `gallery-items.js` script
tag, honouring `prefers-reduced-motion` for the auto-drift, and pausing the
rAF loop when the tab is hidden or the gallery is off-screen.

## 2. The retired Supabase gate

The functions `request-download` and `verify-download` are presumably still
deployed in Supabase (project `xlswtyprnmiymfjdbaez`) but nothing calls them.
Options:

- **Leave them.** No traffic, no cost to speak of. The hardening in this repo
  (atomic redemption, per-IP throttle) stays undeployed — fine, since nothing
  uses the endpoints.
- **Tear down.** Delete both functions and the `download_codes` /
  `download_log` tables from the dashboard. Do NOT delete anything if
  `install.sh`'s anonymous version ping or `scripts/sync-feedback.py` point at
  the same project — check their URLs first (`grep -n supabase install.sh
  scripts/sync-feedback.py`).

Note the local uncommitted Supabase work (migration, config.toml, rewritten
functions) is NOT deployed. If you keep the gate retired, none of it needs
deploying.

## 3. Only if you revive the email-code gate

The gate code in this repo was hardened against abuse (the old live version
had a brute-force race and no per-IP limit). To deploy it:

1. Review `supabase/migrations/0001_init.sql` against the live tables (it was
   inferred from the function code, never run against production; it enables
   RLS and adds two RPCs: `redeem_download_code`, `check_ip_rate_limit`).
   Apply with `supabase link --project-ref xlswtyprnmiymfjdbaez && supabase db push`.
2. `supabase functions deploy request-download` and
   `supabase functions deploy verify-download`. The linked
   `supabase/config.toml` sets `verify_jwt = false` for both — required, since
   the site calls them with the publishable key.
3. Smoke-test: request a code to a real `@eqtr.com` address; 5 wrong attempts
   must cap (429 on the 6th); the right code returns a signed URL once;
   replay fails. All responses should carry `Cache-Control: no-store`.
4. If the gate returns to the website, re-add `https://*.supabase.co` to
   `connect-src` in `website/vercel.json`.

## Release ritual (current, on `main`)

This already works and needs no changes:

```bash
# on main, after bumping CFBundleShortVersionString in scripts/build-app.sh:
./scripts/release.sh notes.md
```

It builds + signs (fails hard on signing errors), zips with ditto (signature
stays intact), and publishes the GitHub release. Optional extra: run
`shasum -a 256 dist/IDEalize-macOS.zip` (or `IDEALIZE_MAKE_ZIP=1
./scripts/build-app.sh`) and paste the hash into the release notes for anyone
who wants to verify their download.
