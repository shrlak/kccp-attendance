#!/usr/bin/env bash
# Weekly encrypted backup: dump -> restore-verify -> encrypt -> upload.
#
# Invoked by .github/workflows/backup.yml, which sets:
#   PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD/PGSSLMODE
#                    libpq settings for the read-only production connection
#   VERIFY_DB_URL    connection string for the throwaway verification Postgres (service container)
#   AGE_PUBLIC_KEY  age recipient public key (age1...)
#   R2_ENDPOINT     https://<account-id>.r2.cloudflarestorage.com
#   R2_BUCKET       target bucket name
#   PARTITION       which 부(department) this run backs up: youth (default) or adult
# AWS credentials for the R2 upload come from the standard AWS_ACCESS_KEY_ID /
# AWS_SECRET_ACCESS_KEY / AWS_DEFAULT_REGION env vars the aws CLI already reads.
#
# ── 두 개의 백업 줄기 ─────────────────────────────────────────────────────────────
# 두 부서는 **스키마가 다르다** (마이그레이션 20260807): 대학·청년부는 public, 장년부는 adult.
# 그래서 백업도 pg_dump --schema 한 줄로 완전히 갈린다 — 어느 쪽 파일에도 다른 부서의 사람은
# 한 명도 들어 있지 않다. 각자 자기 부서에서 데이터가 바뀔 때만 깨어나고(엣지 함수의 청구권이
# 부서별로 따로 있다), 결과도 서로 다른 R2 접두사에 쌓이며, 각 패널은 자기 접두사만 보고
# 자기 것만 복원한다 (복원은 그 스키마를 TRUNCATE 하고 다시 넣는다).
#
#   PARTITION=youth  →  backups/         public 스키마 (대학·청년부 + 공용 표)
#   PARTITION=adult  →  backups/adult/   adult 스키마 (장년부 전부: 명단·기기·출석·권한·설정·기록)
#
# The dump is plain SQL (--data-only --column-inserts), not pg_dump's --format=custom,
# because the in-app restore path (supabase/functions/attendance-api) runs in a Deno edge
# function that can't shell out to pg_restore — it loads plain SQL text straight through a
# Postgres driver instead. db.sql and schema-source.tar.gz are encrypted as two separate
# .age files rather than nested in one outer tar, so that restore path never has to parse
# a tar archive either. Stable `current.*` object names make every successful run replace
# the previous backup instead of accumulating dated copies.
set -euo pipefail

PARTITION="${PARTITION:-youth}"
case "$PARTITION" in
  youth) R2_PREFIX="backups";       DUMP_SCHEMA="public" ;;
  adult) R2_PREFIX="backups/adult"; DUMP_SCHEMA="adult"  ;;
  *) echo "::error::Unknown PARTITION '$PARTITION' (expected youth or adult)"; exit 1 ;;
esac
echo "Backing up partition: $PARTITION (schema $DUMP_SCHEMA) -> s3://\$R2_BUCKET/$R2_PREFIX/"

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

echo "== 1/6 Dumping the $DUMP_SCHEMA schema, data only =="
pg_dump \
  --schema="$DUMP_SCHEMA" \
  --data-only \
  --column-inserts \
  --no-owner \
  --no-privileges \
  --file="$WORKDIR/db.sql"

echo "== 2/6 Building schema in throwaway database (replays the real migrations, so this also proves they're self-sufficient) =="
for f in supabase/migrations/*.sql; do
  psql "$VERIFY_DB_URL" -v ON_ERROR_STOP=1 -f "$f" > /dev/null
done

echo "== 3/6 Clearing seeded data and loading the dump into the throwaway database =="
# Some migrations intentionally seed production rows. The real in-app restore truncates
# every table in the 부's schema before loading a snapshot, so verification must start from
# that same state or seeded rows can collide with their copies in the data-only dump.
verify_tables=$(psql "$VERIFY_DB_URL" -X -v ON_ERROR_STOP=1 -Atc "
  SELECT string_agg(format('%I.%I', table_schema, table_name), ', ' ORDER BY table_name)
  FROM information_schema.tables
  WHERE table_schema = '$DUMP_SCHEMA' AND table_type = 'BASE TABLE';
")
if [ -z "$verify_tables" ]; then
  echo "::error::No $DUMP_SCHEMA tables found in the verification database after migrations."
  exit 1
fi
psql "$VERIFY_DB_URL" -X -v ON_ERROR_STOP=1 \
  -c "TRUNCATE TABLE $verify_tables RESTART IDENTITY CASCADE" > /dev/null
psql "$VERIFY_DB_URL" --single-transaction -v ON_ERROR_STOP=1 -f "$WORKDIR/db.sql" > /dev/null

# Counts every base table in this 부's schema via one query on each side (source vs.
# restored) so a
# newly added table is picked up automatically instead of silently skipped by a stale
# hardcoded table list. query_to_xml is a built-in SQL/XML function, no extension needed.
count_query() {
  psql "$@" -X -Atc "
    SELECT table_name,
           (xpath('/row/c/text()',
             query_to_xml(format('select count(*) as c from %I.%I', '$DUMP_SCHEMA', table_name), false, true, '')
           ))[1]::text::bigint
    FROM information_schema.tables
    WHERE table_schema = '$DUMP_SCHEMA' AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  "
}

echo "== 4/6 Comparing row counts (backup file vs. restored) =="
count_query "$VERIFY_DB_URL" > "$WORKDIR/counts-restored.txt"
# Counted from the dump itself, not from a second live query against production. What
# this gate has to prove is that the file about to be encrypted restores completely —
# and production keeps taking check-ins while the job runs, so a live-vs-restored diff
# fails whenever a row lands between the dump and the comparison (exactly how run #21
# failed: one attendance_log + one audit_log row arrived eight seconds after the dump,
# and the identical re-run two minutes later passed). --column-inserts writes one
# `INSERT INTO public.<table> …` statement per row, so counting them is an exact count
# of what the backup carries; tables the dump has no rows for count 0.
while IFS='|' read -r tbl _; do
  rows=$(grep -cE "^INSERT INTO ${DUMP_SCHEMA}\.\"?${tbl}\"? " "$WORKDIR/db.sql" || true)
  printf '%s|%s\n' "$tbl" "$rows"
done < "$WORKDIR/counts-restored.txt" > "$WORKDIR/counts-dump.txt"
if ! diff -u "$WORKDIR/counts-dump.txt" "$WORKDIR/counts-restored.txt"; then
  echo "::error::Row counts differ between the backup file and the restored copy — see diff above."
  exit 1
fi
echo "Every row in the backup restored:"
cat "$WORKDIR/counts-restored.txt"

# Row-level drift against live production is expected (writes land during the run) and
# is reported, not failed. An entire populated table missing from the dump is a
# different thing — that's a lost table, not drift — so that still fails the run.
# 두 줄기 모두 자기 스키마만 놓고 비교하므로 규칙이 하나다.
count_query > "$WORKDIR/counts-source.txt"
if ! diff -u "$WORKDIR/counts-source.txt" "$WORKDIR/counts-dump.txt" > "$WORKDIR/drift.diff"; then
  echo "::notice::Production moved on while the backup ran — the dump is a consistent snapshot from before those writes."
  cat "$WORKDIR/drift.diff"
fi
empty_in_dump=$(join -t'|' "$WORKDIR/counts-source.txt" "$WORKDIR/counts-dump.txt" \
  | awk -F'|' '$2 > 0 && $3 == 0 {print $1}')
if [ -n "$empty_in_dump" ]; then
  echo "::error::These tables have rows in production but none in the dump: $(echo "$empty_in_dump" | tr '\n' ' ')"
  exit 1
fi

echo "== 5/6 Encrypting =="
tar czf "$WORKDIR/schema-source.tar.gz" -C supabase migrations functions
age -r "$AGE_PUBLIC_KEY" -o "$WORKDIR/current.sql.age" "$WORKDIR/db.sql"
age -r "$AGE_PUBLIC_KEY" -o "$WORKDIR/current.schema.tar.gz.age" "$WORKDIR/schema-source.tar.gz"
sha256sum "$WORKDIR/current.sql.age" | awk '{print $1}' > "$WORKDIR/current.sql.age.sha256"
sha256sum "$WORKDIR/current.schema.tar.gz.age" | awk '{print $1}' > "$WORKDIR/current.schema.tar.gz.age.sha256"
# Scrub plaintext as soon as the ciphertext exists — only the .age files and their
# checksums are meant to leave this machine.
rm -f "$WORKDIR/db.sql" "$WORKDIR/schema-source.tar.gz"

echo "== 6/6 Uploading to R2 =="
for f in "$WORKDIR"/current.sql.age "$WORKDIR"/current.sql.age.sha256 \
         "$WORKDIR"/current.schema.tar.gz.age "$WORKDIR"/current.schema.tar.gz.age.sha256; do
  aws --endpoint-url "$R2_ENDPOINT" s3 cp "$f" "s3://$R2_BUCKET/$R2_PREFIX/$(basename "$f")"
done

echo "Backup complete: $R2_PREFIX/current.sql.age"
