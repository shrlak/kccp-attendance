#!/usr/bin/env bash
# Weekly encrypted backup: dump -> restore-verify -> package -> encrypt -> upload.
#
# Invoked by .github/workflows/backup.yml, which sets:
#   DB_URL          postgresql://backup_reader.<ref>:<password>@<pooler-host>:5432/postgres
#   VERIFY_DB_URL   connection string for the throwaway verification Postgres (service container)
#   AGE_PUBLIC_KEY  age recipient public key (age1...)
#   R2_ENDPOINT     https://<account-id>.r2.cloudflarestorage.com
#   R2_BUCKET       target bucket name
# AWS credentials for the R2 upload come from the standard AWS_ACCESS_KEY_ID /
# AWS_SECRET_ACCESS_KEY / AWS_DEFAULT_REGION env vars the aws CLI already reads.
set -euo pipefail

DATE=$(date -u +%F)
WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

echo "== 1/6 Dumping database =="
pg_dump "$DB_URL" --no-owner --no-privileges --format=custom --file="$WORKDIR/db.dump"

echo "== 2/6 Restoring dump into throwaway database for verification =="
pg_restore --no-owner --no-privileges --clean --if-exists \
  -d "$VERIFY_DB_URL" "$WORKDIR/db.dump"

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

echo "== 3/6 Comparing row counts (source vs. restored) =="
count_query "$DB_URL" > "$WORKDIR/counts-source.txt"
count_query "$VERIFY_DB_URL" > "$WORKDIR/counts-restored.txt"
if ! diff -u "$WORKDIR/counts-source.txt" "$WORKDIR/counts-restored.txt"; then
  echo "::error::Row counts differ between source and restored backup — see diff above."
  exit 1
fi
echo "Row counts match:"
cat "$WORKDIR/counts-source.txt"

echo "== 4/6 Packaging dump + schema source =="
tar czf "$WORKDIR/schema-source.tar.gz" -C supabase migrations functions
tar cf "$WORKDIR/backup-$DATE.tar" -C "$WORKDIR" db.dump schema-source.tar.gz

echo "== 5/6 Encrypting =="
age -r "$AGE_PUBLIC_KEY" -o "$WORKDIR/backup-$DATE.tar.age" "$WORKDIR/backup-$DATE.tar"
sha256sum "$WORKDIR/backup-$DATE.tar.age" | awk '{print $1}' > "$WORKDIR/backup-$DATE.tar.age.sha256"
# Scrub plaintext as soon as the ciphertext exists — only backup-$DATE.tar.age and its
# checksum are meant to leave this machine.
rm -f "$WORKDIR/db.dump" "$WORKDIR/schema-source.tar.gz" "$WORKDIR/backup-$DATE.tar"

echo "== 6/6 Uploading to R2 =="
aws --endpoint-url "$R2_ENDPOINT" s3 cp "$WORKDIR/backup-$DATE.tar.age" "s3://$R2_BUCKET/backups/backup-$DATE.tar.age"
aws --endpoint-url "$R2_ENDPOINT" s3 cp "$WORKDIR/backup-$DATE.tar.age.sha256" "s3://$R2_BUCKET/backups/backup-$DATE.tar.age.sha256"

echo "Backup complete: backups/backup-$DATE.tar.age"
