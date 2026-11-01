#!/usr/bin/env bash
# Exports the public RGCS repository: the committed tree at HEAD minus exclude.txt, checked
# against denylist.txt, as a new repository with a single commit and no internal history.
#
#   scripts/export/export-public.sh <dest> --author "RtoS Co., Ltd. <oss@example.com>"
#   scripts/export/export-public.sh <dest> --report-only   # list the findings, make no repo
#
# Only committed files are exported (git archive): untracked files such as auto.crt / auto.key
# or .dev/ can never leak. <dest> must not exist or be empty. Nothing is pushed.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(git -C "$HERE" rev-parse --show-toplevel)"
REQUIRED=(LICENSE README.md README.ja.md PLUGINS.md)

usage() { sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2; }

DEST=""; AUTHOR=""; REPORT_ONLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --author) AUTHOR="${2:-}"; shift 2 ;;
    --report-only) REPORT_ONLY=1; shift ;;
    -h|--help) usage ;;
    -*) echo "unknown option: $1" >&2; usage ;;
    *) [ -z "$DEST" ] || usage; DEST="$1"; shift ;;
  esac
done
[ -n "$DEST" ] || usage
if [ "$REPORT_ONLY" = 0 ] && ! [[ "$AUTHOR" =~ ^[^\<\>]+\ \<[^\<\>@\ ]+@[^\<\>\ ]+\>$ ]]; then
  echo "--author \"Name <email>\" is required (the public commit's author)" >&2
  exit 2
fi
if [ -e "$DEST" ] && [ -n "$(ls -A "$DEST")" ]; then
  echo "$DEST is not empty" >&2
  exit 2
fi
if [ -n "$(git -C "$REPO" status --porcelain --untracked-files=no)" ]; then
  echo "note: uncommitted changes are not exported (HEAD only)" >&2
fi

# 1. the committed tree without the excluded paths
excludes=()
while IFS= read -r line; do
  case "$line" in ''|'#'*) continue ;; esac
  excludes+=(":(exclude,top)$line")
done < "$HERE/exclude.txt"
mkdir -p "$DEST"
git -C "$REPO" archive --format=tar HEAD -- . "${excludes[@]}" | tar -x -C "$DEST"

# 2. defensive: nothing excluded made it, every required file did
status=0
while IFS= read -r line; do
  case "$line" in ''|'#'*) continue ;; esac
  if [ -e "$DEST/$line" ]; then echo "excluded path present: $line" >&2; status=1; fi
done < "$HERE/exclude.txt"
for f in "${REQUIRED[@]}"; do
  if [ ! -f "$DEST/$f" ]; then echo "required file missing: $f" >&2; status=1; fi
done

# 3. the denylist scan
findings=0
while IFS=$'\t' read -r pattern reason; do
  case "$pattern" in ''|'#'*) continue ;; esac
  hits="$(cd "$DEST" && grep -rnIE --exclude-dir=.git -e "$pattern" . 2>/dev/null | sed 's#^\./##' | cut -c1-200 || true)"
  if [ -n "$hits" ]; then
    echo "== $reason  [/$pattern/]" >&2
    sed 's/^/   /' <<<"$hits" >&2
    findings=$((findings + $(wc -l <<<"$hits")))
  fi
done < "$HERE/denylist.txt"
[ "$findings" = 0 ] || { echo "$findings finding(s): fix them in the internal repo, commit, export again" >&2; status=1; }

if [ "$status" != 0 ] || [ "$REPORT_ONLY" = 1 ]; then
  [ "$REPORT_ONLY" = 1 ] && [ "$status" = 0 ] && echo "report: clean" >&2
  # never leave a half-checked tree that looks like an export
  if [ "$REPORT_ONLY" = 0 ]; then rm -rf "$DEST"; fi
  exit "$status"
fi

# 4. a fresh repository with one commit
name="${AUTHOR% <*}"; email="${AUTHOR##*<}"; email="${email%>}"
version="$( { sed -n 's/^version = "\(.*\)"/\1/p' "$DEST/Cargo.toml" 2>/dev/null || true; } | head -1)"
git -C "$DEST" init -q -b main
git -C "$DEST" add -A
GIT_AUTHOR_NAME="$name" GIT_AUTHOR_EMAIL="$email" GIT_COMMITTER_NAME="$name" GIT_COMMITTER_EMAIL="$email" \
  git -C "$DEST" -c commit.gpgsign=false commit -q -m "RGCS ${version:-initial release}"
echo "exported $(git -C "$DEST" ls-files | wc -l | tr -d ' ') files to $DEST ($(git -C "$DEST" rev-parse --short HEAD)); nothing was pushed"
