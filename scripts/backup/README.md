# Weekly encrypted backup — setup

`.github/workflows/backup.yml` runs every Sunday (and on-demand via `workflow_dispatch`):
dumps the production database through a read-only role, restores that dump into a
throwaway Postgres to verify it, packages it with the migrations + edge-function source,
encrypts it, uploads it to Cloudflare R2, and prunes old backups down to 13 weekly + 12
monthly + 5 annual copies (see `prune-retention.py`). On any failure it opens (or comments
on) a GitHub issue labeled `backup-failure`.

Already done (by Claude, in-session): the `kccp-attendance-backups` R2 bucket and the
`backup_reader` Postgres role (`SELECT`-only, `BYPASSRLS` so it can actually read past
RLS, no `SUPERUSER`/`CREATEDB`/`CREATEROLE`/`REPLICATION`) both exist. What's left below
requires either dashboard access Claude doesn't have, or a private key that must never
pass through an AI session or GitHub in plaintext — so these steps are yours to run.

## 1. Generate the age keypair (do this on your own machine, not in any AI session)

```sh
age-keygen -o backup-key.txt
```

This prints a line like `Public key: age1...` and writes both keys to `backup-key.txt`.

- **Public key** (`age1...`) → goes into the `BACKUP_AGE_PUBLIC_KEY` GitHub secret below.
  It can only encrypt; it does not need to be kept secret.
- **Private key** (the `AGE-SECRET-KEY-1...` line in `backup-key.txt`) → keep this
  somewhere durable and offline (password manager, printed and stored safely — whatever
  your normal secret-custody practice is). **Do not** upload it to GitHub as a secret, or
  paste it into any chat session, including this one. GitHub Actions only ever encrypts
  with the public key; nothing in CI should ever be able to decrypt a backup. If this key
  is lost, every backup taken with it becomes permanently unrecoverable — there is no
  recovery path, so treat the private key file as the one true irreplaceable artifact.

## 2. Create an R2 API token (Cloudflare dashboard)

1. Cloudflare dashboard → **R2** → **Manage R2 API Tokens**.
2. Create a token scoped to just the `kccp-attendance-backups` bucket, permission
   **Object Read & Write** (the prune step needs to delete old objects, not just write new
   ones).
3. Note down, from the token creation screen:
   - **Access Key ID**
   - **Secret Access Key** (shown once)
   - **Account ID** (shown on the same screen / on the R2 landing page) — used to build the
     endpoint URL `https://<account-id>.r2.cloudflarestorage.com`.

## 3. Build the database connection string

GitHub Actions runners are IPv4-only, and Supabase's direct connection host
(`db.loovulhchmmwagtvjnhc.supabase.co:5432`) is IPv6-only without the paid IPv4 add-on —
so this must go through the **Session Pooler**, not the direct host.

1. Supabase dashboard → **Project Settings** → **Database** → **Connection string** →
   select **Session pooler** (not Transaction — `pg_dump` needs session-level features).
2. Copy the connection string. It looks like:
   `postgresql://postgres.loovulhchmmwagtvjnhc:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:5432/postgres`
3. Replace `postgres.loovulhchmmwagtvjnhc` with `backup_reader.loovulhchmmwagtvjnhc`, and
   `[YOUR-PASSWORD]` with the `backup_reader` password Claude generated and displayed once
   in chat when it created the role (not repeated here — if you didn't save it, see
   **Rotating the DB password** below).

## 4. Add the GitHub repo secrets

Repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

| Secret | Value |
|---|---|
| `SUPABASE_BACKUP_DB_URL` | The connection string assembled in step 3 |
| `BACKUP_AGE_PUBLIC_KEY` | The `age1...` public key from step 1 |
| `R2_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` from step 2 |
| `R2_ACCESS_KEY_ID` | From step 2 |
| `R2_SECRET_ACCESS_KEY` | From step 2 |

## 5. First run

Actions tab → **Weekly Encrypted Backup** → **Run workflow**, once all five secrets above
are set. Confirms the whole chain (dump → verify-restore → encrypt → upload → prune)
before waiting for the next scheduled Sunday. If a secret is missing, the run fails fast
at the "Check required secrets are configured" step and names exactly which one.

## Rotating the DB password

If the `backup_reader` password is ever lost or needs rotating, run against the prod
project (via `mcp__Supabase__execute_sql` or the SQL editor):

```sql
ALTER ROLE backup_reader WITH PASSWORD '<new-strong-password>';
```

Then update `SUPABASE_BACKUP_DB_URL` (the password segment) in the GitHub secret to
match.

## Quarterly restore drill

The in-CI verification step only proves the dump restores cleanly — it never exercises
your actual private key. Periodically (recommend quarterly) prove the real, full chain
end to end on your own machine:

```sh
# Download the latest backup from the R2 bucket (dashboard, or aws s3 cp with the
# R2_* credentials from step 2), then:
age -d -i backup-key.txt -o backup.tar backup-2026-07-19.tar.age
tar xf backup.tar        # -> db.dump, schema-source.tar.gz
pg_restore --list db.dump               # sanity-check contents without restoring
createdb restore_drill
pg_restore --no-owner --no-privileges -d restore_drill db.dump
```

If this ever fails, the automated pipeline's in-CI verification wouldn't have caught it —
that's exactly what makes the manual drill worth doing.
