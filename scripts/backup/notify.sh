#!/usr/bin/env bash
# Final step of the weekly backup workflow: tell the edge function that the new
# current.* backup set is live, so it can email / 카카오톡 the recipients registered
# in-app (Admins tab → 전체 백업 → 백업 완료 알림).
#
# Auth is config.backup_notify_token — minted by the backup_notifications migration and
# read here over the same read-only backup_reader connection the dump already uses
# (libpq PG* env vars from backup.yml), so this step needs NO extra GitHub secret.
#
# Delivery is best-effort by design: the backup itself already succeeded, so a notify
# hiccup must not fail the run (which would misfire the backup-failure issue machinery).
# Problems surface as workflow warnings instead.
set -uo pipefail

NOTIFY_URL="${NOTIFY_URL:-https://loovulhchmmwagtvjnhc.supabase.co/functions/v1/attendance-api/api/admin/db-backup/notify}"

token=$(psql -X -Atc "SELECT backup_notify_token FROM config WHERE id = 1" 2>/dev/null)
if [ -z "$token" ]; then
  echo "::warning::backup_notify_token not found (backup_notifications migration not applied yet?) — skipping notifications."
  exit 0
fi

response=$(curl -sS -m 30 -w $'\n%{http_code}' -X POST "$NOTIFY_URL" \
  -H "X-Backup-Token: $token" \
  -H "Content-Type: application/json" \
  -d '{"status":"success"}')
status=${response##*$'\n'}
body=${response%$'\n'*}
if [ "$status" != "200" ]; then
  echo "::warning::Backup notification call failed (HTTP ${status:-?}): $body"
  exit 0
fi
echo "Notification result: $body"
