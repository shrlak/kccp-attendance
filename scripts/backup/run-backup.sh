#!/usr/bin/env bash
# Weekly encrypted backup: dump -> restore-verify -> encrypt -> upload.
#
# Invoked by .github/workflows/backup.yml, which sets:
#   DB_URL          postgresql://backup_reader.<ref>:<password>@<pooler-host>:5432/postgres
#   VERIFY_DB_URL   connection string for the throwaway verification Postgres (service container)
#   AGE_PUBLIC_KEY  age recipient public key (age1...)
#   R2_ENDPOINT     https://<account-id>.r2.cloudflarestorage.com
#   R2_BUCKET       target bucket name
# AWS credentials for the R2 upload come from the standard AWS_ACCESS_KEY_ID /
# AWS_SECRET_ACCESS_KEY / AWS_DEFAULT_REGION env vars the aws CLI already reads.
#
# The dump is plain SQL (--data-only --column-inserts), not pg_dump's --format=custom,
# because the in-app restore path (supabase/functions/attendance-api) runs in a Deno edge
# function that can't shell out to pg_restore — it loads plain SQL text straight through a
# Postgres driver instead. db.sql and schema-source.tar.gz are encrypted as two separate
# .age files rather than nested in one outer tar, so that restore path never has to parse
# a tar archive either — it only ever touches backup-$DATE.sql.age.
set -euo pipefail

DATE=$(date -u +%F)
WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

echo "== 1/6 Dumping database (data only) =="
pg_dump "$DB_URL" --data-only --column-inserts --no-owner --no-privileges --file="$WORKDIR/db.sql"

echo "== 2/6 Building schema in throwaway database (replays the real migrations, so this also proves they're self-sufficient) =="
for f in supabase/migrations/*.sql; do
  psql "$VERIFY_DB_URL" -v ON_ERROR_STOP=1 -f "$f" > /dev/null
done

echo "== 3/6 Loading the dump into the throwaway database =="
psql "$VERIFY_DB_URL" --single-transaction -v ON_ERROR_STOP=1 -f "$WORKDIR/db.sql" > /dev/null

# Counts every public base table via one query on each side (source vs. restored) so a
# newly added table is picked up automatically instead of silently skipped by a stale
# hardcoded table list. query_to_xml is a built-in SQL/XML function, no extension needed.
count_query() {
  psql "$1" -Atc "
    SELECT table_name,
           (xpath('/row/c/text()',
             query_to_xml(format('select count(*) as c from %I.%I', 'public', table_name), false, true, '')
           ))[1]::text::bigint
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  "
}

echo "== 4/6 Comparing row counts (source vs. restored) =="
count_query "$DB_URL" > "$WORKDIR/counts-source.txt"
count_query "$VERIFY_DB_URL" > "$WORKDIR/counts-restored.txt"
if ! diff -u "$WORKDIR/counts-source.txt" "$WORKDIR/counts-restored.txt"; then
  echo "::error::Row counts differ between source and restored backup — see diff above."
  exit 1
fi
echo "Row counts match:"
cat "$WORKDIR/counts-source.txt"

echo "== 5/6 Encrypting =="
tar czf "$WORKDIR/schema-source.tar.gz" -C supabase migrations functions
age -r "$AGE_PUBLIC_KEY" -o "$WORKDIR/backup-$DATE.sql.age" "$WORKDIR/db.sql"
age -r "$AGE_PUBLIC_KEY" -o "$WORKDIR/backup-$DATE.schema.tar.gz.age" "$WORKDIR/schema-source.tar.gz"
sha256sum "$WORKDIR/backup-$DATE.sql.age" | awk '{print $1}' > "$WORKDIR/backup-$DATE.sql.age.sha256"
sha256sum "$WORKDIR/backup-$DATE.schema.tar.gz.age" | awk '{print $1}' > "$WORKDIR/backup-$DATE.schema.tar.gz.age.sha256"
# Scrub plaintext as soon as the ciphertext exists — only the .age files and their
# checksums are meant to leave this machine.
rm -f "$WORKDIR/db.sql" "$WORKDIR/schema-source.tar.gz"

echo "== 6/6 Uploading to R2 =="
for f in "$WORKDIR"/backup-$DATE.sql.age "$WORKDIR"/backup-$DATE.sql.age.sha256 \
         "$WORKDIR"/backup-$DATE.schema.tar.gz.age "$WORKDIR"/backup-$DATE.schema.tar.gz.age.sha256; do
  aws --endpoint-url "$R2_ENDPOINT" s3 cp "$f" "s3://$R2_BUCKET/backups/$(basename "$f")"
done

echo "Backup complete: backups/backup-$DATE.sql.age"
