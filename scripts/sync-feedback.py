#!/usr/bin/env python3
"""Sync IDEalize feedback from Supabase into the Obsidian vault + notify.

Polls the `feedback-sync` Edge Function for rows newer than the last seen one,
appends them to the vault's "Feedback Inbox.md", and raises a macOS
notification. Config + the shared secret live in ~/.idealize/feedback-sync.env
(never committed). Run periodically by the com.idealize.feedback-sync LaunchAgent.
"""
import json
import subprocess
import sys
import urllib.parse
import urllib.request
from datetime import datetime
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
        cfg[k.strip()] = v.strip()
    return cfg


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
    cfg = load_env(ENV)
    url, secret, vault = cfg.get("SYNC_URL"), cfg.get("SYNC_SECRET"), cfg.get("VAULT_FILE")
    if not (url and secret and vault):
        print("incomplete config", file=sys.stderr)
        return

    since = STATE.read_text().strip() if STATE.exists() else "1970-01-01T00:00:00Z"
    req = urllib.request.Request(
        f"{url}?since={urllib.parse.quote(since)}",
        headers={"x-sync-secret": secret},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            rows = json.loads(r.read().decode())
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

    chunks, newest = [], since
    for row in rows:
        created = row.get("created_at", "")
        text = (row.get("text") or "").strip()
        ver = row.get("app_version") or "?"
        osv = row.get("os_version") or ""
        try:
            dt = datetime.fromisoformat(created.replace("Z", "+00:00")).astimezone()
            stamp = dt.strftime("%Y-%m-%d %H:%M")
        except Exception:  # noqa: BLE001
            stamp = created
        chunks.append(f"\n## {stamp} · v{ver}\n\n{text}\n\n"
                      f"<sub>{osv}</sub>\n\n---\n")
        if created > newest:
            newest = created

    with vault_path.open("a") as f:
        f.write("".join(chunks))
    STATE.write_text(newest)

    n = len(rows)
    preview = (rows[-1].get("text") or "").strip().replace("\n", " ")
    if len(preview) > 110:
        preview = preview[:110] + "…"
    title = "New IDEalize feedback" if n == 1 else f"{n} new IDEalize feedback"
    notify(title, preview)
    print(f"synced {n} item(s)")


if __name__ == "__main__":
    main()
