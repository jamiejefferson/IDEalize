#!/usr/bin/env bash
# Go-live for IDEalize V1 (JJ, 16 Sep 2026: "one repo for Idealize and the old
# versions are archived within it"). The public jamiejefferson/IDEalize
# repository keeps its history: V0's last commit is kept as branch `v0` and tag
# `v0-final`, and one squashed V1 commit lands on main with the desktop app at
# the root and the harness under `harness/`. The first release carries the
# macOS disk image; the release workflow on the tag builds the rest.
#
# Prints every step unless called with --go; --yes skips the pauses.
#
#   scripts/flip-public.sh                # print the plan
#   scripts/flip-public.sh --go [--yes]   # perform it
#   scripts/flip-public.sh --sync --go [--yes] [--tag vX.Y.Z]
#       after the first go-live: export both repositories again as one commit
#       on top of the public main (no V0 step, no local disk image) and,
#       with --tag, push that tag so the release workflow builds the assets.
#
set -euo pipefail

DESKTOP="${DESKTOP:-$HOME/dev/idealize-desktop}"
HARNESS="${HARNESS:-$HOME/dev/idealize}"
V0_SITE="${V0_SITE:-$HOME/dev/idealize-site}"
DMG="${DMG:-$DESKTOP/dsh-plugin-desktop/dist/mac-public/IDEalize-V1-1.0.1-universal.dmg}"
OWNER="jamiejefferson"
PUBLIC="https://github.com/$OWNER/IDEalize.git"
VERSION="1.0.1"
EXPORT="$(mktemp -d)"
GO=0; YES=0; SYNC=0; TAG=""
prev=""
for arg in "$@"; do
  [ "$arg" = "--go" ] && GO=1
  [ "$arg" = "--yes" ] && YES=1
  [ "$arg" = "--sync" ] && SYNC=1
  [ "$prev" = "--tag" ] && TAG="$arg"
  prev="$arg"
done

run() {
  echo "+ $*"
  if [ "$GO" = 1 ]; then "$@"; fi
}

confirm() {
  if [ "$GO" = 1 ] && [ "$YES" = 0 ]; then
    read -r -p "$1 [y/N] " answer
    [ "$answer" = "y" ] || { echo "stopped"; exit 1; }
  fi
}

# The tracked tree of one repository's HEAD without its private folders, with
# client names scrubbed, copied into $2.
export_tree() {
  local src="$1" dest="$2"
  echo "+ export $src -> $dest"
  if [ "$GO" = 1 ]; then
    mkdir -p "$dest"
    git -C "$src" archive --format=tar HEAD | tar -x -C "$dest"
    rm -rf "$dest/.idealize" "$dest/.claude"
    grep -rlI -E "the team|eqtr\.com|Notes|the audit" "$dest" --exclude-dir=node_modules 2>/dev/null \
      | xargs -I{} sed -i '' -E 's/the team/the team/g; s/eqtr\.com/example.com/g; s/Notes/Notes/g; s/the audit/the audit/g' {}
  fi
}

echo "== 0. Preflight"
[ "$SYNC" = 1 ] || run test -f "$DMG"
run gitleaks detect --no-git --source "$DESKTOP" --redact --exit-code 0 --report-path "$EXPORT/leaks-desktop.json"
run gitleaks detect --no-git --source "$HARNESS" --redact --exit-code 0 --report-path "$EXPORT/leaks-harness.json"
if [ "$GO" = 1 ]; then echo "gitleaks findings (known: test fixtures, the website download gate, a placeholder):"; python3 -c "import json,sys; [print(' ', f['File'], f['RuleID']) for p in sys.argv[1:] for f in json.load(open(p))]" "$EXPORT/leaks-desktop.json" "$EXPORT/leaks-harness.json"; fi
if [ "$GO" = 1 ]; then
  [ -n "$(git -C "$DESKTOP" status --porcelain)" ] && { echo "desktop tree is dirty"; exit 1; }
  [ -n "$(git -C "$HARNESS" status --porcelain | grep -v 'tool-cordis/src/api-catalog.ts')" ] && { echo "harness tree is dirty"; exit 1; }
fi

if [ "$SYNC" = 0 ]; then
echo "== 1. V0 archived inside the repository: branch v0 and tag v0-final on the current IDEalize main"
run git -C "$V0_SITE" fetch origin main
run git -C "$V0_SITE" push origin origin/main:refs/heads/v0
run git -C "$V0_SITE" push origin origin/main:refs/tags/v0-final
fi

echo "== 2. One squashed V1 commit on top of that history: the desktop app at the root, the harness under harness/"
run git clone -q --branch main "$PUBLIC" "$EXPORT/repo"
if [ "$GO" = 1 ]; then
  git -C "$EXPORT/repo" rm -rq . >/dev/null
  find "$EXPORT/repo" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
fi
export_tree "$DESKTOP" "$EXPORT/repo"
# git archive drops the submodule gitlink; the layout check needs the upstream checkout.
run git -C "$EXPORT/repo" update-index --add --cacheinfo "160000,$(git -C "$DESKTOP" ls-files -s deepseek-harness | awk '{print $2}'),deepseek-harness"
export_tree "$HARNESS" "$EXPORT/repo/harness"
if [ "$GO" = 1 ]; then
  # The harness's pre-release section ends at the first tagged release, and
  # every repository link names the one public repository.
  sed -i '' '/^## Pre-release stance/,/^## Repository layout/{/^## Repository layout/!d;}' "$EXPORT/repo/harness/AGENTS.md"
  grep -rl -E "jamiejefferson/(idealize-v1|idealize-harness|idealize-desktop)" "$EXPORT/repo" --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null \
    | xargs -I{} sed -i '' -E 's#jamiejefferson/(idealize-v1|idealize-harness)#jamiejefferson/IDEalize#g; s#jamiejefferson/IDEalize#jamiejefferson/IDEalize#g' {}
  git -C "$EXPORT/repo" add -A
  if [ "$SYNC" = 1 ]; then
    git -C "$EXPORT/repo" -c user.name="Jamie Jefferson" -c user.email="jj@example.com" commit -q -m "IDEalize V1: sync from the working repositories ($(git -C "$DESKTOP" rev-parse --short HEAD), harness $(git -C "$HARNESS" rev-parse --short HEAD))" || echo "nothing to sync"
  else
  git -C "$EXPORT/repo" -c user.name="Jamie Jefferson" -c user.email="jj@example.com" commit -q -m "IDEalize V1 $VERSION

The agent-directing desktop app for designers (root) over the IDEalize harness (harness/), a fork of DeepSeek Harness. V0 is kept as branch v0 and tag v0-final."
  fi
fi
confirm "Push V1 to $OWNER/IDEalize main (V0 stays on branch v0)?"
run git -C "$EXPORT/repo" push origin main:main
run gh repo edit "$OWNER/IDEalize" --description "IDEalize V1: the agent-directing desktop app for designers, for macOS. V0 lives on branch v0." --homepage "https://idealize.projject.ai"

if [ "$SYNC" = 1 ]; then
  if [ -n "$TAG" ]; then
    echo "== 3. Tag $TAG on the public main; the release workflow builds and uploads the assets"
    run git -C "$EXPORT/repo" tag "$TAG"
    run git -C "$EXPORT/repo" push origin "refs/tags/$TAG"
  fi
  echo "done"
  exit 0
fi
echo "== 3. Release v$VERSION with the macOS disk image; the tag also runs the release workflow"
run cp "$DMG" "$EXPORT/IDEalize-V1-mac.dmg"
run gh release create "v$VERSION" "$EXPORT/IDEalize-V1-mac.dmg" --repo "$OWNER/IDEalize" --target main --title "IDEalize V1 $VERSION" --notes "First public release of V1. macOS, self-signed: run the one-line installer from https://idealize.projject.ai, or drag the app to Applications and clear the quarantine flag once."

echo "== 4. The site: Vercel deploys website/ from IDEalize main on the push; check https://idealize.projject.ai shows the V1 download section"
echo "done"
