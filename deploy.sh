#!/usr/bin/env bash
# Publish this page to GitHub Pages, from this repository.
#
#   GH_TOKEN=ghp_xxx ./deploy.sh [owner] [repo]
#
# The token is read from the environment only. It is never written to the repo, to
# .git/config, to a remote URL or to any file: it reaches GitHub as one extra request
# header per invocation, built at call time.
set -euo pipefail

OWNER="${1:-spoolcron}"
REPO="${2:-ceo-affairs}"
: "${GH_TOKEN:?export GH_TOKEN first (a PAT with repo scope)}"

cd "$(dirname "$0")"
api() { curl -sS -m 45 -H "AUTHORIZATION: Bearer ${GH_TOKEN}" -H "Accept: application/vnd.github+json" "$@"; }
root() { printf 'https://api.github.com/repos/%s/%s' "$OWNER" "$REPO"; }
auth_header() { printf 'http.extraheader=AUTHORIZATION: Basic %s' \
  "$(printf 'x-access-token:%s' "$GH_TOKEN" | base64 -w1 | tr -d '\n')"; }

echo "== 1. sanity =="
[ -s data.js ] || { echo "  data.js missing or empty; run: python3 fetch_data.py" >&2; exit 1; }
grep -q 'window.AFFAIRS' data.js || { echo "  data.js does not look generated" >&2; exit 1; }
python3 -c "import json;d=json.load(open('events.json'));print(f'  {len(d[\"events\"])} cases in events.json')"
if git grep -q -I -E 'ghp_[A-Za-z0-9]{20,}' -- . ; then
  echo "  refusing to publish: a token looks committed" >&2; exit 1
fi

echo "== 2. repository =="
code=$(api -o /dev/null -w '%{http_code}' "$(root)")
case "$code" in
  200) echo "  exists: ${OWNER}/${REPO}" ;;
  404)
    echo "  creating ${OWNER}/${REPO}"
    api -X POST https://api.github.com/user/repos -o /dev/null -w '  create: %{http_code}\n' \
      -d "{\"name\":\"${REPO}\",\"private\":false,\"has_issues\":false,\"has_wiki\":false,\"auto_init\":false}"
    ;;
  *) echo "  probe returned $code - check the token and owner name" >&2; exit 1 ;;
esac

echo "== 3. commit =="
git add -A
git diff --cached --stat
git commit -q -m "Update the page: $(date -u +%Y-%m-%d) data" 2>/dev/null || echo "  nothing new to commit"

echo "== 4. push =="
git -c "$(auth_header)" push --force https://github.com/"$OWNER"/"$REPO".git HEAD:main
echo "  pushed"

echo "== 5. pages =="
code=$(api -X POST "$(root)/pages" -o /dev/null -w '%{http_code}' \
        -d '{"source":{"branch":"main","path":"/"}}')
echo "  enable: $code"
if [ "$code" = "409" ]; then
  api -X PUT "$(root)/pages" -o /dev/null -w '  update: %{http_code}\n' \
    -d '{"source":{"branch":"main","path":"/"}}'
fi

for _ in $(seq 1 24); do
  st=$(api "$(root)/pages" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("status","?"))' 2>/dev/null || echo ?)
  [ "$st" = "built" ] && break
  sleep 5
done
url=$(api "$(root)/pages" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("html_url",""))' 2>/dev/null || echo)
echo
echo "  status: ${st:-unknown}"
echo "  url:    ${url:-https://${OWNER}.github.io/${REPO}/}"
