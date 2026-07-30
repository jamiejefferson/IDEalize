#!/usr/bin/env python3
"""Daily IDEalize feedback triage: find *bug* feedback, send to Claude Code for fixing.

Queries idealize_feedback for rows with feedback_type='bug' AND status='new'.
For each bug, spawns Claude Code in the IDEalize repo to build a fix, creates a
GitHub PR, and updates the feedback row with status='fixing' / 'fixed' + PR link.

Secrets live in ~/.idealize/triage.env (chmod 600):
  SUPABASE_URL=https://xlswtyprnmiymfjdbaez.supabase.co
  SUPABASE_SECRET=sb_secret_CugZ1...

Usage:
  python3 scripts/triage-feedback.py          # normal run
  python3 scripts/triage-feedback.py --dry-run  # list bugs, skip Claude/PR
"""
import json
import os
import stat
import subprocess
import sys
import textwrap
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

HOME = Path.home()
REPO = Path(__file__).resolve().parent.parent   # IDEalize repo root
ENV_FILE = HOME / ".idealize" / "triage.env"
LOG_FILE = HOME / ".idealize" / "triage.log"


# ── helpers ────────────────────────────────────────────────────────────────

def log(msg):
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%SZ")
    line = f"[{stamp}] {msg}"
    print(line, flush=True)
    try:
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(LOG_FILE, "a") as f:
            f.write(line + "\n")
    except OSError:
        pass


def load_env(path):
    if not path.exists():
        log(f"missing env file {path}")
        sys.exit(1)
    mode = stat.S_IMODE(path.stat().st_mode)
    if mode != 0o600:
        log(f"warning: {path} mode {mode:03o}, should be 600 — chmod 600 {path}")
    cfg = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        v = v.strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "'\"":
            v = v[1:-1]
        cfg[k.strip()] = v
    return cfg


def supabase_query(sql: str, env: dict):
    """Run a SQL query via Supabase REST (POST /rest/v1/rpc for safe DB access).
    Uses the management API endpoint with an `apikey` header."""
    url = f"{env['SUPABASE_URL']}/rest/v1/idealize_feedback"
    params = {
        "select": "id,text,app_version,os_version,created_at,feedback_type,status",
        "feedback_type": "eq.bug",
        "status": "eq.new",
        "order": "created_at.asc",
        "limit": "5",
    }
    qs = urllib.parse.urlencode(params, doseq=True)
    full_url = f"{url}?{qs}"
    req = urllib.request.Request(
        full_url,
        headers={
            "apikey": env["SUPABASE_SECRET"],
            "Authorization": f"Bearer {env['SUPABASE_SECRET']}",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def supabase_update(feedback_id: str, fields: dict, env: dict):
    """Patch a single feedback row via Supabase REST."""
    url = f"{env['SUPABASE_URL']}/rest/v1/idealize_feedback"
    params = {"id": f"eq.{feedback_id}"}
    qs = urllib.parse.urlencode(params)
    full_url = f"{url}?{qs}"
    body = json.dumps(fields).encode()
    req = urllib.request.Request(
        full_url,
        data=body,
        headers={
            "apikey": env["SUPABASE_SECRET"],
            "Authorization": f"Bearer {env['SUPABASE_SECRET']}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
        method="PATCH",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        if r.status not in (200, 204):
            raise RuntimeError(f"PATCH failed HTTP {r.status}")


def run(cmd, workdir=None, timeout=300):
    """Shell out; return (stdout, stderr, exit_code)."""
    r = subprocess.run(
        cmd,
        shell=True,
        capture_output=True,
        text=True,
        cwd=workdir or REPO,
        timeout=timeout,
    )
    return r.stdout.strip(), r.stderr.strip(), r.returncode


# ── Claude Code invocation ─────────────────────────────────────────────────

def build_fix_via_claude(feedback_text: str, app_version: str) -> tuple[str, str]:
    """Run Claude Code to fix the bug in the IDEalize repo. Returns (branch_name, pr_url)."""

    # Create a short slug from the timestamp for the branch name
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    branch = f"fix/feedback-{ts}"

    log(f"  creating branch {branch}")
    out, err, rc = run(f"git checkout -b {branch} main")
    if rc != 0:
        raise RuntimeError(f"git checkout failed: {err}")

    # Assemble the prompt
    prompt = textwrap.dedent(f"""\
        You are fixing a bug reported by an IDEalize user.

        USER FEEDBACK:
        ---
        {feedback_text}
        ---

        APP VERSION: {app_version}

        TASK:
        1. Understand the bug from the user's description.
        2. Find the relevant source files in this SwiftUI+AppKit macOS app.
        3. Build a fix. The app lives under Sources/IDEalizeApp/ and Sources/IDEalizeCore/.
        4. Verify the fix compiles with `swift build` (the project uses Swift Package Manager).
        5. Commit your changes with a message like "fix: <short summary of bug>".
        6. Push the branch to origin: `git push origin {branch}`.
        7. Create a PR against `main` using `gh pr create --base main --head {branch} \\\\\\
           --title "Fix: <short summary>" --body "<explanation from user feedback>\\\\n\\\\nFixes feedback: {feedback_text[:200]}"`.
        8. Tell me the PR URL when done.

        Be thorough — the fix should compile and address the root cause, not paper over symptoms.
        """)

    # Write prompt to file (Claude Code handles multi-line better from file)
    prompt_file = REPO / ".claude" / "triage-prompt.txt"
    prompt_file.parent.mkdir(parents=True, exist_ok=True)
    prompt_file.write_text(prompt)

    log(f"  launching Claude Code (this may take a few minutes)...")
    # Use print mode — one-shot task, no dialog handling needed
    cmd = (
        f"claude -p \"$(cat {prompt_file})\""
        f" --allowedTools 'Read,Edit,Write,Bash(git *),Bash(gh *),Bash(swift *)'"
        f" --max-turns 30"
        f" --output-format json"
    )
    out, err, rc = run(cmd)

    if rc != 0:
        log(f"  Claude Code exited {rc}: {err}")

    # Try to parse JSON for session summary
    try:
        result = json.loads(out)
        subtype = result.get("subtype", "unknown")
        turns = result.get("num_turns", 0)
        cost = result.get("total_cost_usd", 0)
        log(f"  Claude done: {subtype}, {turns} turns, ${cost:.4f}")
    except (json.JSONDecodeError, Exception):
        log(f"  Claude output (not JSON): {out[:300]}...")

    # Determine if a PR was created — look in the output for a PR URL
    pr_url = ""
    for line in (out + err).splitlines():
        if "github.com/jamiejefferson/IDEalize/pull/" in line:
            pr_url = line.strip().split(" ")[-1]  # take last token
            break

    # Also try gh to find it
    if not pr_url:
        list_out, _, _ = run(f"gh pr list --head {branch} --json url,number --jq '.[0].url' // ''")
        if list_out:
            pr_url = list_out.strip()

    if not pr_url:
        log(f"  WARNING: no PR URL found in Claude output or gh pr list")

    # Return to main (don't leave the repo on the fix branch)
    run("git checkout main")

    return branch, pr_url


# ── main ───────────────────────────────────────────────────────────────────

def main():
    dry = "--dry-run" in sys.argv

    log("=== IDEalize Feedback Triage ===")
    env = load_env(ENV_FILE)
    required = ["SUPABASE_URL", "SUPABASE_SECRET"]
    for k in required:
        if k not in env:
            log(f"missing {k} in {ENV_FILE}")
            sys.exit(1)

    # Fetch new bugs
    try:
        bugs = supabase_query("", env)
    except Exception as e:
        log(f"Supabase query failed: {e}")
        sys.exit(1)

    if not bugs:
        log("no new bugs to triage")
        return

    log(f"found {len(bugs)} new bug(s)")

    for bug in bugs:
        fid = bug["id"]
        text = bug["text"]
        ver = bug.get("app_version", "unknown")

        # Truncate for display
        preview = text[:120].replace("\n", " ")
        log(f"  bug {fid[:8]}: {preview}...")

        if dry:
            log(f"    [DRY RUN] would send to Claude Code")
            continue

        # Mark as 'fixing' so we don't re-triage if the next run catches it mid-fix
        try:
            supabase_update(fid, {"status": "fixing"}, env)
        except Exception as e:
            log(f"    failed to update status: {e}")
            continue

        try:
            branch, pr_url = build_fix_via_claude(text, ver)
        except Exception as e:
            log(f"    Claude Code failed: {e}")
            supabase_update(fid, {"status": "triaged"}, env)  # retry later
            continue

        # Update feedback row with PR info
        update_fields: dict[str, object] = {
            "status": "fixed",
            "fix_branch": branch,
        }
        if pr_url:
            update_fields["fix_pr_url"] = pr_url
            # Extract PR number from URL
            try:
                pr_num = int(pr_url.rstrip("/").split("/")[-1])
                update_fields["fix_pr_number"] = pr_num
            except (ValueError, IndexError):
                pass

        try:
            supabase_update(fid, update_fields, env)
            log(f"    done — PR: {pr_url}" if pr_url else f"    done — branch: {branch} (no PR)")
        except Exception as e:
            log(f"    fix built but status update failed: {e}")

    log("=== Done ===")


if __name__ == "__main__":
    main()
