#!/bin/sh
# Ships the camera worker from a commit to valley-big-mac and restarts it with BUSTRACKR_COMMIT set.
# Usage: scripts/deploy-worker.sh [ref]   (default origin/main)
set -eu
ref=${1:-origin/main}
host=${BUSTRACKR_HOST:-valley-big-mac}
commit=$(git rev-parse --verify "$ref^{commit}")
files=$(git ls-tree --name-only "$commit" server/ | grep -E '\.mjs$' | grep -v '\.test\.mjs$')
echo "Deploying worker $commit to $host"
git archive --format=tar "$commit" $files | ssh "$host" 'cat > /tmp/bustrackr-worker.tar'
ssh "$host" "COMMIT=$commit sh -s" <<'REMOTE'
set -eu
cd "${BUSTRACKR_ROOT:-$HOME/apps/bustrackr}"
# Code hot-copied ahead of a merge would silently disappear; make the operator merge it first.
unknown=$(ls server/*.mjs | grep -v '\.test\.mjs$' | grep -vxF "$(tar -tf /tmp/bustrackr-worker.tar)" || true)
if [ -n "$unknown" ]; then
  rm /tmp/bustrackr-worker.tar
  echo "Live worker has files missing from $COMMIT: $unknown. Merge that code first; nothing changed." >&2
  exit 1
fi
stamp=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p backups
tar -czf "backups/server-$stamp.tgz" server .env.server
tar -xf /tmp/bustrackr-worker.tar
rm /tmp/bustrackr-worker.tar
if grep -q '^BUSTRACKR_COMMIT=' .env.server; then
  sed -i '' "s/^BUSTRACKR_COMMIT=.*/BUSTRACKR_COMMIT=$COMMIT/" .env.server
else
  printf 'BUSTRACKR_COMMIT=%s\n' "$COMMIT" >> .env.server
fi
launchctl kickstart -k "user/$(id -u)/com.valley.bustrackr"
for _ in $(seq 30); do
  if health=$(curl -sf http://127.0.0.1:18787/api/health); then
    echo "$health"; echo "Previous server and env saved to backups/server-$stamp.tgz"; exit 0
  fi
  sleep 1
done
echo "Worker did not answer /api/health; restore with: tar -xzf backups/server-$stamp.tgz" >&2
exit 1
REMOTE
