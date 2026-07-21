#!/usr/bin/env python3
"""Sync IDEalize feedback from Supabase into the Obsidian vault + notify.

Polls the `feedback-sync` Edge Function for rows newer than the last seen one,
appends them to the vault's "Feedback Inbox.md", and raises a macOS
notification. Config + the shared secret live in ~/.idealize/feedback-sync.env
(never committed). Run periodically by the com.idealize.feedback-sync LaunchAgent.
"""
import json
import stat
import subprocess
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

HOME = Path.home()
ENV = HOME / ".idealize" / "feedback-sync.env"
STATE = HOME / ".idealize" / "feedback-sync.state"


def load_env(path):
    cfg = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        v = v.strip()
        # Tolerate quoted values (KEY="..." / KEY='...') in the env file.
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "'\"":
            v = v[1:-1]
        cfg[k.strip()] = v
    return cfg


def sanitize(s):
    """Strip the characters that would let untrusted feedback text break out of
    its code fence or inject HTML when Obsidian renders the vault note."""
    return s.replace("`", "").replace("<", "").replace(">", "")


def parse_ts(s):
    """Parse a created_at timestamp; None if malformed. Naive values are
    assumed UTC so comparisons stay tz-aware."""
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:  # noqa: BLE001
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def notify(title, text):
    def esc(s):
        return s.replace("\\", "\\\\").replace('"', '\\"')
    script = (f'display notification "{esc(text)}" with title "{esc(title)}" '
              f'sound name "Glass"')
    subprocess.run(["osascript", "-e", script], check=False)


def main():
    if not ENV.exists():
        print("no env file at", ENV, file=sys.stderr)
        return
    mode = stat.S_IMODE(ENV.stat().st_mode)
    if mode != 0o600:
        print(f"warning: {ENV} is mode {mode:03o}, should be 600 — it holds a "
              f"shared secret (chmod 600 {ENV})", file=sys.stderr)
    cfg = load_env(ENV)
    url, secret, vault = cfg.get("SYNC_URL"), cfg.get("SYNC_SECRET"), cfg.get("VAULT_FILE")
    if not (url and secret and vault):
        print("incomplete config", file=sys.stderr)
        return
    if urllib.parse.urlparse(url).scheme != "https":
        print("SYNC_URL must be https:// — refusing to send the secret over "
              "plaintext http", file=sys.stderr)
        return

    since = STATE.read_text().strip() if STATE.exists() else "1970-01-01T00:00:00Z"
    req = urllib.request.Request(
        f"{url}?since={urllib.parse.quote(since)}",
        headers={"x-sync-secret": secret},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            rows = json.loads(r.read(2 * 1024 * 1024).decode())  # 2 MB cap
    except Exception as e:  # noqa: BLE001
        print(f"sync failed: {e}", file=sys.stderr)
        return

    if not isinstance(rows, list):
        print(f"unexpected response: {rows}", file=sys.stderr)
        return
    if not rows:
        return

    vault_path = Path(vault)
    vault_path.parent.mkdir(parents=True, exist_ok=True)
    if not vault_path.exists():
        vault_path.write_text("# IDEalize — Feedback Inbox\n\n"
                              "New feedback from the app syncs here automatically.\n")

    # Compare parsed datetimes, never raw strings — one malformed or far-future
    # created_at must not permanently suppress future syncs.
    since_dt = parse_ts(since) or datetime(1970, 1, 1, tzinfo=timezone.utc)
    chunks, newest_dt, newest_raw, last_text = [], since_dt, since, ""
    for row in rows:
        created = row.get("created_at", "")
        dt = parse_ts(created)
        if dt is None:
            print(f"skipping row with unparseable created_at: {created!r}",
                  file=sys.stderr)
            continue
        text = sanitize((row.get("text") or "").strip())
        ver = row.get("app_version") or "?"
        osv = sanitize(row.get("os_version") or "")
        stamp = dt.astimezone().strftime("%Y-%m-%d %H:%M")
        # Feedback text is untrusted (anyone can insert rows). Fence it in a
        # code block so Obsidian renders it inert — no ![[...]] transclusion,
        # no markdown/HTML injection.
        chunks.append(f"\n## {stamp} · v{ver}\n\n```\n{text}\n```\n\n"
                      f"os: {osv}\n\n---\n")
        last_text = text
        if dt > newest_dt:
            newest_dt, newest_raw = dt, created

    if not chunks:
        return

    with vault_path.open("a") as f:
        f.write("".join(chunks))
    STATE.write_text(newest_raw)

    n = len(chunks)
    preview = last_text.replace("\n", " ")
    if len(preview) > 110:
        preview = preview[:110] + "…"
    title = "New IDEalize feedback" if n == 1 else f"{n} new IDEalize feedback"
    notify(title, preview)
    print(f"synced {n} item(s)")


if __name__ == "__main__":
    main()
