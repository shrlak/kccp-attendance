#!/usr/bin/env python3
"""Applies the retention policy to encrypted backups in R2 and deletes what falls outside it.

Run after a successful weekly upload (never before one — if this week's backup didn't
land, we don't want to be thinning out the older copies that are still all we have).

Policy: keep the most recent 13 weekly backups, plus the most recent backup of each of
the last 12 distinct months (for backups already aged out of the weekly window), plus the
most recent backup of each of the last 5 distinct years (for backups aged out of both).
The tiers are evaluated in that order and don't overlap in what they keep, but a date
that would qualify for more than one tier only needs to win one to survive.

Each backup date is two encrypted files — backup-DATE.sql.age (the restorable data dump)
and backup-DATE.schema.tar.gz.age (migrations + edge-function source, archival only) —
plus a .sha256 checksum next to each. All four share one fate: a date is either fully kept
or fully deleted, decided once at the date level and then applied to every file under it.

Env vars (all set by .github/workflows/backup.yml):
  R2_ENDPOINT   https://<account-id>.r2.cloudflarestorage.com
  R2_BUCKET     target bucket name
AWS credentials come from the standard AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY /
AWS_DEFAULT_REGION env vars the aws CLI already reads.
"""
import datetime
import json
import os
import re
import subprocess

BUCKET = os.environ["R2_BUCKET"]
ENDPOINT = os.environ["R2_ENDPOINT"]
PREFIX = "backups/"
KEY_RE = re.compile(r"^backups/backup-(\d{4}-\d{2}-\d{2})\.(sql\.age|schema\.tar\.gz\.age)$")

WEEKLY_KEEP = 13
MONTHLY_KEEP = 12
ANNUAL_KEEP = 5

WARN_THRESHOLD_GB = 8.0  # R2 free tier is 10 GB/month storage


def aws_json(*args):
    out = subprocess.run(
        ["aws", "--endpoint-url", ENDPOINT, *args, "--output", "json"],
        check=True, capture_output=True, text=True,
    ).stdout
    return json.loads(out) if out.strip() else {}


def list_backups():
    """Returns {date: [(key, size), ...]} — every .sql.age / .schema.tar.gz.age object
    grouped under the date in its filename. .sha256 companions aren't listed here (they
    don't match KEY_RE); they're derived by appending ".sha256" wherever needed below."""
    resp = aws_json("s3api", "list-objects-v2", "--bucket", BUCKET, "--prefix", PREFIX)
    by_date = {}
    for obj in resp.get("Contents", []):
        m = KEY_RE.match(obj["Key"])
        if not m:
            continue
        d = datetime.date.fromisoformat(m.group(1))
        by_date.setdefault(d, []).append((obj["Key"], obj["Size"]))
    return by_date


def first_per_group(dates_desc, key_fn, n):
    """Most-recent date per distinct key_fn(date), capped at the first n distinct groups.
    dates_desc must already be sorted newest-first."""
    seen = {}
    for d in dates_desc:
        k = key_fn(d)
        if k not in seen and len(seen) < n:
            seen[k] = d
    return set(seen.values())


def keep_set(dates_desc):
    keep = set(dates_desc[:WEEKLY_KEEP])

    remaining = [d for d in dates_desc if d not in keep]
    keep |= first_per_group(remaining, lambda d: (d.year, d.month), MONTHLY_KEEP)

    # The annual tier exists to reach further back in time than weekly/monthly do, not to
    # add a second survivor next to a date those tiers already kept — so its candidate
    # pool drops every date from a year that already has *any* weekly/monthly coverage,
    # not just the exact dates already kept. Otherwise a year straddling the monthly
    # window's edge (almost always the current year) hands the annual tier a leftover
    # date from the very month the monthly tier just picked a survivor from.
    covered_years = {d.year for d in keep}
    remaining = [d for d in dates_desc if d.year not in covered_years]
    keep |= first_per_group(remaining, lambda d: d.year, ANNUAL_KEEP)

    return keep


def main():
    by_date = list_backups()
    if not by_date:
        print(f"No backups found under {PREFIX}")
        return

    dates_desc = sorted(by_date.keys(), reverse=True)
    keep = keep_set(dates_desc)

    total_size = sum(size for items in by_date.values() for _, size in items)
    kept_size = sum(size for d, items in by_date.items() if d in keep for _, size in items)
    deleted_keys = []

    summary_rows = []
    for d in dates_desc:
        is_kept = d in keep
        for key, size in sorted(by_date[d]):
            summary_rows.append(f"| {d} | {key} | {size:,} B | {'kept' if is_kept else 'deleted'} |")
        if not is_kept:
            for key, _ in by_date[d]:
                deleted_keys.append(key)
                deleted_keys.append(key + ".sha256")

    for key in deleted_keys:
        # check=False: the .sha256 companion of an already-deleted-in-a-prior-run object
        # (or an object that never had one) shouldn't fail the whole prune step.
        subprocess.run(
            ["aws", "--endpoint-url", ENDPOINT, "s3", "rm", f"s3://{BUCKET}/{key}"],
            check=False,
        )

    deleted_dates = len(dates_desc) - len(keep)
    print(f"Backups: {len(dates_desc)} total, {len(keep)} kept, {deleted_dates} deleted.")
    print(f"Storage: {total_size / 1e9:.2f} GB total -> {kept_size / 1e9:.2f} GB after pruning.")

    step_summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if step_summary:
        with open(step_summary, "a") as f:
            f.write("## Backup retention\n\n")
            f.write("| Date | Key | Size | Status |\n|---|---|---|---|\n")
            f.write("\n".join(summary_rows) + "\n\n")
            f.write(f"**Bucket size after pruning: {kept_size / 1e9:.2f} GB**\n")

    if kept_size / 1e9 > WARN_THRESHOLD_GB:
        print(f"::warning::R2 backup bucket is {kept_size / 1e9:.2f} GB, over the "
              f"{WARN_THRESHOLD_GB} GB watch threshold (R2 free tier is 10 GB/month storage).")


if __name__ == "__main__":
    main()
