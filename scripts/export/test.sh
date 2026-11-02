#!/usr/bin/env bash
# Tests for export-public.sh against a throwaway fixture repo (no network, nothing outside $TMP).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

# fixture: an internal repo with public files, internal files and one denied string
SRC="$TMP/src"
mkdir -p "$SRC/scripts/export" "$SRC/docs" "$SRC/design_base" "$SRC/deploy/plugins/x" "$SRC/app"
cp "$HERE/export-public.sh" "$HERE/exclude.txt" "$HERE/denylist.txt" "$SRC/scripts/export/"
for f in README.md README.ja.md LICENSE LICENSE-EXCEPTION.md PLUGINS.md SECURITY.md CONTRIBUTING.md CLA.md TRADEMARKS.md; do echo "$f" > "$SRC/$f"; done
echo internal > "$SRC/docs/spec.md"
echo internal > "$SRC/design_base/a.html"
echo internal > "$SRC/CLAUDE.md"
echo 'tiles = "x"' > "$SRC/deploy/plugins/x/plugin.toml"
printf 'fn main() {}\n// pilot 川村\n' > "$SRC/app/main.rs"
echo secret > "$SRC/auto.key" # untracked: must never be exported
git -C "$SRC" init -q -b main
git -C "$SRC" -c user.name=t -c user.email=t@example.com add -A ':!auto.key'
git -C "$SRC" -c user.name=t -c user.email=t@example.com commit -q -m internal
EXPORT="$SRC/scripts/export/export-public.sh"

# 1. a denied string stops the export before any repo is made
if out="$("$EXPORT" "$TMP/out1" --author 'RtoS Co., Ltd. <oss@example.com>' 2>&1)"; then fail "export passed with a denied string"; fi
grep -q 'app/main.rs:2' <<<"$out" || fail "the finding names the file and line: $out"
grep -q 'real name' <<<"$out" || fail "the finding gives the reason: $out"
[ ! -d "$TMP/out1/.git" ] || fail "no repo after a refused export"

# 2. --report-only lists findings and makes no repo
"$EXPORT" "$TMP/out2" --report-only >/dev/null 2>&1 && fail "report-only still exits non-zero on findings" || true
[ ! -d "$TMP/out2/.git" ] || fail "report-only made a repo"

# 3. clean tree: one commit, the given author, internal files and untracked files absent
sed -i.bak 's/川村/Sato/' "$SRC/app/main.rs" && rm "$SRC/app/main.rs.bak"
git -C "$SRC" -c user.name=t -c user.email=t@example.com commit -qam clean
"$EXPORT" "$TMP/out3" --author "RtoS Co., Ltd. <oss@example.com>" || fail "clean export failed"
for p in docs design_base CLAUDE.md deploy/plugins scripts/export auto.key; do
  [ ! -e "$TMP/out3/$p" ] || fail "$p was exported"
done
for p in README.md README.ja.md LICENSE PLUGINS.md SECURITY.md app/main.rs; do
  [ -f "$TMP/out3/$p" ] || fail "$p is missing"
done
[ "$(git -C "$TMP/out3" rev-list --count HEAD)" = 1 ] || fail "not a single commit"
[ "$(git -C "$TMP/out3" log -1 --format='%an <%ae>')" = 'RtoS Co., Ltd. <oss@example.com>' ] || fail "author"
[ "$(git -C "$TMP/out3" branch --show-current)" = main ] || fail "branch"
git -C "$TMP/out3" log -1 --format=%B | grep -q internal && fail "the internal history leaked into the message"

# 3b. a pattern allowed in one file is found everywhere else
mkdir -p "$SRC/deploy" && echo 'tiles = "https://server.arcgisonline.com/x"' > "$SRC/deploy/config.toml.example"
git -C "$SRC" -c user.name=t -c user.email=t@example.com add -A ':!auto.key'
git -C "$SRC" -c user.name=t -c user.email=t@example.com commit -qm example
"$EXPORT" "$TMP/out3b" --report-only >/dev/null 2>&1 || fail "the allowed file was reported"
echo '// https://server.arcgisonline.com/y' >> "$SRC/app/main.rs"
git -C "$SRC" -c user.name=t -c user.email=t@example.com commit -qam leak
out="$("$EXPORT" "$TMP/out3c" --report-only 2>&1 || true)"
grep -q 'app/main.rs:3' <<<"$out" || fail "a hit outside the allowed file: $out"
grep -q 'config.toml.example' <<<"$out" && fail "the allowed file was listed: $out"
sed -i.bak '3d' "$SRC/app/main.rs" && rm "$SRC/app/main.rs.bak"
git -C "$SRC" -c user.name=t -c user.email=t@example.com commit -qam unleak

# 4. a non-empty destination is refused
"$EXPORT" "$TMP/out3" --author 'a <a@example.com>' >/dev/null 2>&1 && fail "overwrote a non-empty destination"

# 5. a required public file missing stops the export
for f in SECURITY.md PLUGINS.md CLA.md LICENSE-EXCEPTION.md; do
  git -C "$SRC" rm -q "$f" && git -C "$SRC" -c user.name=t -c user.email=t@example.com commit -qm "drop $f"
  "$EXPORT" "$TMP/out5-$f" --author 'a <a@example.com>' >/dev/null 2>&1 && fail "exported without $f"
  echo "$f" > "$SRC/$f" && git -C "$SRC" add "$f" && git -C "$SRC" -c user.name=t -c user.email=t@example.com commit -qm "restore $f"
done

echo "export tests: ok"
