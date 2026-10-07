#!/usr/bin/env bash
#
# Deploy the site to the Namecheap host.
#
# The host runs no git checkout and no CI, so deploying is "put the files there".
# rsync makes that repeatable and cheap: run it again after any edit and only what
# changed is transferred.
#
#   ./deploy.sh              # deploy
#   ./deploy.sh --dry-run    # show what would change, change nothing
#
# Override the defaults with environment variables if the account ever moves:
#
#   SUAS_HOST=usydbojn@162.0.229.42
#   SUAS_PORT=21098
#   SUAS_KEY=~/.ssh/suas_deploy
#
# What it syncs, and why it is split in two:
#
#   * the site itself -- pages, includes/, assets/ -- is mirrored exactly, so a
#     file deleted here is deleted there.
#   * photos/ is only ever added to. It is the one directory the server writes to
#     at runtime, so mirroring it would delete every photograph people have sent
#     in since the last deploy. Keeping photos out of assets/ is what makes that
#     distinction possible.

set -euo pipefail

HOST="${SUAS_HOST:-usydbojn@162.0.229.42}"
PORT="${SUAS_PORT:-21098}"
KEY="${SUAS_KEY:-$HOME/.ssh/suas_deploy}"
TARGET="${SUAS_TARGET:-public_html/}"
SITE_URL="${SUAS_URL:-https://usydastro.org/}"

cd "$(dirname "$0")"

if [[ ! -f "$KEY" ]]; then
  cat >&2 <<EOF
No deploy key at $KEY.

Create one, then authorise it on the server:

  ssh-keygen -t ed25519 -f "$KEY" -N ''
  cat "$KEY.pub" | ssh -p $PORT $HOST 'mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys'
EOF
  exit 1
fi

dry_run=()
if [[ "${1:-}" == "--dry-run" ]]; then
  dry_run=(--dry-run --itemize-changes)
  echo "Dry run: nothing will be written."
fi

remote() { ssh -p "$PORT" -i "$KEY" -o BatchMode=yes "$HOST" "$@"; }

RSYNC=(
  rsync
  --archive
  --human-readable
  --rsh="ssh -p $PORT -i $KEY -o BatchMode=yes"
)

echo "Deploying to $HOST:$TARGET"

# The pages and the dotfiles. Named rather than globbed on purpose: a new file in
# the repository should be added here deliberately, not swept up by accident.
"${RSYNC[@]}" "${dry_run[@]}" \
  index.php about.php home.php upload.php admin.php moderate.php \
  .htaccess .user.ini \
  "$HOST:$TARGET"

# Code and static assets, mirrored.
"${RSYNC[@]}" "${dry_run[@]}" --delete assets/ "$HOST:${TARGET}assets/"
"${RSYNC[@]}" "${dry_run[@]}" --delete includes/ "$HOST:${TARGET}includes/"

# Photographs. --ignore-existing ships the photographs that come with the
# repository and leaves everything the gallery has gained since alone.
"${RSYNC[@]}" "${dry_run[@]}" --ignore-existing photos/ "$HOST:${TARGET}photos/"

if [[ ${#dry_run[@]} -eq 0 ]]; then
  # Pages this site no longer has. rsync mirrors only the directories above, so a
  # page retired from the repository would otherwise keep answering on the server.
  remote "rm -f ${TARGET}submit.php"

  remote "find ${TARGET}photos -type d -exec chmod 755 {} +; find ${TARGET}photos -type f -exec chmod 644 {} +"

  echo
  echo -n "Checking $SITE_URL ... "
  if curl -sS -o /dev/null --max-time 20 -w "HTTP %{http_code}\n" "$SITE_URL"; then
    :
  else
    echo "the site did not answer; the files are in place, so check the server logs" >&2
  fi
fi
