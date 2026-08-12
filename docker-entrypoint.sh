#!/bin/sh
# Entrypoint: ensure writable dirs for non-root user (home for promptfoo etc, data volume)
set -e

mkdir -p /home/eart/.promptfoo /data/.promptfoo /data/reports /app/logs 2>/dev/null || true
chown -R eart:eart /home/eart /data /app/logs 2>/dev/null || true

exec su-exec eart "$@"
