#!/bin/sh
# Entrypoint: fix ownership of the mounted data/log volumes (named volumes are
# created root-owned on first mount) and then drop to the non-root `eart` user.
set -e

chown -R eart:eart /data /app/logs 2>/dev/null || true

exec su-exec eart "$@"
