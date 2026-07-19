#!/bin/sh
set -e

mkdir -p /data
chown -R nextjs:nodejs /data 2>/dev/null || true

if su-exec nextjs:nodejs sh -c 'touch /data/.write-test && rm -f /data/.write-test'; then
  exec su-exec nextjs:nodejs "$@"
fi

echo "Warning: /data is not writable by nextjs; running as root so records can persist." >&2
exec "$@"
