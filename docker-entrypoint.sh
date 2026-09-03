#!/bin/sh
set -e

# Shared secret for the API <-> game server hop. When the operator does not
# provide one, generate an ephemeral token per boot (both processes live in
# this container, so it only has to match internally).
if [ -z "${TOKEN_AUTH}" ]; then
    TOKEN_AUTH="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
    export TOKEN_AUTH
    echo "[entrypoint] WARNING: TOKEN_AUTH not set; generated an ephemeral token for this boot."
fi

exec node /app/api/dist/unified.js --serve
